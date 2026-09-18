// Manual refund review decisions (Financial Reviews -> Renter refunds).
//
// The server and the review page each carry a copy of the rules; they must be
// the same file, and the rules must read the notes the real queues write.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MANUAL_REFUND_KINDS,
  classifyManualRefund,
  decideRefund,
  getRefundCapacity,
} from "../server/refundDecision.ts";

test("the server and the review page use the same rules", async () => {
  const [server, browser] = await Promise.all([
    readFile(new URL("../server/refundDecision.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/refundDecision.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(server.replace(/\r\n/g, "\n"), browser.replace(/\r\n/g, "\n"));
});

test("every queue's note is recognised as its own kind of case", () => {
  // Notes in the exact shapes the queues write them.
  const cases = [
    ["Unapplied payment cs_test_123: Captured after the booking became \"cancelled\", so it was never applied. Refund the full amount; admin confirms the return method.", "payment_not_applied"],
    ["Unapplied payment cs_test_9: Extension paid, but the extra days could not be added to the booking. Refund the full amount; admin confirms the return method.", "payment_not_applied"],
    ["Manual refund review required. Policy recommendation: refund PHP 2,000 of PHP 2,000 captured (vehicle documents not cleared by pickup). Admin confirms or adjusts. Automatic cancellation for Toyota Vios (ABC 1234): the vehicle's approved documents still did not cover the rental when the pickup time passed. Automatic refund result: Vehicle documents still under review at pickup - full refund recommended, released by admin review.", "documents_not_cleared"],
    ["Renter reported no vehicle at pickup (lister did not deliver). Recommend a full refund pending admin confirmation of the claim.", "no_car_claim"],
    ["Manual refund review required. Policy recommendation: refund PHP 2,000 of PHP 2,000 captured (car not handed over at pickup). Admin confirms or adjusts. Automatic no-car settlement for Toyota Vios (ABC 1234): the renter checked in, the lister never did, and no report was filed within 6 hours of pickup. Automatic refund result: Car not handed over at pickup - full refund recommended, released by admin review.", "no_car_claim"],
    ["Renter no-show at pickup. Policy: a no-show fee of PHP 1,499.25 (75% of a day of rental) — refund PHP 500.75 of PHP 2,000 captured; about PHP 1,499.25 is lister compensation. Admin confirms the return method.", "renter_no_show"],
    ["Manual refund review required. Policy recommendation: refund PHP 500.75 of PHP 2,000 captured (renter no-show at pickup). Admin confirms or adjusts. Automatic renter no-show for Toyota Vios (ABC 1234): the lister checked in, the renter never did.", "renter_no_show"],
    ["Manual refund review required. Policy recommendation: refund PHP 2,000 of PHP 2,000 captured (neither party checked in at pickup). Admin confirms or adjusts. Automatic cancellation for Toyota Vios (ABC 1234): neither the renter nor the lister checked in within 6 hours of the pickup time, and no handover took place.", "nobody_checked_in"],
    ["Manual refund review required. Policy recommendation: refund PHP 1,000 of PHP 2,000 captured (balance payment deadline missed). Admin confirms or adjusts. Automatic balance-deadline cancellation for Toyota Vios (ABC 1234) - no acting user (cron), ticket attributed to the renter. Automatic refund result: Balance payment deadline passed - automatic full refund not applied.", "cancellation_policy"],
    ["Manual refund review required. Policy recommendation: refund PHP 1,000 of PHP 2,000 captured (short-notice cancellation). Admin confirms or adjusts. Renter cancelled 5h before pickup (free cancellation closes 24h before pickup). Automatic refund result: Late cancellation - automatic full refund not applied.", "cancellation_policy"],
    ["Manual refund review required. Admin must choose and record the manual refund return method during refund review. Automatic refund result: PayMongo refund environment is not configured.", "automatic_refund_failed"],
    [null, "other"],
    ["Lister-approved goodwill refund for an early return.", "other"],
  ];
  for (const [notes, expected] of cases) {
    assert.equal(classifyManualRefund(notes), expected, String(notes).slice(0, 80));
  }
});

test("what can still be refunded counts the booking's payments and extensions, less refunds already made", () => {
  const rows = [
    { id: "p1", payment_type: "downpayment", status: "completed", amount: 1000 },
    { id: "p2", payment_type: "balance", status: "completed", amount: 1000 },
    { id: "p3", payment_type: "extension", status: "completed", amount: 500 },
    { id: "p4", payment_type: "balance", status: "pending", amount: 999 },
    { id: "r1", payment_type: "refund", status: "completed", amount: -300 },
    { id: "r2", payment_type: "refund", status: "pending", amount: -700 },
    { id: "r3", payment_type: "refund", status: "failed", amount: -100 },
    { id: "o1", payment_type: "payout", status: "completed", amount: 1500 },
  ];
  assert.deepEqual(getRefundCapacity(rows), {
    collected: 2500, refunded: 300, available: 2200, reservedByOtherRefunds: 800,
  });
  // The row being decided is not "another" refund.
  assert.equal(getRefundCapacity(rows, "r2").reservedByOtherRefunds, 100);
});

const base = { kind: "no_car_claim", bookingStatus: "cancelled", recommended: 2000, available: 2000, reason: null };

test("releasing as recommended needs no reason, exactly as before", () => {
  assert.deepEqual(decideRefund({ ...base, requested: undefined }), {
    ok: true, amount: 2000, decision: "as_recommended", reason: null,
  });
  assert.deepEqual(decideRefund({ ...base, requested: 2000.001 }), {
    ok: true, amount: 2000, decision: "as_recommended", reason: null,
  });
});

test("a different amount or a denial needs a real reason", () => {
  for (const reason of [null, "", "   ", "too short"]) {
    const result = decideRefund({ ...base, requested: 500, reason });
    assert.equal(result.ok, false);
    assert.equal(result.code, "reason_required");
  }
  assert.deepEqual(
    decideRefund({ ...base, requested: 500.756, reason: "Lister arrived on time; renter was late." }),
    { ok: true, amount: 500.76, decision: "adjusted", reason: "Lister arrived on time; renter was late." },
  );
  assert.deepEqual(
    decideRefund({ ...base, requested: 0, reason: "Check-ins show the lister was there first." }),
    { ok: true, amount: 0, decision: "denied", reason: "Check-ins show the lister was there first." },
  );
});

test("never more than was collected and not yet refunded, and never negative", () => {
  const over = decideRefund({ ...base, available: 1500, requested: 1600, reason: "A long enough reason." });
  assert.equal(over.code, "over_capacity");
  const asRecommendedOver = decideRefund({ ...base, available: 1500, requested: undefined });
  assert.equal(asRecommendedOver.code, "over_capacity", "the old guard still holds for the recommended amount");
  assert.equal(decideRefund({ ...base, requested: -1, reason: "A long enough reason." }).code, "invalid_amount");
  assert.equal(decideRefund({ ...base, requested: Number.NaN, reason: "A long enough reason." }).code, "invalid_amount");
});

test("cases that are not a judgement call can only be released as recommended", () => {
  const locked = Object.entries(MANUAL_REFUND_KINDS).filter(([, copy]) => !copy.adjustable).map(([kind]) => kind);
  assert.deepEqual(locked.sort(), ["automatic_refund_failed", "documents_not_cleared", "payment_not_applied"]);
  for (const kind of locked) {
    const result = decideRefund({ kind, bookingStatus: "cancelled", recommended: 2000, available: 2000, requested: 0, reason: "Trying to deny a refund owed." });
    assert.equal(result.code, "not_adjustable", kind);
    assert.equal(decideRefund({ kind, bookingStatus: "cancelled", recommended: 2000, available: 2000, requested: undefined, reason: null }).ok, true);
  }
});

test("a decision made the wrong way can be reversed to a full refund - up to what is left, not a centavo more", () => {
  // Renter no-show: PHP 500.75 recommended of PHP 2,000 collected.
  const noShow = { kind: "renter_no_show", bookingStatus: "cancelled", recommended: 500.75, available: 2000, reason: "Lister's check-in photo is from the wrong place." };
  assert.deepEqual(decideRefund({ ...noShow, requested: 2000 }), {
    ok: true, amount: 2000, decision: "adjusted", reason: noShow.reason,
  });
  assert.equal(decideRefund({ ...noShow, requested: 2000.01 }).code, "over_capacity");
  assert.equal(decideRefund({ ...noShow, requested: 1990 }).ok, true, "a partial amount is allowed; the rest goes to the lister");
});

test("only a cancelled booking's refund can be changed - elsewhere the difference would reach no one", () => {
  for (const bookingStatus of ["confirmed", "active", "completed", null, undefined]) {
    const result = decideRefund({ ...base, bookingStatus, requested: 500, reason: "A long enough reason." });
    assert.equal(result.code, "not_adjustable", String(bookingStatus));
    assert.equal(decideRefund({ ...base, bookingStatus, requested: undefined }).ok, true, "as recommended still releases");
  }
});

test("a changed amount cannot use money another open refund on the booking is meant to return", () => {
  // Collected 2,500 (a 500 payment that could not be applied, refunded separately).
  const shared = { ...base, available: 2500, reservedByOtherRefunds: 500, reason: "A long enough reason." };
  assert.equal(decideRefund({ ...shared, requested: 2001 }).code, "over_capacity");
  assert.equal(decideRefund({ ...shared, requested: 2000, recommended: 1000 }).ok, true);
  assert.equal(decideRefund({ ...shared, requested: undefined }).ok, true, "releasing as recommended keeps its old guard");
});

test("both sides are emailed what they received, in words that fit every kind of case", async () => {
  const [email, compensation, release] = await Promise.all([
    readFile(new URL("../server/email.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/cancellationCompensation.ts", import.meta.url), "utf8"),
    readFile(new URL("../api/mark-manual-refund.ts", import.meta.url), "utf8"),
  ]);
  // A no-show, a denied no-car claim or a missed deadline is not "the renter cancelled".
  assert.doesNotMatch(email, /The renter cancelled \$\{vehicle\}/);
  assert.doesNotMatch(compensation, /The renter cancelled \$\{vehicle\}/);
  // The lister's receipt adds up: paid - refunded - processing fee = compensation.
  assert.match(email, /Payment processing fee \(kept by SafeDrive\)/);
  // The renter's receipt carries the decided amount, and a PHP 0 settlement is emailed too.
  assert.match(release, /sendRefundReceiptEmail\(supabase, \{[\s\S]*?amount: finalAmount/);
  assert.match(release, /else if \(noRefundDue\)[\s\S]*?sendUserNotificationEmail/);
});

// Where the money goes is not a choice an admin should have to make: the
// provider knows the account it came from, and SafeDrive does not. These pin
// the order - provider first, manual only after SafeDrive says it cannot.
test("a decided refund is sent back through the original payment before anything is asked", async () => {
  const [handler, automation] = await Promise.all([
    readFile(new URL("../api/mark-manual-refund.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/refundAutomation.ts", import.meta.url), "utf8"),
  ]);

  // The provider attempt runs before the manual update, and the manual fields
  // are required only once the caller has been told to send it themselves.
  assert.ok(
    handler.indexOf("releaseDecidedRefundToSource") <
      handler.indexOf("let releaseRefundQuery"),
    "the provider path is tried before the row is marked released by hand",
  );
  assert.match(handler, /manualTransfer && \(!refundMethod \|\| !referenceNumber\)/);
  assert.match(handler, /needsManualTransfer: true/);

  // The same guards as the automatic path, and the review's own row is reused.
  assert.match(automation, /buildRefundGroups\(refundBooking, \[/);
  assert.match(automation, /\.eq\("id", refundPaymentId\)/);
  assert.match(automation, /\.eq\("payment_method", "manual_review"\)/);

  // Read only the decided-release function: the automatic path legitimately
  // creates rows, this one must update the review's own row instead, or a
  // booking would carry two refunds for one decision.
  const decidedRelease = automation.slice(
    automation.indexOf("export const releaseDecidedRefundToSource"),
    automation.indexOf("export const processAutomaticRefundForBooking"),
  );
  assert.ok(decidedRelease.length > 500, "the decided-release function was found");
  assert.ok(
    !decidedRelease.includes("createRefundRecord("),
    "the decided release must not create a second refund row",
  );
  assert.ok(
    decidedRelease.includes('.from("payments")') && decidedRelease.includes(".update("),
    "it updates the row the review was opened on",
  );
});

test("a refund someone else released first is never offered a manual transfer", async () => {
  const [handler, automation] = await Promise.all([
    readFile(new URL("../api/mark-manual-refund.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/refundAutomation.ts", import.meta.url), "utf8"),
  ]);

  // Losing the race is its own answer. Treating it as "the provider cannot
  // carry this" would invite a real GCash transfer for money that may already
  // be on its way back to the renter.
  assert.match(automation, /state: "stale"/);
  const staleBranch = handler.slice(
    handler.indexOf('attempt.state === "stale"'),
    handler.indexOf('attempt.state === "unavailable"'),
  );
  assert.ok(staleBranch.length > 50, "the stale branch is handled on its own");
  assert.ok(
    !staleBranch.includes("needsManualTransfer"),
    "a stale refund must not ask for a manual transfer",
  );
  assert.match(staleBranch, /Refresh Financial Reviews/);

  // In live mode the provider refund may already exist, so it is recorded
  // rather than lost when the row cannot be stamped with its reference.
  assert.match(automation, /orphaned_refund: true/);
});

test("a provider refund still travelling is not treated as money already returned", async () => {
  const handler = await readFile(
    new URL("../api/mark-manual-refund.ts", import.meta.url),
    "utf8",
  );

  // No ledger journal for a refund the provider has not confirmed, and none at
  // all when the provider carried it - that journal is posted at the source.
  assert.match(handler, /!providerRefundId && !noRefundDue && referenceNumber/);
  // The case stays open, and the receipt waits for confirmation.
  assert.match(handler, /if \(!providerPending\) \{/);
  assert.match(handler, /!noRefundDue && !providerPending && receiptMethod && receiptReference/);
  // The renter is told it is on its way rather than returned.
  assert.match(handler, /Refund On The Way/);
});

test("lister compensation waits while another refund on the booking is still open", async () => {
  const source = await readFile(new URL("../server/cancellationCompensation.ts", import.meta.url), "utf8");
  assert.match(source, /waitingOnRefunds: true/);
  assert.match(source, /\.in\("status", \["pending", "failed"\]\)/);
});
