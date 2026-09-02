import { postSimpleBalancedJournal } from "./ledger.js";
import { processAutomaticPayoutForBooking } from "./payoutAutomation.js";
import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";
import { sendRefundReceiptEmail } from "./email.js";

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
      refundMethod: providerReference ? "PayMongo" : "Manual security-deposit return",
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
