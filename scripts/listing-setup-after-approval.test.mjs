// CHAPTER 114 - a car is reviewed on its papers, then set up for renters.
//
// Proved against real PostgreSQL (PGlite) with the chapter applied verbatim
// from the master file: a car can be submitted without a price, is never
// offered or bookable until its price and pickup location are in, and keeps
// its approval when the lister updates mileage or photos.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const RENTER = "22222222-2222-4222-8222-222222222222";
const CAR = "33333333-3333-4333-8333-333333333333";

let master;
async function chapter(header) {
  master ??= await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  );
  const body = master.split(header)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, `${header} exists in the master file`);
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create function public.is_admin() returns boolean language sql as $$ select false $$;
    create table public.platform_settings(id text primary key default 'default');
    insert into public.platform_settings(id) values('default');

    create table public.profiles(id uuid primary key);
    insert into public.profiles(id) values('${OWNER}'), ('${RENTER}');

    create table public.cars(
      id uuid primary key,
      owner_id uuid references public.profiles(id) not null,
      model_id uuid,
      plate_number text not null,
      mileage integer,
      price_per_day numeric not null,
      location text,
      transmission text,
      registration_expiry date,
      ctpl_expiry date,
      comprehensive_insurance_expiry date,
      insurer_rental_use_confirmed boolean not null default true,
      insurance_verification_status text not null default 'approved',
      status text not null default 'pending',
      rejection_reason text,
      last_verified_at timestamptz,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now());
    alter table public.cars add constraint cars_price_per_day_check
      check (price_per_day >= 500 and price_per_day <= 100000) not valid;

    create table public.car_images(
      id uuid primary key default gen_random_uuid(),
      car_id uuid references public.cars(id), storage_path text);

    create table public.bookings(
      id uuid primary key default gen_random_uuid(),
      car_id uuid references public.cars(id), renter_id uuid,
      start_date date, end_date date, status text default 'pending');

    create table public.vehicle_unavailability(car_id uuid, start_date date, end_date date);
    create function public.approved_extension_holds()
      returns table(car_id uuid, start_date date, end_date date)
      language sql as $$ select null::uuid, null::date, null::date where false $$;
    create function public.vehicle_compliance_summary(uuid, timestamptz, timestamptz)
      returns jsonb language sql as $$ select '{"eligible": true}'::jsonb $$;

    -- The photo trigger as it stood before this chapter.
    create function public.return_car_image_change_to_review() returns trigger
    language plpgsql as $$
    begin
      update public.cars set status = 'pending', last_verified_at = null, rejection_reason = null
       where id = coalesce(new.car_id, old.car_id) and status in ('approved', 'active', 'inactive');
      return coalesce(new, old);
    end $$;
    create trigger return_car_image_change_to_review
      after insert or update or delete on public.car_images
      for each row execute function public.return_car_image_change_to_review();
  `);
  await db.exec(await chapter("-- CHAPTER 114 - A car is reviewed on its papers, then set up for renters"));
  await db.exec(await chapter("-- CHAPTER 105 - A vehicle waiting for review shows how long it has waited"));
  await db.exec(`
    alter table public.cars add column review_overdue_notified_at timestamptz;
    alter table public.profiles add column verified_status text;
    create function public.stamp_verification_submitted_at() returns trigger
      language plpgsql as $$ begin return new; end $$;
  `);
  await db.exec(await chapter("-- CHAPTER 116 - A car the system sends back to review starts a fresh wait"));
  await db.exec(`
    create trigger return_materially_changed_car_to_review before update on public.cars
      for each row execute function public.return_materially_changed_car_to_review();
    -- Submitted with papers only, then approved by an admin.
    insert into public.cars(id, owner_id, plate_number, price_per_day, status)
      values ('${CAR}', '${OWNER}', 'ABC 1234', null, 'pending');
    update public.cars set status = 'approved' where id = '${CAR}';
  `);
  return db;
}

const available = async (db) =>
  (await db.query("select car_id from public.get_available_car_ids(current_date + 3, current_date + 5)")).rows
    .map((row) => row.car_id);
const statusOf = async (db) =>
  (await db.query("select status from public.cars where id = $1", [CAR])).rows[0].status;
const book = (db) =>
  db.query(
    "insert into public.bookings(car_id, renter_id, start_date, end_date) values ($1, $2, current_date + 3, current_date + 5)",
    [CAR, RENTER],
  );
const setUp = (db) =>
  db.exec(`update public.cars set price_per_day = 1900, location = 'Metro Manila - Quezon City - SM North' where id = '${CAR}'`);

test("a car can be submitted and approved without a price", async () => {
  const db = await fixture();
  assert.equal(await statusOf(db), "approved");
  await assert.rejects(
    db.exec(`update public.cars set price_per_day = 100 where id = '${CAR}'`),
    /cars_price_per_day_check/,
    "a price, once set, still has to be in range",
  );
});

test("an approved car is offered only once its price and pickup location are in", async () => {
  const db = await fixture();
  assert.deepEqual(await available(db), []);
  await db.exec(`update public.cars set price_per_day = 1900 where id = '${CAR}'`);
  assert.deepEqual(await available(db), [], "a price alone is not enough");
  await setUp(db);
  assert.deepEqual(await available(db), [CAR]);
});

test("a booking for a car that is not set up is refused by the database", async () => {
  const db = await fixture();
  await assert.rejects(book(db), /not listed yet/);
  await setUp(db);
  await book(db);
});

test("setting up the listing, mileage and photos keep the approval", async () => {
  const db = await fixture();
  await setUp(db);
  await db.exec(`update public.cars set mileage = 45200 where id = '${CAR}'`);
  assert.equal(await statusOf(db), "approved", "mileage no longer sends the car back");
  await db.exec(`insert into public.car_images(car_id, storage_path) values ('${CAR}', 'new.jpg')`);
  assert.equal(await statusOf(db), "approved", "new photos no longer send the car back");
});

test("what an admin checks against the papers still sends the car back to review", async () => {
  const db = await fixture();
  await setUp(db);
  await db.exec(`update public.cars set plate_number = 'XYZ 9876' where id = '${CAR}'`);
  assert.equal(await statusOf(db), "pending");
});

test("a car the system sends back to review starts a fresh wait", async () => {
  const db = await fixture();
  await setUp(db);
  await db.exec(`update public.cars set review_submitted_at = now() - interval '3 days' where id = '${CAR}'`);
  // The lister's update never names status; the review trigger moves it.
  await db.exec(`update public.cars set plate_number = 'XYZ 9876' where id = '${CAR}'`);
  const { rows } = await db.query(
    "select status, review_submitted_at > now() - interval '1 minute' as fresh from public.cars where id = $1",
    [CAR],
  );
  assert.deepEqual(rows[0], { status: "pending", fresh: true });
  const tg = await db.query(
    "select count(*)::int as n from pg_trigger where tgname = 'stamp_car_review_submitted_at' and tgattr = ''::int2vector",
  );
  assert.equal(tg.rows[0].n, 1, "the verification query in CHAPTER 116 reads this the same way");
});
