import { createClient } from "@supabase/supabase-js";
import { runBookingCompletionSideEffects } from "./lib/bookingCompletion.js";
import {
  createManualRefundReview,
  getCancellationRefundPlan,
  getVehicleLabel,
  type RefundableBooking,
} from "./lib/cancellationRefundPlan.js";

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
) => {
  const isOwnerResponseExpiry = state === "owner_response_expired";
  const notifications = [
    {
      user_id: booking.renter_id,
      title: isOwnerResponseExpiry ? "Booking Request Expired" : "Booking Payment Expired",
      message: isOwnerResponseExpiry
        ? "The lister did not respond before the 24-hour review window closed, so your request was released."
        : "The reservation payment deadline passed before PayMongo confirmed payment, so the booking was cancelled. This affects your completion rate.",
      type: "warning",
      link: "/my-bookings",
    },
    {
      user_id: booking.owner_id,
      title: isOwnerResponseExpiry ? "Booking Request Released" : "Booking Payment Expired",
      message: isOwnerResponseExpiry
        ? "A pending booking request was released because the 24-hour response window passed."
        : "A renter did not complete reservation payment before the deadline, so the booking was cancelled.",
      type: "warning",
      link: "/lister-bookings",
    },
  ];

  await supabase.from("notifications").insert(notifications);
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
    const now = new Date().toISOString();
    const { data: unansweredBookings, error: unansweredError } = await supabase
      .from("bookings")
      .select("id, renter_id, owner_id, status")
      .eq("status", "pending")
      .not("owner_response_deadline", "is", null)
      .lte("owner_response_deadline", now)
      .limit(200);

    if (unansweredError) throw unansweredError;

    const { data: unpaidBookings, error: unpaidError } = await supabase
      .from("bookings")
      .select("id, renter_id, owner_id, car_id, status")
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
        .eq("status", "pending")
        .lte("owner_response_deadline", now)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!updated) continue;

      await notifyParticipants(supabase, booking, "owner_response_expired");
      ownerResponseExpired += 1;
    }

    for (const booking of (unpaidBookings ?? []) as UnpaidBooking[]) {
      const { data: updated, error } = await supabase
        .from("bookings")
        .update({ status: "cancelled", payment_deadline: null })
        .eq("id", booking.id)
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

      await notifyParticipants(supabase, booking, "payment_expired");
      paymentExpired += 1;
    }

    // --- Balance deadline (CHAPTER 42): a downpayment was captured, but the
    // renter never paid the remaining balance before bookings.balance_deadline
    // (stamped once, at downpayment success, in api/webhooks/paymongo.ts).
    // Unlike the unpaid-reservation case above, money was already captured -
    // reuse the same late-cancellation refund policy a renter-initiated
    // cancel already goes through (refund_full_hours_snapshot /
    // refund_late_renter_percent_snapshot via api/lib/cancellationRefundPlan.ts),
    // released through the same manual-refund-review queue in Financial
    // Reviews, not automatically.
    const nowIso = new Date().toISOString();
    const { data: unpaidBalanceBookings, error: unpaidBalanceError } = await supabase
      .from("bookings")
      .select(
        "id, renter_id, owner_id, car_id, start_date, pickup_time, refund_full_hours_snapshot, refund_late_renter_percent_snapshot, payments(payment_type, status, amount), cars(plate_number, car_models(name, car_brands(name)))",
      )
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

        await supabase.from("notifications").insert([
          {
            user_id: rawBooking.renter_id,
            title: "Booking Cancelled - Balance Unpaid",
            message: `Your booking for ${vehicleLabel} was cancelled because the remaining balance was not paid in time. SafeDrive support will review and release your ${refundPlan.lateRenterPercent}% refund. This affects your completion rate.`,
            type: "warning",
            link: "/my-bookings",
          },
          {
            user_id: rawBooking.owner_id,
            title: "Booking Cancelled - Balance Unpaid",
            message: `A renter did not pay the remaining balance for ${vehicleLabel} in time, so the booking was cancelled and those dates are free again.`,
            type: "warning",
            link: "/lister-bookings",
          },
        ]);

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
        .is("balance_reminder_sent_at", null)
        .select("id")
        .maybeSingle();

      if (claimReminderError) throw claimReminderError;
      if (!claimedReminder) continue;

      await supabase.from("notifications").insert({
        user_id: booking.renter_id,
        title: "Balance Payment Reminder",
        message: `Pay the remaining balance for ${getVehicleLabel(booking)} soon - the booking will be automatically cancelled if it is not settled before the deadline.`,
        type: "warning",
        link: "/my-bookings",
      });
      balanceReminderSent += 1;
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

    const { data: staleCompletions, error: staleError } = await supabase
      .from("bookings")
      .select("id, owner_id, renter_id, commission, renter_completed_at")
      .in("status", ["fully_paid", "active"])
      .eq("renter_completed", true)
      .eq("owner_completed", false)
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
      await supabase.from("notifications").insert([
        {
          user_id: booking.owner_id,
          title: "Trip Auto-Completed",
          message: `The renter finished this trip and it was auto-completed after ${timeoutHours} hours without your confirmation.`,
          type: "warning",
          link: "/lister-bookings",
        },
        {
          user_id: booking.renter_id,
          title: "Trip Completed",
          message: "Your trip was completed automatically because the lister did not confirm in time.",
          type: "info",
          link: "/my-bookings",
        },
      ]);
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

    return jsonResponse({
      success: true,
      ownerResponseExpired,
      paymentExpired,
      balanceDeadlineExpired,
      balanceReminderSent,
      listerCompletionAuto,
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
