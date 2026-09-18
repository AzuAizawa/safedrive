import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  extractPayMongoPaymentIds,
  findDuplicateProviderTransactions,
  groupCompletedCheckoutPayments,
  paymentLedgerEventKey,
} from "../server/reconciliation.ts";

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

// A run on live data raised nine criticals that were not money problems: the
// provider had simply not answered - 13 checkouts asked about, 0 records read,
// and the payment list returning HTTP 500. Critical has to mean the provider
// answered and disagreed, or the two findings that were real stay buried.
test("a provider that cannot be reached is a warning, not a critical mismatch", async () => {
  const source = await readFile(
    new URL("../api/run-reconciliation.ts", import.meta.url),
    "utf8",
  );

  // The failed-lookup path files a warning of its own type...
  assert.match(
    source,
    /issue_type: "provider_check_unavailable", severity: "warning"/,
  );
  // ...and a thrown request is caught per checkout rather than ending the run.
  assert.match(source, /catch \(providerError\)/);
  assert.match(source, /providerChecksUnavailable \+= 1/);

  // Critical is reserved for an answer that disagrees: a status that is not
  // paid, or an amount that does not match.
  const criticalNotConfirmed = source.match(
    /issue_type: "local_completed_but_provider_not_confirmed", severity: "critical"/g,
  );
  assert.equal(
    criticalNotConfirmed?.length,
    1,
    "only the answered-but-not-paid branch may raise this as critical",
  );
  assert.ok(
    source.indexOf('providerStatus && !["succeeded", "paid", "completed"]') <
      source.indexOf('issue_type: "local_completed_but_provider_not_confirmed", severity: "critical"'),
    "the remaining critical sits behind a status the provider actually returned",
  );

  // A run that reached almost nothing must not read as a clean one.
  assert.match(source, /provider_checks_unavailable: providerChecksUnavailable/);
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
