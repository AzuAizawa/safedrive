// CHAPTER 126 - a body type is a catalog entry, like a brand.
//
// The list, its key from car_models and its permission gate live in SQL, so
// they are proved against real PostgreSQL (PGlite). The fixture builds only
// what the chapter touches and applies the chapter verbatim out of the master
// file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const BRAND = "11111111-1111-4111-8111-111111111111";

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;

    create function public.admin_can(text) returns boolean language sql stable as
      $$ select coalesce(current_setting('test.catalog_admin', true), 'false') = 'true' $$;

    create table public.car_brands(
      id uuid primary key default gen_random_uuid(),
      name text unique not null);
    create table public.car_models(
      id uuid primary key default gen_random_uuid(),
      brand_id uuid references public.car_brands(id) on delete cascade not null,
      name text not null,
      body_type text not null,
      seats integer default 4 not null,
      fuel_type text not null);
    grant select, insert, update, delete on public.car_models to authenticated;

    insert into public.car_brands(id, name) values('${BRAND}', 'Toyota');
    insert into public.car_models(brand_id, name, body_type, fuel_type) values
      ('${BRAND}', 'Vios', 'sedan', 'gasoline'),
      ('${BRAND}', 'Hiace', ' Van', 'diesel'),
      ('${BRAND}', 'Tamaraw', 'utility', 'diesel');
  `);

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 126 - A body type is a catalog entry, like a brand")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 126 exists in the master file");
  await db.exec("-- CHAPTER 126\n" + chapter);

  return db;
}

const asCatalogAdmin = (db, allowed) =>
  db.query("select set_config('test.catalog_admin', $1, false)", [
    allowed ? "true" : "false",
  ]);

const typeNames = async (db) =>
  (await db.query("select name from public.body_types order by name")).rows.map(
    (r) => r.name,
  );

test("the list starts with the original nine plus AUV, and every type already in use", async () => {
  const db = await fixture();
  assert.deepEqual(await typeNames(db), [
    "auv", "convertible", "coupe", "hatchback", "mpv", "pickup",
    "sedan", "suv", "utility", "van", "wagon",
  ]);

  const { rows } = await db.query(
    "select default_seats from public.body_types where name in ('auv', 'van') order by name",
  );
  assert.deepEqual(rows.map((r) => r.default_seats), [7, 12]);
});

test("a stray capital or space on a model is tidied, not orphaned", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    "select body_type from public.car_models where name = 'Hiace'",
  );
  assert.equal(rows[0].body_type, "van");
});

test("running the chapter twice changes nothing", async () => {
  const db = await fixture();
  const before = await typeNames(db);
  await db.exec("-- CHAPTER 126 again\n" + chapter);
  assert.deepEqual(await typeNames(db), before);
});

test("a model can only name a type the catalog has", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query(
      "insert into public.car_models(brand_id, name, body_type, fuel_type) values($1, 'L300', 'truck', 'diesel')",
      [BRAND],
    ),
    /violates foreign key constraint/i,
  );

  await db.query("insert into public.body_types(name, default_seats) values('utility van', 15)");
  await db.query(
    "insert into public.car_models(brand_id, name, body_type, fuel_type) values($1, 'L300', 'utility van', 'diesel')",
    [BRAND],
  );
});

test("a type in use cannot be deleted; an unused one can", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query("delete from public.body_types where name = 'sedan'"),
    /violates foreign key constraint/i,
  );
  await db.query("delete from public.body_types where name = 'coupe'");
  assert.ok(!(await typeNames(db)).includes("coupe"));
});

test("a name must be lowercase and trimmed", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query("insert into public.body_types(name) values('Crossover')"),
    /check constraint/i,
  );
});

test("everyone reads the list; only a catalog admin writes it", async () => {
  const db = await fixture();
  await db.exec("set role authenticated");

  const { rows } = await db.query("select count(*)::int as n from public.body_types");
  assert.equal(rows[0].n, 11, "a signed-in user reads every type");

  await asCatalogAdmin(db, false);
  await assert.rejects(
    db.query("insert into public.body_types(name) values('crossover')"),
    /row-level security/i,
  );

  await asCatalogAdmin(db, true);
  await db.query("insert into public.body_types(name) values('crossover')");
  await db.query("update public.body_types set discontinued_at = now() where name = 'crossover'");
  const after = await db.query(
    "select discontinued_at is not null as off from public.body_types where name = 'crossover'",
  );
  assert.equal(after.rows[0].off, true);
});
