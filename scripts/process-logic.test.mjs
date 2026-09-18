import assert from "node:assert/strict";
import test from "node:test";

import {
  getPayoutAccountNumberError as getClientPayoutAccountNumberError,
  PAYOUT_METHOD_RULES as CLIENT_PAYOUT_METHOD_RULES,
  sanitizePayoutAccountNumber as sanitizeClientPayoutAccountNumber,
} from "../src/lib/payoutAccount.ts";
import {
  getPayoutAccountNumberError as getServerPayoutAccountNumberError,
  PAYOUT_METHOD_RULES as SERVER_PAYOUT_METHOD_RULES,
} from "../server/payoutAccount.ts";
import { payoutReleaseState } from "../server/payoutAutomation.ts";

import { isMissingTopicsColumn } from "../api/create-guest-inquiry.ts";
import { isMissingResolvedAtColumn } from "../api/reply-guest-inquiry.ts";

import {
  clearAuthFailures,
  formatLockoutRemaining,
  getAuthLockoutState,
  registerAuthFailure,
} from "../src/lib/authLockout.ts";
import {
  clearAllAuthPending,
  getAdminAuthPendingState,
  getUserAuthPendingState,
  isAdminAuthPending,
  isUserAuthPending,
  setAdminAuthPendingState,
  setUserAuthPendingState,
} from "../src/lib/authPending.ts";
import {
  getExtensionDisplayStatus,
  getExtensionStatusLabel,
} from "../src/lib/bookingExtensions.ts";
import { GUEST_INQUIRY_TOPICS } from "../src/lib/guestInquiryTopics.ts";
import { formatDayCount } from "../src/lib/formatCount.ts";
import { clampPage, getPageCount, paginateItems } from "../src/lib/pagination.ts";
import {
  formatElapsed,
  getQueueSeverity,
  getQueueTiming,
} from "../src/lib/queueAge.ts";
import { countAttentionByNavPath } from "../src/lib/adminAttentionCounts.ts";
import {
  buildCsv,
  centavosToPesoCell,
  csvFileName,
  toCsvCell,
} from "../src/lib/csvExport.ts";
import {
  buildEarningsExportRows,
  buildLedgerExportRows,
  EARNINGS_EXPORT_HEADERS,
  LEDGER_EXPORT_HEADERS,
} from "../src/lib/ledgerExportRows.ts";
import {
  summarizeCancellations,
  summarizeQueueHealth,
  summarizeRefundKinds,
} from "../src/lib/insightsSummary.ts";
import {
  formatRichTextForDisplay,
  normalizeRichTextInput,
  richTextHasVisibleContent,
} from "../src/lib/richText.ts";

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  clear() {
    this.#values.clear();
  }
}

globalThis.window = {
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
};

test("booking pagination limits long lists and clamps invalid pages", () => {
  const bookings = Array.from({ length: 14 }, (_, index) => `booking-${index + 1}`);
  assert.equal(getPageCount(bookings.length), 3);
  assert.equal(clampPage(99, bookings.length), 3);

  const secondPage = paginateItems(bookings, 2);
  assert.deepEqual(secondPage.items, bookings.slice(6, 12));
  assert.equal(secondPage.startIndex, 6);
  assert.equal(secondPage.endIndex, 12);

  const lastPage = paginateItems(bookings, 99);
  assert.deepEqual(lastPage.items, ["booking-13", "booking-14"]);
  assert.equal(lastPage.page, 3);
});

test("day counts use singular and plural wording", () => {
  assert.equal(formatDayCount(1), "1 day");
  assert.equal(formatDayCount(2), "2 days");
});

test("user and admin failed-login counters are isolated and normalized by email", () => {
  const email = "  PERSON@Example.com ";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.equal(registerAuthFailure("user", email).isLocked, false);
  }
  const fifth = registerAuthFailure("user", email);
  assert.equal(fifth.isLocked, true);
  assert.equal(fifth.lockoutMinutes, 5);
  assert.equal(getAuthLockoutState("user", "person@example.com").failedAttempts, 5);
  assert.equal(getAuthLockoutState("admin", "person@example.com").failedAttempts, 0);

  clearAuthFailures("user", email);
  assert.equal(getAuthLockoutState("user", email).failedAttempts, 0);
});

test("login lockout duration increases at the next five-attempt boundary", () => {
  const email = "repeat@example.com";
  let outcome;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    outcome = registerAuthFailure("admin", email);
  }
  assert.equal(outcome.isLocked, true);
  assert.equal(outcome.lockoutMinutes, 10);
  assert.match(formatLockoutRemaining(outcome.remainingMs), /^10m 00s$|^9m 59s$/);
  clearAuthFailures("admin", email);
});

test("pending OTP state is kept separate for user and admin portals", () => {
  clearAllAuthPending();
  setUserAuthPendingState({
    email: "user@example.com",
    step: "otp",
    codeMethod: "email",
    otpExpiresAt: 123,
  });
  setAdminAuthPendingState({
    email: "admin@example.com",
    step: "otp",
    codeMethod: "authenticator",
    authFactorId: "factor-1",
  });

  assert.equal(isUserAuthPending(), true);
  assert.equal(isAdminAuthPending(), true);
  assert.equal(getUserAuthPendingState()?.email, "user@example.com");
  assert.equal(getAdminAuthPendingState()?.authFactorId, "factor-1");
  clearAllAuthPending();
});

test("expired unpaid booking extensions display as expired while paid ones do not", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  assert.equal(
    getExtensionDisplayStatus(
      { status: "approved", payment_deadline: "2026-08-15T11:59:00Z" },
      now,
    ),
    "expired",
  );
  assert.equal(
    getExtensionDisplayStatus(
      {
        status: "approved",
        payment_deadline: "2026-08-15T11:59:00Z",
        paid_at: "2026-08-15T11:50:00Z",
      },
      now,
    ),
    "approved",
  );
  assert.match(getExtensionStatusLabel("expired"), /payment window closed/i);
});

test("admin queue timing escalates based on each work type", () => {
  const now = Date.parse("2026-08-15T12:00:00Z");
  assert.equal(getQueueSeverity("2026-08-15T01:00:00Z", "guest", now), "normal");
  assert.equal(getQueueSeverity("2026-08-14T23:00:00Z", "guest", now), "warning");
  assert.equal(getQueueSeverity("2026-08-14T11:00:00Z", "guest", now), "overdue");
  assert.equal(getQueueSeverity("2026-08-13T11:00:00Z", "guest", now), "critical");
  assert.equal(getQueueSeverity("2026-08-15T11:59:00Z", "security", now), "critical");
  assert.deepEqual(getQueueTiming("2026-08-14T10:30:00Z", "support", now), {
    severity: "overdue",
    label: "Waiting 1d 1h 30m",
  });
  assert.equal(formatElapsed("not-a-date", now), "Unknown wait time");
});

test("guest inquiry choices are unique and cover common visitor concerns", () => {
  assert.equal(new Set(GUEST_INQUIRY_TOPICS).size, GUEST_INQUIRY_TOPICS.length);
  for (const expected of [
    "What is SafeDrive / how it works",
    "Listing a vehicle / vehicle eligibility",
    "Booking availability",
    "Payments, fees, or refunds",
    "Safety or insurance",
  ]) {
    assert.ok(GUEST_INQUIRY_TOPICS.includes(expected), `${expected} topic is missing`);
  }
});

test("guest inquiry APIs recognize only their intended legacy-column errors", () => {
  assert.equal(
    isMissingTopicsColumn({
      code: "PGRST204",
      message: "Could not find the 'topics' column",
    }),
    true,
  );
  assert.equal(
    isMissingResolvedAtColumn({
      code: "42703",
      message: "column guest_inquiries.resolved_at does not exist",
    }),
    true,
  );
  assert.equal(
    isMissingTopicsColumn({ code: "23505", message: "duplicate key" }),
    false,
  );
  assert.equal(
    isMissingResolvedAtColumn({ code: "42501", message: "permission denied" }),
    false,
  );
});

test("support rich-text helpers recognize empty markup and escape plain text", () => {
  const browserWindow = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(richTextHasVisibleContent("<p><br></p>"), false);
    assert.equal(normalizeRichTextInput(" plain text "), "plain text");
    assert.equal(
      formatRichTextForDisplay("hello < world\nnext"),
      "hello &lt; world<br />next",
    );
  } finally {
    globalThis.window = browserWindow;
  }
});

// The number saved here is what server/payoutAutomation.ts hands to PayMongo
// as the transfer target, so "it is only a form field" is not true of it.
test("payout account numbers are rejected unless they can actually receive a transfer", () => {
  const cases = [
    // [method, value, expected valid?]
    ["GCash", "09934086208", true],
    ["GCash", "00", false], // the reported case: two digits, silently accepted before
    ["GCash", "", false],
    ["GCash", "0993408620", false], // ten digits
    ["GCash", "099340862081", false], // twelve digits
    ["GCash", "12345678901", false], // right length, not a mobile number
    ["Maya", "09171234567", true],
    ["Maya", "9171234567", false],
    ["BPI", "1234567890", true], // ten, the minimum
    ["BPI", "1234567890123456", true], // sixteen, the maximum
    ["BPI", "123456789", false], // nine
    ["BPI", "12345678901234567", false], // seventeen
    ["BPI", "00", false],
    ["Business Bank Account", "1234567890", false], // retired destination
    [null, "09934086208", false],
  ];

  for (const [method, value, expected] of cases) {
    const error = getClientPayoutAccountNumberError(method, value);
    assert.equal(
      error === null,
      expected,
      `${method} / ${JSON.stringify(value)} should be ${expected ? "valid" : "rejected"}` +
        (error ? ` (got: ${error})` : ""),
    );
  }
});

// api/ and server/ cannot import from src/, so the rules exist twice. If they
// ever disagree, the form and the payout path disagree about who can be paid.
test("the client and server copies of the payout rules agree", () => {
  assert.deepEqual(
    CLIENT_PAYOUT_METHOD_RULES,
    SERVER_PAYOUT_METHOD_RULES,
    "src/lib/payoutAccount.ts and server/payoutAccount.ts have drifted apart",
  );

  const samples = [
    "",
    "00",
    "09934086208",
    "12345678901",
    "1234567890",
    "1234567890123456",
    "12345678901234567",
    "0917 123 4567",
  ];
  for (const method of ["GCash", "Maya", "BPI", "Business Bank Account", null]) {
    for (const sample of samples) {
      assert.equal(
        getClientPayoutAccountNumberError(method, sample),
        getServerPayoutAccountNumberError(method, sample),
        `client and server disagree about ${method} / ${JSON.stringify(sample)}`,
      );
    }
  }
});

test("typing into the account number field strips non-digits and caps at the destination length", () => {
  assert.equal(
    sanitizeClientPayoutAccountNumber("0993-408 6208", "GCash"),
    "09934086208",
  );
  // A GCash number cannot be longer than eleven, so the extra keystroke is
  // dropped at the input rather than saved and rejected later.
  assert.equal(
    sanitizeClientPayoutAccountNumber("099340862081234", "GCash"),
    "09934086208",
  );
  assert.equal(
    sanitizeClientPayoutAccountNumber("12345678901234567890", "BPI"),
    "1234567890123456",
  );
});

test("a rental fee is not held hostage by a case about the car", () => {
  const booking = (over = {}) => ({
    status: "active",
    dispute_status: "none",
    dispute_reason: null,
    owner_completed: false,
    ...over,
  });

  // The ordinary trip: the lister confirmed receipt.
  assert.equal(
    payoutReleaseState(booking({ status: "completed", owner_completed: true })),
    "release",
  );

  // The trip is simply still running.
  assert.equal(payoutReleaseState(booking()), "not_ready");
  assert.equal(
    payoutReleaseState(booking({ status: "completed", owner_completed: false })),
    "not_ready",
  );

  // The car never came back. The renter still had it for the days they paid
  // for, and no outcome of the case refunds those days - so the fee is earned
  // and the lister, who is usually paying for a police report or a tow out of
  // pocket, gets it. Every reason a lister can file behaves the same way.
  for (const reason of [
    "renter_unreachable",
    "stolen_or_missing",
    "accident_or_breakdown",
    "other",
    null, // the overstay path files a case with no reason at all
  ]) {
    assert.equal(
      payoutReleaseState(booking({ dispute_status: "open", dispute_reason: reason })),
      "release",
      `an open case (${reason ?? "no reason"}) must not hold the earned rental`,
    );
  }

  // The renter reporting that the lister never came to take the car back is
  // not a reason to hold either: the renter had the car for every day they
  // paid for, so nothing is owed back to them. The incident ticket already
  // tells admins the trip "will auto-complete with payout if the lister
  // remains unresponsive" - holding the money contradicted that promise.
  assert.equal(
    payoutReleaseState(
      booking({ dispute_status: "open", dispute_reason: "lister_no_show_at_return" }),
    ),
    "release",
  );

  // The situations that CAN owe the renter money - no car at pickup, renter
  // no-show at pickup - cancel the booking rather than leaving it running, so
  // they are held by status alone and never depend on the case flag.
  assert.equal(
    payoutReleaseState(booking({ status: "cancelled", dispute_status: "open" })),
    "not_ready",
  );
  assert.equal(
    payoutReleaseState(booking({ status: "fully_paid", dispute_status: "open" })),
    "not_ready",
  );
});

// The admin sidebar shows a dot on a tab that has work waiting in it. The dot
// is grouped from the same list the notification bell loads, keyed by the path
// each item links to, so the two can never disagree.
test("each admin tab is counted by the path its waiting items link to", () => {
  const counts = countAttentionByNavPath([
    { link: "/admin/users?profile=a1" },
    { link: "/admin/users?profile=a2" },
    { link: "/admin/vehicle-approval?vehicle=c1" },
    { link: "/admin/support?ticket=t1" },
    // Refunds and payouts live behind one tab, so they add up to one dot.
    { link: "/admin/financial-reviews?view=refunds" },
    { link: "/admin/financial-reviews?view=payouts" },
    { link: "/admin/retention-requests" },
    { link: "/admin/reconciliation" },
  ]);

  assert.deepEqual(counts, {
    "/admin/users": 2,
    "/admin/vehicle-approval": 1,
    "/admin/support": 1,
    "/admin/financial-reviews": 2,
    "/admin/retention-requests": 1,
    "/admin/reconciliation": 1,
  });
});

test("a queue that empties leaves no dot behind", () => {
  // Absent, not zero: the sidebar reads a missing key as "nothing waiting", so
  // clearing the last item in a queue removes its dot on the next refresh.
  const counts = countAttentionByNavPath([{ link: "/admin/support?ticket=t1" }]);
  assert.equal(counts["/admin/guest-inquiries"], undefined);
  assert.deepEqual(countAttentionByNavPath([]), {});
});

test("the dashboard never carries a dot, because it already shows every queue", () => {
  assert.deepEqual(
    countAttentionByNavPath([{ link: "/admin" }, { link: "/admin?panel=queues" }]),
    {},
  );
});

// SafeDrive does not file taxes; it owes the bookkeeper the underlying record.
// A file that splits a memo across columns, or rounds centavos away, is worse
// than no file, so the shaping is pinned here.
test("a cell that carries a comma, a quote or a newline survives the file", () => {
  assert.equal(toCsvCell("Reverse lister payable"), "Reverse lister payable");
  assert.equal(
    toCsvCell("Reverse lister payable, per review"),
    '"Reverse lister payable, per review"',
  );
  assert.equal(toCsvCell('He said "no refund"'), '"He said ""no refund"""');
  assert.equal(toCsvCell("line one\nline two"), '"line one\nline two"');
  // Edge whitespace is quoted too, or a spreadsheet trims it silently.
  assert.equal(toCsvCell(" 1010"), '" 1010"');
  assert.equal(toCsvCell(null), "");
  assert.equal(toCsvCell(undefined), "");
  assert.equal(toCsvCell(0), "0");
});

test("centavos become pesos with both decimals, never a rounded peso", () => {
  assert.equal(centavosToPesoCell(123456), "1234.56");
  assert.equal(centavosToPesoCell(5), "0.05");
  assert.equal(centavosToPesoCell(100000), "1000.00");
  assert.equal(centavosToPesoCell(null), "0.00");
  assert.equal(centavosToPesoCell("799600"), "7996.00");
});

test("the file names the period it covers", () => {
  assert.equal(
    csvFileName("ledger", "2026-09-01", "2026-09-30"),
    "safedrive-ledger-2026-09-01_2026-09-30.csv",
  );
});

test("rows are joined with CRLF and a header line", () => {
  assert.equal(
    buildCsv(["Month", "Total (PHP)"], [["September 2026", "7996.00"]]),
    "Month,Total (PHP)\r\nSeptember 2026,7996.00",
  );
});

test("every ledger line carries the booking and event it belongs to", () => {
  const journals = [
    {
      id: "j1",
      effective_at: "2026-09-15T12:19:13.000Z",
      event_type: "renter_payment_collected",
      event_key: "payment:downpayment:cs_test_1",
      booking_id: "b1",
      provider_reference: "cs_test_1",
      status: "finalized",
      reversal_of: null,
      correction_reason: null,
    },
  ];
  const entries = [
    { journal_id: "j1", account_code: "1010", debit_centavos: 200000, credit_centavos: 0, memo: "Funds confirmed" },
    { journal_id: "j1", account_code: "2010", debit_centavos: 0, credit_centavos: 180000, memo: "Lister payable" },
  ];

  const rows = buildLedgerExportRows(journals, entries, { "1010": "Cash", "2010": "Lister payable" });
  assert.equal(rows.length, 2, "one line per entry");
  assert.equal(rows[0].length, LEDGER_EXPORT_HEADERS.length, "every line fills the header");
  // 8:19 PM in Manila, not the UTC stamp: the books are kept in Manila time.
  assert.equal(rows[0][0], "2026-09-15 20:19");
  assert.equal(rows[0][1], "renter payment collected");
  assert.equal(rows[0][2], "b1", "the booking is on the line, not only on a group header");
  assert.deepEqual(rows[0].slice(3, 8), ["1010", "Cash", "2000.00", "0.00", "Funds confirmed"]);
  assert.deepEqual(rows[1].slice(3, 8), ["2010", "Lister payable", "0.00", "1800.00", "Lister payable"]);
  // Both lines repeat the journal's context, so the file can be filtered.
  assert.equal(rows[1][2], "b1");
});

test("a record with no lines still appears, rather than vanishing from the file", () => {
  const rows = buildLedgerExportRows(
    [
      {
        id: "j2",
        effective_at: "2026-09-16T01:00:00.000Z",
        event_type: "lister_payout_completed",
        event_key: "payout:sandbox_1",
        booking_id: null,
        provider_reference: null,
        status: "draft",
        reversal_of: "j1",
        correction_reason: "Wrong amount released",
      },
    ],
    [],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0][7], "(no lines recorded)");
  assert.equal(rows[0][10], "j1", "a correction names the record it reverses");
  assert.equal(rows[0][11], "Wrong amount released");
});

// The Insights sections read records SafeDrive already keeps. Nothing is
// tracked or collected for them, so the only thing that can be wrong is the
// counting - pinned here.
test("cancellations are counted by who cancelled and why", () => {
  const summary = summarizeCancellations([
    { cancelled_by_role: "renter", reason: "change_of_plans", was_late: true },
    { cancelled_by_role: "renter", reason: "change_of_plans", was_late: false },
    { cancelled_by_role: "lister", reason: "vehicle_unavailable", was_late: false },
    { cancelled_by_role: "both", reason: null, was_late: false },
  ]);

  assert.equal(summary.total, 4);
  assert.equal(summary.late, 1, "a late cancellation is the one that costs someone a trip");
  assert.deepEqual(summary.byRole[0], {
    key: "renter",
    label: "Cancelled by the renter",
    count: 2,
  });
  // A lister backing out is a moderation question, so it must stay visible.
  assert.ok(summary.byRole.some((row) => row.key === "lister" && row.count === 1));
  assert.deepEqual(summary.byReason[0], {
    key: "change_of_plans",
    label: "Change of plans",
    count: 2,
  });
  assert.ok(
    summary.byReason.some((row) => row.label === "Not given"),
    "a cancellation with no reason is still counted, not dropped",
  );
});

test("refunds are grouped by the same kinds the review dialog shows", () => {
  const summary = summarizeRefundKinds([
    {
      payment_method: "manual_review",
      notes: "Renter reported no vehicle at pickup (lister did not deliver). Recommend a full refund pending admin confirmation of the claim.",
    },
    {
      payment_method: "manual_review",
      notes: "Manual refund review required. Policy recommendation: refund PHP 1,000 of PHP 2,000 captured (short-notice cancellation). Admin confirms or adjusts.",
    },
    {
      payment_method: "GCash",
      notes: "Manual refund review required. Policy recommendation: refund PHP 1,000 of PHP 2,000 captured (short-notice cancellation). Released by super admin.",
    },
    // A provider refund carries no review note, so it gets its own slice
    // instead of being mislabelled as a failed automatic refund.
    { payment_method: "PayMongo", notes: null },
  ]);

  assert.equal(summary.total, 4);
  assert.deepEqual(summary.slices[0], {
    key: "cancellation_policy",
    label: "Cancellation fee",
    count: 2,
  });
  assert.ok(summary.slices.some((slice) => slice.key === "no_car_claim" && slice.count === 1));
  assert.ok(
    summary.slices.some((slice) => slice.key === "provider_refund" && slice.count === 1),
  );
  assert.ok(
    !summary.slices.some((slice) => slice.key === "automatic_refund_failed"),
    "a completed PayMongo refund is not a failed one",
  );
});

// The note shapes below are taken from live refund rows, not invented: the
// classification has to survive what the database actually holds.
test("refund rows that carry no reason are named as such, not filed as a review", () => {
  const summary = summarizeRefundKinds([
    // Released before the release note kept the original context behind it.
    { payment_method: "GCash", notes: "Refund released by super admin through GCash." },
    { payment_method: "GCash", notes: "Refund released by super admin through GCash." },
    { payment_method: "No refund due", notes: "Settled by super admin: refund denied after review." },
    // An automatic refund for a booking the lister called off.
    {
      payment_method: "demo",
      notes: "Demo refund - no PayMongo transfer. Source transaction IDs: cs_403ced58e49dd25ce4eefac3; SafeDrive refund for Ford Ranger (ASX 1232). Lister cancelled the accepted paid booking.",
    },
  ]);

  assert.deepEqual(summary.slices[0], {
    key: "reason_not_recorded",
    label: "Released, reason not recorded",
    count: 3,
  });
  assert.ok(
    summary.slices.some((slice) => slice.key === "lister_cancelled" && slice.count === 1),
  );
  assert.ok(
    !summary.slices.some((slice) => slice.key === "other"),
    "a lost reason is never dressed up as a manual review",
  );
});

test("when a note carries both the release line and the original context, the context wins", () => {
  // Today the release path overwrites the note, so this shape does not occur
  // yet. Pinned now so that preserving the context later is a one-line change
  // in the API with the classification already proved.
  const summary = summarizeRefundKinds([
    {
      payment_method: "GCash",
      notes: "Refund released by super admin through GCash. | Manual refund review required. Policy recommendation: refund PHP 7,996 of PHP 15,992 captured (short-notice cancellation). Admin confirms or adjusts.",
    },
  ]);
  assert.deepEqual(summary.slices[0], {
    key: "cancellation_policy",
    label: "Cancellation fee",
    count: 1,
  });
});

test("queue health reports the oldest wait, not just the count", () => {
  const rows = summarizeQueueHealth([
    { kind: "support", createdAt: "2026-09-16T02:00:00.000Z" },
    { kind: "support", createdAt: "2026-09-10T02:00:00.000Z" },
    { kind: "vehicle", createdAt: "2026-09-17T02:00:00.000Z" },
    { kind: "refund", createdAt: "2026-09-01T02:00:00.000Z" },
    { kind: "support", createdAt: "not a date" },
  ]);

  // Oldest first: the queue that has been waiting longest leads.
  assert.deepEqual(
    rows.map((row) => row.key),
    ["refund", "support", "vehicle"],
  );
  const support = rows.find((row) => row.key === "support");
  assert.equal(support.count, 2, "an unreadable timestamp is skipped, not counted");
  assert.equal(support.oldestCreatedAt, "2026-09-10T02:00:00.000Z");
  assert.equal(support.label, "Support needing a reply");
  assert.deepEqual(summarizeQueueHealth([]), []);
});

test("the earnings summary ends with a total line", () => {
  const rows = buildEarningsExportRows([
    { label: "August 2026", commission: 100000, subscription: 49900 },
    { label: "September 2026", commission: 250000, subscription: 0 },
  ]);
  assert.equal(rows.length, 3, "two months plus the total");
  assert.equal(rows[0].length, EARNINGS_EXPORT_HEADERS.length);
  assert.deepEqual(rows[0], ["August 2026", "1000.00", "499.00", "1499.00"]);
  assert.deepEqual(rows[2], ["Total", "3500.00", "499.00", "3999.00"]);
});
