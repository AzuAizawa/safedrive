// CHAPTER 86 - a lister can delete a car; the record it explains stays.
//
// What may and may not be retired is enforced in the database, so it is proved
// against real PostgreSQL (PGlite). The fixture builds only what the chapter
// touches and applies the chapter verbatim out of the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const RENTER = "22222222-2222-4222-8222-222222222222";
const CAR = "33333333-3333-4333-8333-333333333333";
const FRESH_CAR = "44444444-4444-4444-8444-444444444444";

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table public.profiles(id uuid primary key);
    create table public.car_models(id uuid primary key default gen_random_uuid(), name text);
    create table public.cars(
      id uuid primary key default gen_random_uuid(),
      owner_id uuid references public.profiles(id) not null,
      plate_number text,
      status text default 'approved');
    create table public.bookings(
      id uuid primary key default gen_random_uuid(),
      car_id uuid references public.cars(id) not null,
      renter_id uuid, owner_id uuid,
      status text default 'pending');
    create table public.payments(
      id uuid primary key default gen_random_uuid(),
      booking_id uuid references public.bookings(id) not null,
      payment_type text not null,
      status text default 'pending');

    insert into public.profiles(id) values('${OWNER}'), ('${RENTER}');
    insert into public.cars(id, owner_id, plate_number) values
      ('${CAR}', '${OWNER}', 'ABC 1234'),
      ('${FRESH_CAR}', '${OWNER}', 'NEW 0001');
  `);

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 86 - A lister can delete a car")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 86 exists in the master file");
  await db.exec("-- CHAPTER 86\n" + chapter.slice(chapter.indexOf("\n")));

  return db;
}

const addBooking = (db, status) =>
  db
    .query(
      `insert into public.bookings(car_id, renter_id, owner_id, status)
       values($1, $2, $3, $4) returning id`,
      [CAR, RENTER, OWNER, status],
    )
    .then((r) => r.rows[0].id);

const softDelete = (db, carId = CAR) =>
  db.query("update public.cars set deleted_at = now() where id = $1", [carId]);

const deletedAt = async (db, carId = CAR) => {
  const { rows } = await db.query("select deleted_at from public.cars where id = $1", [carId]);
  return rows[0]?.deleted_at ?? null;
};

test("the chapter adds the column and deletes nothing", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='cars' and column_name='deleted_at'`,
  );
  assert.equal(rows.length, 1);

  const { rows: live } = await db.query(
    "select count(*)::int as n from public.cars where deleted_at is not null",
  );
  assert.equal(live[0].n, 0);
});

test("a car whose trips are all over can be deleted - that is the point", async () => {
  const db = await fixture();
  await addBooking(db, "completed");
  await addBooking(db, "completed");
  await addBooking(db, "cancelled");

  await softDelete(db);

  assert.ok(await deletedAt(db), "past bookings no longer stand in the way");
});

test("the record it explains survives the delete", async () => {
  const db = await fixture();
  const bookingId = await addBooking(db, "completed");
  await softDelete(db);

  // This is the join every booking view does to say what was rented.
  const { rows } = await db.query(
    `select b.id, c.plate_number
       from public.bookings b join public.cars c on c.id = b.car_id
      where b.id = $1`,
    [bookingId],
  );
  assert.equal(rows.length, 1, "the booking still resolves to its car");
  assert.equal(rows[0].plate_number, "ABC 1234");
});

test("a trip still in the air blocks the delete", async () => {
  const db = await fixture();
  for (const status of [
    "pending",
    "confirmed",
    "awaiting_payment",
    "downpayment_paid",
    "fully_paid",
    "active",
  ]) {
    const live = await fixture();
    await live.query(
      "insert into public.bookings(car_id, renter_id, owner_id, status) values($1,$2,$3,$4)",
      [CAR, RENTER, OWNER, status],
    );
    await assert.rejects(
      softDelete(live),
      /have not finished/i,
      `${status} should block the delete`,
    );
    assert.equal(await deletedAt(live), null);
  }
  assert.equal(await deletedAt(db), null);
});

test("money still owed blocks the delete", async () => {
  const db = await fixture();
  const bookingId = await addBooking(db, "completed");

  for (const status of ["pending", "failed"]) {
    await db.query(
      "insert into public.payments(booking_id, payment_type, status) values($1, 'payout', $2)",
      [bookingId, status],
    );
    await assert.rejects(softDelete(db), /payout for this car has not reached/i);
    await db.query("delete from public.payments");
  }

  // Once the payout has landed, the car can go.
  await db.query(
    "insert into public.payments(booking_id, payment_type, status) values($1, 'payout', 'completed')",
    [bookingId],
  );
  await softDelete(db);
  assert.ok(await deletedAt(db));
});

test("a payout owed on someone else's car is not this car's problem", async () => {
  const db = await fixture();
  const bookingId = await addBooking(db, "completed");
  await db.query(
    "insert into public.payments(booking_id, payment_type, status) values($1, 'payout', 'pending')",
    [bookingId],
  );

  // FRESH_CAR has no bookings at all, so the owed payout above is irrelevant.
  await softDelete(db, FRESH_CAR);
  assert.ok(await deletedAt(db, FRESH_CAR));
});

test("restoring is never blocked, and re-deleting is checked again", async () => {
  const db = await fixture();
  await addBooking(db, "completed");
  await softDelete(db);

  await db.query("update public.cars set deleted_at = null where id = $1", [CAR]);
  assert.equal(await deletedAt(db), null, "a restore is always allowed");

  await db.query(
    "insert into public.bookings(car_id, renter_id, owner_id, status) values($1,$2,$3,'active')",
    [CAR, RENTER, OWNER],
  );
  await assert.rejects(softDelete(db), /have not finished/i, "and the guard runs again");
});

test("a car nobody ever booked is still removed outright", async () => {
  const db = await fixture();
  await db.query("delete from public.cars where id = $1", [FRESH_CAR]);
  const { rows } = await db.query("select id from public.cars where id = $1", [FRESH_CAR]);
  assert.equal(rows.length, 0, "nothing points at it, so nothing is kept");
});

test("a car with bookings still cannot be removed outright", async () => {
  const db = await fixture();
  await addBooking(db, "completed");
  await assert.rejects(
    db.query("delete from public.cars where id = $1", [CAR]),
    /violates foreign key constraint/i,
  );
});
