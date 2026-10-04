// CHAPTER 120 - a deleted car is erased; what it earned stays on record.
//
// Proved against real PostgreSQL (PGlite): CHAPTERS 86, 95 and 120 are
// applied verbatim from the master file, in order. A lister's delete and an
// admin's removal both erase the plate, papers and photos while bookings,
// payments and rental agreements stay; the plate can be listed again; an
// admin is not held by a payout, a lister is; a removal waits for a trip
// under way and finishes once it ends; cars deleted before the chapter are
// erased by it.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const RENTER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const CAR = "44444444-4444-4444-8444-444444444444";
const BRAND = "55555555-5555-4555-8555-555555555555";
const MODEL = "66666666-6666-4666-8666-666666666666";
const OLD_CAR = "77777777-7777-4777-8777-777777777777";
const NOTE = "The OR/CR photo belongs to a different vehicle.";

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

async function fixture({ deletedBeforeChapter = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.admin_can(text) returns boolean language sql stable as
      $$ select coalesce(current_setting('test.vehicles_delete', true), 'false') = 'true' $$;
    create function public.admin_can_for(uuid, text) returns boolean language sql stable as
      $$ select $1 = '${ADMIN}'::uuid $$;

    create table public.profiles(id uuid primary key, deleted_at timestamptz);
    create table public.car_brands(id uuid primary key, name text);
    create table public.car_models(id uuid primary key, brand_id uuid references public.car_brands(id), name text);
    create table public.cars(
      id uuid primary key default gen_random_uuid(),
      owner_id uuid references public.profiles(id) not null,
      model_id uuid references public.car_models(id),
      plate_number text unique not null
        constraint cars_plate_number_format check (plate_number ~ '^[A-Z]{3}[ -]?[0-9]{3,4}$'),
      status text default 'approved',
      location text, contact_number text, additional_info text,
      rejection_reason text,
      last_verified_at timestamptz,
      updated_at timestamptz default now());
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
    create table public.car_renewals(
      id uuid primary key default gen_random_uuid(), car_id uuid references public.cars(id), status text);
    create table public.car_documents(
      id uuid primary key default gen_random_uuid(),
      car_id uuid references public.cars(id), document_type text,
      storage_bucket text, storage_path text,
      renewal_id uuid references public.car_renewals(id));
    create table public.car_images(
      id uuid primary key default gen_random_uuid(), car_id uuid references public.cars(id), storage_path text);
    create table public.vehicle_unavailability(
      id uuid primary key default gen_random_uuid(), car_id uuid references public.cars(id));
    create table public.vehicle_compliance_reminders(car_id uuid references public.cars(id));
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, title text, message text, type text, link text,
      created_at timestamptz default clock_timestamp());
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb,
      created_at timestamptz default clock_timestamp());

    insert into public.profiles(id) values('${OWNER}'), ('${RENTER}'), ('${ADMIN}');
    insert into public.car_brands(id, name) values('${BRAND}', 'Toyota');
    insert into public.car_models(id, brand_id, name) values('${MODEL}', '${BRAND}', 'Vios');
    insert into public.cars(id, owner_id, model_id, plate_number, location, contact_number, additional_info)
      values('${CAR}', '${OWNER}', '${MODEL}', 'ABC 1234', 'Makati', '09170000000', 'Dashcam');
    insert into public.car_renewals(id, car_id, status)
      values('88888888-8888-4888-8888-888888888888', '${CAR}', 'approved');
    insert into public.car_documents(car_id, document_type, storage_bucket, storage_path, renewal_id) values
      ('${CAR}', 'bir', 'vehicle-private-documents', '${OWNER}/${CAR}/bir.jpg', '88888888-8888-4888-8888-888888888888'),
      ('${CAR}', 'or', 'vehicle-private-documents', '${OWNER}/${CAR}/or.jpg', null),
      ('${CAR}', 'rental_agreement', 'vehicle-private-documents', '${OWNER}/${CAR}/agreement.pdf', '88888888-8888-4888-8888-888888888888');
    insert into public.car_images(car_id, storage_path) values
      ('${CAR}', '${OWNER}/${CAR}/front.jpg'), ('${CAR}', 'https://legacy.example/old.jpg');
    insert into public.vehicle_unavailability(car_id) values('${CAR}');
    insert into public.vehicle_compliance_reminders(car_id) values('${CAR}');
  `);
  await db.exec(await chapter("-- CHAPTER 86 - A lister can delete a car"));
  await db.exec(await chapter("-- CHAPTER 95 - A removed car tells its lister why"));
  if (deletedBeforeChapter) {
    await db.exec(`
      insert into public.cars(id, owner_id, model_id, plate_number) values('${OLD_CAR}', '${OWNER}', '${MODEL}', 'TES1234');
      insert into public.car_documents(car_id, document_type, storage_bucket, storage_path)
        values('${OLD_CAR}', 'cr', 'vehicle-private-documents', 'old/cr.jpg');
      update public.cars set deleted_at = now() where id = '${OLD_CAR}';
    `);
  }
  await db.exec(await chapter("-- CHAPTER 120 - A deleted car is erased"));
  return db;
}

async function actAs(db, uid, { remover = false } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  await db.query("select set_config('test.vehicles_delete', $1, false)", [remover ? "true" : "false"]);
}

async function booking(db, status, payout = null) {
  const { rows } = await db.query(
    `insert into public.bookings(car_id, renter_id, owner_id, status) values($1, $2, $3, $4) returning id`,
    [CAR, RENTER, OWNER, status],
  );
  await db.query(`insert into public.payments(booking_id, payment_type, status) values($1, 'downpayment', 'completed')`, [rows[0].id]);
  if (payout) {
    await db.query(`insert into public.payments(booking_id, payment_type, status) values($1, 'payout', $2)`, [rows[0].id, payout]);
  }
  return rows[0].id;
}

const car = async (db, id = CAR) =>
  (await db.query(`select * from public.cars where id = $1`, [id])).rows[0];
const count = async (db, sql, params = []) => (await db.query(sql, params)).rows[0].n;

const deleteAsOwner = (db) =>
  db.query("select public.delete_my_vehicle_for($1, $2) as result", [OWNER, CAR]);
const removeAsAdmin = (db, admin = ADMIN) =>
  db.query("select public.remove_vehicle_for($1, $2, 'invalid_documents', $3) as result", [admin, CAR, NOTE]);

async function assertErased(db) {
  const erased = await car(db);
  assert.equal(erased.plate_number, "DELETED-44444444");
  assert.ok(erased.deleted_at);
  assert.equal(erased.status, "inactive");
  assert.equal(erased.location, null);
  assert.equal(erased.contact_number, null);
  assert.equal(erased.additional_info, null);
  const docs = await db.query(`select document_type, renewal_id from public.car_documents where car_id = $1`, [CAR]);
  assert.deepEqual(docs.rows, [{ document_type: "rental_agreement", renewal_id: null }], "only the agreement stays");
  assert.equal(await count(db, `select count(*)::int as n from public.car_images where car_id = $1`, [CAR]), 0);
  assert.equal(await count(db, `select count(*)::int as n from public.car_renewals where car_id = $1`, [CAR]), 0);
  assert.equal(await count(db, `select count(*)::int as n from public.vehicle_unavailability`), 0);
  assert.equal(await count(db, `select count(*)::int as n from public.vehicle_compliance_reminders`), 0);
  const queue = await db.query(`select bucket, path from public.vehicle_file_purge_queue order by path`);
  assert.deepEqual(queue.rows, [
    { bucket: "vehicle-private-documents", path: `${OWNER}/${CAR}/bir.jpg` },
    { bucket: "vehicle-documents", path: `${OWNER}/${CAR}/front.jpg` },
    { bucket: "vehicle-private-documents", path: `${OWNER}/${CAR}/or.jpg` },
  ]);
}

test("a lister's delete erases the car but keeps its bookings and payments", async () => {
  const db = await fixture();
  await booking(db, "completed", "completed");
  const { rows } = await deleteAsOwner(db);
  assert.equal(rows[0].result.vehicle, "Toyota Vios (ABC 1234)");
  await assertErased(db);
  assert.equal(await count(db, `select count(*)::int as n from public.bookings`), 1);
  assert.equal(await count(db, `select count(*)::int as n from public.payments`), 2);

  const notes = await db.query(`select title, message from public.notifications where user_id = $1`, [OWNER]);
  assert.equal(notes.rows[0].title, "Vehicle deleted");
  assert.match(notes.rows[0].message, /add it as a new car/);
  const audit = await db.query(`select action, details from public.audit_log where entity_id = $1`, [CAR]);
  assert.equal(audit.rows[0].action, "lister_deleted_vehicle");
  assert.equal(audit.rows[0].details.plate, "ABC 1234", "the plate is kept in the audit log");

  await db.query(`insert into public.cars(owner_id, model_id, plate_number) values($1, $2, 'ABC 1234')`, [OWNER, MODEL]);
});

test("a lister cannot delete past an unfinished trip, an owed payout, or someone else's car", async () => {
  const db = await fixture();
  await assert.rejects(db.query("select public.delete_my_vehicle_for($1, $2)", [RENTER, CAR]), /Only the owner/);
  await booking(db, "completed", "pending");
  await assert.rejects(deleteAsOwner(db), /payout for this car has not reached its owner/);
  await booking(db, "fully_paid");
  await assert.rejects(deleteAsOwner(db), /1 booking\(s\) that have not finished/);
  assert.equal((await car(db)).plate_number, "ABC 1234");
});

test("an admin removal erases the car and is not held by an owed payout", async () => {
  const db = await fixture();
  await booking(db, "completed", "pending");
  const { rows } = await removeAsAdmin(db);
  assert.equal(rows[0].result.state, "removed");
  await assertErased(db);
  assert.equal((await car(db)).deletion_reason, `Fake or invalid documents: ${NOTE}`);
  const notes = await db.query(`select title, message, link from public.notifications where user_id = $1`, [OWNER]);
  assert.equal(notes.rows[0].title, "Your vehicle listing was removed");
  assert.match(notes.rows[0].message, /add it again as a new car/);
  assert.equal(notes.rows[0].link, "/my-vehicles");
  const audit = await db.query(`select action, user_id, details from public.audit_log where entity_id = $1`, [CAR]);
  assert.equal(audit.rows[0].action, "admin_deleted_vehicle");
  assert.equal(audit.rows[0].user_id, ADMIN);
  assert.equal(audit.rows[0].details.plate, "ABC 1234");
});

test("a live car still needs a real plate; the placeholder is for erased cars only", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query(`update public.cars set plate_number = 'DELETED-44444444' where id = $1`, [CAR]),
    /cars_plate_number_format/,
  );
  await assert.rejects(
    db.query(`insert into public.cars(owner_id, model_id, plate_number) values($1, $2, 'not a plate')`, [OWNER, MODEL]),
    /cars_plate_number_format/,
  );
});

test("only a vehicle remover may remove, with a listed reason and a real note", async () => {
  const db = await fixture();
  await assert.rejects(removeAsAdmin(db, RENTER), /vehicles\.delete permission/);
  await assert.rejects(
    db.query("select public.remove_vehicle_for($1, $2, 'other', 'short')", [ADMIN, CAR]),
    /at least 10 characters/,
  );
  assert.equal((await car(db)).plate_number, "ABC 1234");
});

test("a removal waits for a trip under way, hides the car, and finishes after it", async () => {
  const db = await fixture();
  const trip = await booking(db, "active");
  const { rows } = await removeAsAdmin(db);
  assert.equal(rows[0].result.state, "scheduled");
  const waiting = await car(db);
  assert.equal(waiting.status, "inactive", "off Browse at once");
  assert.equal(waiting.plate_number, "ABC 1234", "not erased mid-trip");
  assert.ok(waiting.removal_scheduled_at);

  await actAs(db, OWNER);
  await assert.rejects(
    db.query(`update public.cars set status = 'approved' where id = $1`, [CAR]),
    /SafeDrive is removing this vehicle/,
  );
  await actAs(db, null);

  assert.equal((await db.query("select * from public.finish_scheduled_vehicle_removals()")).rows.length, 0);
  await db.query(`update public.bookings set status = 'completed' where id = $1`, [trip]);
  const finished = await db.query("select * from public.finish_scheduled_vehicle_removals()");
  assert.equal(finished.rows.length, 1);
  assert.equal(finished.rows[0].owner_id, OWNER);
  assert.match(finished.rows[0].message, /trip on your Toyota Vios \(ABC 1234\) has ended/);
  await assertErased(db);
  assert.equal((await car(db)).removal_scheduled_at, null);
});

test("cars deleted before the chapter are erased, and none can be restored", async () => {
  const db = await fixture({ deletedBeforeChapter: true });
  const old = await car(db, OLD_CAR);
  assert.equal(old.plate_number, "DELETED-77777777");
  assert.equal(await count(db, `select count(*)::int as n from public.car_documents where car_id = $1`, [OLD_CAR]), 0);
  await db.query(`insert into public.cars(owner_id, model_id, plate_number) values($1, $2, 'TES1234')`, [OWNER, MODEL]);
  await assert.rejects(
    db.query(`update public.cars set deleted_at = null where id = $1`, [OLD_CAR]),
    /cannot be restored/,
  );
});
