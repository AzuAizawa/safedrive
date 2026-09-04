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
