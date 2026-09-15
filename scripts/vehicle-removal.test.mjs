// CHAPTER 95 - a removed car tells its lister why, and can be brought back.
//
// Removal is a moderation power over someone else's listing, so its guards are
// proved against real PostgreSQL (PGlite). The fixture builds only what the
// chapter touches, then applies CHAPTER 86 and CHAPTER 95 verbatim out of the
// master file, in order.
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

const NOTE = "The OR/CR photo belongs to a different vehicle.";

let master;
async function chapter(header) {
  master ??= await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  );
  const body = master.split(header)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, `${header} exists in the master file`);
  // The chapter's own header line is a comment; re-attach one so the slice is
  // still valid SQL on its own.
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.admin_can(text) returns boolean language sql stable as
      $$ select coalesce(current_setting('test.vehicles_delete', true), 'false') = 'true' $$;

    create table public.profiles(id uuid primary key, deleted_at timestamptz);
    create table public.car_brands(id uuid primary key, name text);
    create table public.car_models(
      id uuid primary key,
      brand_id uuid references public.car_brands(id),
      name text);
    create table public.cars(
      id uuid primary key default gen_random_uuid(),
      owner_id uuid references public.profiles(id) not null,
      model_id uuid references public.car_models(id),
      plate_number text unique not null,
      status text default 'approved',
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
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, title text, message text, type text, link text,
      created_at timestamptz default clock_timestamp());
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb,
      created_at timestamptz default clock_timestamp());

    -- The two row-delete policies the chapter retires, as they exist live.
    create policy "Owners can delete own cars" on public.cars for delete using (true);
    create policy "Admins can delete cars" on public.cars for delete using (true);

    insert into public.profiles(id) values('${OWNER}'), ('${RENTER}'), ('${ADMIN}');
    insert into public.car_brands(id, name) values('${BRAND}', 'Toyota');
    insert into public.car_models(id, brand_id, name) values('${MODEL}', '${BRAND}', 'Vios');
    insert into public.cars(id, owner_id, model_id, plate_number, last_verified_at)
      values('${CAR}', '${OWNER}', '${MODEL}', 'ABC 1234', now());
  `);

  await db.exec(await chapter("-- CHAPTER 86 - A lister can delete a car"));
  await db.exec(await chapter("-- CHAPTER 95 - A removed car tells its lister why"));
  return db;
}

/** Act as a signed-in person; `remover` grants vehicles.delete. */
async function actAs(db, uid, { remover = false } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.query("select set_config('test.vehicles_delete', $1, false)", [
    remover ? "true" : "false",
  ]);
}

const removeCar = (db, reason = "invalid_documents", note = NOTE) =>
  db.query("select public.admin_remove_car($1, $2, $3) as result", [CAR, reason, note]);

const restoreCar = (db) =>
  db.query("select public.admin_restore_car($1) as result", [CAR]);

const carState = async (db) => {
  const { rows } = await db.query(
    `select deleted_at, deleted_by, deletion_reason, status, rejection_reason, last_verified_at
       from public.cars where id = $1`,
    [CAR],
  );
  return rows[0];
};

const notificationsFor = async (db, userId = OWNER) => {
  const { rows } = await db.query(
    "select title, message, type, link from public.notifications where user_id = $1 order by created_at",
    [userId],
  );
  return rows;
};

const auditActions = async (db) => {
  const { rows } = await db.query(
    "select action, user_id, details from public.audit_log where entity_id = $1 order by created_at",
    [CAR],
  );
  return rows;
};

test("the chapter adds the columns, removes nothing, and retires the row-delete policies", async () => {
  const db = await fixture();

  const { rows: columns } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'cars'
        and column_name in ('deleted_by', 'deletion_reason')
      order by column_name`,
  );
  assert.deepEqual(columns.map((r) => r.column_name), ["deleted_by", "deletion_reason"]);

  const { rows: removed } = await db.query(
    "select count(*)::int as n from public.cars where deleted_at is not null",
  );
  assert.equal(removed[0].n, 0);

  const { rows: policies } = await db.query(
    "select count(*)::int as n from pg_policies where tablename = 'cars' and cmd = 'DELETE'",
  );
  assert.equal(policies[0].n, 0, "no path removes a car row any more");
});

test("an admin removes a car with a reason, and the lister is told why", async () => {
  const db = await fixture();
  await actAs(db, ADMIN, { remover: true });

  const { rows } = await removeCar(db);
  assert.equal(rows[0].result.vehicle, "Toyota Vios (ABC 1234)");

  const state = await carState(db);
  assert.ok(state.deleted_at, "the car is archived, not gone");
  assert.equal(state.deleted_by, ADMIN, "who removed it is recorded");
  assert.equal(state.deletion_reason, `Fake or invalid documents: ${NOTE}`);
  assert.equal(state.status, "approved", "removal does not rewrite the review status");

  const notes = await notificationsFor(db);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Your vehicle listing was removed");
  assert.match(notes[0].message, /Toyota Vios \(ABC 1234\)/);
  assert.match(notes[0].message, /Reason: Fake or invalid documents: The OR\/CR photo belongs to a different vehicle\. Past bookings/);
  assert.equal(notes[0].link, "/support");

  const audit = await auditActions(db);
  assert.deepEqual(audit.map((r) => r.action), ["admin_deleted_vehicle"]);
  assert.equal(audit[0].user_id, ADMIN);
  assert.equal(audit[0].details.reason_code, "invalid_documents");
});

test("removal needs vehicles.delete, a listed reason and a real note", async () => {
  const db = await fixture();

  await actAs(db, ADMIN, { remover: false });
  await assert.rejects(removeCar(db), /vehicles\.delete permission/i);

  await actAs(db, ADMIN, { remover: true });
  await assert.rejects(removeCar(db, "i_dont_like_it"), /Choose a reason/i);
  for (const bad of [null, "", "   ", "too short"]) {
    await assert.rejects(removeCar(db, "other", bad), /at least 10 characters/i);
  }

  assert.equal((await carState(db)).deleted_at, null);
  assert.equal((await notificationsFor(db)).length, 0);
  assert.equal((await auditActions(db)).length, 0);
});

test("a trip or a payout still open blocks removal, and nothing is half-written", async () => {
  const db = await fixture();
  await actAs(db, ADMIN, { remover: true });

  const { rows } = await db.query(
    "insert into public.bookings(car_id, renter_id, owner_id, status) values($1, $2, $3, 'confirmed') returning id",
    [CAR, RENTER, OWNER],
  );
  await assert.rejects(removeCar(db), /have not finished/i);

  await db.query("update public.bookings set status = 'completed' where id = $1", [rows[0].id]);
  await db.query(
    "insert into public.payments(booking_id, payment_type, status) values($1, 'payout', 'failed')",
    [rows[0].id],
  );
  await assert.rejects(removeCar(db), /payout for this car has not reached/i);

  assert.equal((await carState(db)).deleted_at, null);
  assert.equal((await notificationsFor(db)).length, 0, "the lister is not told about a removal that did not happen");
  assert.equal((await auditActions(db)).length, 0);
});

test("a car already removed is not removed twice", async () => {
  const db = await fixture();
  await actAs(db, ADMIN, { remover: true });
  await removeCar(db);

  await assert.rejects(removeCar(db, "policy_violation", "A second attempt at the same car."), /already been removed/i);
  assert.equal((await notificationsFor(db)).length, 1);
});

test("a lister's own delete still works, records the lister, and cannot carry a reason", async () => {
  const db = await fixture();
  await actAs(db, OWNER);

  await db.query(
    "update public.cars set deleted_at = now(), deleted_by = $1, deletion_reason = 'Removed by SafeDrive' where id = $2",
    [ADMIN, CAR],
  );

  const state = await carState(db);
  assert.ok(state.deleted_at);
  assert.equal(state.deleted_by, OWNER, "a lister cannot put an admin's name on their own delete");
  assert.equal(state.deletion_reason, null);
  assert.equal((await notificationsFor(db)).length, 0);
});

test("a lister cannot restore a removed car or rewrite why it was removed", async () => {
  const db = await fixture();
  await actAs(db, ADMIN, { remover: true });
  await removeCar(db);

  await actAs(db, OWNER);
  await assert.rejects(
    db.query("update public.cars set deleted_at = null where id = $1", [CAR]),
    /Only SafeDrive support can restore/i,
  );
  await assert.rejects(
    db.query("update public.cars set deletion_reason = 'Nothing happened' where id = $1", [CAR]),
    /Only SafeDrive can record who removed a vehicle/i,
  );
  await assert.rejects(
    db.query("update public.cars set deleted_by = $1 where id = $2", [OWNER, CAR]),
    /Only SafeDrive can record who removed a vehicle/i,
  );

  const state = await carState(db);
  assert.ok(state.deleted_at, "still removed");
  assert.equal(state.deleted_by, ADMIN);
  assert.equal(state.deletion_reason, `Fake or invalid documents: ${NOTE}`);
});

test("an admin restores a removed car: back under review, and the lister is told", async () => {
  const db = await fixture();
  await actAs(db, ADMIN, { remover: true });
  await removeCar(db);

  const { rows } = await restoreCar(db);
  assert.equal(rows[0].result.status, "pending");

  const state = await carState(db);
  assert.equal(state.deleted_at, null);
  assert.equal(state.deleted_by, null, "the removal record is cleared");
  assert.equal(state.deletion_reason, null);
  assert.equal(state.status, "pending", "a car that was live goes back through review");
  assert.equal(state.last_verified_at, null);

  const notes = await notificationsFor(db);
  assert.deepEqual(notes.map((n) => n.title), [
    "Your vehicle listing was removed",
    "Your vehicle listing was restored",
  ]);
  assert.match(notes[1].message, /under review/);
  assert.equal(notes[1].link, "/my-vehicles");

  const audit = await auditActions(db);
  assert.deepEqual(audit.map((r) => r.action), ["admin_deleted_vehicle", "admin_restored_vehicle"]);
  assert.equal(audit[1].details.previous_reason, `Fake or invalid documents: ${NOTE}`);
  assert.equal(audit[1].details.previous_status, "approved");
});

test("a lister's own delete can be restored by an admin too", async () => {
  const db = await fixture();
  await actAs(db, OWNER);
  await db.query("update public.cars set deleted_at = now() where id = $1", [CAR]);

  await actAs(db, ADMIN, { remover: true });
  await restoreCar(db);
  assert.equal((await carState(db)).deleted_at, null);
});

test("a car that was not live keeps its status when restored", async () => {
  const db = await fixture();
  await db.query("update public.cars set status = 'rejected', rejection_reason = 'Blurry OR/CR photo' where id = $1", [CAR]);
  await actAs(db, ADMIN, { remover: true });
  await removeCar(db);
  await restoreCar(db);

  const state = await carState(db);
  assert.equal(state.status, "rejected");
  assert.equal(state.rejection_reason, "Blurry OR/CR photo", "the earlier review note stays with it");
  const notes = await notificationsFor(db);
  assert.match(notes[1].message, /It is back on your listings\.$/);
});

test("restore needs the permission, a removed car, and an open owner account", async () => {
  const db = await fixture();

  await actAs(db, ADMIN, { remover: true });
  await assert.rejects(restoreCar(db), /is not removed/i);

  await removeCar(db);
  await actAs(db, ADMIN, { remover: false });
  await assert.rejects(restoreCar(db), /vehicles\.delete permission/i);

  await db.query("update public.profiles set deleted_at = now() where id = $1", [OWNER]);
  await actAs(db, ADMIN, { remover: true });
  await assert.rejects(restoreCar(db), /account is closed/i);
  assert.ok((await carState(db)).deleted_at, "still removed");
});

// The three older functions CHAPTER 95 teaches about removed cars. Their other
// dependencies are stood in for here: the slot trigger as it exists live, a
// subscriptions table, and a document check that finds every car ineligible.
async function withOlderCarFunctions(db) {
  await db.exec(`
    alter table public.cars add column created_at timestamptz default clock_timestamp();
    create table public.subscriptions(user_id uuid, status text, additional_slots integer default 0);
    create table public.car_renewals(
      id uuid primary key default gen_random_uuid(),
      car_id uuid, lister_id uuid, status text, document_update boolean);
    create function public.vehicle_compliance_summary(uuid, timestamptz, timestamptz)
      returns jsonb language sql stable as $$ select '{"eligible": false}'::jsonb $$;
    create function public.refresh_vehicle_compliance(uuid)
      returns void language plpgsql as $$ begin end $$;
    create trigger enforce_live_car_limit before update on public.cars
      for each row execute function public.trg_enforce_live_car_limit();
  `);
}

const addCar = (db, plate, status) =>
  db
    .query(
      "insert into public.cars(owner_id, model_id, plate_number, status) values($1, $2, $3, $4) returning id",
      [OWNER, MODEL, plate, status],
    )
    .then((r) => r.rows[0].id);

test("a removed car no longer takes one of the lister's live-listing slots", async () => {
  const db = await fixture();
  await withOlderCarFunctions(db);

  // Five live cars (the free allowance) including CAR, and one paused.
  for (const plate of ["LIV 0001", "LIV 0002", "LIV 0003", "LIV 0004"]) {
    await addCar(db, plate, "approved");
  }
  const paused = await addCar(db, "PAU 0001", "inactive");

  const enable = () =>
    db.query("update public.cars set status = 'approved' where id = $1", [paused]);
  await assert.rejects(enable(), /slot limit reached/i, "all five slots are taken");

  await actAs(db, ADMIN, { remover: true });
  await removeCar(db);

  await enable();
  const { rows } = await db.query("select status from public.cars where id = $1", [paused]);
  assert.equal(rows[0].status, "approved", "the removed car's slot is free again");

  // When the plan shrinks, the removed car is not counted either: exactly
  // five live cars remain, so nothing is paused to make room for it.
  const { rows: paused2 } = await db.query(
    "select public.deactivate_cars_over_slot_limit($1) as affected",
    [OWNER],
  );
  assert.equal(paused2[0].affected, 0);
});

test("the daily document scan leaves a removed car alone", async () => {
  const db = await fixture();
  await withOlderCarFunctions(db);
  await addCar(db, "LIV 0009", "approved");

  await actAs(db, ADMIN, { remover: true });
  await removeCar(db);

  const { rows } = await db.query("select plate_number from public.flag_vehicles_needing_renewal()");
  assert.deepEqual(rows.map((r) => r.plate_number), ["LIV 0009"], "only the live car is flagged");

  const { rows: asked } = await db.query(
    "select count(*)::int as n from public.notifications where title = 'Vehicle documents required' and message like '%ABC 1234%'",
  );
  assert.equal(asked[0].n, 0, "the lister is not asked to renew documents for a removed car");
});

test("documents cannot be submitted for a removed car", async () => {
  const db = await fixture();
  await withOlderCarFunctions(db);
  await actAs(db, ADMIN, { remover: true });
  await removeCar(db);

  await actAs(db, OWNER);
  await assert.rejects(
    db.query("select public.submit_vehicle_document_update($1, $2::jsonb)", [
      CAR,
      JSON.stringify([{ document_type: "or", storage_path: `${OWNER}/${CAR}/or.jpg`, valid_until: "2027-01-01" }]),
    ]),
    /was removed from SafeDrive/i,
  );
  const { rows } = await db.query("select count(*)::int as n from public.car_renewals");
  assert.equal(rows[0].n, 0, "no renewal is opened for it");
});

test("a restored car can be removed again, and the guard checks again", async () => {
  const db = await fixture();
  await actAs(db, ADMIN, { remover: true });
  await removeCar(db);
  await restoreCar(db);

  await db.query(
    "insert into public.bookings(car_id, renter_id, owner_id, status) values($1, $2, $3, 'pending')",
    [CAR, RENTER, OWNER],
  );
  await assert.rejects(removeCar(db, "policy_violation", "Listed again with the same fake papers."), /have not finished/i);
});
