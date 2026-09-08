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
 * WHY IT LIVES HERE rather than in its own api/lib/noShowGrace.ts, which is
 * where it belongs: Vercel turns EVERY .ts file under api/ into a serverless
 * function, api/lib helpers included, and this project sits right on the
 * plan's function ceiling. 53 files deploy; 54 fail. Adding one more file for
 * this helper broke three deployments in a row while every local build passed.
 *
 * So the constraint is real and it is not going away on its own: until the
 * api/lib helpers are moved out of api/ entirely (they are shared modules, not
 * endpoints, and should never have been counted as functions), a NEW FILE
 * UNDER api/ WILL BREAK THE DEPLOYMENT. Add shared server code to an existing
 * module instead, as this does.
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
