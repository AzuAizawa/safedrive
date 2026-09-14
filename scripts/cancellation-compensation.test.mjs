// Short-notice lister compensation on a cancelled booking.
//
// What the lister is owed is read off the booking's own ledger rather than
// recomputed, so the figure matches the books to the centavo. These tests pin
// that reading against the exact journals the live system wrote for a real
// case (a renter cancelling 16h before pickup), and against the edges that
// would pay someone the wrong amount.
import assert from "node:assert/strict";
import test from "node:test";

import { summarizeCompensationFromEntries } from "../server/cancellationCompensation.ts";

const LISTER_PAYABLE = "2010";
const DEFERRED_FEE = "2040";
const CASH = "1010";
const PROCESSING_FEE = "4020";

const credit = (account_code, pesos) => ({
  account_code,
  debit_centavos: 0,
  credit_centavos: Math.round(pesos * 100),
});
const debit = (account_code, pesos) => ({
  account_code,
  debit_centavos: Math.round(pesos * 100),
  credit_centavos: 0,
});

// The two capture journals booking dbc252a9 actually carries: PHP 15,992 in
// two parts, each split 90% lister payable / 10% platform fee.
const captured = [
  debit(CASH, 7996), credit(LISTER_PAYABLE, 7196.4), credit(DEFERRED_FEE, 799.6),
  debit(CASH, 7996), credit(LISTER_PAYABLE, 7196.4), credit(DEFERRED_FEE, 799.6),
];

// The proportional reversal server/ledger.ts posts for a PHP 7,996 refund.
const halfRefunded = [
  debit(LISTER_PAYABLE, 7196.4), debit(DEFERRED_FEE, 799.6), credit(CASH, 7996),
];

test("the live case: renter gets half back, the lister is owed the other half in full", () => {
  const summary = summarizeCompensationFromEntries([...captured, ...halfRefunded]);

  assert.equal(summary.listerPayableCentavos, 719640, "PHP 7,196.40 already sits with the lister");
  assert.equal(summary.deferredFeeCentavos, 79960, "PHP 799.60 of platform fee that can never be earned");
  assert.equal(summary.totalCentavos, 799600, "the lister receives PHP 7,996 - no commission taken");
});

test("before any refund is posted the whole captured amount would be owed", () => {
  const summary = summarizeCompensationFromEntries(captured);
  assert.equal(summary.totalCentavos, 1599200);
});

test("a full refund leaves the lister nothing - a lister-side cancellation pays no compensation", () => {
  const fullyRefunded = [
    ...captured,
    debit(LISTER_PAYABLE, 7196.4), debit(DEFERRED_FEE, 799.6), credit(CASH, 7996),
    debit(LISTER_PAYABLE, 7196.4), debit(DEFERRED_FEE, 799.6), credit(CASH, 7996),
  ];
  const summary = summarizeCompensationFromEntries(fullyRefunded);
  assert.equal(summary.totalCentavos, 0);
});

test("the processing-fee recovery stays with SafeDrive and is never paid to the lister", () => {
  const withFee = [
    debit(CASH, 1030), credit(LISTER_PAYABLE, 900), credit(DEFERRED_FEE, 100), credit(PROCESSING_FEE, 30),
  ];
  const summary = summarizeCompensationFromEntries(withFee);
  assert.equal(summary.totalCentavos, 100000, "PHP 1,000 - the PHP 30 fee recovery is excluded");
});

test("a payout already recorded against the booking is subtracted, so nothing is paid twice", () => {
  const alreadyPaid = [
    ...captured,
    ...halfRefunded,
    debit(DEFERRED_FEE, 799.6), credit(LISTER_PAYABLE, 799.6),
    debit(LISTER_PAYABLE, 7996), credit(CASH, 7996),
  ];
  const summary = summarizeCompensationFromEntries(alreadyPaid);
  assert.equal(summary.totalCentavos, 0);
});

test("a booking whose ledger is empty owes nothing through this path", () => {
  const summary = summarizeCompensationFromEntries([]);
  assert.deepEqual(summary, {
    listerPayableCentavos: 0,
    deferredFeeCentavos: 0,
    totalCentavos: 0,
  });
});

test("an over-reversed account is never turned into a negative payout", () => {
  const overReversed = [credit(LISTER_PAYABLE, 100), debit(LISTER_PAYABLE, 150)];
  const summary = summarizeCompensationFromEntries(overReversed);
  assert.equal(summary.totalCentavos, 0);
});
