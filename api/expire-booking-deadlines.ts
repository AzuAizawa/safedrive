import { createClient } from "@supabase/supabase-js";
import {
  fetchNoShowGraceMinutes,
  runBookingCompletionSideEffects,
} from "../server/bookingCompletion.js";
import {
  createManualRefundReview,
  getCancellationRefundPlan,
  getVehicleLabel,
  type RefundableBooking,
} from "../server/cancellationRefundPlan.js";
import { sendUserNotificationEmail } from "../server/email.js";
import { processAutomaticPayoutForBooking } from "../server/payoutAutomation.js";
import { vehicleGuardMessage } from "../server/vehicleCompliance.js";


export const config = {
  runtime: "edge",
};

const DEFAULT_LISTER_COMPLETION_TIMEOUT_HOURS = 18;
const DEFAULT_BALANCE_REMINDER_HOURS_BEFORE = 6;

type DeadlineBooking = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: "pending" | "confirmed" | "awaiting_payment";
};

type UnpaidBooking = DeadlineBooking & { car_id: string };

// Only the fields the balance-deadline expiry/reminder pass needs, on top of
// what RefundableBooking already carries for the refund-plan calculation.
type BalanceDeadlineBooking = RefundableBooking & {
  car_id: string;
  balance_deadline: string | null;
  balance_reminder_sent_at: string | null;
};

type PendingEarlyReturn = {
  id: string;
  renter_id: string;
  owner_id: string;
  requested_end_date: string;
  current_end_date: string;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin environment variables");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const isAuthorizedCronRequest = (req: Request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error("CRON_SECRET must be configured before deadline expiry can run");
  }

  const authorization = req.headers.get("Authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  return bearerToken === cronSecret || req.headers.get("x-cron-secret") === cronSecret;
};

const notifyParticipants = async (
  supabase: ReturnType<typeof getSupabaseAdmin>,
  booking: DeadlineBooking,
  state: "owner_response_expired" | "payment_expired",
  baseOrigin: string,
) => {
  const isOwnerResponseExpiry = state === "owner_response_expired";
  const renterTitle = isOwnerResponseExpiry ? "Booking Request Expired" : "Booking Payment Expired";
  const renterMessage = isOwnerResponseExpiry
    ? "The lister did not respond before the 24-hour review window closed, so your request was released."
    : "The reservation payment deadline passed before PayMongo confirmed payment, so the booking was cancelled. This affects your completion rate.";
  const ownerTitle = isOwnerResponseExpiry ? "Booking Request Released" : "Booking Payment Expired";
  const ownerMessage = isOwnerResponseExpiry
    ? "A pending booking request was released because the 24-hour response window passed."
    : "A renter did not complete reservation payment before the deadline, so the booking was cancelled.";

  await supabase.from("notifications").insert([
    { user_id: booking.renter_id, title: renterTitle, message: renterMessage, type: "warning", link: "/my-bookings" },
    { user_id: booking.owner_id, title: ownerTitle, message: ownerMessage, type: "warning", link: "/lister-bookings" },
  ]);
  await sendUserNotificationEmail(supabase, {
    userId: booking.renter_id,
    title: renterTitle,
    message: renterMessage,
    link: "/my-bookings",
    baseOrigin,
    eventKey: `${state}-renter:${booking.id}`,
  });
  await sendUserNotificationEmail(supabase, {
    userId: booking.owner_id,
    title: ownerTitle,
    message: ownerMessage,
    link: "/lister-bookings",
    baseOrigin,
    eventKey: `${state}-owner:${booking.id}`,
  });
  await supabase.from("audit_log").insert({
    user_id: null,
    action: state,
    entity_type: "booking",
    entity_id: booking.id,
    details: { previous_status: booking.status, automated: true },
  });
};

export default async function handler(req: Request) {
  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    if (!isAuthorizedCronRequest(req)) {
      return jsonResponse({ error: "Unauthorized deadline expiry run" }, 401);
    }

    const supabase = getSupabaseAdmin();
    const { error: complianceError } = await supabase.rpc("flag_vehicles_needing_renewal");
    if (complianceError) throw complianceError;
    const baseOrigin = new URL(req.url).origin;
    const now = new Date().toISOString();
    const { data: unansweredBookings, error: unansweredError } = await supabase
      .from("bookings")
      .select("id, renter_id, owner_id, status")
      .eq("compliance_hold", false)
      .eq("status", "pending")
      .not("owner_response_deadline", "is", null)
      .lte("owner_response_deadline", now)
      .limit(200);

    if (unansweredError) throw unansweredError;

    const { data: unpaidBookings, error: unpaidError } = await supabase
      .from("bookings")
      .select("id, renter_id, owner_id, car_id, status")
      .eq("compliance_hold", false)
      .in("status", ["confirmed", "awaiting_payment"])
      .not("payment_deadline", "is", null)
      .lte("payment_deadline", now)
      .limit(200);

    if (unpaidError) throw unpaidError;

    let ownerResponseExpired = 0;
    let paymentExpired = 0;

    for (const booking of (unansweredBookings ?? []) as DeadlineBooking[]) {
      const { data: updated, error } = await supabase
        .from("bookings")
        .update({ status: "rejected", owner_response_deadline: null })
        .eq("id", booking.id)
        .eq("compliance_hold", false)
        .eq("status", "pending")
        .lte("owner_response_deadline", now)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!updated) continue;

      await notifyParticipants(supabase, booking, "owner_response_expired", baseOrigin);
      ownerResponseExpired += 1;
    }

    for (const booking of (unpaidBookings ?? []) as UnpaidBooking[]) {
      const { data: updated, error } = await supabase
        .from("bookings")
        .update({ status: "cancelled", payment_deadline: null })
        .eq("id", booking.id)
        .eq("compliance_hold", false)
        .in("status", ["confirmed", "awaiting_payment"])
        .lte("payment_deadline", now)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!updated) continue;

      // The renter never completed the reservation payment (nothing was
      // captured), so there is no refund to run - but it ties up the car the
      // same way a late cancellation does, so it counts the same way against
      // their reliability record. Never fails the run: a missing/pre-CHAPTER-27
      // table must not block the actual booking cancellation above.
      try {
        await supabase.from("booking_cancellations").upsert(
          {
            booking_id: booking.id,
            cancelled_by_role: "renter",
            cancelled_by_id: booking.renter_id,
            lister_id: booking.owner_id,
            renter_id: booking.renter_id,
            car_id: booking.car_id,
            reason: "Payment deadline passed with no reservation payment captured.",
            was_late: true,
            had_captured_payment: false,
          },
          { onConflict: "booking_id" },
        );
      } catch {
        // Non-fatal - see comment above.
      }

      await notifyParticipants(supabase, booking, "payment_expired", baseOrigin);
      paymentExpired += 1;
    }

    // --- Balance deadline (CHAPTER 42): a downpayment was captured, but the
    // renter never paid the remaining balance before bookings.balance_deadline
    // (stamped once, at downpayment success, in api/webhooks/paymongo.ts).
    // Unlike the unpaid-reservation case above, money was already captured -
    // reuse the same late-cancellation refund policy a renter-initiated
    // cancel already goes through (refund_full_hours_snapshot /
    // refund_late_renter_percent_snapshot via server/cancellationRefundPlan.ts),
    // released through the same manual-refund-review queue in Financial
    // Reviews, not automatically.
    const nowIso = new Date().toISOString();
    const { data: unpaidBalanceBookings, error: unpaidBalanceError } = await supabase
      .from("bookings")
      .select(
        "id, renter_id, owner_id, car_id, start_date, pickup_time, refund_full_hours_snapshot, refund_late_renter_percent_snapshot, payments(payment_type, status, amount), cars(plate_number, car_models(name, car_brands(name)))",
      )
      .eq("compliance_hold", false)
      .eq("status", "downpayment_paid")
      .not("balance_deadline", "is", null)
      .lte("balance_deadline", nowIso)
      .limit(200);

    if (unpaidBalanceError) throw unpaidBalanceError;

    let balanceDeadlineExpired = 0;
    for (const rawBooking of (unpaidBalanceBookings ?? []) as unknown as BalanceDeadlineBooking[]) {
      const { data: claimed, error: claimError } = await supabase
        .from("bookings")
        .update({ status: "cancelled", payment_deadline: null, balance_deadline: null })
        .eq("id", rawBooking.id)
        .eq("compliance_hold", false)
        .eq("status", "downpayment_paid")
        .lte("balance_deadline", nowIso)
        .select("id")
        .maybeSingle();

      if (claimError) throw claimError;
      if (!claimed) continue;

      const refundPlan = getCancellationRefundPlan(rawBooking);
      const vehicleLabel = getVehicleLabel(rawBooking);

      try {
        const manualRefundPaymentId = await createManualRefundReview(
          supabase,
          rawBooking,
          rawBooking.renter_id,
          `Automatic balance-deadline cancellation for ${vehicleLabel} - no acting user (cron), ticket attributed to the renter.`,
          "Balance payment deadline passed - automatic full refund not applied.",
          refundPlan.recommendedRenterRefund,
          "balance payment deadline missed",
        );

        await supabase.from("booking_cancellations").upsert(
          {
            booking_id: rawBooking.id,
            cancelled_by_role: "renter",
            cancelled_by_id: rawBooking.renter_id,
            lister_id: rawBooking.owner_id,
            renter_id: rawBooking.renter_id,
            car_id: rawBooking.car_id,
            reason: "Balance payment deadline passed without payment.",
            hours_before_pickup:
              refundPlan.hoursToPickup === null
                ? null
                : Math.round(refundPlan.hoursToPickup),
            was_late: true,
            had_captured_payment: true,
          },
          { onConflict: "booking_id" },
        );

        const balanceRenterTitle = "Booking Cancelled - Balance Unpaid";
        const balanceRenterMessage = `Your booking for ${vehicleLabel} was cancelled because the remaining balance was not paid in time. SafeDrive support will review and release your ${refundPlan.lateRenterPercent}% refund. This affects your completion rate.`;
        const balanceOwnerTitle = "Booking Cancelled - Balance Unpaid";
        const balanceOwnerMessage = `A renter did not pay the remaining balance for ${vehicleLabel} in time, so the booking was cancelled and those dates are free again.`;
        await supabase.from("notifications").insert([
          {
            user_id: rawBooking.renter_id,
            title: balanceRenterTitle,
            message: balanceRenterMessage,
            type: "warning",
            link: "/my-bookings",
          },
          {
            user_id: rawBooking.owner_id,
            title: balanceOwnerTitle,
            message: balanceOwnerMessage,
            type: "warning",
            link: "/lister-bookings",
          },
        ]);
        await sendUserNotificationEmail(supabase, {
          userId: rawBooking.renter_id,
          title: balanceRenterTitle,
          message: balanceRenterMessage,
          link: "/my-bookings",
          baseOrigin,
          eventKey: `balance-deadline-renter:${rawBooking.id}`,
        });
        await sendUserNotificationEmail(supabase, {
          userId: rawBooking.owner_id,
          title: balanceOwnerTitle,
          message: balanceOwnerMessage,
          link: "/lister-bookings",
          baseOrigin,
          eventKey: `balance-deadline-owner:${rawBooking.id}`,
        });

        await supabase.from("audit_log").insert({
          user_id: null,
          action: "balance_deadline_expired",
          entity_type: "booking",
          entity_id: rawBooking.id,
          details: {
            automated: true,
            captured_total: refundPlan.capturedTotal,
            recommended_renter_refund: refundPlan.recommendedRenterRefund,
            lister_compensation: refundPlan.listerCompensation,
            refund_payment_id: manualRefundPaymentId,
          },
        });

        balanceDeadlineExpired += 1;
      } catch (error) {
        console.error("Balance-deadline cancellation follow-up failed", rawBooking.id, error);
      }
    }

    // --- Balance-deadline reminder: a one-time notification sent while the
    // deadline is still ahead but inside the reminder window. Live setting
    // (not snapshotted) - a change to it applies to every booking still
    // waiting, same as arrival_checkin_lead_hours.
    const { data: reminderSettingsRow } = await supabase
      .from("platform_settings")
      .select("balance_reminder_hours_before")
      .eq("id", "default")
      .maybeSingle();
    const reminderHoursBefore = (() => {
      const parsed = Number(reminderSettingsRow?.balance_reminder_hours_before);
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 168
        ? Math.round(parsed)
        : DEFAULT_BALANCE_REMINDER_HOURS_BEFORE;
    })();
    const reminderCutoffIso = new Date(
      Date.now() + reminderHoursBefore * 60 * 60 * 1000,
    ).toISOString();

    const { data: reminderBookings, error: reminderError } = await supabase
      .from("bookings")
      .select("id, renter_id, balance_deadline, cars(plate_number, car_models(name, car_brands(name)))")
      .eq("compliance_hold", false)
      .eq("status", "downpayment_paid")
      .is("balance_reminder_sent_at", null)
      .not("balance_deadline", "is", null)
      .gt("balance_deadline", nowIso)
      .lte("balance_deadline", reminderCutoffIso)
      .limit(200);

    if (reminderError) throw reminderError;

    let balanceReminderSent = 0;
    for (const booking of (reminderBookings ?? []) as unknown as Array<
      Pick<BalanceDeadlineBooking, "id" | "renter_id" | "balance_deadline" | "cars">
    >) {
      const { data: claimedReminder, error: claimReminderError } = await supabase
        .from("bookings")
        .update({ balance_reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id)
        .eq("compliance_hold", false)
        .is("balance_reminder_sent_at", null)
        .select("id")
        .maybeSingle();

      if (claimReminderError) throw claimReminderError;
      if (!claimedReminder) continue;

      const balanceReminderTitle = "Balance Payment Reminder";
      const balanceReminderMessage = `Pay the remaining balance for ${getVehicleLabel(booking)} soon - the booking will be automatically cancelled if it is not settled before the deadline.`;
      await supabase.from("notifications").insert({
        user_id: booking.renter_id,
        title: balanceReminderTitle,
        message: balanceReminderMessage,
        type: "warning",
        link: "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: booking.renter_id,
        title: balanceReminderTitle,
        message: balanceReminderMessage,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `balance-reminder:${booking.id}`,
      });
      balanceReminderSent += 1;
    }

    // --- Early-return response deadline: the lister never approved or
    // rejected a pending early-return request within its response window
    // (booking_early_returns.response_deadline, stamped at request time in
    // api/booking-early-return-action.ts). No response is treated the same
    // as a decline - the booking's end_date is never touched, so the
    // original return date simply stands.
    const { data: staleEarlyReturns, error: staleEarlyReturnsError } = await supabase
      .from("booking_early_returns")
      .select("id, renter_id, owner_id, requested_end_date, current_end_date")
      .eq("status", "pending")
      .not("response_deadline", "is", null)
      .lte("response_deadline", nowIso)
      .limit(200);

    if (staleEarlyReturnsError) throw staleEarlyReturnsError;

    let earlyReturnExpired = 0;
    for (const er of (staleEarlyReturns ?? []) as PendingEarlyReturn[]) {
      const { data: claimedEarlyReturn, error: claimEarlyReturnError } = await supabase
        .from("booking_early_returns")
        .update({ status: "expired" })
        .eq("id", er.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (claimEarlyReturnError) throw claimEarlyReturnError;
      if (!claimedEarlyReturn) continue;

      const earlyReturnRenterTitle = "Early return request expired";
      const earlyReturnRenterMessage = `The lister did not respond to your early-return request in time. The original return date (${er.current_end_date}) stands.`;
      const earlyReturnOwnerTitle = "Early return request expired";
      const earlyReturnOwnerMessage = `You did not respond to a renter's early-return request in time, so it expired. The original return date (${er.current_end_date}) stands.`;
      await supabase.from("notifications").insert([
        {
          user_id: er.renter_id,
          title: earlyReturnRenterTitle,
          message: earlyReturnRenterMessage,
          type: "warning",
          link: "/my-bookings",
        },
        {
          user_id: er.owner_id,
          title: earlyReturnOwnerTitle,
          message: earlyReturnOwnerMessage,
          type: "warning",
          link: "/lister-bookings",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: er.renter_id,
        title: earlyReturnRenterTitle,
        message: earlyReturnRenterMessage,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `early-return-expired-renter:${er.id}`,
      });
      await sendUserNotificationEmail(supabase, {
        userId: er.owner_id,
        title: earlyReturnOwnerTitle,
        message: earlyReturnOwnerMessage,
        link: "/lister-bookings",
        baseOrigin,
        eventKey: `early-return-expired-owner:${er.id}`,
      });

      await supabase.from("audit_log").insert({
        user_id: null,
        action: "booking_early_return_expired",
        entity_type: "booking_early_return",
        entity_id: er.id,
        details: {
          automated: true,
          requested_end_date: er.requested_end_date,
          current_end_date: er.current_end_date,
        },
      });

      earlyReturnExpired += 1;
    }

    // --- Auto-complete when the renter finished but the lister never confirmed.
    const { data: settingsRow } = await supabase
      .from("platform_settings")
      .select("lister_completion_timeout_hours")
      .eq("id", "default")
      .maybeSingle();
    const timeoutHours = (() => {
      const parsed = Number(settingsRow?.lister_completion_timeout_hours);
      return Number.isFinite(parsed) && parsed >= 1 && parsed <= 72
        ? Math.round(parsed)
        : DEFAULT_LISTER_COMPLETION_TIMEOUT_HOURS;
    })();
    const timeoutCutoff = new Date(
      Date.now() - timeoutHours * 60 * 60 * 1000,
    ).toISOString();

    // A silent lister usually means they simply forgot to tap. But it can
    // also mean the car was never handed back - the renter marked it
    // returned and the lister has nothing to confirm. Auto-completing on the
    // renter's unverified word in that case would close the trip, release
    // the payout and free the car's calendar while the car is still gone.
    //
    // report_non_return (api/booking-incident-action.ts) is the lister's way
    // to say exactly that, and it sets dispute_status='open'. Honour it here:
    // an open dispute stops this clock and leaves the case to an admin.
    const { data: staleCompletions, error: staleError } = await supabase
      .from("bookings")
      .select("id, owner_id, renter_id, commission, renter_completed_at")
      .in("status", ["fully_paid", "active"])
      .eq("renter_completed", true)
      .eq("owner_completed", false)
      .neq("dispute_status", "open")
      .not("renter_completed_at", "is", null)
      .lte("renter_completed_at", timeoutCutoff)
      .limit(100);
    if (staleError) throw staleError;

    let listerCompletionAuto = 0;
    for (const booking of staleCompletions ?? []) {
      const { data: updated, error } = await supabase
        .from("bookings")
        .update({
          owner_completed: true,
          owner_completed_at: new Date().toISOString(),
          status: "completed",
        })
        .eq("id", booking.id)
          .in("status", ["fully_paid", "active"])
        .eq("renter_completed", true)
        .eq("owner_completed", false)
        // Re-checked at claim time too: the lister may have filed
        // report_non_return in the moments between the select above and this
        // update, and that has to win.
        .neq("dispute_status", "open")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!updated) continue;

      await supabase.from("audit_log").insert({
        user_id: null,
        action: "owner_completion_auto_after_timeout",
        entity_type: "booking",
        entity_id: booking.id,
        details: { timeout_hours: timeoutHours, automated: true },
      });
      const autoCompleteOwnerTitle = "Trip Auto-Completed";
      const autoCompleteOwnerMessage = `The renter finished this trip and it was auto-completed after ${timeoutHours} hours without your confirmation.`;
      const autoCompleteRenterTitle = "Trip Completed";
      const autoCompleteRenterMessage = "Your trip was completed automatically because the lister did not confirm in time.";
      await supabase.from("notifications").insert([
        {
          user_id: booking.owner_id,
          title: autoCompleteOwnerTitle,
          message: autoCompleteOwnerMessage,
          type: "warning",
          link: "/lister-bookings",
        },
        {
          user_id: booking.renter_id,
          title: autoCompleteRenterTitle,
          message: autoCompleteRenterMessage,
          type: "info",
          link: "/my-bookings",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: booking.owner_id,
        title: autoCompleteOwnerTitle,
        message: autoCompleteOwnerMessage,
        link: "/lister-bookings",
        baseOrigin,
        eventKey: `lister-timeout-owner:${booking.id}`,
      });
      await sendUserNotificationEmail(supabase, {
        userId: booking.renter_id,
        title: autoCompleteRenterTitle,
        message: autoCompleteRenterMessage,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `lister-timeout-renter:${booking.id}`,
      });
      await runBookingCompletionSideEffects(
        supabase,
        {
          id: booking.id,
          owner_id: booking.owner_id,
          renter_id: booking.renter_id,
          commission: booking.commission,
        },
        { initiatedByUserId: null, baseOrigin: new URL(req.url).origin },
      );
      listerCompletionAuto += 1;
    }


    // --- Handover stuck-state timeout (2 hours): both sides arrived for
    // pickup, but the mandatory handover sub-sequence (lister required
    // photos + "hand over", renter "received") never finished. If the
    // lister already handed over and only the renter is silent, assume
    // good faith and auto-activate on the renter's behalf - same philosophy
    // as the lister-completion-timeout above, zero new taps for the renter.
    // If the lister never even confirmed the handover, this is a
    // lister-fault stall - notify both sides once (deduped via
    // handover_stall_notified_at) rather than repeating every 15 minutes.
    const HANDOVER_STALL_TIMEOUT_HOURS = 2;
    const handoverStallCutoff = new Date(
      Date.now() - HANDOVER_STALL_TIMEOUT_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const { data: stuckHandovers, error: stuckHandoverError } = await supabase
      .from("bookings")
      .select(
        "id, renter_id, owner_id, lister_handover_confirmed_at, handover_stall_notified_at, cars(plate_number, car_models(name, car_brands(name)))",
      )
      .eq("compliance_hold", false)
      .eq("status", "fully_paid")
      .not("renter_arrived_at", "is", null)
      .not("lister_arrived_at", "is", null)
      .is("renter_handover_received_at", null)
      .lte("renter_arrived_at", handoverStallCutoff)
      .lte("lister_arrived_at", handoverStallCutoff)
      .limit(200);
    if (stuckHandoverError) throw stuckHandoverError;

    let handoverAutoActivated = 0;
    let handoverStallFlagged = 0;
    for (const booking of (stuckHandovers ?? []) as unknown as Array<{
      id: string;
      renter_id: string;
      owner_id: string;
      lister_handover_confirmed_at: string | null;
      handover_stall_notified_at: string | null;
      cars: { plate_number: string; car_models: { name: string; car_brands: { name: string } } } | null;
    }>) {
      const vehicleLabel = getVehicleLabel(booking as unknown as RefundableBooking);

      if (booking.lister_handover_confirmed_at) {
        const { data: activated, error: activateError } = await supabase
          .from("bookings")
          .update({
            renter_handover_received_at: new Date().toISOString(),
            status: "active",
          })
          .eq("id", booking.id)
        .eq("compliance_hold", false)
          .eq("status", "fully_paid")
          .is("renter_handover_received_at", null)
          .select("id")
          .maybeSingle();
        if (activateError) {
          // One vehicle whose documents lapsed must not abort the whole sweep.
          // The booking simply stays at fully_paid; the compliance hold and its
          // deadline extension are what handle this case properly.
          if (vehicleGuardMessage(activateError)) continue;
          throw activateError;
        }
        if (!activated) continue;

        await supabase.from("audit_log").insert({
          user_id: null,
          action: "handover_receipt_auto_after_timeout",
          entity_type: "booking",
          entity_id: booking.id,
          details: { timeout_hours: HANDOVER_STALL_TIMEOUT_HOURS, automated: true },
        });
        const tripStartedRenterTitle = "Trip Started";
        const tripStartedRenterMessage = `Your trip for ${vehicleLabel} was started automatically after ${HANDOVER_STALL_TIMEOUT_HOURS} hours since the lister handed over the car.`;
        const tripStartedOwnerTitle = "Trip Started";
        const tripStartedOwnerMessage = `The rental for ${vehicleLabel} started automatically because the renter did not confirm receipt in time.`;
        await supabase.from("notifications").insert([
          {
            user_id: booking.renter_id,
            title: tripStartedRenterTitle,
            message: tripStartedRenterMessage,
            type: "info",
            link: "/my-bookings",
          },
          {
            user_id: booking.owner_id,
            title: tripStartedOwnerTitle,
            message: tripStartedOwnerMessage,
            type: "info",
            link: "/lister-bookings",
          },
        ]);
        await sendUserNotificationEmail(supabase, {
          userId: booking.renter_id,
          title: tripStartedRenterTitle,
          message: tripStartedRenterMessage,
          link: "/my-bookings",
          baseOrigin,
          eventKey: `handover-stall-activated-renter:${booking.id}`,
        });
        await sendUserNotificationEmail(supabase, {
          userId: booking.owner_id,
          title: tripStartedOwnerTitle,
          message: tripStartedOwnerMessage,
          link: "/lister-bookings",
          baseOrigin,
          eventKey: `handover-stall-activated-owner:${booking.id}`,
        });
        handoverAutoActivated += 1;
      } else if (!booking.handover_stall_notified_at) {
        const { data: claimedNotice, error: claimNoticeError } = await supabase
          .from("bookings")
          .update({ handover_stall_notified_at: new Date().toISOString() })
          .eq("id", booking.id)
        .eq("compliance_hold", false)
          .is("handover_stall_notified_at", null)
          .select("id")
          .maybeSingle();
        if (claimNoticeError) throw claimNoticeError;
        if (!claimedNotice) continue;

        const handoverStallOwnerTitle = "Complete the handover";
        const handoverStallOwnerMessage = `You and the renter both arrived for ${vehicleLabel} over ${HANDOVER_STALL_TIMEOUT_HOURS} hours ago, but the car hasn't been handed over yet. Submit your pickup photos and tap "Hand Over the Car."`;
        const handoverStallRenterTitle = "Waiting on the lister";
        const handoverStallRenterMessage = `You and the lister both arrived for ${vehicleLabel} over ${HANDOVER_STALL_TIMEOUT_HOURS} hours ago, but the lister hasn't handed over the car yet.`;
        await supabase.from("notifications").insert([
          {
            user_id: booking.owner_id,
            title: handoverStallOwnerTitle,
            message: handoverStallOwnerMessage,
            type: "warning",
            link: "/lister-bookings",
          },
          {
            user_id: booking.renter_id,
            title: handoverStallRenterTitle,
            message: handoverStallRenterMessage,
            type: "warning",
            link: "/my-bookings",
          },
        ]);
        await sendUserNotificationEmail(supabase, {
          userId: booking.owner_id,
          title: handoverStallOwnerTitle,
          message: handoverStallOwnerMessage,
          link: "/lister-bookings",
          baseOrigin,
          eventKey: `handover-stall-notice-owner:${booking.id}`,
        });
        await sendUserNotificationEmail(supabase, {
          userId: booking.renter_id,
          title: handoverStallRenterTitle,
          message: handoverStallRenterMessage,
          link: "/my-bookings",
          baseOrigin,
          eventKey: `handover-stall-notice-renter:${booking.id}`,
        });
        await supabase.from("audit_log").insert({
          user_id: null,
          action: "handover_stall_notified",
          entity_type: "booking",
          entity_id: booking.id,
          details: { timeout_hours: HANDOVER_STALL_TIMEOUT_HOURS, automated: true },
        });
        handoverStallFlagged += 1;
      }
    }

    // --- Return-leg no-show reminder: never auto-cancels - the rental
    // period is already consumed by this point, so unlike pickup no-show
    // there is no refund-eligible outcome the same way; this is purely
    // advisory, pointing the arrived party at the incident-report actions.
    //
    // The grace window is the admin setting (CHAPTER 68), not a constant kept
    // here - this branch used to carry its own copy of 30, three files away
    // from the client gate it had to agree with.
    const returnNoShowGraceMinutes = await fetchNoShowGraceMinutes(supabase);
    const { data: returnNoShowCandidates, error: returnNoShowError } = await supabase
      .from("bookings")
      .select(
        "id, renter_id, owner_id, end_date, dropoff_time, renter_return_arrived_at, lister_return_arrived_at, renter_completed, cars(plate_number, car_models(name, car_brands(name)))",
      )
      .eq("status", "active")
      .is("return_no_show_reminder_sent_at", null)
      .or("dispute_status.neq.open,dispute_reason.eq.lister_no_show_at_return")
      .limit(200);
    if (returnNoShowError) throw returnNoShowError;

    // Prefer an approved early-return instant over the original, batch-fetched
    // once for the whole candidate set rather than per-row.
    const returnNoShowCandidateIds = (returnNoShowCandidates ?? []).map((b) => b.id);
    const { data: approvedEarlyReturnRows } = returnNoShowCandidateIds.length
      ? await supabase
          .from("booking_early_returns")
          .select("booking_id, requested_end_date, requested_end_time, approved_at")
          .eq("status", "approved")
          .in("booking_id", returnNoShowCandidateIds)
          .order("approved_at", { ascending: false })
      : { data: [] as { booking_id: string; requested_end_date: string; requested_end_time: string }[] };
    const approvedEarlyReturnByBooking = new Map<string, { requested_end_date: string; requested_end_time: string }>();
    for (const early of approvedEarlyReturnRows ?? []) {
      if (!approvedEarlyReturnByBooking.has(early.booking_id)) {
        approvedEarlyReturnByBooking.set(early.booking_id, early);
      }
    }
    const getInstantMs = (dateOnly: string, time: string | null, fallback = "18:00") => {
      const [y, m, d] = (dateOnly || "").split("-").map(Number);
      const [hh, mm] = (time || fallback).split(":").map(Number);
      if (!y || !m || !d) return null;
      return Date.UTC(y, m - 1, d, hh || 0, mm || 0) - 8 * 60 * 60 * 1000;
    };

    let returnNoShowReminderSent = 0;
    for (const booking of (returnNoShowCandidates ?? []) as unknown as Array<{
      id: string;
      renter_id: string;
      owner_id: string;
      end_date: string;
      dropoff_time: string | null;
      renter_return_arrived_at: string | null;
      lister_return_arrived_at: string | null;
      renter_completed: boolean;
      cars: { plate_number: string; car_models: { name: string; car_brands: { name: string } } } | null;
    }>) {
      // A renter who has already said "I returned it" has armed the
      // lister-completion timeout; that clock will finish this trip on its
      // own, so a second nudge here would only be noise.
      if (booking.renter_completed) continue;

      const approvedEarly = approvedEarlyReturnByBooking.get(booking.id);
      const dropoffMs = approvedEarly
        ? getInstantMs(approvedEarly.requested_end_date, approvedEarly.requested_end_time)
        : getInstantMs(booking.end_date, booking.dropoff_time);
      if (dropoffMs === null) continue;
      if (Date.now() < dropoffMs + returnNoShowGraceMinutes * 60_000) continue;

      const { data: claimed, error: claimError } = await supabase
        .from("bookings")
        .update({ return_no_show_reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id)
          .is("return_no_show_reminder_sent_at", null)
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;

      const vehicleLabel = getVehicleLabel(booking as unknown as RefundableBooking);
      const renterArrived = Boolean(booking.renter_return_arrived_at);
      const listerArrived = Boolean(booking.lister_return_arrived_at);

      // Who still has a tap to make decides who hears about it. The lister is
      // named whenever the trip cannot close without them, because confirming
      // receipt is what releases their own payout.
      const recipients: Array<{ userId: string; title: string; message: string; link: string; key: string }> = [];
      if (renterArrived && !listerArrived) {
        recipients.push({
          userId: booking.renter_id,
          title: "The lister hasn't shown up",
          message: `You arrived to return ${vehicleLabel}, but the lister hasn't checked in yet. You can still tap "Car Returned" to record your side. If they never arrive, report a no-show from the booking.`,
          link: "/my-bookings",
          key: "renter",
        });
      } else if (listerArrived && !renterArrived) {
        recipients.push({
          userId: booking.owner_id,
          title: "Finish the return to release your payout",
          message: `You checked in to receive ${vehicleLabel}, but the trip is still open. Submit your return report and tap "Confirm - Car Received" - you do not need the renter to check in. If the car was never returned, report that instead.`,
          link: "/lister-bookings",
          key: "owner",
        });
      } else if (renterArrived && listerArrived) {
        recipients.push({
          userId: booking.owner_id,
          title: "Finish the return to release your payout",
          message: `You and the renter both checked in for ${vehicleLabel}, but the trip is still open. Submit your return report and tap "Confirm - Car Received" to close it and release your payout.`,
          link: "/lister-bookings",
          key: "owner",
        });
      } else {
        // Neither tapped. Previously this sweep skipped exactly this case, so
        // the one situation where nobody was going to act on their own was
        // also the only one nobody was told about. The car is usually already
        // back and both simply forgot; the trip cannot close, and the lister's
        // payout waits behind it.
        recipients.push({
          userId: booking.owner_id,
          title: "Finish the return to release your payout",
          message: `The return time for ${vehicleLabel} has passed and neither of you confirmed it. If you have the car back, tap "I Have Arrived", submit your return report, then "Confirm - Car Received" to close the trip and release your payout. If the car was never returned, report that instead.`,
          link: "/lister-bookings",
          key: "owner",
        });
        recipients.push({
          userId: booking.renter_id,
          title: "Your trip is still open",
          message: `The return time for ${vehicleLabel} has passed and the trip was never closed. If you already returned the car, tap "I Have Arrived" and then "Car Returned" so it is on record.`,
          link: "/my-bookings",
          key: "renter",
        });
      }

      for (const recipient of recipients) {
        await supabase.from("notifications").insert({
          user_id: recipient.userId,
          title: recipient.title,
          message: recipient.message,
          type: "warning",
          link: recipient.link,
        });
        await sendUserNotificationEmail(supabase, {
          userId: recipient.userId,
          title: recipient.title,
          message: recipient.message,
          link: recipient.link,
          baseOrigin,
          eventKey: `return-no-show-${recipient.key}:${booking.id}`,
        });
      }
      await supabase.from("audit_log").insert({
        user_id: null,
        action: "return_no_show_reminder_sent",
        entity_type: "booking",
        entity_id: booking.id,
        details: {
          automated: true,
          renter_arrived: renterArrived,
          lister_arrived: listerArrived,
          notified: recipients.map((r) => r.key),
        },
      });
      returnNoShowReminderSent += 1;
    }

    // --- Return auto-completion: the last resort for a trip nobody closed.
    //
    // A renter who has already driven away has nothing left to gain from
    // opening the app, and until this existed the lister's payout sat behind
    // that renter's tap indefinitely. Relaxing the completion gates fixed the
    // common case - a lister who is paying attention can now finish alone -
    // but it cannot help a lister who is also not looking. This is that case.
    //
    // What makes it safe to pay without anyone confirming: reaching 'active'
    // at all required the full pickup handshake, so the car demonstrably left
    // with the renter, and the only open question is whether it came back.
    // Exactly one person knows the answer, and they have a button for saying
    // it did not - report_non_return, open to them from the return deadline,
    // which sets dispute_status to open. Silence from the one party who would
    // object, after being told, is taken as agreement.
    //
    // Deliberately unreachable unless the reminder above has been sent: no
    // trip is closed on a timer its owner was never warned about.
    const RETURN_AUTO_COMPLETE_HOURS = 24;
    const { data: returnAutoCandidates, error: returnAutoError } = await supabase
      .from("bookings")
      .select(
        "id, renter_id, owner_id, commission, end_date, dropoff_time, return_no_show_reminder_sent_at, cars(plate_number, car_models(name, car_brands(name)))",
      )
      .eq("status", "active")
      .eq("owner_completed", false)
      .or("dispute_status.neq.open,dispute_reason.eq.lister_no_show_at_return")
      .not("return_no_show_reminder_sent_at", "is", null)
      .limit(100);
    if (returnAutoError) throw returnAutoError;

    const returnAutoIds = (returnAutoCandidates ?? []).map((b) => b.id);
    // An unresolved extension moves the very end date this sweep measures
    // from, and api/booking-action.ts refuses completion while one is open.
    // Refuse it here too, rather than letting a timer do what a person is
    // forbidden to do.
    const { data: openExtensionRows } = returnAutoIds.length
      ? await supabase
          .from("booking_extensions")
          .select("booking_id")
          .in("booking_id", returnAutoIds)
          .in("status", ["pending", "approved"])
      : { data: [] as { booking_id: string }[] };
    const blockedByExtension = new Set((openExtensionRows ?? []).map((row) => row.booking_id));

    const { data: autoEarlyReturnRows } = returnAutoIds.length
      ? await supabase
          .from("booking_early_returns")
          .select("booking_id, requested_end_date, requested_end_time, approved_at")
          .eq("status", "approved")
          .in("booking_id", returnAutoIds)
          .order("approved_at", { ascending: false })
      : { data: [] as { booking_id: string; requested_end_date: string; requested_end_time: string }[] };
    const autoEarlyReturnByBooking = new Map<string, { requested_end_date: string; requested_end_time: string }>();
    for (const early of autoEarlyReturnRows ?? []) {
      if (!autoEarlyReturnByBooking.has(early.booking_id)) {
        autoEarlyReturnByBooking.set(early.booking_id, early);
      }
    }

    let returnAutoCompleted = 0;
    for (const booking of (returnAutoCandidates ?? []) as unknown as Array<{
      id: string;
      renter_id: string;
      owner_id: string;
      commission: number;
      end_date: string;
      dropoff_time: string | null;
      return_no_show_reminder_sent_at: string;
      cars: { plate_number: string; car_models: { name: string; car_brands: { name: string } } } | null;
    }>) {
      if (blockedByExtension.has(booking.id)) continue;

      const approvedEarly = autoEarlyReturnByBooking.get(booking.id);
      const autoDropoffMs = approvedEarly
        ? getInstantMs(approvedEarly.requested_end_date, approvedEarly.requested_end_time)
        : getInstantMs(booking.end_date, booking.dropoff_time);
      if (autoDropoffMs === null) continue;

      // Measured from the deadline AND from the reminder, whichever lands
      // later, so a reminder that went out late cannot shorten the window.
      const deadlineDue =
        autoDropoffMs + returnNoShowGraceMinutes * 60_000 + RETURN_AUTO_COMPLETE_HOURS * 3_600_000;
      const reminderDue =
        new Date(booking.return_no_show_reminder_sent_at).getTime() +
        RETURN_AUTO_COMPLETE_HOURS * 3_600_000;
      if (Date.now() < Math.max(deadlineDue, reminderDue)) continue;

      const { data: autoCompleted, error: autoCompleteError } = await supabase
        .from("bookings")
        .update({
          owner_completed: true,
          owner_completed_at: new Date().toISOString(),
          status: "completed",
          // A lister-no-show case is about the handover, and completing the
          // trip is the handover being settled. Nothing else in SafeDrive
          // writes 'resolved', so without this the case would outlive the
          // booking it describes.
          dispute_status: "resolved",
        })
        .eq("id", booking.id)
        .eq("status", "active")
        .eq("owner_completed", false)
        // Re-checked at claim time: the lister may have filed
        // report_non_return between the select above and this update, and
        // that has to win.
        .neq("dispute_status", "open")
        .select("id")
        .maybeSingle();
      if (autoCompleteError) throw autoCompleteError;
      if (!autoCompleted) continue;

      const autoVehicleLabel = getVehicleLabel(booking as unknown as RefundableBooking);
      await supabase.from("audit_log").insert({
        user_id: null,
        action: "return_auto_completed_after_deadline",
        entity_type: "booking",
        entity_id: booking.id,
        details: {
          automated: true,
          hours_after_deadline: RETURN_AUTO_COMPLETE_HOURS,
          grace_minutes: returnNoShowGraceMinutes,
        },
      });

      const autoOwnerTitle = "Trip closed and payout released";
      const autoOwnerMessage = `No one confirmed the return of ${autoVehicleLabel}, so the trip was closed ${RETURN_AUTO_COMPLETE_HOURS} hours after the return deadline and your payout was released. No return report was filed, so there is no record of the condition of the car at handback - file one at the return next time if you may need to claim damage.`;
      const autoRenterTitle = "Trip closed";
      const autoRenterMessage = `Your trip with ${autoVehicleLabel} was closed automatically because neither side confirmed the return. If you have not actually returned the car, contact support now.`;
      await supabase.from("notifications").insert([
        {
          user_id: booking.owner_id,
          title: autoOwnerTitle,
          message: autoOwnerMessage,
          type: "warning",
          link: "/lister-bookings",
        },
        {
          user_id: booking.renter_id,
          title: autoRenterTitle,
          message: autoRenterMessage,
          type: "info",
          link: "/my-bookings",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: booking.owner_id,
        title: autoOwnerTitle,
        message: autoOwnerMessage,
        link: "/lister-bookings",
        baseOrigin,
        eventKey: `return-auto-complete-owner:${booking.id}`,
      });
      await sendUserNotificationEmail(supabase, {
        userId: booking.renter_id,
        title: autoRenterTitle,
        message: autoRenterMessage,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `return-auto-complete-renter:${booking.id}`,
      });
      await runBookingCompletionSideEffects(
        supabase,
        {
          id: booking.id,
          owner_id: booking.owner_id,
          renter_id: booking.renter_id,
          commission: booking.commission,
        },
        { initiatedByUserId: null, baseOrigin: new URL(req.url).origin },
      );
      returnAutoCompleted += 1;
    }

    // --- Earned rental on a vehicle that was never brought back.
    //
    // The trip does NOT complete here and the case stays open - the car is
    // still missing and that is not settled by a timer. Only the money moves.
    //
    // Why it moves at all: the renter had the car for the days they paid for,
    // and no outcome of a non-return case refunds those days to them. The fee
    // is not the contested thing; the vehicle is, and SafeDrive is not holding
    // the vehicle. Meanwhile the lister is usually paying for a police report,
    // an insurance claim or a tow out of pocket, and this is the one sum they
    // were counting on. Holding it protected nobody.
    //
    // Not tied to the case being closed, deliberately: a lister cannot close a
    // case about a car that is genuinely still gone, so that condition would
    // have starved them in exactly the situation this exists for.
    const { data: unreturnedPayoutCandidates, error: unreturnedPayoutError } = await supabase
      .from("bookings")
      .select(
        "id, renter_id, owner_id, end_date, dropoff_time, dispute_reason, cars(plate_number, car_models(name, car_brands(name))), payments(payment_type, status)",
      )
      .eq("status", "active")
      .eq("dispute_status", "open")
      .limit(50);
    if (unreturnedPayoutError) throw unreturnedPayoutError;

    const unreturnedIds = (unreturnedPayoutCandidates ?? []).map((b) => b.id);
    const { data: unreturnedEarlyRows } = unreturnedIds.length
      ? await supabase
          .from("booking_early_returns")
          .select("booking_id, requested_end_date, requested_end_time, approved_at")
          .eq("status", "approved")
          .in("booking_id", unreturnedIds)
          .order("approved_at", { ascending: false })
      : { data: [] as { booking_id: string; requested_end_date: string; requested_end_time: string }[] };
    const unreturnedEarlyByBooking = new Map<string, { requested_end_date: string; requested_end_time: string }>();
    for (const early of unreturnedEarlyRows ?? []) {
      if (!unreturnedEarlyByBooking.has(early.booking_id)) {
        unreturnedEarlyByBooking.set(early.booking_id, early);
      }
    }

    let unreturnedPayoutReleased = 0;
    for (const booking of (unreturnedPayoutCandidates ?? []) as unknown as Array<{
      id: string;
      renter_id: string;
      owner_id: string;
      end_date: string;
      dropoff_time: string | null;
      dispute_reason: string | null;
      cars: { plate_number: string; car_models: { name: string; car_brands: { name: string } } } | null;
      payments: { payment_type: string; status: string }[] | null;
    }>) {
      // A case the renter raised - the lister never came to take the car back -
      // can end with money owed to the renter, and a disbursement cannot be
      // recalled. That one waits for a human.
      if (booking.dispute_reason === "lister_no_show_at_return") continue;

      // Filtered here rather than re-read per booking: the payout call is
      // idempotent, but without this a permanently open case would be polled
      // on every run forever.
      const alreadyPaid = (booking.payments ?? []).some(
        (payment) => payment.payment_type === "payout" && payment.status === "completed",
      );
      if (alreadyPaid) continue;

      const approvedEarly = unreturnedEarlyByBooking.get(booking.id);
      const unreturnedDropoffMs = approvedEarly
        ? getInstantMs(approvedEarly.requested_end_date, approvedEarly.requested_end_time)
        : getInstantMs(booking.end_date, booking.dropoff_time);
      if (unreturnedDropoffMs === null) continue;
      if (
        Date.now() <
        unreturnedDropoffMs + returnNoShowGraceMinutes * 60_000 + RETURN_AUTO_COMPLETE_HOURS * 3_600_000
      ) {
        continue;
      }

      const payoutOutcome = await processAutomaticPayoutForBooking({
        supabase,
        bookingId: booking.id,
        initiatedByUserId: null,
        baseOrigin: new URL(req.url).origin,
      });
      if (payoutOutcome.state === "skipped") continue;

      const unreturnedLabel = getVehicleLabel(booking as unknown as RefundableBooking);
      const unreturnedTitle = "Your rental earnings have been released";
      const unreturnedMessage = `The case for ${unreturnedLabel} is still open, but the rental itself was already earned - the renter paid for the days they had the car. That amount, net of commission, is on its way to your payout method. The case stays open and SafeDrive support is still working it; releasing this does not settle anything about the vehicle.`;
      await supabase.from("notifications").insert({
        user_id: booking.owner_id,
        title: unreturnedTitle,
        message: unreturnedMessage,
        type: "info",
        link: "/lister-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: booking.owner_id,
        title: unreturnedTitle,
        message: unreturnedMessage,
        link: "/lister-bookings",
        baseOrigin,
        eventKey: `unreturned-payout:${booking.id}`,
      });
      await supabase.from("audit_log").insert({
        user_id: null,
        action: "unreturned_vehicle_payout_released",
        entity_type: "booking",
        entity_id: booking.id,
        details: {
          automated: true,
          dispute_reason: booking.dispute_reason,
          hours_after_deadline: RETURN_AUTO_COMPLETE_HOURS,
          note: "Booking deliberately left active with the case open; only the earned rental was released.",
        },
      });
      unreturnedPayoutReleased += 1;
    }

    // --- Extension response deadline: the lister never approved or rejected
    // a pending extension request within its response window
    // (booking_extensions.response_deadline, stamped at request time in
    // api/booking-extension-action.ts). No response is treated the same as
    // a decline - the booking is untouched, so the current end date stands.
    const { data: staleExtensionRequests, error: staleExtensionRequestsError } =
      await supabase
        .from("booking_extensions")
        .select("id, renter_id, owner_id, requested_end_date, current_end_date")
        .eq("status", "pending")
        .not("response_deadline", "is", null)
        .lte("response_deadline", nowIso)
        .limit(200);
    if (staleExtensionRequestsError) throw staleExtensionRequestsError;

    let extensionRequestExpired = 0;
    for (const ext of (staleExtensionRequests ?? []) as Array<{
      id: string;
      renter_id: string;
      owner_id: string;
      requested_end_date: string;
      current_end_date: string;
    }>) {
      const { data: claimedExt, error: claimExtError } = await supabase
        .from("booking_extensions")
        .update({ status: "expired" })
        .eq("id", ext.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (claimExtError) throw claimExtError;
      if (!claimedExt) continue;

      const extensionExpiredRenterTitle = "Extension request expired";
      const extensionExpiredRenterMessage = `The lister did not respond to your extension request in time. The current return date (${ext.current_end_date}) stands.`;
      const extensionExpiredOwnerTitle = "Extension request expired";
      const extensionExpiredOwnerMessage = `You did not respond to a renter's extension request in time, so it expired. The current return date (${ext.current_end_date}) stands.`;
      await supabase.from("notifications").insert([
        {
          user_id: ext.renter_id,
          title: extensionExpiredRenterTitle,
          message: extensionExpiredRenterMessage,
          type: "warning",
          link: "/my-bookings",
        },
        {
          user_id: ext.owner_id,
          title: extensionExpiredOwnerTitle,
          message: extensionExpiredOwnerMessage,
          type: "warning",
          link: "/lister-bookings",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: ext.renter_id,
        title: extensionExpiredRenterTitle,
        message: extensionExpiredRenterMessage,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `extension-expired-renter:${ext.id}`,
      });
      await sendUserNotificationEmail(supabase, {
        userId: ext.owner_id,
        title: extensionExpiredOwnerTitle,
        message: extensionExpiredOwnerMessage,
        link: "/lister-bookings",
        baseOrigin,
        eventKey: `extension-expired-owner:${ext.id}`,
      });
      await supabase.from("audit_log").insert({
        user_id: null,
        action: "booking_extension_response_expired",
        entity_type: "booking_extension",
        entity_id: ext.id,
        details: {
          automated: true,
          requested_end_date: ext.requested_end_date,
          current_end_date: ext.current_end_date,
        },
      });
      extensionRequestExpired += 1;
    }

    // --- Extension approved-but-unpaid expiry: the renter never completed
    // the added payment within the window stamped at approve time
    // (booking_extensions.payment_deadline). The booking itself is
    // untouched - end_date only ever changes on successful payment
    // (api/webhooks/paymongo.ts).
    const { data: staleUnpaidExtensions, error: staleUnpaidExtensionsError } =
      await supabase
        .from("booking_extensions")
        .select("id, renter_id, owner_id, current_end_date")
        .eq("status", "approved")
        .not("payment_deadline", "is", null)
        .lte("payment_deadline", nowIso)
        .limit(200);
    if (staleUnpaidExtensionsError) throw staleUnpaidExtensionsError;

    let extensionPaymentExpired = 0;
    for (const ext of (staleUnpaidExtensions ?? []) as Array<{
      id: string;
      renter_id: string;
      owner_id: string;
      current_end_date: string;
    }>) {
      const { data: claimedExt, error: claimExtError } = await supabase
        .from("booking_extensions")
        .update({ status: "expired" })
        .eq("id", ext.id)
        .eq("status", "approved")
        .select("id")
        .maybeSingle();
      if (claimExtError) throw claimExtError;
      if (!claimedExt) continue;

      const extensionPaymentRenterTitle = "Extension payment window expired";
      const extensionPaymentRenterMessage = `You did not complete the extension payment in time, so the approved extension expired. The current return date (${ext.current_end_date}) stands.`;
      const extensionPaymentOwnerTitle = "Extension payment window expired";
      const extensionPaymentOwnerMessage = `The renter did not pay for the approved extension in time, so it expired. The current return date (${ext.current_end_date}) stands.`;
      await supabase.from("notifications").insert([
        {
          user_id: ext.renter_id,
          title: extensionPaymentRenterTitle,
          message: extensionPaymentRenterMessage,
          type: "warning",
          link: "/my-bookings",
        },
        {
          user_id: ext.owner_id,
          title: extensionPaymentOwnerTitle,
          message: extensionPaymentOwnerMessage,
          type: "warning",
          link: "/lister-bookings",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: ext.renter_id,
        title: extensionPaymentRenterTitle,
        message: extensionPaymentRenterMessage,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `extension-payment-expired-renter:${ext.id}`,
      });
      await sendUserNotificationEmail(supabase, {
        userId: ext.owner_id,
        title: extensionPaymentOwnerTitle,
        message: extensionPaymentOwnerMessage,
        link: "/lister-bookings",
        baseOrigin,
        eventKey: `extension-payment-expired-owner:${ext.id}`,
      });
      await supabase.from("audit_log").insert({
        user_id: null,
        action: "booking_extension_payment_expired",
        entity_type: "booking_extension",
        entity_id: ext.id,
        details: { automated: true, current_end_date: ext.current_end_date },
      });
      extensionPaymentExpired += 1;
    }

    return jsonResponse({
      success: true,
      ownerResponseExpired,
      paymentExpired,
      balanceDeadlineExpired,
      balanceReminderSent,
      earlyReturnExpired,
      listerCompletionAuto,
      handoverAutoActivated,
      handoverStallFlagged,
      returnNoShowReminderSent,
      returnAutoCompleted,
      unreturnedPayoutReleased,
      extensionRequestExpired,
      extensionPaymentExpired,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected booking deadline expiry error",
      },
      500,
    );
  }
}
