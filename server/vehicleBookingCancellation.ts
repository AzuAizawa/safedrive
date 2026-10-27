import { sendUserNotificationEmail } from "./email.js";
import {
  createManualRefundReview,
  processAutomaticRefundForBooking,
} from "./refundAutomation.js";
import { getVehicleLabel } from "./cancellationRefundPlan.js";
import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";

/**
 * Bookings that have not started when SafeDrive takes a car off the platform,
 * by removing it (CHAPTER 120) or disabling it (CHAPTER 131). A booking whose
 * handover has begun is not among them: it runs to its end.
 */
export const NOT_STARTED_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "awaiting_payment",
  "downpayment_paid",
  "fully_paid",
];
const REFUNDABLE = ["downpayment", "balance"];

export const NOT_STARTED_BOOKING_SELECT =
  "id, renter_id, owner_id, status, start_date, end_date, cars(plate_number, car_models(name, car_brands(name))), payments(payment_type, status, amount)";

export type CancellableBooking = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  start_date: string;
  end_date: string;
  cars: { plate_number: string; car_models: { name: string; car_brands: { name: string } } } | null;
  payments: Array<{ payment_type: string; status: string; amount: number | string }>;
};

/**
 * A disabled car's trip under way runs to its scheduled end and no further
 * (CHAPTER 131): no extension is asked for, approved, or paid for.
 */
export const DISABLED_CAR_EXTENSION_MESSAGE =
  "SafeDrive disabled this vehicle, so the trip cannot be extended. Return it on the original date.";

export async function carIsDisabled(supabase: ServiceRoleSupabaseClient, carId: string) {
  const { data, error } = await supabase.from("cars").select("status").eq("id", carId).maybeSingle();
  if (error) throw error;
  return (data as { status?: string } | null)?.status === "disabled";
}

/** Why the car left: the words the renter and lister read, and how it is recorded. */
export type VehicleExit = "removed" | "disabled";

const WORDING: Record<VehicleExit, {
  verb: string;
  audit: string;
  eventKey: string;
}> = {
  removed: { verb: "removed", audit: "admin_cancelled_booking_for_vehicle_removal", eventKey: "vehicle-removal-cancel" },
  disabled: { verb: "disabled", audit: "admin_cancelled_booking_for_vehicle_disable", eventKey: "vehicle-disable-cancel" },
};

/**
 * Cancel one booking that has not started because SafeDrive removed or
 * disabled its car: the renter is refunded everything they paid (a failed
 * automatic refund goes to manual review), the cancellation does not count
 * against the lister, and both sides are told and emailed.
 * Returns false when the booking moved on (e.g. the handover began) - it is
 * then left to finish.
 */
export async function cancelBookingForVehicleExit(
  supabase: ServiceRoleSupabaseClient,
  booking: CancellableBooking,
  carId: string,
  adminId: string,
  reason: string,
  baseOrigin: string,
  exit: VehicleExit,
) {
  const words = WORDING[exit];
  const { data: claimed, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", payment_deadline: null })
    .eq("id", booking.id)
    .is("lister_handover_confirmed_at", null)
    .in("status", NOT_STARTED_BOOKING_STATUSES)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!claimed) return false;

  const label = getVehicleLabel(booking);
  const paid = booking.payments.some(
    (p) => REFUNDABLE.includes(p.payment_type) && p.status === "completed" && Number(p.amount) > 0,
  );
  let refundState = "none";
  if (paid) {
    const note = `SafeDrive ${words.verb} this vehicle (${reason}); the renter is refunded in full.`;
    try {
      const outcome = await processAutomaticRefundForBooking({
        supabase,
        bookingId: booking.id,
        initiatedByUserId: adminId,
        reason: "others",
        note,
        allowedPaymentTypes: REFUNDABLE,
        baseOrigin,
      });
      refundState = outcome.state;
      const outcomeReason = "reason" in outcome && outcome.reason ? outcome.reason : note;
      if (outcome.state === "failed" || (outcome.state === "skipped" && !/already pending/i.test(outcomeReason))) {
        await createManualRefundReview(supabase, booking, booking.renter_id, null, outcomeReason);
        refundState = "manual_review";
      }
    } catch (refundError) {
      await createManualRefundReview(
        supabase,
        booking,
        booking.renter_id,
        null,
        refundError instanceof Error ? refundError.message : "Automatic refund failed",
      );
      refundState = "manual_review";
    }
  }

  await supabase.from("booking_cancellations").upsert(
    {
      booking_id: booking.id,
      cancelled_by_role: "lister",
      cancelled_by_id: adminId,
      lister_id: booking.owner_id,
      renter_id: booking.renter_id,
      car_id: carId,
      reason: `SafeDrive ${words.verb} the vehicle: ${reason}`,
      hours_before_pickup: null,
      was_late: false,
      had_captured_payment: paid,
      strike_waived: true,
    },
    { onConflict: "booking_id" },
  );
  await supabase.from("audit_log").insert({
    user_id: adminId,
    action: words.audit,
    entity_type: "booking",
    entity_id: booking.id,
    details: { vehicle: label, reason, refund_state: refundState },
  });

  const dates = `${booking.start_date} to ${booking.end_date}`;
  const renterNotice = {
    title: "Your booking was cancelled",
    message: paid
      ? `SafeDrive ${words.verb} ${label}${exit === "removed" ? " from the platform" : ""}, so your booking for ${dates} was cancelled. Everything you paid is being refunded to you in full. Browse other cars to rebook.`
      : `SafeDrive ${words.verb} ${label}${exit === "removed" ? " from the platform" : ""}, so your booking request for ${dates} was cancelled. Browse other cars to rebook.`,
  };
  const listerNotice = {
    title: "A booking was cancelled",
    message: `Because SafeDrive ${words.verb} ${label}, its booking for ${dates} was cancelled${paid ? " and the renter is refunded in full" : ""}. This does not count against you as a late cancellation.`,
  };
  await supabase.from("notifications").insert([
    { user_id: booking.renter_id, ...renterNotice, type: "error", link: "/my-bookings" },
    { user_id: booking.owner_id, ...listerNotice, type: "info", link: "/lister-bookings" },
  ]);
  await sendUserNotificationEmail(supabase, {
    userId: booking.renter_id,
    ...renterNotice,
    link: "/my-bookings",
    baseOrigin,
    eventKey: `${words.eventKey}:${booking.id}:renter`,
  });
  await sendUserNotificationEmail(supabase, {
    userId: booking.owner_id,
    ...listerNotice,
    link: "/lister-bookings",
    baseOrigin,
    eventKey: `${words.eventKey}:${booking.id}:lister`,
  });
  return true;
}
