// Manual refund review (Financial Reviews -> Renter refunds): what kind of case
// a pending manual refund is, how much can still go back, and whether a super
// admin's decision is allowed. Used identically by api/mark-manual-refund.ts
// (server/refundDecision.ts) and the review page (src/lib/refundDecision.ts);
// scripts/refund-decision.test.mjs keeps the two copies the same.

export type ManualRefundKind =
  | "payment_not_applied"
  | "automatic_refund_failed"
  | "documents_not_cleared"
  | "no_car_claim"
  | "renter_no_show"
  | "nobody_checked_in"
  | "cancellation_policy"
  | "other";

type KindCopy = {
  label: string;
  guidance: string;
  // false: nothing to judge - the refund is released as recommended.
  adjustable: boolean;
};

export const MANUAL_REFUND_KINDS: Record<ManualRefundKind, KindCopy> = {
  payment_not_applied: {
    label: "Payment not applied",
    guidance:
      "Money arrived that could not be applied to the booking. It is refunded in full - there is nothing to decide.",
    adjustable: false,
  },
  automatic_refund_failed: {
    label: "Automatic refund failed",
    guidance:
      "The renter is owed this refund, but it could not be sent automatically. Send it manually and record the reference.",
    adjustable: false,
  },
  documents_not_cleared: {
    label: "Vehicle documents not cleared",
    guidance:
      "The booking was cancelled because the vehicle's documents did not cover it at pickup - not the renter's doing. It is refunded in full.",
    adjustable: false,
  },
  no_car_claim: {
    label: "Claim: no car at pickup",
    guidance:
      "The renter was not handed the car. Check both check-in times, the photos and the case before deciding. A full refund is recommended if the claim holds.",
    adjustable: true,
  },
  renter_no_show: {
    label: "Renter no-show",
    guidance:
      "The renter did not show up, so the no-show fee applies. Check both check-in times and the case before deciding.",
    adjustable: true,
  },
  nobody_checked_in: {
    label: "Nobody checked in",
    guidance:
      "Neither side checked in at pickup. A full refund is recommended unless the case shows otherwise.",
    adjustable: true,
  },
  cancellation_policy: {
    label: "Cancellation fee",
    guidance:
      "The cancellation policy charged a fee (a late cancellation or a missed balance deadline). Change it only with a documented reason.",
    adjustable: true,
  },
  other: {
    label: "Manual review",
    guidance: "Read the note and the case before deciding.",
    adjustable: true,
  },
};

// Every place that queues a manual refund writes one of these phrases into the
// row's note (the context label near the start, so the 450-character note
// limit never cuts it off). Checked most specific first.
export const classifyManualRefund = (
  notes: string | null | undefined,
): ManualRefundKind => {
  const text = (notes ?? "").toLowerCase();
  if (text.startsWith("unapplied payment")) return "payment_not_applied";
  if (
    text.includes("vehicle documents not cleared by pickup") ||
    text.includes("vehicle documents still under review at pickup")
  ) {
    return "documents_not_cleared";
  }
  if (text.includes("no vehicle at pickup") || text.includes("car not handed over at pickup")) {
    return "no_car_claim";
  }
  if (text.includes("renter no-show at pickup")) return "renter_no_show";
  if (text.includes("neither party checked in at pickup")) return "nobody_checked_in";
  if (
    text.includes("balance payment deadline") ||
    text.includes("short-notice cancellation") ||
    text.includes("late cancellation")
  ) {
    return "cancellation_policy";
  }
  if (text.includes("automatic refund result:")) return "automatic_refund_failed";
  return "other";
};

export const roundPesos = (value: number) => Math.round(value * 100) / 100;

const REFUNDABLE_PAYMENT_TYPES = ["downpayment", "balance", "extension"];

// What a booking collected, what has already gone back, and what is left that
// could still be refunded. A pending refund row is not counted as refunded;
// the refunds still owed besides the one being decided (pending, or failed and
// waiting for a retry) are reported separately so a changed amount cannot use
// money another refund on the booking is meant to return.
export const getRefundCapacity = (
  payments: Array<{
    id?: string;
    payment_type: string;
    status: string;
    amount: number | string | null;
  }>,
  excludePaymentId?: string | null,
) => {
  const collected = payments
    .filter(
      (row) =>
        REFUNDABLE_PAYMENT_TYPES.includes(String(row.payment_type)) &&
        row.status === "completed" &&
        Number(row.amount) > 0,
    )
    .reduce((total, row) => total + Number(row.amount || 0), 0);
  const refunded = payments
    .filter((row) => row.payment_type === "refund" && row.status === "completed")
    .reduce((total, row) => total + Math.abs(Number(row.amount || 0)), 0);
  const reservedByOtherRefunds = payments
    .filter(
      (row) =>
        row.payment_type === "refund" &&
        (row.status === "pending" || row.status === "failed") &&
        (!excludePaymentId || row.id !== excludePaymentId),
    )
    .reduce((total, row) => total + Math.abs(Number(row.amount || 0)), 0);
  return {
    collected: roundPesos(collected),
    refunded: roundPesos(refunded),
    available: roundPesos(Math.max(0, collected - refunded)),
    reservedByOtherRefunds: roundPesos(reservedByOtherRefunds),
  };
};

export const REFUND_DECISION_REASON_MIN = 10;

export type RefundDecision = "as_recommended" | "adjusted" | "denied";

export type RefundDecisionResult =
  | { ok: true; amount: number; decision: RefundDecision; reason: string | null }
  | { ok: false; code: "invalid_amount" | "over_capacity" | "not_adjustable" | "reason_required"; error: string };

const peso = (amount: number) =>
  `PHP ${amount.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// `requested` null/undefined means "release as recommended", exactly the
// release that existed before a decision could be made - it keeps the one
// guard it always had (never more than collected and not yet refunded).
//
// A changed amount must also leave a destination for the difference. Only a
// cancelled booking has one: the lister's compensation is read from what the
// refund leaves in the ledger (server/cancellationCompensation.ts). On any
// other booking the difference would reach no one.
export const decideRefund = (input: {
  kind: ManualRefundKind;
  bookingStatus: string | null | undefined;
  recommended: number;
  requested: number | null | undefined;
  available: number;
  reservedByOtherRefunds?: number;
  reason: string | null | undefined;
}): RefundDecisionResult => {
  const recommended = roundPesos(Math.abs(Number(input.recommended) || 0));
  const amount =
    input.requested === null || input.requested === undefined
      ? recommended
      : roundPesos(Number(input.requested));

  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, code: "invalid_amount", error: "Enter a refund amount of PHP 0 or more." };
  }
  if (amount > input.available + 0.005) {
    return {
      ok: false,
      code: "over_capacity",
      error: `The renter can get back at most ${peso(input.available)} - what this booking collected and has not already refunded.`,
    };
  }

  const reason = (input.reason ?? "").trim();
  if (Math.abs(amount - recommended) <= 0.005) {
    return { ok: true, amount: recommended, decision: "as_recommended", reason: reason || null };
  }

  const copy = MANUAL_REFUND_KINDS[input.kind];
  if (!copy.adjustable) {
    return {
      ok: false,
      code: "not_adjustable",
      error: `${copy.label}: this refund is not a judgement call, so it is released as recommended (${peso(recommended)}).`,
    };
  }
  if (input.bookingStatus !== "cancelled") {
    return {
      ok: false,
      code: "not_adjustable",
      error: `Only a cancelled booking's refund can be changed - on this booking nothing would receive the difference, so it is released as recommended (${peso(recommended)}).`,
    };
  }

  const reserved = roundPesos(Math.max(0, Number(input.reservedByOtherRefunds) || 0));
  const maxForDecision = roundPesos(Math.max(0, input.available - reserved));
  if (amount > maxForDecision + 0.005) {
    return {
      ok: false,
      code: "over_capacity",
      error: `The renter can get back at most ${peso(maxForDecision)} here - ${peso(reserved)} of what is left is already owed through another refund on this booking.`,
    };
  }

  if (reason.length < REFUND_DECISION_REASON_MIN) {
    return {
      ok: false,
      code: "reason_required",
      error: `Give a reason of at least ${REFUND_DECISION_REASON_MIN} characters for changing the recommended ${peso(recommended)} - the renter and the lister are both sent it.`,
    };
  }
  return { ok: true, amount, decision: amount === 0 ? "denied" : "adjusted", reason };
};
