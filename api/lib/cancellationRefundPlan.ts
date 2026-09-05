import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";

/**
 * The narrow booking shape this module needs. Deliberately not the full
 * BookingRecord from booking-action.ts - that file keeps its own local copy
 * of this same calculation (getCancellationRefundPlan / createManualRefundReview)
 * for its user-initiated `cancel` action, unchanged, to avoid touching a
 * large payment-critical file for this feature. This module exists so
 * api/expire-booking-deadlines.ts (the balance-payment-deadline auto-cancel,
 * CHAPTER 42) can reuse the exact same policy without duplicating the math a
 * third time - if you change the calculation here, check booking-action.ts's
 * copy too.
 */
export type RefundableBooking = {
  id: string;
  renter_id: string;
  owner_id: string;
  start_date: string;
  pickup_time: string | null;
  refund_full_hours_snapshot: number | string | null;
  refund_late_renter_percent_snapshot: number | string | null;
  payments: Array<{
    payment_type: string;
    status: string;
    amount: number | string;
  }>;
  cars?: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: { name: string };
    };
  } | null;
};

const DEFAULT_REFUND_FULL_HOURS = 24;
const DEFAULT_REFUND_LATE_RENTER_PERCENT = 50;
const REFUNDABLE_BOOKING_PAYMENT_TYPES = ["downpayment", "balance"];

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
};

export const getVehicleLabel = (booking: Pick<RefundableBooking, "id" | "cars">) => {
  if (!booking.cars) return `Booking ${booking.id}`;
  return `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`;
};

export const getCapturedBookingPaymentTotal = (booking: RefundableBooking) =>
  booking.payments
    .filter(
      (payment) =>
        REFUNDABLE_BOOKING_PAYMENT_TYPES.includes(payment.payment_type) &&
        payment.status === "completed" &&
        Number(payment.amount) > 0,
    )
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);

// Same Manila-correct pattern used across booking-action.ts /
// booking-incident-action.ts - start_date is a plain calendar date, pickup
// time is treated as Manila local time (-8h from the naive UTC instant).
const getBookingPickupMs = (booking: RefundableBooking) => {
  const [year, month, day] = (booking.start_date || "")
    .split("-")
    .map((part) => Number(part));
  const [hour, minute] = (booking.pickup_time || "09:00")
    .split(":")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour || 0, minute || 0);
  return asUtc - 8 * 60 * 60 * 1000;
};

/**
 * Cancellation-refund policy (Terms 6.1/6.2, values snapshot per booking):
 * cancelling >= refund_full_hours before pickup earns an automatic full refund;
 * inside that window the renter's share is refund_late_renter_percent and the
 * rest is short-notice lister compensation, released through admin review.
 * Identical to booking-action.ts's local copy - kept in sync manually.
 */
export const getCancellationRefundPlan = (booking: RefundableBooking) => {
  const capturedTotal = getCapturedBookingPaymentTotal(booking);
  const fullHours = Math.round(
    clampNumber(
      booking.refund_full_hours_snapshot,
      0,
      720,
      DEFAULT_REFUND_FULL_HOURS,
    ),
  );
  const lateRenterPercent = clampNumber(
    booking.refund_late_renter_percent_snapshot,
    0,
    100,
    DEFAULT_REFUND_LATE_RENTER_PERCENT,
  );
  const pickupMs = getBookingPickupMs(booking);
  const hoursToPickup =
    pickupMs === null ? null : (pickupMs - Date.now()) / (60 * 60 * 1000);
  const isLate = hoursToPickup !== null && hoursToPickup < fullHours;
  const pastPickup = hoursToPickup !== null && hoursToPickup <= 0;

  const recommendedRenterRefund = !isLate
    ? capturedTotal
    : pastPickup
      ? 0
      : Math.round(capturedTotal * (lateRenterPercent / 100) * 100) / 100;

  return {
    capturedTotal,
    fullHours,
    lateRenterPercent,
    hoursToPickup,
    isLate,
    pastPickup,
    recommendedRenterRefund,
    listerCompensation:
      Math.round((capturedTotal - recommendedRenterRefund) * 100) / 100,
  };
};

/**
 * Opens (or reuses) the manual-refund-review payment row + support ticket a
 * super-admin releases from Financial Reviews - no automatic money movement.
 * Identical to booking-action.ts's local copy except `contextLabel` replaces
 * the hardcoded "short-notice cancellation" wording so a caller outside the
 * user-initiated cancel flow (the balance-deadline auto-cancel, which has no
 * acting user - pass the booking's own renter_id as `userId`) can describe
 * itself accurately.
 */
export const createManualRefundReview = async (
  supabase: ServiceRoleSupabaseClient,
  booking: RefundableBooking,
  userId: string,
  manualDestinationNote: string | null,
  automaticFailureReason: string,
  recommendedRefundAmount?: number,
  contextLabel: string = "short-notice cancellation",
) => {
  const capturedTotal = getCapturedBookingPaymentTotal(booking);
  if (!Number.isFinite(capturedTotal) || capturedTotal <= 0) {
    throw new Error(
      "Manual refund review cannot be created without a captured refundable amount.",
    );
  }
  const hasRecommendation =
    typeof recommendedRefundAmount === "number" &&
    Number.isFinite(recommendedRefundAmount) &&
    recommendedRefundAmount >= 0 &&
    recommendedRefundAmount <= capturedTotal;
  const refundAmount = hasRecommendation ? recommendedRefundAmount : capturedTotal;

  const safeDestinationNote =
    manualDestinationNote ||
    "Admin must choose and record the manual refund return method during refund review.";
  const note = [
    "Manual refund review required.",
    hasRecommendation
      ? `Policy recommendation: refund PHP ${refundAmount.toLocaleString()} of PHP ${capturedTotal.toLocaleString()} captured (${contextLabel}). Admin confirms or adjusts.`
      : null,
    safeDestinationNote,
    `Automatic refund result: ${automaticFailureReason}`,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 450);

  const { data: existingRefundPayment, error: existingRefundPaymentError } =
    await supabase
      .from("payments")
      .select("id")
      .eq("booking_id", booking.id)
      .eq("payment_type", "refund")
      .eq("status", "pending")
      .eq("payment_method", "manual_review")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (existingRefundPaymentError) throw existingRefundPaymentError;

  let refundPaymentId = existingRefundPayment?.id as string | undefined;

  if (!refundPaymentId) {
    const { data: refundPayment, error: refundPaymentError } = await supabase
      .from("payments")
      .insert({
        booking_id: booking.id,
        amount: -Math.abs(refundAmount),
        payment_type: "refund",
        status: "pending",
        payment_method: "manual_review",
        transaction_id: null,
        notes: note,
      })
      .select("id")
      .single();

    if (refundPaymentError) throw refundPaymentError;
    refundPaymentId = refundPayment?.id as string | undefined;
  }

  const { data: existingTicket, error: existingTicketError } = await supabase
    .from("support_tickets")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("tag", "manual_refund")
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingTicketError) throw existingTicketError;

  const reusedExistingTicket = Boolean(existingTicket?.id);
  if (!reusedExistingTicket) {
    const { error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        user_id: userId,
        subject: `Manual refund review: ${getVehicleLabel(booking)}`,
        tag: "manual_refund",
        booking_id: booking.id,
        status: "open",
      })
      .select("id")
      .single();

    if (ticketError) throw ticketError;
  }

  return refundPaymentId ?? null;
};
