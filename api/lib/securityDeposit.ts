import { postSimpleBalancedJournal } from "./ledger.js";
import { processAutomaticPayoutForBooking } from "./payoutAutomation.js";
import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";
import { sendRefundReceiptEmail } from "./email.js";
import { isDemoMoneyMovementEnabled } from "./paymongoMode.js";

type ReleaseResult = {
  state: "released" | "refund_pending" | "blocked" | "already_finalized";
  status?: string;
  providerRefundId?: string | null;
  reason?: string;
};

/**
 * Shared security-deposit release path used by the super-admin endpoint, the
 * lister "confirm return - no issues" action, and the claim-window auto-release
 * job. Decides approved vs refundable, requests the PayMongo refund for the
 * refundable remainder when needed, and finalizes (ledger + notifications +
 * receipt + payout) once the refund is accepted.
 *
 * `enforceClaimWindow` is true only for the manual super-admin path; the lister
 * waiver and the auto-release job pass false because the window no longer
 * matters (the lister is waiving, or it has already elapsed).
 */
export async function runSecurityDepositRelease(
  supabase: ServiceRoleSupabaseClient,
  input: {
    depositId: string;
    actorId: string | null;
    baseOrigin: string;
    enforceClaimWindow: boolean;
  },
): Promise<ReleaseResult> {
  const paymongoKey = process.env.PAYMONGO_SECRET_KEY;

  const { data: deposit, error: depositError } = await supabase
    .from("security_deposits")
    .select("*")
    .eq("id", input.depositId)
    .single();
  if (depositError || !deposit) throw depositError || new Error("Security deposit not found");

  if (["released", "partially_released", "claimed"].includes(deposit.status)) {
    return { state: "already_finalized", status: deposit.status };
  }

  const { data: unresolvedClaims } = await supabase
    .from("security_deposit_claims")
    .select("id")
    .eq("security_deposit_id", deposit.id)
    .in("status", ["submitted", "renter_responded"]);
  if ((unresolvedClaims ?? []).length > 0) {
    return { state: "blocked", reason: "Decide every open claim before releasing the deposit" };
  }

  if (
    input.enforceClaimWindow &&
    deposit.status === "return_review" &&
    deposit.claim_deadline &&
    new Date(deposit.claim_deadline).getTime() > Date.now()
  ) {
    return { state: "blocked", reason: "The lister claim window is still open" };
  }

  if (deposit.status === "return_review") {
    await supabase
      .from("security_deposits")
      .update({ status: "no_claim" })
      .eq("id", deposit.id)
      .eq("status", "return_review");
  }

  const { data: approvedClaims } = await supabase
    .from("security_deposit_claims")
    .select("approved_amount_centavos")
    .eq("security_deposit_id", deposit.id)
    .in("status", ["approved", "partially_approved"]);
  const approved = Math.min(
    Number(deposit.amount_centavos),
    (approvedClaims ?? []).reduce(
      (sum, claim) => sum + Number(claim.approved_amount_centavos || 0),
      0,
    ),
  );
  const refundable = Math.max(0, Number(deposit.amount_centavos) - approved);

  if (refundable === 0) {
    const finalized = await finalizeSecurityDepositRelease(supabase, {
      depositId: deposit.id,
      actorId: input.actorId,
      baseOrigin: input.baseOrigin,
    });
    return { state: "released", status: finalized.status };
  }

  // Demo money-movement mode: finalize the refundable release (ledger +
  // notifications + receipt) with a synthetic reference and no PayMongo call.
  if (isDemoMoneyMovementEnabled(paymongoKey)) {
    const finalized = await finalizeSecurityDepositRelease(supabase, {
      depositId: deposit.id,
      providerRefundId: `sandbox_deposit_refund_${deposit.id.slice(0, 8)}_${Date.now()}`,
      actorId: input.actorId,
      baseOrigin: input.baseOrigin,
    });
    return { state: "released", status: finalized.status };
  }

  if (!String(deposit.provider_payment_id || "").startsWith("pay_")) {
    return {
      state: "blocked",
      reason:
        "The original PayMongo Payment ID is missing. Run reconciliation before attempting a refund.",
    };
  }
  if (!paymongoKey) {
    return { state: "blocked", reason: "PayMongo is not configured for deposit refunds" };
  }

  const authHeader = `Basic ${btoa(`${paymongoKey}:`)}`;

  if (deposit.status === "refund_pending" && deposit.provider_refund_id) {
    const check = await fetch(
      `https://api.paymongo.com/v1/refunds/${deposit.provider_refund_id}`,
      { headers: { Accept: "application/json", Authorization: authHeader } },
    );
    const checked = await check.json();
    const status = checked?.data?.attributes?.status as string | undefined;
    if (!check.ok) {
      return { state: "blocked", reason: "PayMongo refund status could not be checked" };
    }
    if (status === "succeeded") {
      const finalized = await finalizeSecurityDepositRelease(supabase, {
        depositId: deposit.id,
        providerRefundId: deposit.provider_refund_id,
        actorId: input.actorId,
        baseOrigin: input.baseOrigin,
      });
      return { state: "released", status: finalized.status };
    }
    if (status === "failed") {
      await supabase
        .from("security_deposits")
        .update({ status: "failed" })
        .eq("id", deposit.id)
        .eq("status", "refund_pending");
      return { state: "blocked", reason: "The PayMongo deposit refund failed" };
    }
    return { state: "refund_pending", providerRefundId: deposit.provider_refund_id };
  }

  const providerResponse = await fetch("https://api.paymongo.com/v1/refunds", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader,
      "Idempotency-Key": `safedrive-deposit-refund-${deposit.id}`,
    },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: refundable,
          payment_id: deposit.provider_payment_id,
          reason: "others",
          notes: `SafeDrive refundable security deposit release for booking ${deposit.booking_id}`,
        },
      },
    }),
  });
  const providerData = await providerResponse.json();
  if (!providerResponse.ok) {
    return { state: "blocked", reason: "PayMongo did not accept the deposit refund" };
  }
  const refundId = providerData?.data?.id as string | undefined;
  const refundStatus = providerData?.data?.attributes?.status as string | undefined;
  if (!refundId) {
    return { state: "blocked", reason: "PayMongo returned an incomplete refund" };
  }

  await supabase
    .from("security_deposits")
    .update({ status: "refund_pending", provider_refund_id: refundId })
    .eq("id", deposit.id)
    .in("status", ["no_claim", "deduction_approved", "failed"]);
  await supabase.from("audit_log").insert({
    user_id: input.actorId,
    action: "security_deposit_refund_requested",
    entity_type: "security_deposit",
    entity_id: deposit.id,
    details: {
      booking_id: deposit.booking_id,
      refund_id: refundId,
      refund_status: refundStatus,
      refunded_centavos: refundable,
      approved_deduction_centavos: approved,
    },
  });

  if (refundStatus === "succeeded") {
    const finalized = await finalizeSecurityDepositRelease(supabase, {
      depositId: deposit.id,
      providerRefundId: refundId,
      actorId: input.actorId,
      baseOrigin: input.baseOrigin,
    });
    return { state: "released", status: finalized.status };
  }
  return { state: "refund_pending", providerRefundId: refundId };
}

export function calculateSecurityDepositDisposition(
  totalCentavos: number,
  approvedClaimAmounts: number[],
) {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) {
    throw new Error("Security deposit amount is invalid");
  }
  const approvedTotal = approvedClaimAmounts.reduce((sum, rawAmount) => {
    const amount = Number(rawAmount);
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error("Approved security deposit claim amount is invalid");
    }
    return sum + amount;
  }, 0);
  const approvedCentavos = Math.min(totalCentavos, approvedTotal);
  const refundableCentavos = totalCentavos - approvedCentavos;
  const status =
    refundableCentavos === 0
      ? "claimed"
      : approvedCentavos > 0
        ? "partially_released"
        : "released";

  return { approvedCentavos, refundableCentavos, status };
}

export async function finalizeSecurityDepositRelease(
  supabase: ServiceRoleSupabaseClient,
  input: { depositId: string; providerRefundId?: string | null; actorId?: string | null; baseOrigin?: string | null },
) {
  const { data: deposit, error: depositError } = await supabase
    .from("security_deposits")
    .select("id, booking_id, renter_id, owner_id, amount_centavos, status, provider_refund_id")
    .eq("id", input.depositId)
    .single();
  if (depositError || !deposit) throw depositError || new Error("Security deposit not found");
  if (["released", "partially_released", "claimed"].includes(deposit.status)) {
    let payoutState: string | null = null;
    if (input.baseOrigin) {
      try {
        const payout = await processAutomaticPayoutForBooking({
          supabase,
          bookingId: deposit.booking_id,
          initiatedByUserId: input.actorId || deposit.renter_id,
          baseOrigin: input.baseOrigin,
        });
        payoutState = payout.state;
      } catch (error) {
        payoutState = "failed";
        console.error("Payout retry after deposit release failed", error);
      }
    }
    return { status: deposit.status, payoutState, alreadyFinalized: true };
  }

  const { data: claims, error: claimError } = await supabase
    .from("security_deposit_claims")
    .select("approved_amount_centavos, status")
    .eq("security_deposit_id", deposit.id)
    .in("status", ["approved", "partially_approved"]);
  if (claimError) throw claimError;

  const total = Number(deposit.amount_centavos);
  const {
    approvedCentavos: approved,
    refundableCentavos: refundable,
    status: nextStatus,
  } = calculateSecurityDepositDisposition(
    total,
    (claims ?? []).map((claim) => Number(claim.approved_amount_centavos || 0)),
  );
  const providerReference = input.providerRefundId || deposit.provider_refund_id || null;

  if (refundable > 0) {
    await postSimpleBalancedJournal(supabase, {
      bookingId: deposit.booking_id,
      eventKey: `security-deposit:refund:${deposit.id}`,
      eventType: "security_deposit_refunded",
      providerReference,
      actorId: input.actorId,
      debitAccount: "2020",
      creditAccount: "1010",
      amountCentavos: refundable,
      partyUserId: deposit.renter_id,
      memo: "Refundable security deposit returned to renter",
    });
  }
  if (approved > 0) {
    await postSimpleBalancedJournal(supabase, {
      bookingId: deposit.booking_id,
      eventKey: `security-deposit:approved-deduction:${deposit.id}`,
      eventType: "security_deposit_deduction_allocated",
      providerReference: null,
      actorId: input.actorId,
      debitAccount: "2020",
      creditAccount: "2010",
      amountCentavos: approved,
      partyUserId: deposit.owner_id,
      memo: "Approved deposit deduction added to lister payable",
    });
  }

  const { error: updateError } = await supabase.from("security_deposits").update({
    status: nextStatus,
    provider_refund_id: providerReference,
    released_at: new Date().toISOString(),
  }).eq("id", deposit.id).in("status", ["return_review", "no_claim", "deduction_approved", "refund_pending", "failed"]);
  if (updateError) throw updateError;

  await supabase.from("notifications").insert([
    { user_id: deposit.renter_id, title: "Security Deposit Review Completed", message: refundable > 0 ? `PHP ${(refundable / 100).toLocaleString()} of your security deposit was released to the original payment method.` : "The documented claim used the full security deposit after super-admin review.", type: approved > 0 ? "warning" : "success", link: `/security-deposit/${deposit.booking_id}` },
    { user_id: deposit.owner_id, title: "Security Deposit Review Completed", message: approved > 0 ? `PHP ${(approved / 100).toLocaleString()} was approved and added to your lister payable; the remaining deposit was returned to the renter.` : "No deposit deduction was approved. The refundable amount was returned to the renter.", type: "info", link: `/security-deposit/${deposit.booking_id}` },
  ]);
  if (refundable > 0 && input.baseOrigin) {
    const receipt = await sendRefundReceiptEmail(supabase, {
      bookingId: deposit.booking_id,
      amount: refundable / 100,
      refundId: providerReference || `security-deposit-${deposit.id}`,
      refundMethod: providerReference
        ? providerReference.startsWith("sandbox_deposit_refund_")
          ? "Demo refund (no real transfer)"
          : "PayMongo"
        : "Manual security-deposit return",
      baseOrigin: input.baseOrigin,
    });
    if (receipt.state !== "sent" && receipt.state !== "not_configured") {
      console.warn("Security deposit refund receipt email was not delivered", {
        state: receipt.state,
        bookingId: deposit.booking_id,
      });
    }
  }
  await supabase.from("audit_log").insert({
    user_id: input.actorId || null,
    action: "security_deposit_release_finalized",
    entity_type: "security_deposit",
    entity_id: deposit.id,
    details: { booking_id: deposit.booking_id, original_amount_centavos: total, refunded_centavos: refundable, approved_deduction_centavos: approved, provider_refund_id: providerReference, final_status: nextStatus },
  });
  let payoutState: string | null = null;
  if (input.baseOrigin) {
    try {
      const payout = await processAutomaticPayoutForBooking({
        supabase,
        bookingId: deposit.booking_id,
        initiatedByUserId: input.actorId || deposit.renter_id,
        baseOrigin: input.baseOrigin,
      });
      payoutState = payout.state;
    } catch (error) {
      payoutState = "failed";
      console.error("Automatic payout after deposit release failed", error);
    }
  }
  return { status: nextStatus, refundedCentavos: refundable, approvedDeductionCentavos: approved, payoutState, alreadyFinalized: false };
}
