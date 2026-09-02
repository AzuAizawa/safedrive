import assert from "node:assert/strict";
import test from "node:test";

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
