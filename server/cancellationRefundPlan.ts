import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";
import {
  getCancellationOutcome,
  type CancellationEvent,
  type CancellationPolicyBooking,
} from "./cancellationPolicy.js";

export { describeRenterCharge, formatPeso } from "./cancellationPolicy.js";

/**
 * The narrow booking shape this module needs. Every path that settles a
 * renter's cancellation or no-show reads its plan from here - the user's
 * `cancel` in api/booking-action.ts, the balance-deadline auto-cancel in
 * api/expire-booking-deadlines.ts (CHAPTER 42) and `renter_no_show` in
 * api/booking-incident-action.ts - so the three can never charge different
 * fees. The rules themselves are in server/cancellationPolicy.ts.
 */
export type RefundableBooking = CancellationPolicyBooking & {
  id: string;
  renter_id: string;
  owner_id: string;
  payments: Array<{
    payment_type: string;
    status: string;
    amount: number | string;
    created_at?: string | null;
  }>;
  cars?: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: { name: string };
    };
  } | null;
};

const REFUNDABLE_BOOKING_PAYMENT_TYPES = ["downpayment", "balance"];

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

// When the renter first paid - the start of the short-notice free window.
export const getFirstCapturedPaymentAtMs = (booking: RefundableBooking) => {
  const times = booking.payments
    .filter(
      (payment) =>
        REFUNDABLE_BOOKING_PAYMENT_TYPES.includes(payment.payment_type) &&
        payment.status === "completed" &&
        Number(payment.amount) > 0,
    )
    .map((payment) => new Date(payment.created_at ?? "").getTime())
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.min(...times) : null;
};

/**
 * Cancellation policy (Terms 6.1/6.2/6.4, values snapshotted per booking): a
 * free cancellation is refunded automatically; otherwise the renter is charged
 * the late-cancellation or no-show fee and the rest is refunded through admin
 * review, with the lister's compensation released in the same decision.
 */
export const getCancellationRefundPlan = (
  booking: RefundableBooking,
  event: CancellationEvent = "cancel",
  nowMs = Date.now(),
) => {
  const plan = getCancellationOutcome({
    booking,
    capturedTotal: getCapturedBookingPaymentTotal(booking),
    firstPaymentAtMs: getFirstCapturedPaymentAtMs(booking),
    nowMs,
    event,
  });
  return {
    ...plan,
    isLate: plan.outcome !== "free",
    recommendedRenterRefund: plan.renterRefund,
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
