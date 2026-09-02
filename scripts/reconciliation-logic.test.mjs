import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPayMongoPaymentIds,
  findDuplicateProviderTransactions,
  groupCompletedCheckoutPayments,
  paymentLedgerEventKey,
} from "../api/lib/reconciliation.ts";

const payment = (overrides = {}) => ({
  id: "payment-1",
  booking_id: "booking-1",
  amount: 500,
  payment_type: "downpayment",
  status: "completed",
  transaction_id: "cs_checkout_1",
  notes: null,
  ...overrides,
});

test("one full checkout may create downpayment and balance rows without being a duplicate", () => {
  const payments = [
    payment(),
    payment({ id: "payment-2", payment_type: "balance", amount: 500 }),
  ];
  assert.deepEqual(findDuplicateProviderTransactions(payments), []);
  assert.deepEqual(groupCompletedCheckoutPayments(payments), [{
    transactionId: "cs_checkout_1",
    bookingId: "booking-1",
    payments,
    localAmountCentavos: 100_000,
  }]);
});

test("the same checkout used by different bookings is critical duplication", () => {
  const duplicate = findDuplicateProviderTransactions([
    payment(),
    payment({ id: "payment-2", booking_id: "booking-2" }),
  ]);
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].transactionId, "cs_checkout_1");
});

test("the same checkout component repeated for one booking is duplication", () => {
  assert.equal(findDuplicateProviderTransactions([
    payment(),
    payment({ id: "payment-2" }),
  ]).length, 1);
});

test("pending and non-checkout records do not enter provider checkout totals", () => {
  assert.deepEqual(groupCompletedCheckoutPayments([
    payment({ status: "pending" }),
    payment({ transaction_id: "pay_direct_1" }),
  ]), []);
});

test("ledger event keys distinguish payment components sharing a checkout", () => {
  assert.equal(paymentLedgerEventKey(payment()), "payment:downpayment:cs_checkout_1");
  assert.equal(paymentLedgerEventKey(payment({ payment_type: "balance" })), "payment:balance:cs_checkout_1");
});

test("PayMongo payment IDs are extracted from stored notes", () => {
  assert.deepEqual(
    extractPayMongoPaymentIds("Confirmed\nPayMongo payment ID: pay_abc123\nPayMongo payment ID: pay_xyz789"),
    ["pay_abc123", "pay_xyz789"],
  );
});
