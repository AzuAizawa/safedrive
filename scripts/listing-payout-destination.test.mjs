// CHAPTER 99 - a new listing needs a payout destination.
//
// The rule has to hold in the database, not only in the Add Vehicle form: the
// cars insert policy checks only that the owner inserts their own row, so a
// direct PostgREST insert would otherwise sail past the UI. Proved against real
// PostgreSQL (PGlite) with the chapter applied verbatim from the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const READY = "11111111-1111-4111-8111-111111111111";
const NO_DETAILS = "22222222-2222-4222-8222-222222222222";
const METHOD_ONLY = "33333333-3333-4333-8333-333333333333";
const BRAND = "55555555-5555-4555-8555-555555555555";
const MODEL = "66666666-6666-4666-8666-666666666666";

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
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.is_trusted_server_context() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.server', true), 'false') = 'true' $$;

    create table public.profiles(
      id uuid primary key,
      payout_method text,
      payout_account_name text,
      payout_account_number text);
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
      price_per_day numeric default 1000,
      status text default 'pending',
      deleted_at timestamptz,
      created_at timestamptz default clock_timestamp());

    insert into public.profiles(id, payout_method, payout_account_name, payout_account_number)
      values
        ('${READY}', 'GCash', 'Karl Chua', '09170000000'),
        ('${NO_DETAILS}', null, null, null),
        -- Exactly the shape the old form produced: a method, nothing else.
        ('${METHOD_ONLY}', 'GCash', null, null);
    insert into public.car_brands(id, name) values('${BRAND}', 'Toyota');
    insert into public.car_models(id, brand_id, name) values('${MODEL}', '${BRAND}', 'Vios');
  `);

  // The car a lister already had before this chapter existed.
  await db.query(
    "insert into public.cars(owner_id, model_id, plate_number, status) values($1, $2, 'OLD 1111', 'approved')",
    [METHOD_ONLY, MODEL],
  );

  await db.exec(await chapter("-- CHAPTER 99 - A new listing needs a payout destination"));
  return db;
}

const addCar = (db, owner, plate) =>
  db.query(
    "insert into public.cars(owner_id, model_id, plate_number) values($1, $2, $3) returning id",
    [owner, MODEL, plate],
  );

const asServer = (db, on) =>
  db.query("select set_config('test.server', $1, false)", [on ? "true" : "false"]);

test("a lister with a complete payout destination can list", async () => {
  const db = await fixture();
  const { rows } = await addCar(db, READY, "NEW 0001");
  assert.equal(rows.length, 1);
});

test("no payout details at all: the listing is refused", async () => {
  const db = await fixture();
  await assert.rejects(
    addCar(db, NO_DETAILS, "NEW 0002"),
    /Add your GCash or Maya payout details before listing/i,
  );
});

test("a payout method with no account name or number is not a destination", async () => {
  const db = await fixture();
  await assert.rejects(addCar(db, METHOD_ONLY, "NEW 0003"), /payout details/i);

  // Blank strings are not a destination either.
  await db.query(
    "update public.profiles set payout_account_name = '  ', payout_account_number = '  ' where id = $1",
    [METHOD_ONLY],
  );
  await assert.rejects(addCar(db, METHOD_ONLY, "NEW 0004"), /payout details/i);
});

test("cars already listed are untouched - they stay live and can still be edited", async () => {
  const db = await fixture();
  const { rows: before } = await db.query(
    "select id, status from public.cars where owner_id = $1",
    [METHOD_ONLY],
  );
  assert.equal(before.length, 1, "the old car is still there");
  assert.equal(before[0].status, "approved");

  // Editing, pausing and removing an existing car never reach this trigger.
  await db.query("update public.cars set price_per_day = 1500 where id = $1", [before[0].id]);
  await db.query("update public.cars set status = 'inactive' where id = $1", [before[0].id]);
  await db.query("update public.cars set deleted_at = now() where id = $1", [before[0].id]);
  const { rows: after } = await db.query(
    "select price_per_day, status, deleted_at from public.cars where id = $1",
    [before[0].id],
  );
  assert.equal(Number(after[0].price_per_day), 1500);
  assert.equal(after[0].status, "inactive");
  assert.ok(after[0].deleted_at, "removal still works");
});

test("completing the details lets the same lister add their next car", async () => {
  const db = await fixture();
  await assert.rejects(addCar(db, METHOD_ONLY, "NEW 0005"), /payout details/i);

  await db.query(
    "update public.profiles set payout_account_name = $2, payout_account_number = $3 where id = $1",
    [METHOD_ONLY, "Karl Chua", "09171111111"],
  );
  const { rows } = await addCar(db, METHOD_ONLY, "NEW 0006");
  assert.equal(rows.length, 1);
});

test("the server is exempt, so imports and support fixes are not blocked", async () => {
  const db = await fixture();
  await asServer(db, true);
  const { rows } = await addCar(db, NO_DETAILS, "SRV 0007");
  assert.equal(rows.length, 1);

  await asServer(db, false);
  await assert.rejects(addCar(db, NO_DETAILS, "SRV 0008"), /payout details/i);
});

test("the trigger fires on insert only", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select tgtype & 4 = 4 as on_insert, tgtype & 16 = 16 as on_update, tgtype & 8 = 8 as on_delete
       from pg_trigger where tgname = 'require_payout_destination_for_new_car' and not tgisinternal`,
  );
  assert.deepEqual(rows[0], { on_insert: true, on_update: false, on_delete: false });
});
