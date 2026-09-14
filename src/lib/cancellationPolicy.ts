// Cancellation and no-show terms (CHAPTER 91) - the browser copy of
// server/cancellationPolicy.ts, which decides the actual refund. The rules are
// explained there. Kept import-free and identical below this header so
// scripts/cancellation-policy.test.mjs can pin both copies to the same answers;
// change them together.

export const SHORT_TRIP_MAX_DAYS = 2;
export const DEFAULT_REFUND_FULL_HOURS = 24;
export const DEFAULT_REFUND_LATE_RENTER_PERCENT = 50;
export const DEFAULT_SHORT_NOTICE_FREE_HOURS = 4;
export const DEFAULT_LATE_CANCEL_FEE_DAYS = 1;
export const DEFAULT_SHORT_TRIP_LATE_CANCEL_FEE_DAYS = 0.5;
export const DEFAULT_NO_SHOW_FEE_DAYS = 2;
export const DEFAULT_SHORT_TRIP_NO_SHOW_FEE_DAYS = 0.75;

type StoredValue = number | string | null | undefined;

export type CancellationPolicyBooking = {
  start_date: string;
  pickup_time: string | null;
  total_days?: StoredValue;
  total_price?: StoredValue;
  base_price?: StoredValue;
  refund_full_hours_snapshot?: StoredValue;
  refund_late_renter_percent_snapshot?: StoredValue;
  short_notice_free_hours_snapshot?: StoredValue;
  late_cancel_fee_days_snapshot?: StoredValue;
  short_trip_late_cancel_fee_days_snapshot?: StoredValue;
  no_show_fee_days_snapshot?: StoredValue;
  short_trip_no_show_fee_days_snapshot?: StoredValue;
};

export type CancellationEvent = "cancel" | "no_show";

export type CancellationOutcome = {
  terms: "fee_days" | "legacy_percent";
  outcome: "free" | "late_cancel" | "no_show";
  freeReason: "before_window" | "short_notice_grace" | null;
  // When the free cancellation that applies right now ends.
  freeUntilMs: number | null;
  fullHours: number;
  hoursToPickup: number | null;
  pastPickup: boolean;
  capturedTotal: number;
  feeDays: number | null;
  // The fee as the policy counts it, before the cap at what was paid.
  feeBeforeCap: number;
  fee: number;
  renterRefund: number;
  // What the lister receives. The ledger reverses a refund in the same
  // proportions the payment was booked, so the payment-processing part of the
  // fee stays with SafeDrive and the lister gets the rental part.
  listerCompensation: number;
  lateRenterPercent: number | null;
};

const HOUR_MS = 3_600_000;

// An empty value is "not set", never 0. Number(null) is 0, which is a valid
// setting, so a bare range check would read a missing snapshot as "no fee".
const storedNumber = (value: unknown, min: number, max: number) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

const toPesos = (amount: number) => Math.round(amount * 100) / 100;

// start_date is a plain calendar date and pickup_time is Manila local time.
export const getPickupMs = (
  booking: Pick<CancellationPolicyBooking, "start_date" | "pickup_time">,
) => {
  const [year, month, day] = (booking.start_date || "").split("-").map((part) => Number(part));
  const [hour, minute] = (booking.pickup_time || "09:00").split(":").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day, hour || 0, minute || 0) - 8 * HOUR_MS;
};

// Every booking created since CHAPTER 91 carries this snapshot; an older one
// never does.
export const usesFeeDayTerms = (booking: CancellationPolicyBooking) =>
  storedNumber(booking.late_cancel_fee_days_snapshot, 0, 30) !== null;

export const getCancellationOutcome = (input: {
  booking: CancellationPolicyBooking;
  capturedTotal: number;
  firstPaymentAtMs: number | null;
  nowMs: number;
  event: CancellationEvent;
}): CancellationOutcome => {
  const { booking, event, nowMs } = input;
  const capturedTotal = Math.max(0, toPesos(Number(input.capturedTotal) || 0));
  const fullHours = Math.round(
    storedNumber(booking.refund_full_hours_snapshot, 0, 720) ?? DEFAULT_REFUND_FULL_HOURS,
  );
  const pickupMs = getPickupMs(booking);
  const hoursToPickup = pickupMs === null ? null : (pickupMs - nowMs) / HOUR_MS;
  const pastPickup = hoursToPickup !== null && hoursToPickup <= 0;
  const feeDayTerms = usesFeeDayTerms(booking);
  const terms: CancellationOutcome["terms"] = feeDayTerms ? "fee_days" : "legacy_percent";
  const common = { terms, fullHours, hoursToPickup, pastPickup, capturedTotal };

  if (event === "cancel") {
    const free = (
      freeReason: "before_window" | "short_notice_grace",
      freeUntilMs: number | null,
    ): CancellationOutcome => ({
      ...common,
      outcome: "free",
      freeReason,
      freeUntilMs,
      feeDays: null,
      feeBeforeCap: 0,
      fee: 0,
      renterRefund: capturedTotal,
      listerCompensation: 0,
      lateRenterPercent: null,
    });

    if (hoursToPickup === null || hoursToPickup >= fullHours) {
      return free("before_window", pickupMs === null ? null : pickupMs - fullHours * HOUR_MS);
    }
    if (feeDayTerms && pickupMs !== null && !pastPickup && input.firstPaymentAtMs !== null) {
      const graceHours =
        storedNumber(booking.short_notice_free_hours_snapshot, 0, 24) ??
        DEFAULT_SHORT_NOTICE_FREE_HOURS;
      const graceEndsMs = Math.min(input.firstPaymentAtMs + graceHours * HOUR_MS, pickupMs);
      if (nowMs < graceEndsMs) return free("short_notice_grace", graceEndsMs);
    }
  }

  const outcome: CancellationOutcome["outcome"] =
    event === "no_show" || pastPickup ? "no_show" : "late_cancel";

  if (!feeDayTerms) {
    const lateRenterPercent =
      storedNumber(booking.refund_late_renter_percent_snapshot, 0, 100) ??
      DEFAULT_REFUND_LATE_RENTER_PERCENT;
    // Unchanged pre-CHAPTER 91 terms, including that a renter cancelling after
    // the pickup time was recommended no refund at all.
    const renterRefund =
      event === "cancel" && pastPickup ? 0 : toPesos(capturedTotal * (lateRenterPercent / 100));
    const fee = toPesos(capturedTotal - renterRefund);
    return {
      ...common,
      outcome,
      freeReason: null,
      freeUntilMs: null,
      feeDays: null,
      feeBeforeCap: fee,
      fee,
      renterRefund,
      listerCompensation: fee,
      lateRenterPercent,
    };
  }

  const totalDays = Number(booking.total_days);
  const totalPrice = Number(booking.total_price);
  const basePrice = Number(booking.base_price);
  const shortTrip = !(totalDays > SHORT_TRIP_MAX_DAYS);
  const feeDays =
    outcome === "no_show"
      ? shortTrip
        ? storedNumber(booking.short_trip_no_show_fee_days_snapshot, 0, 2) ??
          DEFAULT_SHORT_TRIP_NO_SHOW_FEE_DAYS
        : storedNumber(booking.no_show_fee_days_snapshot, 0, 30) ?? DEFAULT_NO_SHOW_FEE_DAYS
      : shortTrip
        ? storedNumber(booking.short_trip_late_cancel_fee_days_snapshot, 0, 2) ??
          DEFAULT_SHORT_TRIP_LATE_CANCEL_FEE_DAYS
        : storedNumber(booking.late_cancel_fee_days_snapshot, 0, 30) ??
          DEFAULT_LATE_CANCEL_FEE_DAYS;

  // Turo's "average cost of one day": the whole booking total over its days.
  const dailyCost = totalDays > 0 && totalPrice > 0 ? totalPrice / totalDays : 0;
  const feeBeforeCap = toPesos(dailyCost * feeDays);
  const fee = Math.min(capturedTotal, feeBeforeCap);
  const listerShare =
    totalPrice > 0 && basePrice >= 0 && basePrice <= totalPrice ? basePrice / totalPrice : 1;

  return {
    ...common,
    outcome,
    freeReason: null,
    freeUntilMs: null,
    feeDays,
    feeBeforeCap,
    fee,
    renterRefund: toPesos(capturedTotal - fee),
    listerCompensation: toPesos(fee * listerShare),
    lateRenterPercent: null,
  };
};

export const formatPeso = (amount: number) =>
  `PHP ${amount.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const formatFeeDays = (days: number) => {
  if (days === 1) return "1 day";
  if (days === 0.5) return "half a day";
  if (days > 0 && days < 1) return `${Math.round(days * 100)}% of a day`;
  return `${Math.round(days * 100) / 100} days`;
};

// "a late-cancellation fee of PHP 500 (half a day of rental)"
export const describeRenterCharge = (plan: CancellationOutcome) => {
  if (plan.outcome === "free") return "no fee";
  if (plan.terms === "legacy_percent" || plan.feeDays === null) {
    return `${formatPeso(plan.fee)} under the short-notice terms this booking was made with`;
  }
  const kind = plan.outcome === "no_show" ? "a no-show fee" : "a late-cancellation fee";
  const capped =
    plan.capturedTotal > 0 && plan.fee < plan.feeBeforeCap
      ? `, capped at the ${formatPeso(plan.fee)} paid`
      : "";
  return `${kind} of ${formatPeso(plan.feeBeforeCap)} (${formatFeeDays(plan.feeDays)} of rental${capped})`;
};

export type PickupProgress = {
  renter_arrived_at?: string | null;
  lister_arrived_at?: string | null;
  lister_handover_confirmed_at?: string | null;
  renter_handover_received_at?: string | null;
};

// Whether the pickup has gone too far for this side to cancel. Nobody may once
// the car is handed over. A renter may not after either side has checked in on
// arrival - the no-car and no-show reports settle that, and a renter cancel at
// the meetup would be a free way around the late fee. A lister may, up to the
// handover: the car can turn out undrivable at the meetup, and the renter, who
// travelled for nothing, is then refunded in full.
export const pickupBlocksCancellation = (
  booking: PickupProgress,
  role: "renter" | "lister",
) => {
  if (booking.lister_handover_confirmed_at || booking.renter_handover_received_at) return true;
  if (role === "lister") return false;
  return Boolean(booking.renter_arrived_at || booking.lister_arrived_at);
};
