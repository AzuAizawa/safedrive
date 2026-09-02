import { postSimpleBalancedJournal } from "./ledger.js";
import { processAutomaticPayoutForBooking } from "./payoutAutomation.js";
import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";
import { sendAdminAlertEmail, sendUserNotificationEmail } from "./email.js";

const DEFAULT_DEPOSIT_CLAIM_WINDOW_HOURS = 24;

const clampWholeHours = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return Math.round(parsed);
};

export const fetchDepositClaimWindowHours = async (
  supabase: ServiceRoleSupabaseClient,
) => {
  const { data } = await supabase
    .from("platform_settings")
    .select("deposit_claim_window_hours")
    .eq("id", "default")
    .maybeSingle();
  return clampWholeHours(
    data?.deposit_claim_window_hours,
    1,
    168,
    DEFAULT_DEPOSIT_CLAIM_WINDOW_HOURS,
  );
};

/**
 * Side effects that run once a booking reaches `completed` (both parties, or the
 * lister-timeout auto-completion): recognize platform commission, open the
 * security-deposit return-review window, notify participants, and - when there
 * is no deposit to review - trigger the automatic lister payout. Safe to call
 * more than once: the commission journal is keyed and the deposit update is
 * status-guarded.
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
      "This booking is now complete. Your payout - the rental amount net of the SafeDrive commission - is being processed to your payout method (after any security-deposit review closes). A separate payout receipt email follows.",
    link: "/lister-bookings",
    baseOrigin: options.baseOrigin,
    eventKey: `lister-trip-completed:${booking.id}`,
  });

  const claimWindowHours = await fetchDepositClaimWindowHours(supabase);
  const claimDeadline = new Date(
    Date.now() + claimWindowHours * 60 * 60 * 1000,
  ).toISOString();
  const { data: depositForReview, error: depositReviewError } = await supabase
    .from("security_deposits")
    .update({ status: "return_review", claim_deadline: claimDeadline })
    .eq("booking_id", booking.id)
    .eq("status", "paid")
    .select("id")
    .maybeSingle();
  if (depositReviewError) throw depositReviewError;

  if (depositForReview) {
    await supabase.from("notifications").insert([
      {
        user_id: booking.owner_id,
        title: "Security Deposit Review Window",
        message: `Confirm the return, or submit a documented deposit claim within ${claimWindowHours} hours. No deduction is automatic; after the window the deposit is released to the renter.`,
        type: "warning",
        link: "/lister-bookings",
      },
      {
        user_id: booking.renter_id,
        title: "Security Deposit Under Return Review",
        message: `The refundable deposit is in a ${claimWindowHours}-hour evidence review window before it is released back to you.`,
        type: "info",
        link: "/my-bookings",
      },
    ]);
    return { depositInReview: true };
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
  return { depositInReview: false };
}
