// CHAPTER 112 - how many vehicles each plan can list is a platform setting.
//
// The slot counts used to be written into the code (5, +5 Pro, +10 Premium).
// Proved against real PostgreSQL (PGlite) with the chapter applied verbatim
// from the master file: the allowance follows the live setting for current
// subscribers too, and lowering it pauses the newest listings the same way an
// expiring plan does.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const FREE = "11111111-1111-4111-8111-111111111111";
const PRO = "22222222-2222-4222-8222-222222222222";
const PREMIUM = "33333333-3333-4333-8333-333333333333";

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
      updated_at timestamptz not null default now());
    insert into public.platform_settings(id) values('default');

    create table public.profiles(id uuid primary key);
    insert into public.profiles(id) values('${FREE}'), ('${PRO}'), ('${PREMIUM}');

    create table public.subscriptions(
      id uuid primary key default gen_random_uuid(),
      user_id uuid references public.profiles(id) not null,
      plan_type text not null,
      additional_slots integer not null default 0,
      status text default 'active');
    -- The stored extras are deliberately wrong: the setting decides now.
    insert into public.subscriptions(user_id, plan_type, additional_slots) values
      ('${PRO}', 'pro', 99), ('${PREMIUM}', 'premium', 0);

    create table public.cars(
      id uuid primary key default gen_random_uuid(),
      owner_id uuid references public.profiles(id) not null,
      plate_number text,
      status text default 'pending',
      deleted_at timestamptz,
      created_at timestamptz not null default now());

    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null, title text not null, message text not null,
      type text default 'info', link text);
  `);
  await db.exec(await chapter("-- CHAPTER 112 - How many vehicles each plan can list is a platform setting"));
  await db.exec(`
    create trigger enforce_live_car_limit before update on public.cars
      for each row execute function public.trg_enforce_live_car_limit();
  `);
  return db;
}

const allowance = async (db, owner) =>
  (await db.query("select public.vehicle_slot_allowance($1) as n", [owner])).rows[0].n;

const listCars = async (db, owner, count) => {
  for (let index = 0; index < count; index += 1) {
    await db.query(
      `insert into public.cars(owner_id, plate_number, status, created_at)
       values ($1, $2, 'approved', now() - make_interval(days => $3))`,
      [owner, `CAR ${index}`, 100 - index],
    );
  }
};

test("the defaults are today's numbers, so applying the chapter changes nothing", async () => {
  const db = await fixture();
  assert.equal(await allowance(db, FREE), 5);
  assert.equal(await allowance(db, PRO), 10, "5 + 5, not the 99 stored on the subscription");
  assert.equal(await allowance(db, PREMIUM), 15);
});

test("raising a plan's extra slots reaches people already subscribed", async () => {
  const db = await fixture();
  await db.exec("update public.platform_settings set pro_extra_vehicle_slots = 8");
  assert.equal(await allowance(db, PRO), 13);
  await db.exec("update public.platform_settings set free_vehicle_slots = 3");
  assert.equal(await allowance(db, FREE), 3);
  assert.equal(await allowance(db, PREMIUM), 13);
});

test("lowering slots pauses the newest listings and tells the lister", async () => {
  const db = await fixture();
  await listCars(db, FREE, 5);
  await db.exec("update public.platform_settings set free_vehicle_slots = 3");

  const { rows } = await db.query(
    "select plate_number, status from public.cars where owner_id = $1 order by created_at",
    [FREE],
  );
  assert.deepEqual(
    rows.map((row) => row.status),
    ["approved", "approved", "approved", "inactive", "inactive"],
    "the oldest three stay live",
  );
  const notes = (await db.query("select title, message, link from public.notifications where user_id = $1", [FREE])).rows;
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /2 of your listings were paused/);
  assert.equal(notes[0].link, "/my-vehicles");
});

test("a lister who still fits is left alone and not notified", async () => {
  const db = await fixture();
  await listCars(db, PRO, 6);
  await db.exec("update public.platform_settings set pro_extra_vehicle_slots = 2");
  const live = (await db.query(
    "select count(*)::int as n from public.cars where owner_id = $1 and status = 'approved'",
    [PRO],
  )).rows[0].n;
  assert.equal(live, 6, "6 fits in 5 + 2");
  const notes = (await db.query("select count(*)::int as n from public.notifications")).rows[0].n;
  assert.equal(notes, 0);
});

test("turning a paused listing back on is refused while the plan is full", async () => {
  const db = await fixture();
  await listCars(db, FREE, 4);
  await db.exec("update public.platform_settings set free_vehicle_slots = 3");
  await assert.rejects(
    db.query("update public.cars set status = 'approved' where owner_id = $1 and status = 'inactive'", [FREE]),
    /your current plan allows 3 live listing/,
  );
  // Off one, on the other: the swap the notification describes.
  await db.query(
    `update public.cars set status = 'inactive'
      where id = (select id from public.cars where owner_id = $1 and status = 'approved' order by created_at limit 1)`,
    [FREE],
  );
  await db.query("update public.cars set status = 'approved' where owner_id = $1 and plate_number = 'CAR 3'", [FREE]);
});

test("the three slot settings go through the vote's whitelist with their bounds", async () => {
  const db = await fixture();
  await db.query(
    `select public.validate_platform_setting_change('{"free_vehicle_slots": 4, "pro_extra_vehicle_slots": 0, "premium_extra_vehicle_slots": 100}'::jsonb)`,
  );
  await assert.rejects(
    db.query(`select public.validate_platform_setting_change('{"free_vehicle_slots": 0}'::jsonb)`),
    /free_vehicle_slots must be a whole number 1-100/,
  );
  await assert.rejects(
    db.query(`select public.validate_platform_setting_change('{"pro_extra_vehicle_slots": 2.5}'::jsonb)`),
    /pro_extra_vehicle_slots must be a whole number 0-100/,
  );
  await assert.rejects(
    db.query(`select public.validate_platform_setting_change('{"commission_rate": 2}'::jsonb)`),
    /commission_rate must be 0-1/,
    "the existing keys keep their bounds",
  );
});
