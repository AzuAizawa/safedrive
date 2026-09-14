import { postSimpleBalancedJournal } from "./ledger.js";
import { processAutomaticPayoutForBooking } from "./payoutAutomation.js";
import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";
import { sendAdminAlertEmail, sendUserNotificationEmail } from "./email.js";

/**
 * Side effects that run once a booking reaches `completed` (both parties, or the
 * lister-timeout auto-completion): recognize platform commission, notify
 * participants, and trigger the automatic lister payout. Safe to call more
 * than once: the commission journal is keyed and payout is idempotent.
 */
export async function runBookingCompletionSideEffects(
  supabase: ServiceRoleSupabaseClient,
  booking: {
    id: string;
    owner_id: string;
    renter_id: string;
    commission: number | string;
  },
  options: { initiatedByUserId: string | null; baseOrigin: string },
) {
  if (Number(booking.commission) > 0) {
    await postSimpleBalancedJournal(supabase, {
      bookingId: booking.id,
      eventKey: `booking:commission-earned:${booking.id}`,
      eventType: "platform_commission_earned",
      actorId: options.initiatedByUserId,
      debitAccount: "2040",
      creditAccount: "4010",
      amountCentavos: Math.round(Number(booking.commission) * 100),
      memo: "Platform commission recognized after both parties completed the trip",
    });
  }

  await sendUserNotificationEmail(supabase, {
    userId: booking.owner_id,
    title: "Trip Completed",
    message:
      "This booking is now complete. Your payout - the rental amount net of the SafeDrive commission - is being processed to your payout method. A separate payout receipt email follows.",
    link: "/lister-bookings",
    baseOrigin: options.baseOrigin,
    eventKey: `lister-trip-completed:${booking.id}`,
  });

  // The completion itself settles the pickup/return case the booking carried,
  // so its incident ticket is closed first - otherwise the payout below is
  // refused with "Open booking support case found" and nothing ever retries.
  try {
    await settleCompletedBookingCase(supabase, booking.id);
  } catch (settleError) {
    console.error(
      "Could not settle the booking case before payout:",
      settleError instanceof Error ? settleError.message : settleError,
    );
  }

  try {
    await processAutomaticPayoutForBooking({
      supabase,
      bookingId: booking.id,
      // A completion-triggered payout is always automatic, never a deliberate
      // admin release - keep the audit/notification wording accurate.
      initiatedByUserId: null,
      baseOrigin: options.baseOrigin,
    });
  } catch (payoutError) {
    console.error(
      "Automatic payout attempt failed after booking completion:",
      payoutError instanceof Error ? payoutError.message : payoutError,
    );
    await sendAdminAlertEmail(supabase, {
      subject: "Payout did not run after completion",
      message: `Booking ${booking.id} completed but the automatic lister payout threw an error and did not finish. No money moved. Open Financial Reviews -> Lister payouts and release it manually.`,
      link: "/admin/financial-reviews?view=payouts",
      baseOrigin: options.baseOrigin,
      eventKey: `payout-exception:${booking.id}`,
    }).catch(() => undefined);
  }
}

/**
 * Close the incident ticket of a booking that has completed.
 *
 * booking_incident tickets are opened only by api/booking-incident-action.ts:
 * no car / renter no-show at pickup (those bookings are cancelled, never
 * completed), a non-return report, and a lister no-show at the return. A
 * completed trip has settled the last two - resolving a non-return case is what
 * completes it, and completing the trip is the return handover happening - but
 * nothing closed the ticket, and an open ticket blocks the lister's payout.
 *
 * A non-return case still open is left alone: only the lister or support
 * closes that one. A lister-no-show-at-return case is marked resolved here, the
 * same way the return auto-completion in api/expire-booking-deadlines.ts
 * already does. Returns how many tickets were closed.
 */
export async function settleCompletedBookingCase(
  supabase: ServiceRoleSupabaseClient,
  bookingId: string,
): Promise<number> {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("status, dispute_status, dispute_reason")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError) throw bookingError;
  if (!booking || booking.status !== "completed") return 0;

  if (booking.dispute_status === "open") {
    if (booking.dispute_reason !== "lister_no_show_at_return") return 0;
    const { error: resolveError } = await supabase
      .from("bookings")
      .update({ dispute_status: "resolved" })
      .eq("id", bookingId)
      .eq("status", "completed")
      .eq("dispute_status", "open");
    if (resolveError) throw resolveError;
  }

  const { data: closedTickets, error: closeError } = await supabase
    .from("support_tickets")
    .update({ status: "closed" })
    .eq("booking_id", bookingId)
    .eq("tag", "booking_incident")
    .is("participant_user_id", null)
    .in("status", ["open", "in_progress"])
    .select("id");
  if (closeError) throw closeError;

  const closedIds = (closedTickets ?? []).map((ticket) => ticket.id as string);
  if (closedIds.length) {
    await supabase.from("audit_log").insert({
      user_id: null,
      action: "booking_incident_closed_on_completion",
      entity_type: "booking",
      entity_id: bookingId,
      details: { ticket_ids: closedIds, automated: true },
    });
  }
  return closedIds.length;
}

/* ---------------------------------------------------------------------------
 * The no-show grace window (CHAPTER 68)
 *
 * How long someone waits at the meetup, past the agreed time, before they may
 * report the other side and claim a refund. Read live, never snapshotted, and
 * every server path goes through this one function so the number that decides
 * when the button APPEARS cannot drift from the number that decides whether
 * the click is ACCEPTED - the failure that produced a visible, permanently
 * rejecting button twice before.
 *
 * It lived briefly in api/lib/noShowGrace.ts, which broke three deployments:
 * Vercel turns EVERY .ts file under api/ into a serverless function, api/lib
 * helpers included, and one more file crossed the plan's ceiling - 53 deployed,
 * 54 did not. The shared modules have since moved to server/, out of api/
 * entirely, taking the function count from 53 to 41, so that ceiling is no
 * longer close. This helper stayed here rather than moving back to a file of
 * its own; a booking timing belongs with booking lifecycle either way.
 * ------------------------------------------------------------------------ */
export const DEFAULT_NO_SHOW_GRACE_MINUTES = 30;
export const NO_SHOW_GRACE_MINUTES_MIN = 15;
export const NO_SHOW_GRACE_MINUTES_MAX = 180;

export const fetchNoShowGraceMinutes = async (
  supabase: ServiceRoleSupabaseClient,
): Promise<number> => {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("no_show_grace_minutes")
      .eq("id", "default")
      .maybeSingle();

    // A missing column (before CHAPTER 68 is run) or any lookup failure falls
    // back to the shipped default rather than taking the handler down. The
    // client falls back to the same number, so a failed read leaves the two
    // sides agreeing on 30 instead of disagreeing.
    if (error) return DEFAULT_NO_SHOW_GRACE_MINUTES;

    const parsed = Number(data?.no_show_grace_minutes);
    if (
      !Number.isFinite(parsed) ||
      parsed < NO_SHOW_GRACE_MINUTES_MIN ||
      parsed > NO_SHOW_GRACE_MINUTES_MAX
    ) {
      return DEFAULT_NO_SHOW_GRACE_MINUTES;
    }
    return Math.round(parsed);
  } catch {
    return DEFAULT_NO_SHOW_GRACE_MINUTES;
  }
};
