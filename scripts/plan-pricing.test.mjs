// CHAPTER 115 - plan prices are a setting, and a higher plan is always better.
//
// Proved against real PostgreSQL (PGlite) with CHAPTERS 112 and 115 applied
// verbatim from the master file: prices go through the vote's whitelist, and
// neither a proposal nor a direct write can leave Premium giving fewer slots
// than Pro, Pro no more than Free, or Premium costing no more than Pro.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

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
    create role anon; create role authenticated;
    create table public.platform_settings(
      id text primary key default 'default',
      commission_rate numeric not null default 0.1,
      updated_at timestamptz not null default now());
    insert into public.platform_settings(id) values('default');
    create table public.profiles(id uuid primary key);
    create table public.subscriptions(
      id uuid primary key default gen_random_uuid(), user_id uuid, plan_type text,
      additional_slots integer not null default 0, status text default 'active');
    create table public.cars(
      id uuid primary key default gen_random_uuid(), owner_id uuid, status text,
      deleted_at timestamptz, created_at timestamptz not null default now());
    create table public.notifications(
      id uuid primary key default gen_random_uuid(), user_id uuid, title text,
      message text, type text, link text);
  `);
  await db.exec(await chapter("-- CHAPTER 112 - How many vehicles each plan can list is a platform setting"));
  await db.exec(await chapter("-- CHAPTER 115 - Plan prices are a setting, and a higher plan is always better"));
  return db;
}

const propose = (db, changes) =>
  db.query("select public.validate_platform_setting_change($1::jsonb)", [JSON.stringify(changes)]);

test("today's prices are the defaults", async () => {
  const db = await fixture();
  const { rows } = await db.query("select pro_price_php, premium_price_php from public.platform_settings");
  assert.deepEqual(rows[0], { pro_price_php: 199, premium_price_php: 299 });
});

test("prices are votable within PHP 100 to 10,000", async () => {
  const db = await fixture();
  await propose(db, { pro_price_php: 249, premium_price_php: 349 });
  await assert.rejects(propose(db, { pro_price_php: 99 }), /pro_price_php must be a whole number of pesos 100-10000/);
  await assert.rejects(propose(db, { premium_price_php: 10001 }), /premium_price_php must be/);
  await assert.rejects(propose(db, { pro_price_php: 199.5 }), /pro_price_php must be/);
});

test("a proposal that would make Premium the worse deal is refused", async () => {
  const db = await fixture();
  // The panel's example: Premium down to 3 total while Pro gives 10 for less.
  await assert.rejects(
    propose(db, { premium_extra_vehicle_slots: 0 }),
    /Premium must give more vehicle slots than Pro/,
  );
  await assert.rejects(propose(db, { pro_extra_vehicle_slots: 10 }), /Premium must give more vehicle slots than Pro/);
  await assert.rejects(propose(db, { pro_extra_vehicle_slots: 0 }), /Pro must give more vehicle slots than Free/);
  await assert.rejects(propose(db, { premium_price_php: 199 }), /Premium must cost more than Pro/);
  await assert.rejects(propose(db, { pro_price_php: 399 }), /Premium must cost more than Pro/);
});

test("a proposal is judged on the values as they would stand after it", async () => {
  const db = await fixture();
  // Raising Pro past Premium is fine when Premium rises in the same change.
  await propose(db, { pro_extra_vehicle_slots: 12, premium_extra_vehicle_slots: 20 });
  await propose(db, { pro_price_php: 399, premium_price_php: 499 });
  // A change that touches no plan value is never held up by the rule.
  await propose(db, { commission_rate: 0.12 });
});

test("the row itself refuses an out-of-order plan at commit, after every key is written", async () => {
  const db = await fixture();
  // One key at a time, as the vote applies a change: Pro passes Premium for a
  // moment, which is fine because the check waits for the commit.
  await db.transaction(async (tx) => {
    await tx.query("update public.platform_settings set pro_extra_vehicle_slots = 12");
    await tx.query("update public.platform_settings set premium_extra_vehicle_slots = 20");
  });
  await assert.rejects(
    db.exec("update public.platform_settings set premium_price_php = 150"),
    /Premium must cost more than Pro/,
  );
  const { rows } = await db.query("select premium_price_php from public.platform_settings");
  assert.equal(rows[0].premium_price_php, 299, "nothing was written");
});

// The admin form says the same thing before a proposal is ever sent.
test("the admin form names the same out-of-order plans", async () => {
  const { planOrderProblem } = await import("../src/lib/planRules.ts");
  const today = { free: 5, proExtra: 5, premiumExtra: 10, proPricePhp: 199, premiumPricePhp: 299 };
  assert.equal(planOrderProblem(today), null);
  assert.match(planOrderProblem({ ...today, premiumExtra: 0 }), /Premium must give more vehicle slots than Pro \(10 total\)/);
  assert.match(planOrderProblem({ ...today, proExtra: 0 }), /Pro must give more vehicle slots than Free/);
  assert.match(planOrderProblem({ ...today, premiumPricePhp: 199 }), /Premium must cost more than Pro/);
});
