// CHAPTER 93 - a trip cannot start sooner than the minimum notice.
//
// The chapter is applied verbatim to real PostgreSQL (PGlite), and the notice
// rule is pinned through both copies - the server refuses the request, the car
// page only offers the times that pass - with the case that was reported.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import * as server from "../server/bookingNotice.ts";
import * as browser from "../src/lib/bookingNotice.ts";
import { TIME_OPTIONS } from "../src/lib/timeOptions.ts";

const HOUR = 3_600_000;
const HEADING = "-- CHAPTER 93 - A trip cannot start sooner than the minimum notice";

const chapterText = async () => {
  const master = await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  );
  const body = master.split(HEADING)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, "CHAPTER 93 exists in the master file");
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table public.platform_settings(id text primary key);
    insert into public.platform_settings(id) values ('default');
  `);
  await db.exec(await chapterText());
  return db;
}

test("the setting starts at 12 hours and stays within 1-168", async () => {
  const db = await fixture();
  const { rows } = await db.query("select min_booking_notice_hours as h from public.platform_settings");
  assert.equal(Number(rows[0].h), 12);
  await assert.rejects(db.exec("update public.platform_settings set min_booking_notice_hours = 0"), /_check/);
  await assert.rejects(db.exec("update public.platform_settings set min_booking_notice_hours = 169"), /_check/);
});

test("super admins can propose it, and the earlier keys still pass", async () => {
  const db = await fixture();
  const validate = (changes) =>
    db.query("select public.validate_platform_setting_change($1::jsonb)", [JSON.stringify(changes)]);
  await validate({ min_booking_notice_hours: 24 });
  await validate({ mutual_no_show_close_hours: 6, late_cancel_fee_days: 1 });
  await assert.rejects(validate({ min_booking_notice_hours: 0 }), /whole number 1-168/);
  await assert.rejects(validate({ min_booking_notice_hours: 1.5 }), /whole number 1-168/);
  await assert.rejects(validate({ min_booking_notice_hours: "12" }), /must be a number/);
});

// Sept 14, 2026, 11:30 PM in Manila.
const NOW = Date.UTC(2026, 8, 14, 23, 30) - 8 * HOUR;

test("the reported request: 11:30 PM for a 12:00 AM pickup is refused", () => {
  for (const notice of [server, browser]) {
    const midnight = notice.getManilaPickupMs("2026-09-15", "00:00");
    assert.equal(midnight, NOW + 0.5 * HOUR);
    assert.equal(notice.meetsBookingNotice(midnight, NOW, 12), false, "30 minutes is not 12 hours");
    assert.equal(notice.meetsBookingNotice(notice.getManilaPickupMs("2026-09-15", "11:30"), NOW, 12), true);
    assert.equal(notice.meetsBookingNotice(notice.getManilaPickupMs("2026-09-15", "11:00"), NOW, 12), false);
    assert.equal(notice.formatManilaDateTime(notice.getEarliestPickupMs(NOW, 12)), "Sep 15, 11:30 AM");
  }
});

test("the car page only offers pickup times that meet the notice", () => {
  for (const notice of [server, browser]) {
    const nextDay = notice.filterPickupTimesByNotice(TIME_OPTIONS, "2026-09-15", NOW, 12);
    assert.equal(nextDay[0].value, "11:30", "the first time offered on Sept 15");
    assert.equal(nextDay.length, 25, "11:30 AM through 11:30 PM");
    assert.equal(notice.filterPickupTimesByNotice(TIME_OPTIONS, "2026-09-16", NOW, 12).length, 48);
    assert.equal(notice.filterPickupTimesByNotice(TIME_OPTIONS, "2026-09-15", NOW, 1)[0].value, "00:30");
    assert.equal(notice.filterPickupTimesByNotice(TIME_OPTIONS, "2026-09-15", NOW, 48).length, 0);
  }
});

test("an unreadable setting is the default, never zero hours", () => {
  for (const notice of [server, browser]) {
    assert.equal(notice.normalizeBookingNoticeHours(null), 12);
    assert.equal(notice.normalizeBookingNoticeHours(""), 12);
    assert.equal(notice.normalizeBookingNoticeHours(0), 12);
    assert.equal(notice.normalizeBookingNoticeHours("24"), 24);
    assert.equal(notice.normalizeBookingNoticeHours(500), 12);
  }
});
