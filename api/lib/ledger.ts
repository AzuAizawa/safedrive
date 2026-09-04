import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";

type CompletedPayment = {
  bookingId: string;
  amount: number;
  paymentType: string;
  transactionId: string;
  /**
   * Explicit lister / commission / fee split for this payment, in pesos. Used
   * when the booking-wide ratio would misallocate - e.g. a paid trip extension,
   * whose fuel top-up is a lister reimbursement and whose commission is a fixed
   * slice, not a proportion of the whole booking.
   */
  allocationOverride?: {
    ownerPesos: number;
    commissionPesos: number;
    feePesos: number;
  };
};

type LedgerEntryDraft = {
  journal_id: string;
  account_code: string;
  debit_centavos?: number;
  credit_centavos?: number;
  party_user_id?: string | null;
  memo: string;
};

const withLedgerAmounts = (entry: LedgerEntryDraft) => ({
  ...entry,
  debit_centavos: entry.debit_centavos ?? 0,
  credit_centavos: entry.credit_centavos ?? 0,
});

export function calculatePaymentLedgerAllocation(input: {
  amountCentavos: number;
  basePrice: number;
  commission: number;
  totalPrice: number;
}) {
  if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) {
    throw new Error("Ledger payment amount is invalid");
  }

  const basePrice = Math.max(0, Number(input.basePrice));
  const commission = Math.max(0, Number(input.commission));
  const totalPrice = Number(input.totalPrice);
  if (![basePrice, commission, totalPrice].every(Number.isFinite) || totalPrice <= 0) {
    throw new Error("Ledger booking allocation is invalid");
  }

  const ownerShare = Math.min(
    input.amountCentavos,
    Math.max(0, Math.round((input.amountCentavos * basePrice) / totalPrice)),
  );
  const commissionShare = Math.min(
    input.amountCentavos - ownerShare,
    Math.max(0, Math.round((input.amountCentavos * commission) / totalPrice)),
  );
  const processingFeeShare = input.amountCentavos - ownerShare - commissionShare;

  return { ownerShare, commissionShare, processingFeeShare };
}

export async function postCompletedPaymentToLedger(
  supabase: ServiceRoleSupabaseClient,
  payment: CompletedPayment,
) {
  const eventKey = `payment:${payment.paymentType}:${payment.transactionId}`;
  const { data: existing, error: existingError } = await supabase.from("ledger_journals").select("id, status").eq("event_key", eventKey).maybeSingle();
  if (existingError) {
    if (existingError.code === "42P01") return { posted: false, reason: "ledger_not_installed" };
    throw existingError;
  }
  if (existing) return { posted: false, reason: "already_posted" };

  const amountCentavos = Math.round(Number(payment.amount) * 100);
  if (!Number.isInteger(amountCentavos) || amountCentavos <= 0) throw new Error("Ledger payment amount is invalid");
  const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, renter_id, owner_id, base_price, commission, total_price, payment_processing_fee").eq("id", payment.bookingId).single();
  if (bookingError || !booking) throw bookingError || new Error("Ledger booking not found");

  const { data: journal, error: journalError } = await supabase.from("ledger_journals").insert({ booking_id: payment.bookingId, event_key: eventKey, event_type: "renter_payment_collected", provider_reference: payment.transactionId, metadata: { payment_type: payment.paymentType, source: "paymongo_webhook" } }).select("id").single();
  if (journalError || !journal) {
    if (journalError?.code === "23505") return { posted: false, reason: "already_posted" };
    throw journalError || new Error("Ledger journal was not created");
  }

  const lines: LedgerEntryDraft[] = [
    { journal_id: journal.id, account_code: "1010", debit_centavos: amountCentavos, party_user_id: booking.renter_id, memo: "Funds confirmed by PayMongo" },
  ];
  let ownerShare: number;
  let commissionShare: number;
  let feeShare: number;
  if (payment.allocationOverride) {
    commissionShare = Math.max(0, Math.round(payment.allocationOverride.commissionPesos * 100));
    feeShare = Math.max(0, Math.round(payment.allocationOverride.feePesos * 100));
    // Give the lister the exact remainder so the three lines always sum to the
    // captured amount even after per-part rounding.
    ownerShare = amountCentavos - commissionShare - feeShare;
    if (ownerShare < 0) {
      throw new Error("Ledger allocation override exceeds the captured amount");
    }
  } else {
    ({
      ownerShare,
      commissionShare,
      processingFeeShare: feeShare,
    } = calculatePaymentLedgerAllocation({
      amountCentavos,
      basePrice: Number(booking.base_price),
      commission: Number(booking.commission),
      totalPrice: Number(booking.total_price),
    }));
  }
  if (ownerShare) lines.push({ journal_id: journal.id, account_code: "2010", credit_centavos: ownerShare, party_user_id: booking.owner_id, memo: "Lister payable allocation" });
  if (commissionShare) lines.push({ journal_id: journal.id, account_code: "2040", credit_centavos: commissionShare, memo: "Platform fee deferred until completion" });
  if (feeShare) lines.push({ journal_id: journal.id, account_code: "4020", credit_centavos: feeShare, memo: "Disclosed renter processing-fee recovery" });

  const { error: entryError } = await supabase
    .from("ledger_entries")
    .insert(lines.map(withLedgerAmounts));
  if (entryError) {
    await supabase.from("ledger_journals").delete().eq("id", journal.id).eq("status", "draft");
    throw entryError;
  }
  const { error: finalizeError } = await supabase.rpc("finalize_ledger_journal", { p_journal_id: journal.id, p_actor: booking.renter_id });
  if (finalizeError) throw finalizeError;
  return { posted: true, journalId: journal.id };
}

export async function postSimpleBalancedJournal(
  supabase: ServiceRoleSupabaseClient,
  input: {
    bookingId: string;
    eventKey: string;
    eventType: string;
    providerReference?: string | null;
    actorId?: string | null;
    debitAccount: string;
    creditAccount: string;
    amountCentavos: number;
    partyUserId?: string | null;
    memo: string;
  },
) {
  if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) throw new Error("Ledger journal amount is invalid");
  const { data: existing, error: existingError } = await supabase.from("ledger_journals").select("id").eq("event_key", input.eventKey).maybeSingle();
  if (existingError) {
    if (existingError.code === "42P01") return { posted: false, reason: "ledger_not_installed" };
    throw existingError;
  }
  if (existing) return { posted: false, reason: "already_posted" };
  const { data: journal, error: journalError } = await supabase.from("ledger_journals").insert({ booking_id: input.bookingId, event_key: input.eventKey, event_type: input.eventType, provider_reference: input.providerReference || null }).select("id").single();
  if (journalError || !journal) {
    if (journalError?.code === "23505") return { posted: false, reason: "already_posted" };
    throw journalError || new Error("Ledger journal was not created");
  }
  const { error: entryError } = await supabase.from("ledger_entries").insert([
    {
      journal_id: journal.id,
      account_code: input.debitAccount,
      debit_centavos: input.amountCentavos,
      credit_centavos: 0,
      party_user_id: input.partyUserId || null,
      memo: input.memo,
    },
    {
      journal_id: journal.id,
      account_code: input.creditAccount,
      debit_centavos: 0,
      credit_centavos: input.amountCentavos,
      party_user_id: input.partyUserId || null,
      memo: input.memo,
    },
  ]);
  if (entryError) throw entryError;
  const { error: finalizeError } = await supabase.rpc("finalize_ledger_journal", { p_journal_id: journal.id, p_actor: input.actorId || undefined });
  if (finalizeError) throw finalizeError;
  return { posted: true, journalId: journal.id };
}

export async function postCompletedRefundToLedger(
  supabase: ServiceRoleSupabaseClient,
  input: {
    bookingId: string;
    amount: number;
    refundId: string;
    actorId?: string | null;
  },
) {
  const amountCentavos = Math.round(Math.abs(Number(input.amount)) * 100);
  if (!Number.isInteger(amountCentavos) || amountCentavos <= 0) {
    throw new Error("Ledger refund amount is invalid");
  }
  const eventKey = `refund:${input.refundId}`;
  const { data: existing, error: existingError } = await supabase
    .from("ledger_journals")
    .select("id, status")
    .eq("event_key", eventKey)
    .maybeSingle();
  if (existingError) {
    if (existingError.code === "42P01") return { posted: false, reason: "ledger_not_installed" };
    throw existingError;
  }
  if (existing?.status === "finalized") return { posted: false, reason: "already_posted" };
  if (existing?.status === "draft") {
    const { count: existingEntryCount, error: existingEntryError } = await supabase
      .from("ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("journal_id", existing.id);
    if (existingEntryError) throw existingEntryError;
    if ((existingEntryCount ?? 0) > 0) {
      throw new Error("Existing refund ledger journal has entries but was not finalized. Review it before retrying.");
    }

    const { error: deleteDraftError } = await supabase
      .from("ledger_journals")
      .delete()
      .eq("id", existing.id)
      .eq("status", "draft");
    if (deleteDraftError) throw deleteDraftError;
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("renter_id, owner_id, base_price, commission, total_price")
    .eq("id", input.bookingId)
    .single();
  if (bookingError || !booking) throw bookingError || new Error("Ledger booking not found");
  const allocation = calculatePaymentLedgerAllocation({
    amountCentavos,
    basePrice: Number(booking.base_price),
    commission: Number(booking.commission),
    totalPrice: Number(booking.total_price),
  });

  const { data: journal, error: journalError } = await supabase
    .from("ledger_journals")
    .insert({
      booking_id: input.bookingId,
      event_key: eventKey,
      event_type: "renter_refund_completed",
      provider_reference: input.refundId,
      metadata: { source: "paymongo_refund", amount_centavos: amountCentavos },
    })
    .select("id")
    .single();
  if (journalError || !journal) {
    if (journalError?.code === "23505") return { posted: false, reason: "already_posted" };
    throw journalError || new Error("Ledger refund journal was not created");
  }

  const lines: LedgerEntryDraft[] = [];
  if (allocation.ownerShare) lines.push({ journal_id: journal.id, account_code: "2010", debit_centavos: allocation.ownerShare, party_user_id: booking.owner_id, memo: "Reverse lister payable for refund" });
  if (allocation.commissionShare) lines.push({ journal_id: journal.id, account_code: "2040", debit_centavos: allocation.commissionShare, memo: "Reverse deferred platform fee for refund" });
  if (allocation.processingFeeShare) lines.push({ journal_id: journal.id, account_code: "4020", debit_centavos: allocation.processingFeeShare, memo: "Reverse renter fee recovery for refund" });
  lines.push({ journal_id: journal.id, account_code: "1010", credit_centavos: amountCentavos, party_user_id: booking.renter_id, memo: "PayMongo refund confirmed" });

  const { error: entryError } = await supabase
    .from("ledger_entries")
    .insert(lines.map(withLedgerAmounts));
  if (entryError) {
    await supabase.from("ledger_journals").delete().eq("id", journal.id).eq("status", "draft");
    throw entryError;
  }
  const { error: finalizeError } = await supabase.rpc("finalize_ledger_journal", {
    p_journal_id: journal.id,
    p_actor: input.actorId || undefined,
  });
  if (finalizeError) throw finalizeError;
  return { posted: true, journalId: journal.id };
}
