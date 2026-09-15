// CHAPTER 91 - cancellation and no-show fees are counted in rental days.
//
// The chapter is applied verbatim to real PostgreSQL (PGlite), on top of the
// legal documents exactly as first published. The fee rules are pinned through
// both copies - the server decides the refund, the browser shows it - with the
// cases the policy was written for.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import * as server from "../server/cancellationPolicy.ts";
import * as browser from "../src/lib/cancellationPolicy.ts";
import { getCancellationRefundPlan } from "../server/cancellationRefundPlan.ts";

const HOUR = 3_600_000;
const HEADING = "-- CHAPTER 91 - Cancellation and no-show fees are counted in rental days";

let masterText;
const loadMaster = async () => {
  masterText ??= await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  );
  return masterText;
};

const chapterText = (master) => {
  const body = master.split(HEADING)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, "CHAPTER 91 exists in the master file");
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
};

// The version-1 text each document was first published with - still the live
// version of both on the day this chapter was written.
const seedOf = (master, key) => {
  const match = master.match(
    new RegExp(`select '${key}', 1, \\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`),
  );
  assert.ok(match, `${key} has a seed in the master file`);
  return match[2];
};

async function fixture() {
  const master = await loadMaster();
  const db = new PGlite();
  await db.exec(`
    create table public.platform_settings(
      id text primary key,
      refund_late_renter_percent numeric not null default 50);
    insert into public.platform_settings(id) values ('default');
    create table public.bookings(
      id uuid primary key,
      refund_late_renter_percent_snapshot numeric);
    insert into public.bookings values ('11111111-1111-4111-8111-111111111111', 50);
    create table public.audit_log(
      id bigserial primary key,
      user_id uuid,
      action text not null,
      entity_type text,
      entity_id text,
      details jsonb);
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text not null,
      version_number integer not null,
      content_html text not null,
      status text not null default 'published',
      published_by uuid,
      published_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      unique (document_key, version_number));
    create unique index legal_document_one_published_version
      on public.legal_document_versions (document_key) where status = 'published';
  `);
  for (const key of ["terms_of_service", "privacy_policy", "platform_agreement"]) {
    await db.query(
      "insert into public.legal_document_versions(document_key, version_number, content_html) values ($1, 1, $2)",
      [key, seedOf(master, key)],
    );
  }
  await db.exec(chapterText(master));
  return db;
}

test("applying the chapter sets the defaults and leaves existing bookings on their old terms", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    "select short_notice_free_hours, late_cancel_fee_days, short_trip_late_cancel_fee_days, no_show_fee_days, short_trip_no_show_fee_days from public.platform_settings",
  );
  assert.deepEqual(Object.values(rows[0]).map(Number), [4, 1, 0.5, 2, 0.75]);
  const booking = await db.query("select late_cancel_fee_days_snapshot from public.bookings");
  assert.equal(
    booking.rows[0].late_cancel_fee_days_snapshot,
    null,
    "an empty snapshot is what keeps an old booking on its percentage terms",
  );
});

test("each setting stays inside its bounds", async () => {
  const db = await fixture();
  for (const sql of [
    "update public.platform_settings set short_notice_free_hours = 25",
    "update public.platform_settings set late_cancel_fee_days = 31",
    "update public.platform_settings set short_trip_late_cancel_fee_days = 2.5",
    "update public.platform_settings set no_show_fee_days = -1",
    "update public.platform_settings set short_trip_no_show_fee_days = 3",
  ]) {
    await assert.rejects(db.exec(sql), /_check/, sql);
  }
});

test("super admins can propose the new keys, and nothing else slips through", async () => {
  const db = await fixture();
  const validate = (changes) =>
    db.query("select public.validate_platform_setting_change($1::jsonb)", [JSON.stringify(changes)]);
  await validate({
    short_notice_free_hours: 0,
    late_cancel_fee_days: 1.5,
    short_trip_late_cancel_fee_days: 0.5,
    no_show_fee_days: 3,
    short_trip_no_show_fee_days: 2,
  });
  await validate({ refund_full_hours: 48, no_show_grace_minutes: 30 });
  await assert.rejects(validate({ short_notice_free_hours: 2.5 }), /whole number 0-24/);
  await assert.rejects(validate({ late_cancel_fee_days: 31 }), /late_cancel_fee_days must be 0-30/);
  await assert.rejects(validate({ short_trip_no_show_fee_days: 2.1 }), /must be 0-2/);
  await assert.rejects(validate({ no_show_fee_days: "2" }), /must be a number/);
  await assert.rejects(validate({ no_show_renter_refund_percent: 50 }), /not configurable/);
});

test("the Terms and Platform Agreement are republished with the fee wording, once", async () => {
  const db = await fixture();
  const published = async (key) =>
    (
      await db.query(
        "select version_number, content_html from public.legal_document_versions where status = 'published' and document_key = $1",
        [key],
      )
    ).rows[0];

  const terms = await published("terms_of_service");
  assert.equal(terms.version_number, 2);
  assert.match(terms.content_html, /6\.1 Free Renter Cancellation/);
  assert.match(terms.content_html, /6\.2 Late Renter Cancellation Fee/);
  assert.match(terms.content_html, /no-show fee counted the same way/);
  assert.doesNotMatch(terms.content_html, /A policy share of the captured amount/);

  const agreement = await published("platform_agreement");
  assert.equal(agreement.version_number, 2);
  assert.match(agreement.content_html, /a cancellation fee counted in rental days applies/);
  assert.match(agreement.content_html, /no-show fee counted in rental days/);
  assert.doesNotMatch(agreement.content_html, /forfeits the same published share/);
  assert.doesNotMatch(agreement.content_html, /only a published share of the captured amount/);

  assert.equal((await published("privacy_policy")).version_number, 1, "privacy policy untouched");
  const superseded = await db.query(
    "select count(*)::int as n from public.legal_document_versions where status = 'superseded'",
  );
  assert.equal(superseded.rows[0].n, 2, "version 1 of both stays in the history");
  const audited = await db.query(
    "select count(*)::int as n from public.audit_log where action = 'legal_document_published'",
  );
  assert.equal(audited.rows[0].n, 2);

  await db.exec(chapterText(await loadMaster()));
  assert.equal((await published("terms_of_service")).version_number, 2, "a second run changes nothing");
  assert.equal((await published("platform_agreement")).version_number, 2);
});

// 2030-10-10 10:00 in Manila.
const PICKUP = Date.UTC(2030, 9, 10, 10, 0) - 8 * HOUR;

const feeDayBooking = (overrides = {}) => ({
  start_date: "2030-10-10",
  pickup_time: "10:00",
  total_days: 2,
  total_price: 2000,
  base_price: 2000,
  refund_full_hours_snapshot: 24,
  refund_late_renter_percent_snapshot: 50,
  short_notice_free_hours_snapshot: 4,
  late_cancel_fee_days_snapshot: 1,
  short_trip_late_cancel_fee_days_snapshot: 0.5,
  no_show_fee_days_snapshot: 2,
  short_trip_no_show_fee_days_snapshot: 0.75,
  ...overrides,
});

const fiveDays = (overrides = {}) =>
  feeDayBooking({ total_days: 5, total_price: 5000, base_price: 5000, ...overrides });

// Both copies must give the identical answer for every case.
const outcome = (booking, { captured, hoursBeforePickup, paidHoursBeforePickup = 72, event = "cancel" }) => {
  const input = {
    booking,
    capturedTotal: captured,
    firstPaymentAtMs: paidHoursBeforePickup === null ? null : PICKUP - paidHoursBeforePickup * HOUR,
    nowMs: PICKUP - hoursBeforePickup * HOUR,
    event,
  };
  const decided = server.getCancellationOutcome(input);
  assert.deepEqual(browser.getCancellationOutcome(input), decided, "server and browser agree");
  return decided;
};

test("the reported case: paying in full no longer costs more than paying the downpayment", () => {
  const paidInFull = outcome(feeDayBooking(), { captured: 2000, hoursBeforePickup: 10 });
  assert.equal(paidInFull.outcome, "late_cancel");
  assert.equal(paidInFull.feeDays, 0.5, "a 2-day trip is a short trip: half a day");
  assert.equal(paidInFull.fee, 500);
  assert.equal(paidInFull.renterRefund, 1500);
  assert.equal(paidInFull.listerCompensation, 500);

  const downpayment = outcome(feeDayBooking(), { captured: 1000, hoursBeforePickup: 10 });
  assert.equal(downpayment.fee, 500, "the same fee");
  assert.equal(downpayment.renterRefund, 500);
});

test("a trip over two days costs one day to cancel late", () => {
  assert.equal(outcome(feeDayBooking({ total_days: 3, total_price: 3000, base_price: 3000 }), { captured: 3000, hoursBeforePickup: 10 }).fee, 1000);
  const full = outcome(fiveDays(), { captured: 5000, hoursBeforePickup: 10 });
  assert.deepEqual([full.fee, full.renterRefund], [1000, 4000]);
  const down = outcome(fiveDays(), { captured: 2500, hoursBeforePickup: 10 });
  assert.deepEqual([down.fee, down.renterRefund], [1000, 1500]);
});

test("a no-show costs more than a late cancellation", () => {
  const short = outcome(feeDayBooking(), { captured: 2000, hoursBeforePickup: 0, event: "no_show" });
  assert.deepEqual([short.outcome, short.fee, short.renterRefund], ["no_show", 750, 1250]);
  const long = outcome(fiveDays(), { captured: 5000, hoursBeforePickup: 0, event: "no_show" });
  assert.deepEqual([long.fee, long.renterRefund], [2000, 3000]);
});

test("the fee never takes more than was paid", () => {
  const capped = outcome(feeDayBooking(), { captured: 400, hoursBeforePickup: 0, event: "no_show" });
  assert.equal(capped.feeBeforeCap, 750);
  assert.equal(capped.fee, 400);
  assert.equal(capped.renterRefund, 0, "a PHP 0 refund - settled without a transfer");
});

test("cancelling a day or more ahead is free and automatic", () => {
  const early = outcome(feeDayBooking(), { captured: 2000, hoursBeforePickup: 30 });
  assert.equal(early.outcome, "free");
  assert.equal(early.freeReason, "before_window");
  assert.equal(early.renterRefund, 2000);
  assert.equal(early.freeUntilMs, PICKUP - 24 * HOUR);
});

test("a booking paid close to pickup gets a few free hours after paying, never past pickup", () => {
  const inGrace = outcome(feeDayBooking(), { captured: 2000, paidHoursBeforePickup: 20, hoursBeforePickup: 17 });
  assert.equal(inGrace.outcome, "free");
  assert.equal(inGrace.freeReason, "short_notice_grace");
  assert.equal(inGrace.freeUntilMs, PICKUP - 16 * HOUR);

  const afterGrace = outcome(feeDayBooking(), { captured: 2000, paidHoursBeforePickup: 20, hoursBeforePickup: 15 });
  assert.equal(afterGrace.outcome, "late_cancel");
  assert.equal(afterGrace.fee, 500);

  const nearPickup = outcome(feeDayBooking(), { captured: 2000, paidHoursBeforePickup: 3, hoursBeforePickup: 1 });
  assert.equal(nearPickup.outcome, "free");
  assert.equal(nearPickup.freeUntilMs, PICKUP, "the free hours stop at pickup");
});

test("cancelling after the pickup time is a no-show", () => {
  const late = outcome(feeDayBooking(), { captured: 2000, paidHoursBeforePickup: 2, hoursBeforePickup: -1 });
  assert.equal(late.outcome, "no_show");
  assert.equal(late.fee, 750);
});

test("the payment-processing part of the fee stays with SafeDrive; the lister gets the rental part", () => {
  const withFee = outcome(feeDayBooking({ total_price: 2100 }), { captured: 2100, hoursBeforePickup: 10 });
  assert.equal(withFee.fee, 525, "half of the PHP 1,050 average day");
  assert.equal(withFee.listerCompensation, 500);
  assert.equal(withFee.renterRefund, 1575);
});

test("an admin value of 0 means no fee, and a missing snapshot means the default - never 0", () => {
  const noFee = outcome(feeDayBooking({ short_trip_late_cancel_fee_days_snapshot: 0 }), { captured: 2000, hoursBeforePickup: 10 });
  assert.deepEqual([noFee.fee, noFee.renterRefund], [0, 2000]);
  const missing = outcome(feeDayBooking({ short_trip_late_cancel_fee_days_snapshot: null }), { captured: 2000, hoursBeforePickup: 10 });
  assert.equal(missing.fee, 500);
  const empty = outcome(feeDayBooking({ short_trip_no_show_fee_days_snapshot: "" }), { captured: 2000, hoursBeforePickup: 0, event: "no_show" });
  assert.equal(empty.fee, 750);
});

test("a booking made before CHAPTER 91 keeps its percentage terms", () => {
  const legacy = {
    start_date: "2030-10-10",
    pickup_time: "10:00",
    total_days: 2,
    total_price: 2000,
    base_price: 2000,
    refund_full_hours_snapshot: 24,
    refund_late_renter_percent_snapshot: 40,
  };
  const late = outcome(legacy, { captured: 2000, paidHoursBeforePickup: 1, hoursBeforePickup: 10 });
  assert.equal(late.terms, "legacy_percent");
  assert.equal(late.outcome, "late_cancel", "no free hours after paying under the old terms");
  assert.deepEqual([late.renterRefund, late.fee, late.lateRenterPercent], [800, 1200, 40]);
  assert.equal(outcome(legacy, { captured: 2000, hoursBeforePickup: -1 }).renterRefund, 0);
  assert.equal(outcome(legacy, { captured: 2000, hoursBeforePickup: 0, event: "no_show" }).renterRefund, 800);
  assert.equal(
    outcome({ ...legacy, refund_late_renter_percent_snapshot: null }, { captured: 2000, hoursBeforePickup: 10 }).renterRefund,
    1000,
    "a missing percentage is the 50% default, not 0",
  );
});

test("the charge is described in pesos and days", () => {
  const describe = (booking, options) => {
    const text = server.describeRenterCharge(outcome(booking, options));
    assert.equal(browser.describeRenterCharge(outcome(booking, options)), text);
    return text;
  };
  assert.equal(describe(feeDayBooking(), { captured: 2000, hoursBeforePickup: 10 }), "a late-cancellation fee of PHP 500 (half a day of rental)");
  assert.equal(describe(fiveDays(), { captured: 5000, hoursBeforePickup: 0, event: "no_show" }), "a no-show fee of PHP 2,000 (2 days of rental)");
  assert.equal(
    describe(feeDayBooking(), { captured: 400, hoursBeforePickup: 0, event: "no_show" }),
    "a no-show fee of PHP 750 (75% of a day of rental, capped at the PHP 400 paid)",
  );
  assert.equal(describe(fiveDays(), { captured: 5000, hoursBeforePickup: 10 }), "a late-cancellation fee of PHP 1,000 (1 day of rental)");
  assert.equal(describe(feeDayBooking(), { captured: 2000, hoursBeforePickup: 30 }), "no fee");
});

test("a lister can cancel at the meetup until the handover; a renter cannot once anyone checked in", () => {
  const at = "2030-10-10T02:00:00Z";
  const cases = [
    [{}, "renter", false, "before anyone arrives, the renter can cancel"],
    [{}, "lister", false, "and so can the lister"],
    [{ renter_arrived_at: at }, "renter", true, "renter checked in - the no-car report takes over"],
    [{ lister_arrived_at: at }, "renter", true, "lister checked in - the no-show report takes over"],
    [{ renter_arrived_at: at, lister_arrived_at: at }, "lister", false, "both here, car not handed over: the lister can still cancel"],
    [{ lister_arrived_at: at }, "lister", false, "the lister alone at the meetup can cancel"],
    [{ renter_arrived_at: at, lister_arrived_at: at, lister_handover_confirmed_at: at }, "lister", true, "handed over - too late for anyone"],
    [{ renter_handover_received_at: at }, "renter", true, "received - too late for anyone"],
  ];
  for (const [booking, role, blocked, why] of cases) {
    assert.equal(server.pickupBlocksCancellation(booking, role), blocked, why);
    assert.equal(browser.pickupBlocksCancellation(booking, role), blocked, `${why} (browser)`);
  }
});

const HEADING_92 = "-- CHAPTER 92 - A pickup nobody checks in for is closed, not left hanging";

const chapter92Text = (master) => {
  const body = master.split(HEADING_92)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, "CHAPTER 92 exists in the master file");
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
};

// CHAPTER 92 sits on top of CHAPTER 91, so both are applied, in order.
async function fixture92() {
  const db = await fixture();
  await db.exec(`
    create role anon; create role authenticated;
    alter table public.platform_settings add column no_show_grace_minutes integer not null default 30;
    alter table public.bookings
      add column owner_id uuid, add column renter_id uuid,
      add column status text, add column end_date date;
    create table public.booking_cancellations(
      booking_id uuid primary key,
      cancelled_by_role text not null check (cancelled_by_role in ('renter', 'lister')),
      lister_id uuid, renter_id uuid,
      was_late boolean not null default false,
      strike_waived boolean not null default false,
      cancelled_at timestamptz not null default now());
  `);
  await db.exec(chapter92Text(await loadMaster()));
  return db;
}

test("CHAPTER 92: the close-hours setting, its bounds, and the vote whitelist", async () => {
  const db = await fixture92();
  const { rows } = await db.query("select mutual_no_show_close_hours as h from public.platform_settings");
  assert.equal(Number(rows[0].h), 6);
  await assert.rejects(db.exec("update public.platform_settings set mutual_no_show_close_hours = 0"), /_check/);
  await assert.rejects(db.exec("update public.platform_settings set mutual_no_show_close_hours = 73"), /_check/);
  const validate = (changes) =>
    db.query("select public.validate_platform_setting_change($1::jsonb)", [JSON.stringify(changes)]);
  await validate({ mutual_no_show_close_hours: 12, late_cancel_fee_days: 1 });
  await assert.rejects(validate({ mutual_no_show_close_hours: 2.5 }), /whole number 1-72/);
});

test("CHAPTER 92: a missed pickup is one 'both' row, and it counts for each side", async () => {
  const db = await fixture92();
  const LISTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const RENTER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await db.query(
    "insert into public.booking_cancellations(booking_id, cancelled_by_role, lister_id, renter_id, was_late) values ($1, 'both', $2, $3, true)",
    ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", LISTER, RENTER],
  );
  await assert.rejects(
    db.query(
      "insert into public.booking_cancellations(booking_id, cancelled_by_role) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'system')",
    ),
    /cancelled_by_role_check/,
  );
  const lister = (await db.query("select public.get_lister_reliability($1) as r", [LISTER])).rows[0].r;
  const renter = (await db.query("select public.get_renter_reliability($1) as r", [RENTER])).rows[0].r;
  assert.equal(lister.cancellations, 1, "counts against the lister");
  assert.equal(lister.late_cancellations, 1);
  assert.equal(renter.cancellations, 1, "and against the renter");
});

test("CHAPTER 92: Terms 6.4 is republished with the rule, once", async () => {
  const db = await fixture92();
  const published = async () =>
    (
      await db.query(
        "select version_number, content_html from public.legal_document_versions where status = 'published' and document_key = 'terms_of_service'",
      )
    ).rows[0];
  const terms = await published();
  assert.equal(terms.version_number, 3);
  assert.match(terms.content_html, /If neither participant checks in within a set number of hours/);
  assert.match(terms.content_html, /6\.2 Late Renter Cancellation Fee/, "CHAPTER 91's clauses are kept");
  const agreement = await db.query(
    "select version_number from public.legal_document_versions where status = 'published' and document_key = 'platform_agreement'",
  );
  assert.equal(agreement.rows[0].version_number, 2, "the agreement is untouched");
  await db.exec(chapter92Text(await loadMaster()));
  assert.equal((await published()).version_number, 3, "a second run changes nothing");
});

test("a pickup nobody checks in for is warned after the grace window and closed hours after pickup", () => {
  const booking = { start_date: "2030-10-10", pickup_time: "10:00" };
  for (const policy of [server, browser]) {
    const times = policy.getMutualNoShowTimes(booking, 30, 6);
    assert.equal(times.pickupMs, PICKUP);
    assert.equal(times.noticeAtMs, PICKUP + 30 * 60_000);
    assert.equal(times.closeAtMs, PICKUP + 6 * HOUR);
    const tight = policy.getMutualNoShowTimes(booking, 180, 1);
    assert.equal(tight.closeAtMs, tight.noticeAtMs, "never closed before the warning is due");
    assert.equal(policy.getMutualNoShowTimes({ start_date: "", pickup_time: null }, 30, 6), null);
  }
});

test("a pickup that started but never became a trip is warned, then settled", () => {
  const at = (hours) => new Date(PICKUP + hours * HOUR).toISOString();
  const base = { start_date: "2030-10-10", pickup_time: "10:00" };
  for (const policy of [server, browser]) {
    assert.equal(policy.getStalledPickup(base, 30, 6, null), null, "nobody arrived is CHAPTER 92's case");

    const renterOnly = policy.getStalledPickup({ ...base, renter_arrived_at: at(-0.5) }, 30, 6, null);
    assert.equal(renterOnly.situation, "renter_only");
    assert.equal(renterOnly.noticeAtMs, PICKUP + 30 * 60_000);
    assert.equal(renterOnly.closeAtMs, PICKUP + 6 * HOUR);

    const warnedLate = policy.getStalledPickup({ ...base, lister_arrived_at: at(0) }, 30, 6, PICKUP + 5.5 * HOUR);
    assert.equal(warnedLate.situation, "lister_only");
    assert.equal(warnedLate.closeAtMs, PICKUP + 6.5 * HOUR, "never closed within an hour of its warning");

    const bothHere = policy.getStalledPickup(
      { ...base, renter_arrived_at: at(1), lister_arrived_at: at(3) },
      30,
      6,
      null,
    );
    assert.equal(bothHere.situation, "no_handover");
    assert.equal(bothHere.noticeAtMs, PICKUP + 5 * HOUR, "two hours after both are there");
    assert.equal(bothHere.closeAtMs, PICKUP + 6 * HOUR);

    assert.equal(
      policy.getStalledPickup({ ...base, renter_arrived_at: at(0), lister_arrived_at: at(0), lister_handover_confirmed_at: at(1) }, 30, 6, null),
      null,
      "a handed-over car is not a stalled pickup",
    );
  }
});

const HEADING_94 = "-- CHAPTER 94 - The Terms and Platform Agreement say what the booking rules do";

test("CHAPTER 94: the Terms and Platform Agreement are corrected and republished, once", async () => {
  const db = await fixture92();
  const master = await loadMaster();
  const body = master.split(HEADING_94)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, "CHAPTER 94 exists in the master file");
  const chapter94 = "-- chapter\n" + body.slice(body.indexOf("\n"));
  await db.exec(chapter94);

  const published = async (key) =>
    (
      await db.query(
        "select version_number, content_html from public.legal_document_versions where status = 'published' and document_key = $1",
        [key],
      )
    ).rows[0];

  const terms = await published("terms_of_service");
  assert.equal(terms.version_number, 4, "on top of CHAPTER 91 (v2) and CHAPTER 92 (v3)");
  for (const phrase of [
    "default 12 hours",
    "A trip can start at most 60 days after the request is sent.",
    "a single continuous trip can last at most 30 days",
    "by its balance deadline",
    "cancelled as described in Section 5.3",
    "The vehicle page shows the free cancellation time and the fees in pesos",
    "6.3 Lister Cancellation and Vehicle Documents",
    "including at the pickup point after arriving",
    "vehicle's documents are still under review",
    "when only one participant checks in and no report is filed",
    "recorded against both participants",
  ]) {
    assert.ok(terms.content_html.includes(phrase), `Terms: ${phrase}`);
  }
  for (const gone of [
    "Bookings cannot be made more than 30 days in advance",
    "same 30-day booking horizon",
    "before the designated rental start time",
    "is cancelled under this same rule",
    "A lister may cancel before the trip starts.",
  ]) {
    assert.ok(!terms.content_html.includes(gone), `Terms no longer says: ${gone}`);
  }

  const agreement = await published("platform_agreement");
  assert.equal(agreement.version_number, 3, "on top of CHAPTER 91 (v2)");
  for (const phrase of [
    "Maximum Advance Booking and Trip Length",
    "at most 60 days after the request",
    "(default 12 hours)",
    "settles the booking automatically a set number of hours after the pickup time (default 6)",
    "by its balance deadline",
    "including at the pickup point",
    "released after SafeDrive support confirms the claim",
    "The vehicle page shows these amounts in pesos",
  ]) {
    assert.ok(agreement.content_html.includes(phrase), `Agreement: ${phrase}`);
  }
  for (const gone of ["maximum of 30 days in advance", "<em>full</em> automatic refund", "A pre-trip lister cancellation"]) {
    assert.ok(!agreement.content_html.includes(gone), `Agreement no longer says: ${gone}`);
  }

  assert.equal((await published("privacy_policy")).version_number, 1, "privacy policy untouched");
  await db.exec(chapter94);
  assert.equal((await published("terms_of_service")).version_number, 4, "a second run changes nothing");
  assert.equal((await published("platform_agreement")).version_number, 3);
});

test("the car page's quote is the fee a real cancellation charges", () => {
  const settings = {
    refundFullHours: 24,
    shortNoticeFreeHours: 4,
    lateCancelFeeDays: 1,
    shortTripLateCancelFeeDays: 0.5,
    noShowFeeDays: 2,
    shortTripNoShowFeeDays: 0.75,
  };
  for (const policy of [server, browser]) {
    for (const trip of [
      { totalDays: 2, totalPrice: 2000, basePrice: 2000 },
      { totalDays: 5, totalPrice: 5000, basePrice: 5000 },
      { totalDays: 3, totalPrice: 3150, basePrice: 3000 },
    ]) {
      const quote = policy.getCancellationQuote({ ...trip, pickupMs: PICKUP, nowMs: PICKUP - 72 * HOUR, settings });
      const booking = feeDayBooking({
        total_days: trip.totalDays,
        total_price: trip.totalPrice,
        base_price: trip.basePrice,
      });
      const late = policy.getCancellationOutcome({
        booking,
        capturedTotal: trip.totalPrice,
        firstPaymentAtMs: PICKUP - 72 * HOUR,
        nowMs: PICKUP - 10 * HOUR,
        event: "cancel",
      });
      const noShow = policy.getCancellationOutcome({
        booking,
        capturedTotal: trip.totalPrice,
        firstPaymentAtMs: PICKUP - 72 * HOUR,
        nowMs: PICKUP,
        event: "no_show",
      });
      assert.equal(quote.lateFee, late.fee, `late fee, ${trip.totalDays} days`);
      assert.equal(quote.noShowFee, noShow.fee, `no-show fee, ${trip.totalDays} days`);
      assert.equal(quote.lateFeeDays, late.feeDays);
      assert.equal(quote.noShowFeeDays, noShow.feeDays);
    }

    const early = policy.getCancellationQuote({ totalDays: 2, totalPrice: 2000, basePrice: 2000, pickupMs: PICKUP, nowMs: PICKUP - 72 * HOUR, settings });
    assert.equal(early.freeUntilMs, PICKUP - 24 * HOUR);
    assert.equal(early.freeWindowOpenNow, true);

    const close = policy.getCancellationQuote({ totalDays: 2, totalPrice: 2000, basePrice: 2000, pickupMs: PICKUP, nowMs: PICKUP - 3 * HOUR, settings });
    assert.equal(close.freeWindowOpenNow, false, "only the free hours after paying remain");
    assert.equal(close.graceHours, 4);

    const noTimeYet = policy.getCancellationQuote({ totalDays: 2, totalPrice: 2000, basePrice: 2000, pickupMs: null, nowMs: PICKUP, settings });
    assert.equal(noTimeYet.freeUntilMs, null);
    assert.equal(noTimeYet.lateFee, 500);

    const noFees = policy.getCancellationQuote({
      totalDays: 5, totalPrice: 5000, basePrice: 5000, pickupMs: PICKUP, nowMs: PICKUP - 72 * HOUR,
      settings: { ...settings, lateCancelFeeDays: 0, noShowFeeDays: 0 },
    });
    assert.deepEqual([noFees.lateFee, noFees.noShowFee], [0, 0], "an admin value of 0 is quoted as no fee");
  }
});

test("the server plan reads what was paid, and when, off the booking's own payments", () => {
  const booking = {
    id: "booking",
    renter_id: "renter",
    owner_id: "owner",
    ...feeDayBooking(),
    payments: [
      { payment_type: "downpayment", status: "completed", amount: "1000", created_at: new Date(PICKUP - 20 * HOUR).toISOString() },
      { payment_type: "balance", status: "failed", amount: 1000, created_at: new Date(PICKUP - 19 * HOUR).toISOString() },
      { payment_type: "refund", status: "completed", amount: -50, created_at: new Date(PICKUP - 30 * HOUR).toISOString() },
    ],
  };
  const inGrace = getCancellationRefundPlan(booking, "cancel", PICKUP - 17 * HOUR);
  assert.equal(inGrace.capturedTotal, 1000, "only completed downpayment and balance count");
  assert.equal(inGrace.isLate, false);
  assert.equal(inGrace.recommendedRenterRefund, 1000);

  const late = getCancellationRefundPlan(booking, "cancel", PICKUP - 10 * HOUR);
  assert.equal(late.isLate, true);
  assert.equal(late.recommendedRenterRefund, 500);

  const noShow = getCancellationRefundPlan(booking, "no_show", PICKUP + HOUR);
  assert.equal(noShow.fee, 750);
  assert.equal(noShow.recommendedRenterRefund, 250);
});
