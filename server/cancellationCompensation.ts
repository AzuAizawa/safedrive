import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";
import { postSimpleBalancedJournal } from "./ledger.js";
import { isDemoMoneyMovementEnabled } from "./paymongoMode.js";
import { sendCompensationReceiptEmail } from "./email.js";

/**
 * Short-notice compensation for the lister on a cancelled booking.
 *
 * When a renter cancels inside the refund window (or fails to show at pickup),
 * policy returns a share of what they paid and keeps the rest as compensation
 * for the lister - the Terms, the Platform Agreement and the help center all
 * say so. Until now that second half existed only as a sentence: the refund
 * plan computed `listerCompensation` and wrote it into a message and an audit
 * row, and nothing ever paid it. The only payout path in the system
 * (processAutomaticPayoutForBooking) releases money for a COMPLETED booking,
 * and a cancelled one never completes. The money sat in the ledger as owed to
 * the lister indefinitely.
 *
 * This releases it in the same super-admin decision that releases the renter's
 * refund, so one click settles both sides.
 *
 * Two rules the amount follows:
 *
 * - It is read off the booking's own ledger, not recomputed. After the refund
 *   journal posts, whatever is still credited to the lister payable (2010)
 *   and the deferred platform fee (2040) is exactly what the renter did not get
 *   back - to the centavo, whatever share the admin actually refunded. The
 *   processing-fee recovery (4020) is SafeDrive's and is not touched.
 *
 * - No commission is taken. SafeDrive's commission is "deferred until
 *   completion" and is only recognised when both parties complete a trip
 *   (server/bookingCompletion.ts). A cancelled booking has no trip, so the
 *   deferred fee is moved to the lister rather than kept.
 */

const LISTER_PAYABLE = "2010";
const DEFERRED_PLATFORM_FEE = "2040";
const CASH = "1010";

type LedgerEntryLike = {
  account_code: string;
  debit_centavos: number | string | null;
  credit_centavos: number | string | null;
};

/**
 * What the lister is owed on a booking, from its ledger entries. Pure, so the
 * arithmetic is proved in scripts/cancellation-compensation.test.mjs.
 *
 * An account that has been reversed past zero is treated as owing nothing -
 * a negative figure here would mean paying the renter through the lister.
 */
export function summarizeCompensationFromEntries(entries: LedgerEntryLike[]) {
  let listerPayable = 0;
  let deferredFee = 0;
  for (const entry of entries) {
    const net =
      (Number(entry.credit_centavos) || 0) - (Number(entry.debit_centavos) || 0);
    if (entry.account_code === LISTER_PAYABLE) listerPayable += net;
    else if (entry.account_code === DEFERRED_PLATFORM_FEE) deferredFee += net;
  }
  const listerPayableCentavos = Math.max(0, Math.round(listerPayable));
  const deferredFeeCentavos = Math.max(0, Math.round(deferredFee));
  return {
    listerPayableCentavos,
    deferredFeeCentavos,
    totalCentavos: listerPayableCentavos + deferredFeeCentavos,
  };
}

export type CompensationResult =
  | { state: "completed"; amount: number; paymentId: string; transactionId: string }
  | { state: "pending"; amount: number; paymentId: string; reason: string }
  | { state: "already_released"; reason: string }
  | { state: "skipped"; reason: string };

type BookingForCompensation = {
  id: string;
  status: string;
  owner_id: string;
  cars: {
    plate_number: string;
    car_models: { name: string; car_brands: { name: string } } | null;
  } | null;
};

const vehicleLabel = (booking: BookingForCompensation) => {
  const model = booking.cars?.car_models;
  const name = model ? `${model.car_brands.name} ${model.name}` : "your vehicle";
  return booking.cars?.plate_number ? `${name} (${booking.cars.plate_number})` : name;
};

const peso = (amount: number) =>
  `PHP ${amount.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export async function releaseCancellationCompensation(
  supabase: ServiceRoleSupabaseClient,
  input: { bookingId: string; actorId: string | null; baseOrigin: string },
): Promise<CompensationResult> {
  const { data: bookingRow, error: bookingError } = await supabase
    .from("bookings")
    .select("id, status, owner_id, cars(plate_number, car_models(name, car_brands(name)))")
    .eq("id", input.bookingId)
    .maybeSingle();
  if (bookingError) throw bookingError;
  if (!bookingRow) return { state: "skipped", reason: "Booking not found." };

  const booking = bookingRow as unknown as BookingForCompensation;

  // A running or completed booking is paid through the ordinary payout path.
  // An early-return goodwill refund also lands here, and must not trigger this.
  if (booking.status !== "cancelled") {
    return {
      state: "skipped",
      reason: "Only a cancelled booking carries short-notice compensation.",
    };
  }

  const { data: existingPayout, error: existingError } = await supabase
    .from("payments")
    .select("id, status, amount")
    .eq("booking_id", booking.id)
    .eq("payment_type", "payout")
    .in("status", ["pending", "completed"])
    .maybeSingle();
  if (existingError) throw existingError;

  if (existingPayout?.status === "completed") {
    return {
      state: "already_released",
      reason: "The lister's compensation for this booking was already paid.",
    };
  }

  const { data: journals, error: journalError } = await supabase
    .from("ledger_journals")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("status", "finalized");
  if (journalError) {
    if (journalError.code === "42P01") {
      return { state: "skipped", reason: "The ledger is not installed, so compensation cannot be read from it." };
    }
    throw journalError;
  }

  const journalIds = (journals ?? []).map((journal) => journal.id as string);
  if (!journalIds.length) {
    // Money was taken before the ledger recorded bookings. Rather than guess a
    // figure, leave it for a person - an unpaid lister is recoverable, an
    // overpaid one is not.
    return {
      state: "skipped",
      reason:
        "This booking has no ledger record, so the amount owed to the lister could not be confirmed. Settle it manually.",
    };
  }

  const { data: entries, error: entryError } = await supabase
    .from("ledger_entries")
    .select("account_code, debit_centavos, credit_centavos")
    .in("journal_id", journalIds);
  if (entryError) throw entryError;

  const summary = summarizeCompensationFromEntries(entries ?? []);
  if (summary.totalCentavos <= 0) {
    return {
      state: "skipped",
      reason: "Nothing is owed to the lister - the renter was refunded in full.",
    };
  }

  const amount = summary.totalCentavos / 100;
  const demo = isDemoMoneyMovementEnabled(process.env.PAYMONGO_SECRET_KEY);
  const vehicle = vehicleLabel(booking);

  const { data: owner } = await supabase
    .from("profiles")
    .select("payout_method")
    .eq("id", booking.owner_id)
    .maybeSingle();

  // Reuse a pending row left behind by an interrupted earlier attempt instead
  // of creating a second one - the unique index would refuse it anyway.
  let paymentId: string;
  if (existingPayout?.status === "pending") {
    if (Math.round(Number(existingPayout.amount) * 100) !== summary.totalCentavos) {
      return {
        state: "skipped",
        reason:
          "A pending payout for this booking does not match the amount the ledger shows as owed. Review it before releasing anything.",
      };
    }
    paymentId = existingPayout.id as string;
  } else {
    const { data: payout, error: payoutError } = await supabase
      .from("payments")
      .insert({
        booking_id: booking.id,
        amount,
        payment_type: "payout",
        status: "pending",
        payment_method: (owner?.payout_method as string | null) || "Unspecified",
        notes: demo
          ? "Short-notice compensation queued (demo mode). No PayMongo transfer is requested."
          : "Short-notice compensation owed to the lister. Live mode sends no automatic transfer - send it manually and record the release.",
      })
      .select("id")
      .single();
    if (payoutError?.code === "23505") {
      return {
        state: "already_released",
        reason: "Another request already recorded this booking's compensation.",
      };
    }
    if (payoutError || !payout) {
      throw payoutError ?? new Error("Compensation payout record was not created");
    }
    paymentId = payout.id as string;
  }

  // Commission is earned only when a trip completes; this one never happened,
  // so the deferred fee belongs to the lister. Keyed per booking, so a retry
  // cannot move it twice.
  if (summary.deferredFeeCentavos > 0) {
    await postSimpleBalancedJournal(supabase, {
      bookingId: booking.id,
      eventKey: `compensation-fee-waived:${booking.id}`,
      eventType: "cancellation_commission_waived",
      actorId: input.actorId,
      debitAccount: DEFERRED_PLATFORM_FEE,
      creditAccount: LISTER_PAYABLE,
      amountCentavos: summary.deferredFeeCentavos,
      partyUserId: booking.owner_id,
      memo: "Platform commission waived: the booking was cancelled before any trip took place",
    });
  }

  if (!demo) {
    await supabase.from("notifications").insert({
      user_id: booking.owner_id,
      title: "Short-notice compensation owed to you",
      message: `The renter cancelled ${vehicle} close to pickup. ${peso(amount)} is owed to you as short-notice compensation, with no SafeDrive commission, and SafeDrive support will send it to you.`,
      type: "info",
      link: "/lister-bookings",
    });
    await supabase.from("audit_log").insert({
      user_id: input.actorId,
      action: "cancellation_compensation_owed",
      entity_type: "booking",
      entity_id: booking.id,
      details: { amount, payment_id: paymentId, commission_waived_centavos: summary.deferredFeeCentavos, mode: "manual" },
    });
    return {
      state: "pending",
      amount,
      paymentId,
      reason: "Live mode sends no automatic transfer. Send this to the lister manually.",
    };
  }

  const transactionId = `sandbox_compensation_${booking.id.slice(0, 8)}_${Date.now()}`;
  const { error: completeError } = await supabase
    .from("payments")
    .update({
      status: "completed",
      transaction_id: transactionId,
      notes:
        "Short-notice compensation recorded (demo mode). No commission taken - the trip never took place. No real PayMongo transfer was sent.",
    })
    .eq("id", paymentId)
    .eq("status", "pending");
  if (completeError) throw completeError;

  // The key reconciliation looks for on every completed payout.
  await postSimpleBalancedJournal(supabase, {
    bookingId: booking.id,
    eventKey: `payout:${transactionId}`,
    eventType: "lister_payout_completed",
    providerReference: transactionId,
    actorId: input.actorId,
    debitAccount: LISTER_PAYABLE,
    creditAccount: CASH,
    amountCentavos: summary.totalCentavos,
    partyUserId: booking.owner_id,
    memo: "Short-notice compensation paid to the lister (demo mode)",
  });

  await supabase.from("notifications").insert({
    user_id: booking.owner_id,
    title: "Short-notice compensation paid",
    message: `The renter cancelled ${vehicle} close to pickup. Your short-notice compensation of ${peso(amount)} was recorded, with no SafeDrive commission because the trip never took place. This build runs in demo payout mode, so no real transfer was sent.`,
    type: "success",
    link: "/lister-bookings",
  });
  await supabase.from("audit_log").insert({
    user_id: input.actorId,
    action: "cancellation_compensation_released",
    entity_type: "booking",
    entity_id: booking.id,
    details: {
      amount,
      payment_id: paymentId,
      transaction_id: transactionId,
      commission_waived_centavos: summary.deferredFeeCentavos,
      mode: "sandbox",
    },
  });

  // In demo mode nothing moves, so the emailed receipt is the proof the lister
  // was paid - the same way every other demo payout here is evidenced. A
  // delivery failure is logged; it never undoes a payout already recorded.
  const { data: settledRows } = await supabase
    .from("payments")
    .select("payment_type, amount")
    .eq("booking_id", booking.id)
    .eq("status", "completed");
  const settled = (settledRows ?? []) as Array<{ payment_type: string; amount: number | string }>;
  const capturedAmount = settled
    .filter((row) => ["downpayment", "balance"].includes(row.payment_type))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const refundedAmount = settled
    .filter((row) => row.payment_type === "refund")
    .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);

  const receipt = await sendCompensationReceiptEmail(supabase, {
    bookingId: booking.id,
    amount,
    capturedAmount,
    refundedAmount,
    payoutId: paymentId,
    payoutMethod: (owner?.payout_method as string | null) || "Unspecified",
    transactionId,
    baseOrigin: input.baseOrigin,
  });
  if (receipt.state !== "sent" && receipt.state !== "not_configured") {
    console.warn("Compensation receipt email was not delivered", {
      state: receipt.state,
      bookingId: booking.id,
    });
  }

  return { state: "completed", amount, paymentId, transactionId };
}
