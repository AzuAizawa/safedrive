import assert from "node:assert/strict";
import test from "node:test";

import { calculatePaymentLedgerAllocation } from "../api/lib/ledger.ts";

// Commission is deducted from the LISTER's earnings, not added to what the
// renter pays (api/create-booking.ts) - so totalPrice is basePrice + the
// payment-processing fee only, and ownerShare is (basePrice - commission)'s
// proportional share of whatever was paid.
test("a full renter payment allocates owner (net of commission), commission, and disclosed processing fee", () => {
  const allocation = calculatePaymentLedgerAllocation({
    amountCentavos: 102_000,
    basePrice: 1_000,
    commission: 100,
    totalPrice: 1_020,
  });

  assert.deepEqual(allocation, {
    ownerShare: 90_000,
    commissionShare: 10_000,
    processingFeeShare: 2_000,
  });
});

test("a partial payment uses the same proportional allocation", () => {
  const allocation = calculatePaymentLedgerAllocation({
    amountCentavos: 51_000,
    basePrice: 1_000,
    commission: 100,
    totalPrice: 1_020,
  });

  assert.deepEqual(allocation, {
    ownerShare: 45_000,
    commissionShare: 5_000,
    processingFeeShare: 1_000,
  });
});

test("rounding can never make ledger credits exceed the collected cash", () => {
  const allocation = calculatePaymentLedgerAllocation({
    amountCentavos: 1,
    basePrice: 1,
    commission: 1,
    totalPrice: 2,
  });
  const credits =
    allocation.ownerShare + allocation.commissionShare + allocation.processingFeeShare;

  assert.equal(credits, 1);
  assert.ok(Object.values(allocation).every((amount) => amount >= 0));
});

test("invalid ledger allocations are rejected", () => {
  assert.throws(
    () =>
      calculatePaymentLedgerAllocation({
        amountCentavos: 0,
        basePrice: 1_000,
        commission: 100,
        totalPrice: 1_100,
      }),
    /amount is invalid/,
  );
});
