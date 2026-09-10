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
