export type ReconciliationPayment = {
  id: string;
  booking_id: string;
  amount: number | string;
  payment_type: string;
  status: string;
  transaction_id: string | null;
  notes?: string | null;
};

export type CheckoutPaymentGroup = {
  transactionId: string;
  bookingId: string;
  payments: ReconciliationPayment[];
  localAmountCentavos: number;
};

export function paymentLedgerEventKey(payment: Pick<ReconciliationPayment, "payment_type" | "transaction_id">) {
  return payment.transaction_id
    ? `payment:${payment.payment_type}:${payment.transaction_id}`
    : null;
}

export function findDuplicateProviderTransactions(payments: ReconciliationPayment[]) {
  const groups = new Map<string, ReconciliationPayment[]>();
  for (const payment of payments) {
    if (payment.status !== "completed" || !payment.transaction_id) continue;
    const group = groups.get(payment.transaction_id) ?? [];
    group.push(payment);
    groups.set(payment.transaction_id, group);
  }

  return [...groups.entries()].flatMap(([transactionId, group]) => {
    const bookingIds = new Set(group.map((payment) => payment.booking_id));
    const compositeKeys = group.map(
      (payment) => `${payment.booking_id}:${payment.payment_type}:${transactionId}`,
    );
    const hasRepeatedComponent = new Set(compositeKeys).size !== compositeKeys.length;

    // One checkout may validly create a downpayment and a balance row for the
    // same booking. It is only a duplicate when it crosses bookings or repeats
    // the same booking/payment component.
    return bookingIds.size > 1 || hasRepeatedComponent
      ? [{ transactionId, payments: group }]
      : [];
  });
}

export function groupCompletedCheckoutPayments(payments: ReconciliationPayment[]) {
  const groups = new Map<string, CheckoutPaymentGroup>();
  for (const payment of payments) {
    if (payment.status !== "completed" || !payment.transaction_id?.startsWith("cs_")) {
      continue;
    }
    const key = `${payment.booking_id}:${payment.transaction_id}`;
    const amountCentavos = Math.round(Number(payment.amount) * 100);
    if (!Number.isFinite(amountCentavos)) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.payments.push(payment);
      existing.localAmountCentavos += amountCentavos;
    } else {
      groups.set(key, {
        transactionId: payment.transaction_id,
        bookingId: payment.booking_id,
        payments: [payment],
        localAmountCentavos: amountCentavos,
      });
    }
  }
  return [...groups.values()];
}

export function extractPayMongoPaymentIds(notes: string | null | undefined) {
  if (!notes) return [];
  return [...notes.matchAll(/PayMongo payment ID:\s*(pay_[A-Za-z0-9_-]+)/g)].map(
    (match) => match[1],
  );
}
