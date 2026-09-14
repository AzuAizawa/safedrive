// CHAPTER 87 - Browse Cars filters by date; every calendar sees every booking.
//
// Which cars are offered for a date is decided in the database, so it is
// proved against real PostgreSQL (PGlite). The fixture builds only what the
// chapter touches and applies the chapter verbatim out of the master file.
// The dates carried from Browse to a car's page are checked at the end.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { formatDateOnly, parseTripDatesQuery, tripDatesQuery } from "../src/lib/tripDates.ts";

const BOOKED = "11111111-1111-4111-8111-111111111111"; // fully paid Oct 26-28
const BLACKOUT = "22222222-2222-4222-8222-222222222222"; // owner blocked Oct 20-22
const EXPIRING = "33333333-3333-4333-8333-333333333333"; // documents end Oct 27, 09:00
const FREE = "44444444-4444-4444-8444-444444444444"; // only cancelled/finished bookings
const UNLISTED = "55555555-5555-4555-8555-555555555555"; // still pending approval
const DELETED = "66666666-6666-4666-8666-666666666666"; // deleted by its lister

const HOLDING = ["pending", "confirmed", "awaiting_payment", "downpayment_paid", "fully_paid", "active"];

let chapter;

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
      renter_id uuid default gen_random_uuid(),
      start_date date not null,
      end_date date not null,
      status text not null);
    create table public.vehicle_unavailability(
      id uuid primary key default gen_random_uuid(),
      car_id uuid not null references public.cars(id),
      start_date date not null,
      end_date date not null,
      category text);

    -- Stand-in for the real document check: eligible while documents cover
    -- the end of the window asked about.
    create function public.vehicle_compliance_summary(
      p_car_id uuid, p_start timestamptz default now(), p_end timestamptz default now()
    ) returns jsonb language sql stable as $$
      select jsonb_build_object('eligible', coalesce(c.covered_until >= p_end, true))
      from public.cars c where c.id = p_car_id
    $$;

    insert into public.cars(id, status, deleted_at, covered_until) values
      ('${BOOKED}', 'approved', null, null),
      ('${BLACKOUT}', 'active', null, null),
      ('${EXPIRING}', 'approved', null, '2030-10-27 09:00:00+08'),
      ('${FREE}', 'approved', null, null),
      ('${UNLISTED}', 'pending', null, null),
      ('${DELETED}', 'approved', now(), null);

    insert into public.bookings(car_id, start_date, end_date, status) values
      ('${BOOKED}', '2030-10-26', '2030-10-28', 'fully_paid'),
      ('${FREE}', '2030-10-25', '2030-10-27', 'cancelled'),
      ('${FREE}', '2030-10-25', '2030-10-27', 'completed'),
      ('${FREE}', '2030-10-25', '2030-10-27', 'rejected'),
      ('${FREE}', '2020-01-01', '2020-01-03', 'fully_paid');

    insert into public.vehicle_unavailability(car_id, start_date, end_date, category) values
      ('${BLACKOUT}', '2030-10-20', '2030-10-22', 'maintenance');
  `);

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 87 - Browse Cars can filter by date")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 87 exists in the master file");
  await db.exec("-- CHAPTER 87\n" + chapter.slice(chapter.indexOf("\n")));

  return db;
}

const available = async (db, start, end = null) => {
  const { rows } = await db.query(
    "select car_id from public.get_available_car_ids($1::date, $2::date)",
    [start, end],
  );
  return new Set(rows.map((r) => r.car_id));
};

test("the chapter adds two functions and changes no data", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select proname from pg_proc
      where proname in ('get_car_booked_ranges', 'get_available_car_ids')
      order by proname`,
  );
  assert.deepEqual(rows.map((r) => r.proname), ["get_available_car_ids", "get_car_booked_ranges"]);

  const { rows: counts } = await db.query(
    "select (select count(*) from public.bookings)::int as b, (select count(*) from public.cars)::int as c",
  );
  assert.deepEqual(counts[0], { b: 5, c: 6 });
});

test("a pickup and return date: only cars free for the whole trip", async () => {
  const db = await fixture();
  const cars = await available(db, "2030-10-25", "2030-10-27");
  assert.equal(cars.has(BOOKED), false, "booked from the 26th");
  assert.equal(cars.has(FREE), true, "cancelled, completed and rejected bookings hold nothing");
  assert.equal(cars.has(BLACKOUT), true, "its blackout was the week before");
  assert.equal(cars.has(EXPIRING), true, "documents last until the return");
});

test("a pickup date alone: the car must be free for the shortest trip from it", async () => {
  const db = await fixture();
  assert.equal((await available(db, "2030-10-25")).has(BOOKED), false,
    "a one-day trip from the 25th returns on the 26th, which is taken");
  assert.equal((await available(db, "2030-10-24")).has(BOOKED), true, "the 24th to the 25th is free");
});

test("the return day of a booking is still that booking's", async () => {
  const db = await fixture();
  assert.equal((await available(db, "2030-10-28")).has(BOOKED), false, "returned on the 28th");
  assert.equal((await available(db, "2030-10-29")).has(BOOKED), true);
});

test("every status that holds dates in create-booking holds them here", async () => {
  for (const status of HOLDING) {
    const db = await fixture();
    await db.query(
      "insert into public.bookings(car_id, start_date, end_date, status) values($1, '2030-11-10', '2030-11-12', $2)",
      [FREE, status],
    );
    assert.equal((await available(db, "2030-11-11")).has(FREE), false, `${status} should hold the dates`);
  }
});

test("an owner's blackout takes the car out for those dates", async () => {
  const db = await fixture();
  assert.equal((await available(db, "2030-10-21")).has(BLACKOUT), false);
  assert.equal((await available(db, "2030-10-19")).has(BLACKOUT), false, "returning on the 20th");
  assert.equal((await available(db, "2030-10-23")).has(BLACKOUT), true);
});

test("documents have to cover the whole trip", async () => {
  const db = await fixture();
  assert.equal((await available(db, "2030-10-25", "2030-10-27")).has(EXPIRING), true);
  assert.equal((await available(db, "2030-10-25", "2030-10-28")).has(EXPIRING), false,
    "the return is after the documents end");
});

test("unlisted and deleted cars are never offered", async () => {
  const db = await fixture();
  const cars = await available(db, "2030-12-01");
  assert.equal(cars.has(UNLISTED), false);
  assert.equal(cars.has(DELETED), false);
  assert.equal(cars.has(FREE), true);
});

test("a return on or before the pickup, or a trip over 30 days, is refused", async () => {
  const db = await fixture();
  await assert.rejects(available(db, "2030-10-25", "2030-10-25"), /return date must be after/i);
  await assert.rejects(available(db, "2030-10-25", "2030-10-24"), /return date must be after/i);
  await assert.rejects(available(db, "2030-10-01", "2030-11-01"), /at most 30 days/i);
  assert.ok((await available(db, "2030-10-01", "2030-10-31")).has(FREE), "exactly 30 days is fine");
});

test("a car's calendar gets every booking's dates, and nothing about who booked", async () => {
  const db = await fixture();
  const { rows, fields } = await db.query(
    "select * from public.get_car_booked_ranges($1)",
    [BOOKED],
  );
  assert.deepEqual(fields.map((f) => f.name), ["start_date", "end_date"], "no renter column");
  assert.equal(rows.length, 1);

  const { rows: free } = await db.query("select * from public.get_car_booked_ranges($1)", [FREE]);
  assert.equal(free.length, 0, "cancelled, finished and long-past bookings are not shown");

  await db.query(
    "insert into public.bookings(car_id, start_date, end_date, status) values($1, '2030-10-01', '2030-10-02', 'pending')",
    [UNLISTED],
  );
  const { rows: unlisted } = await db.query("select * from public.get_car_booked_ranges($1)", [UNLISTED]);
  assert.equal(unlisted.length, 0, "an unlisted car has no public calendar");
});

test("signed-in users may call both; anonymous visitors may not", async () => {
  const db = await fixture();
  const { rows } = await db.query(`
    select
      has_function_privilege('authenticated', 'public.get_available_car_ids(date,date)', 'execute') as auth_available,
      has_function_privilege('authenticated', 'public.get_car_booked_ranges(uuid)', 'execute') as auth_ranges,
      has_function_privilege('anon', 'public.get_available_car_ids(date,date)', 'execute') as anon_available,
      has_function_privilege('anon', 'public.get_car_booked_ranges(uuid)', 'execute') as anon_ranges
  `);
  assert.deepEqual(rows[0], {
    auth_available: true,
    auth_ranges: true,
    anon_available: false,
    anon_ranges: false,
  });
});

// Dates carried from Browse Cars to a car's page.
const NOW = new Date(2030, 9, 1, 15, 0); // Oct 1 2030, 3 PM
const LIMITS = { maxAdvanceDays: 60, maxTripDays: 30 };
const day = (d) => (d ? formatDateOnly(d) : undefined);
const parsed = (search) => {
  const trip = parseTripDatesQuery(search, NOW, LIMITS);
  return trip ? { from: day(trip.from), to: day(trip.to) } : undefined;
};

test("chosen dates travel to the car's page and back unchanged", () => {
  const query = tripDatesQuery({ from: new Date(2030, 9, 25), to: new Date(2030, 9, 27) });
  assert.equal(query, "?pickup=2030-10-25&return=2030-10-27");
  assert.deepEqual(parsed(query), { from: "2030-10-25", to: "2030-10-27" });

  assert.equal(tripDatesQuery({ from: new Date(2030, 9, 25) }), "?pickup=2030-10-25");
  assert.deepEqual(parsed("?pickup=2030-10-25"), { from: "2030-10-25", to: undefined });
  assert.equal(tripDatesQuery(undefined), "");
});

test("a link outside the booking windows is dropped, not half-applied", () => {
  assert.equal(parsed(""), undefined);
  assert.equal(parsed("?pickup=25-10-2030"), undefined, "wrong format");
  assert.equal(parsed("?pickup=2030-02-30"), undefined, "no such day");
  assert.equal(parsed("?pickup=2030-10-01"), undefined, "today - pickup starts tomorrow");
  assert.deepEqual(parsed("?pickup=2030-10-02"), { from: "2030-10-02", to: undefined });
  assert.equal(parsed("?pickup=2030-12-01"), undefined, "61 days ahead");

  assert.deepEqual(parsed("?pickup=2030-10-25&return=2030-10-25"), { from: "2030-10-25", to: undefined },
    "a return on the pickup day is dropped; the pickup stays");
  assert.deepEqual(parsed("?pickup=2030-10-02&return=2030-11-02"), { from: "2030-10-02", to: undefined },
    "a 31-day trip keeps only its pickup");
});
