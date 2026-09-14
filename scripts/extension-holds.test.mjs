// CHAPTER 88 - an approved extension holds its dates until it is paid.
//
// The hold has to reach every place that decides whether a day is free - a new
// booking, the lister's approval, an owner's blackout, the car's calendar and
// the Browse date filter - or it is a gap, not a hold. So the database side is
// proved against real PostgreSQL (PGlite) with CHAPTERS 87 and 88 applied
// verbatim, and the two copies of the rules that run outside it (server and
// browser) are pinned to the same answers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import * as server from "../server/extensionHolds.ts";
import * as browser from "../src/lib/bookingExtensions.ts";

const CAR_A = "11111111-1111-4111-8111-111111111111";
const CAR_B = "22222222-2222-4222-8222-222222222222";
const JUAN = "33333333-3333-4333-8333-333333333333"; // on a trip in CAR_A
const MARIA = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";
const JUAN_TRIP = "66666666-6666-4666-8666-666666666666"; // Oct 20-25, fully paid

const FUTURE = "2099-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";

let chapters;

const chapterText = (master, heading) => {
  const body = master.split(heading)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, `${heading} exists in the master file`);
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;

    create table public.cars(
      id uuid primary key,
      status text not null default 'approved',
      deleted_at timestamptz,
      covered_until timestamptz);
    create table public.bookings(
      id uuid primary key default gen_random_uuid(),
      car_id uuid not null references public.cars(id),
      renter_id uuid not null,
      start_date date not null,
      end_date date not null,
      status text not null);
    create table public.booking_extensions(
      id uuid primary key default gen_random_uuid(),
      booking_id uuid not null references public.bookings(id),
      renter_id uuid not null,
      owner_id uuid not null,
      current_end_date date not null,
      requested_end_date date not null,
      status text not null default 'pending',
      payment_deadline timestamptz);
    create table public.vehicle_unavailability(
      id uuid primary key default gen_random_uuid(),
      car_id uuid not null references public.cars(id),
      start_date date not null,
      end_date date not null,
      category text);
    create function public.vehicle_compliance_summary(
      p_car_id uuid, p_start timestamptz default now(), p_end timestamptz default now()
    ) returns jsonb language sql stable as $$
      select jsonb_build_object('eligible', coalesce(c.covered_until >= p_end, true))
      from public.cars c where c.id = p_car_id
    $$;

    insert into public.cars(id) values ('${CAR_A}'), ('${CAR_B}');
    insert into public.bookings(id, car_id, renter_id, start_date, end_date, status)
      values ('${JUAN_TRIP}', '${CAR_A}', '${JUAN}', '2030-10-20', '2030-10-25', 'fully_paid');
  `);

  if (!chapters) {
    const master = await readFile(
      new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
      "utf8",
    );
    chapters = [
      chapterText(master, "-- CHAPTER 87 - Browse Cars can filter by date"),
      chapterText(master, "-- CHAPTER 88 - An approved extension holds its dates"),
    ];
  }
  for (const chapter of chapters) await db.exec(chapter);
  return db;
}

// Juan asks to return on the 27th instead of the 25th: the 26th and 27th.
const addExtension = (db, { status = "approved", deadline = FUTURE, to = "2030-10-27" } = {}) =>
  db
    .query(
      `insert into public.booking_extensions
         (booking_id, renter_id, owner_id, current_end_date, requested_end_date, status, payment_deadline)
       values ($1, $2, $3, '2030-10-25', $4, $5, $6) returning id`,
      [JUAN_TRIP, JUAN, OWNER, to, status, deadline],
    )
    .then((r) => r.rows[0].id);

const book = (db, { car = CAR_A, renter = MARIA, start, end, status = "pending" }) =>
  db
    .query(
      "insert into public.bookings(car_id, renter_id, start_date, end_date, status) values($1,$2,$3,$4,$5) returning id",
      [car, renter, start, end, status],
    )
    .then((r) => r.rows[0].id);

const availableOn = async (db, start, end = null) => {
  const { rows } = await db.query(
    "select car_id from public.get_available_car_ids($1::date, $2::date)",
    [start, end],
  );
  return new Set(rows.map((r) => r.car_id));
};

const calendarOf = async (db, car) => {
  const { rows } = await db.query("select start_date, end_date from public.get_car_booked_ranges($1)", [car]);
  return rows.map((r) => `${r.start_date.toISOString().slice(0, 10)}..${r.end_date.toISOString().slice(0, 10)}`);
};

test("the chapter changes no rows", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select (select count(*) from public.bookings)::int as bookings,
            (select count(*) from public.booking_extensions)::int as extensions`,
  );
  assert.deepEqual(rows[0], { bookings: 1, extensions: 0 });
  const { rows: triggers } = await db.query(
    `select tgname from pg_trigger where tgname in
      ('guard_booking_against_extension_holds', 'guard_extension_approval', 'guard_blackout_against_extension_holds')
     order by tgname`,
  );
  assert.equal(triggers.length, 3);
});

test("an approved, unpaid extension shows as booked on the calendar and in Browse", async () => {
  const db = await fixture();
  await addExtension(db);

  assert.deepEqual(await calendarOf(db, CAR_A), ["2030-10-20..2030-10-25", "2030-10-26..2030-10-27"]);
  assert.equal((await availableOn(db, "2030-10-26")).has(CAR_A), false, "the 26th is held");
  assert.equal((await availableOn(db, "2030-10-27")).has(CAR_A), false, "the 27th is held");
  assert.equal((await availableOn(db, "2030-10-28")).has(CAR_A), true, "the 28th is free");
});

test("only an approved extension inside its payment window, on a live trip, holds anything", async () => {
  for (const [label, setup] of [
    ["pending", (db) => addExtension(db, { status: "pending" })],
    ["rejected", (db) => addExtension(db, { status: "rejected" })],
    ["expired", (db) => addExtension(db, { status: "expired" })],
    ["cancelled", (db) => addExtension(db, { status: "cancelled" })],
    ["paid (the booking itself covers the days)", (db) => addExtension(db, { status: "paid" })],
    ["approved but past its payment deadline", (db) => addExtension(db, { deadline: PAST })],
    ["approved on a completed trip", async (db) => {
      await addExtension(db);
      await db.query("update public.bookings set status = 'completed' where id = $1", [JUAN_TRIP]);
    }],
  ]) {
    const db = await fixture();
    await setup(db);
    assert.equal((await availableOn(db, "2030-10-26")).has(CAR_A), true, `${label} should hold nothing`);
    await book(db, { start: "2030-10-26", end: "2030-10-27" }); // does not throw
  }
});

test("nobody can book the held days of that car", async () => {
  const db = await fixture();
  await addExtension(db);
  await assert.rejects(
    book(db, { start: "2030-10-27", end: "2030-10-29" }),
    /held for an approved extension/i,
  );
  await book(db, { start: "2030-10-28", end: "2030-10-29" }); // the day after is free
});

test("the renter cannot start another trip on the days they are extending into", async () => {
  const db = await fixture();
  await addExtension(db);
  await assert.rejects(
    book(db, { car: CAR_B, renter: JUAN, start: "2030-10-26", end: "2030-10-28" }),
    /one trip at a time/i,
  );
  await book(db, { car: CAR_B, renter: MARIA, start: "2030-10-26", end: "2030-10-28" }); // other renter, other car
});

test("paying the extension stretches the booking over its own held days", async () => {
  const db = await fixture();
  await addExtension(db);
  await db.query("update public.bookings set end_date = '2030-10-27' where id = $1", [JUAN_TRIP]);
  const { rows } = await db.query("select end_date from public.bookings where id = $1", [JUAN_TRIP]);
  assert.equal(rows[0].end_date.toISOString().slice(0, 10), "2030-10-27");
});

test("a booking already holding its dates keeps moving through its statuses", async () => {
  const db = await fixture();
  // A race left both in place; the booking's payment must still go through.
  const maria = await book(db, { start: "2030-10-27", end: "2030-10-29" });
  await addExtension(db); // inserted directly - the approval guard runs on update
  for (const status of ["confirmed", "downpayment_paid", "fully_paid"]) {
    await db.query("update public.bookings set status = $1 where id = $2", [status, maria]);
  }
  await db.query("update public.bookings set end_date = '2030-10-28' where id = $1", [maria]); // shrinking is fine
  await assert.rejects(
    db.query("update public.bookings set start_date = '2030-10-26' where id = $1", [maria]),
    /held for an approved extension/i,
    "but it cannot grow into held days",
  );
});

test("a lister cannot approve an extension whose days are no longer free", async () => {
  const cases = [
    ["another booking on the car", (db) => book(db, { start: "2030-10-27", end: "2030-10-28" }), /overlap another booking/i],
    ["a trip of the same renter elsewhere", (db) => book(db, { car: CAR_B, renter: JUAN, start: "2030-10-26", end: "2030-10-26" }), /overlap another booking/i],
    ["an owner blackout", (db) => db.query(
      "insert into public.vehicle_unavailability(car_id, start_date, end_date) values($1, '2030-10-27', '2030-10-27')", [CAR_A]),
      /owner blocked/i],
  ];
  for (const [label, setup, message] of cases) {
    const db = await fixture();
    const ext = await addExtension(db, { status: "pending", deadline: null });
    await setup(db);
    await assert.rejects(
      db.query("update public.booking_extensions set status = 'approved' where id = $1", [ext]),
      message,
      label,
    );
  }

  const db = await fixture();
  const ext = await addExtension(db, { status: "pending", deadline: null });
  await book(db, { start: "2030-10-28", end: "2030-10-29" }); // starts the day after
  await db.query("update public.booking_extensions set status = 'approved', payment_deadline = $2 where id = $1", [ext, FUTURE]);
});

test("an owner cannot block days an approved extension holds", async () => {
  const db = await fixture();
  const ext = await addExtension(db, { status: "pending", deadline: null });
  const blackout = "insert into public.vehicle_unavailability(car_id, start_date, end_date) values($1, '2030-10-26', '2030-10-26')";

  // While the request is only pending, blocking is still allowed...
  await db.query(blackout, [CAR_A]);
  await db.query("delete from public.vehicle_unavailability");

  // ...once approved, it is not.
  await db.query("update public.booking_extensions set status = 'approved', payment_deadline = $2 where id = $1", [ext, FUTURE]);
  await assert.rejects(db.query(blackout, [CAR_A]), /conflicts with an approved extension/i);
});

test("the holds list is internal; browsers get only the date functions", async () => {
  const db = await fixture();
  const { rows } = await db.query(`
    select
      has_function_privilege('authenticated', 'public.approved_extension_holds()', 'execute') as auth_holds,
      has_function_privilege('anon', 'public.approved_extension_holds()', 'execute') as anon_holds,
      has_function_privilege('authenticated', 'public.get_car_booked_ranges(uuid)', 'execute') as auth_ranges,
      has_function_privilege('anon', 'public.get_available_car_ids(date,date)', 'execute') as anon_available
  `);
  assert.deepEqual(rows[0], { auth_holds: false, anon_holds: false, auth_ranges: true, anon_available: false });
});

// The rules that run outside the database.

test("server and browser count the same added days, across month and year ends", () => {
  for (const [current, requested, start] of [
    ["2030-10-25", "2030-10-27", "2030-10-26"],
    ["2030-10-31", "2030-11-02", "2030-11-01"],
    ["2030-12-31", "2031-01-01", "2031-01-01"],
    ["2032-02-28", "2032-03-01", "2032-02-29"],
  ]) {
    const extension = { current_end_date: current, requested_end_date: requested };
    assert.deepEqual(server.extensionAddedDays(extension), { start, end: requested });
    assert.deepEqual(browser.extensionAddedDays(extension), server.extensionAddedDays(extension));
  }
});

test("server and browser agree on which extensions hold dates", () => {
  const now = Date.parse("2030-10-25T12:00:00Z");
  for (const status of ["pending", "approved", "rejected", "paid", "cancelled", "expired"]) {
    for (const deadline of [null, "2030-10-26T00:00:00Z", "2030-10-25T00:00:00Z"]) {
      for (const bookingStatus of ["fully_paid", "active", "completed", "cancelled"]) {
        const extension = { status, payment_deadline: deadline };
        assert.equal(
          browser.isExtensionHoldingDates(extension, bookingStatus, now),
          server.isHoldingExtension(extension, bookingStatus, now),
          `${status} / ${deadline} / ${bookingStatus}`,
        );
      }
    }
  }
  assert.equal(server.isHoldingExtension({ status: "approved", payment_deadline: "2030-10-26T00:00:00Z" }, "active", now), true);
  assert.equal(server.isHoldingExtension({ status: "approved", payment_deadline: "2030-10-25T00:00:00Z" }, "active", now), false);
});

test("the lister is warned about exactly the requests an acceptance closes", () => {
  const juanTrip = { id: "juan", car_id: "A", renter_id: "juan", start_date: "2030-10-20", end_date: "2030-10-25" };
  const pedroTrip = { id: "pedro", car_id: "B", renter_id: "pedro", start_date: "2030-10-20", end_date: "2030-10-25" };
  const bookings = [juanTrip, pedroTrip];
  const extensions = [
    { id: "e1", booking_id: "juan", status: "pending", current_end_date: "2030-10-25", requested_end_date: "2030-10-27" },
    { id: "e2", booking_id: "pedro", status: "pending", current_end_date: "2030-10-25", requested_end_date: "2030-10-27" },
    { id: "e3", booking_id: "juan", status: "approved", current_end_date: "2030-10-25", requested_end_date: "2030-10-27" },
  ];
  const taken = (booking) =>
    browser.findPendingExtensionsTakenBy(booking, [...bookings, booking], extensions).map((t) => t.extension.id);

  assert.deepEqual(taken({ id: "maria", car_id: "A", renter_id: "maria", start_date: "2030-10-27", end_date: "2030-10-29" }), ["e1"],
    "same car, overlapping days: only the pending request - an approved one blocks the booking instead");
  assert.deepEqual(taken({ id: "maria", car_id: "A", renter_id: "maria", start_date: "2030-10-28", end_date: "2030-10-29" }), [],
    "the day after the requested return is free");
  assert.deepEqual(taken({ id: "maria", car_id: "C", renter_id: "maria", start_date: "2030-10-26", end_date: "2030-10-26" }), [],
    "another car, another renter");
  assert.deepEqual(taken({ id: "juan-2", car_id: "C", renter_id: "juan", start_date: "2030-10-26", end_date: "2030-10-28" }), ["e1"],
    "the same renter's next trip, on any car");
});
