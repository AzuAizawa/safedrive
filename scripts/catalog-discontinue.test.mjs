// CHAPTER 84 - a catalog entry is discontinued, not deleted.
//
// The brand/model cascade and its permission gate live in SQL, so they are
// proved against real PostgreSQL (PGlite) rather than trusted. The fixture
// builds only what the chapter touches and applies the chapter verbatim out of
// the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER_BRAND = "22222222-2222-4222-8222-222222222222";
const MODEL_A = "33333333-3333-4333-8333-333333333333";
const MODEL_B = "44444444-4444-4444-8444-444444444444";
const OTHER_MODEL = "55555555-5555-4555-8555-555555555555";
const CAR = "66666666-6666-4666-8666-666666666666";

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;

    create function public.admin_can(text) returns boolean language sql stable as
      $$ select coalesce(current_setting('test.catalog_admin', true), 'false') = 'true' $$;

    create table public.car_brands(
      id uuid primary key default gen_random_uuid(),
      name text unique not null,
      created_at timestamptz default now());
    create table public.car_models(
      id uuid primary key default gen_random_uuid(),
      brand_id uuid references public.car_brands(id) on delete cascade not null,
      name text not null,
      body_type text not null,
      seats integer default 4 not null,
      fuel_type text not null,
      created_at timestamptz default now());
    create table public.cars(
      id uuid primary key default gen_random_uuid(),
      model_id uuid references public.car_models(id) not null,
      plate_number text);

    insert into public.car_brands(id, name) values('${BRAND}', 'Kia'), ('${OTHER_BRAND}', 'Toyota');
    insert into public.car_models(id, brand_id, name, body_type, fuel_type) values
      ('${MODEL_A}', '${BRAND}', 'Soluto', 'sedan', 'gasoline'),
      ('${MODEL_B}', '${BRAND}', 'Picanto', 'hatchback', 'gasoline'),
      ('${OTHER_MODEL}', '${OTHER_BRAND}', 'Vios', 'sedan', 'gasoline');
    insert into public.cars(id, model_id, plate_number) values('${CAR}', '${MODEL_A}', 'ABC 1234');
  `);

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 84 - A catalog entry is discontinued, not deleted")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 84 exists in the master file");
  await db.exec("-- CHAPTER 84\n" + chapter);

  return db;
}

const asCatalogAdmin = (db, allowed) =>
  db.query("select set_config('test.catalog_admin', $1, false)", [
    allowed ? "true" : "false",
  ]);

const discontinuedState = async (db) => {
  const { rows } = await db.query(`
    select 'brand:' || name as label, discontinued_at is not null as off from public.car_brands
    union all
    select 'model:' || name, discontinued_at is not null from public.car_models
    order by label
  `);
  return Object.fromEntries(rows.map((r) => [r.label, r.off]));
};

test("the chapter adds the columns and withdraws nothing", async () => {
  const db = await fixture();

  const { rows } = await db.query(
    `select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'discontinued_at'
      order by table_name`,
  );
  assert.deepEqual(
    rows.map((r) => r.table_name),
    ["car_brands", "car_models"],
  );

  const state = await discontinuedState(db);
  assert.deepEqual(Object.values(state).filter(Boolean), [], "everything starts active");
});

test("discontinuing a brand takes its models with it, and leaves other brands alone", async () => {
  const db = await fixture();
  await asCatalogAdmin(db, true);

  await db.query("select public.set_brand_discontinued($1, true)", [BRAND]);

  assert.deepEqual(await discontinuedState(db), {
    "brand:Kia": true,
    "brand:Toyota": false,
    "model:Picanto": true,
    "model:Soluto": true,
    "model:Vios": false,
  });
});

test("restoring a brand brings its models back", async () => {
  const db = await fixture();
  await asCatalogAdmin(db, true);

  await db.query("select public.set_brand_discontinued($1, true)", [BRAND]);
  await db.query("select public.set_brand_discontinued($1, false)", [BRAND]);

  const state = await discontinuedState(db);
  assert.deepEqual(Object.values(state).filter(Boolean), [], "nothing left withdrawn");
});

test("discontinuing never touches a listing", async () => {
  const db = await fixture();
  await asCatalogAdmin(db, true);

  await db.query("select public.set_brand_discontinued($1, true)", [BRAND]);

  const { rows } = await db.query("select id, model_id from public.cars");
  assert.equal(rows.length, 1, "the car is still listed");
  assert.equal(rows[0].model_id, MODEL_A, "and still resolves to its model");
});

test("a model in use still cannot be deleted - that is the point of discontinuing", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query("delete from public.car_models where id = $1", [MODEL_A]),
    /violates foreign key constraint/i,
  );

  // And deleting the brand cannot get around it: the cascade to its models
  // reaches the same car and the whole statement is refused.
  await assert.rejects(
    db.query("delete from public.car_brands where id = $1", [BRAND]),
    /violates foreign key constraint/i,
  );
});

test("an entry nobody ever used can still be deleted outright", async () => {
  const db = await fixture();
  await db.query("delete from public.car_models where id = $1", [MODEL_B]);
  const { rows } = await db.query("select id from public.car_models where id = $1", [MODEL_B]);
  assert.equal(rows.length, 0, "a never-used model is a typo, not a record");
});

test("catalog permission is required, and a missing brand is reported", async () => {
  const db = await fixture();

  await asCatalogAdmin(db, false);
  await assert.rejects(
    db.query("select public.set_brand_discontinued($1, true)", [BRAND]),
    /Catalog management permission required/i,
  );
  assert.deepEqual(
    Object.values(await discontinuedState(db)).filter(Boolean),
    [],
    "the refused call changed nothing",
  );

  await asCatalogAdmin(db, true);
  await assert.rejects(
    db.query("select public.set_brand_discontinued($1, true)", [
      "77777777-7777-4777-8777-777777777777",
    ]),
    /Brand not found/i,
  );
});
