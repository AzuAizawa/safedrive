// CHAPTER 113 - a review that runs past its target time is announced, once.
//
// Proved against real PostgreSQL (PGlite) with CHAPTERS 104, 105 and 113
// applied verbatim from the master file: the person waiting and every active
// admin hear about a late review exactly once per submission, a resubmission
// starts over, and nothing is rejected on the way.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const DISABLED_ADMIN = "22222222-2222-4222-8222-222222222222";
const LATE_USER = "33333333-3333-4333-8333-333333333333";
const FRESH_USER = "44444444-4444-4444-8444-444444444444";
const LATE_CAR = "55555555-5555-4555-8555-555555555555";
const FRESH_CAR = "66666666-6666-4666-8666-666666666666";

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
    create table public.platform_settings(
      id text primary key default 'default',
      updated_at timestamptz not null default now());
    insert into public.platform_settings(id) values('default');

    create table public.profiles(
      id uuid primary key,
      email text not null,
      full_name text,
      role text not null default 'user',
      verified_status text not null default 'unverified',
      deleted_at timestamptz,
      admin_disabled_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now());

    create table public.cars(
      id uuid primary key,
      owner_id uuid references public.profiles(id) not null,
      plate_number text,
      status text default 'pending',
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now());

    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null, title text not null, message text not null,
      type text default 'info', link text);

    insert into public.profiles(id, email, full_name, role, admin_disabled_at) values
      ('${ADMIN}', 'admin@example.com', 'Admin', 'super_admin', null),
      ('${DISABLED_ADMIN}', 'gone@example.com', 'Gone', 'admin', now());
    insert into public.profiles(id, email, full_name) values
      ('${LATE_USER}', 'late@example.com', 'Lara Late'),
      ('${FRESH_USER}', 'fresh@example.com', 'Fred Fresh');
    insert into public.cars(id, owner_id, plate_number, status) values
      ('${LATE_CAR}', '${FRESH_USER}', 'ABC 1234', 'approved'),
      ('${FRESH_CAR}', '${FRESH_USER}', 'XYZ 5678', 'approved');
  `);
  await db.exec(await chapter("-- CHAPTER 104 - A review that is late is visible as late"));
  await db.exec(await chapter("-- CHAPTER 105 - A vehicle waiting for review shows how long it has waited"));
  await db.exec(await chapter("-- CHAPTER 113 - A review that runs past its target time is announced, once"));
  await db.exec(await chapter("-- CHAPTER 117 - A late review is emailed as well as notified"));

  // Everyone submits now; the late ones are then aged past the 24-hour target.
  await db.exec(`
    update public.profiles set verified_status = 'pending' where id in ('${LATE_USER}', '${FRESH_USER}');
    update public.cars set status = 'pending';
    update public.profiles set verification_submitted_at = now() - interval '30 hours' where id = '${LATE_USER}';
    update public.cars set review_submitted_at = now() - interval '30 hours' where id = '${LATE_CAR}';
  `);
  return db;
}

// CHAPTER 117: one row per notice, which the worker turns into emails.
const runRows = async (db) => (await db.query("select * from public.notify_overdue_reviews()")).rows;
const run = async (db) => {
  const rows = await runRows(db);
  return {
    identity_notices: rows.filter((row) => row.kind === "identity").length,
    vehicle_notices: rows.filter((row) => row.kind === "vehicle").length,
  };
};
const notesFor = async (db, user) =>
  (await db.query("select title, message, link from public.notifications where user_id = $1 order by title", [user])).rows;

test("a late identity review and a late vehicle review are each announced", async () => {
  const db = await fixture();
  assert.deepEqual(await run(db), { identity_notices: 1, vehicle_notices: 1 });

  const userNotes = await notesFor(db, LATE_USER);
  assert.equal(userNotes.length, 1);
  assert.match(userNotes[0].message, /do not need to resubmit/);
  assert.equal(userNotes[0].link, "/verify");

  const ownerNotes = await notesFor(db, FRESH_USER);
  assert.equal(ownerNotes.length, 1, "only the late car, not the fresh one");
  assert.match(ownerNotes[0].message, /ABC 1234/);
  assert.equal(ownerNotes[0].link, "/my-vehicles");

  const adminNotes = await notesFor(db, ADMIN);
  assert.deepEqual(adminNotes.map((note) => note.title), ["Identity review past target", "Vehicle review past target"]);
  assert.match(adminNotes[0].message, /Lara Late has waited more than 24 hours/);
  assert.equal((await notesFor(db, DISABLED_ADMIN)).length, 0, "a disabled admin is not told");
});

test("the same submission is announced only once", async () => {
  const db = await fixture();
  await run(db);
  assert.deepEqual(await run(db), { identity_notices: 0, vehicle_notices: 0 });
  assert.equal((await notesFor(db, LATE_USER)).length, 1);
});

test("nothing is rejected: the late submissions stay in the queue", async () => {
  const db = await fixture();
  await run(db);
  const { rows } = await db.query(
    `select (select verified_status from public.profiles where id = $1) as profile,
            (select status from public.cars where id = $2) as car`,
    [LATE_USER, LATE_CAR],
  );
  assert.deepEqual(rows[0], { profile: "pending", car: "pending" });
});

test("a resubmission past its own target is announced again", async () => {
  const db = await fixture();
  await run(db);
  await db.exec(`
    update public.profiles set verified_status = 'rejected' where id = '${LATE_USER}';
    update public.profiles set verified_status = 'pending' where id = '${LATE_USER}';
  `);
  const stamp = (await db.query("select verification_overdue_notified_at as t from public.profiles where id = $1", [LATE_USER])).rows[0].t;
  assert.equal(stamp, null, "a new submission clears the old notice");
  assert.deepEqual(await run(db), { identity_notices: 0, vehicle_notices: 0 }, "not late yet");

  await db.exec(`update public.profiles set verification_submitted_at = now() - interval '25 hours' where id = '${LATE_USER}'`);
  assert.deepEqual(await run(db), { identity_notices: 1, vehicle_notices: 0 });
});

test("the target follows the platform setting", async () => {
  const db = await fixture();
  await db.exec("update public.platform_settings set verification_review_target_hours = 48, vehicle_review_target_hours = 12");
  assert.deepEqual(await run(db), { identity_notices: 0, vehicle_notices: 1 }, "30h is under 48h but over 12h");
});

test("each notice comes back as a row the worker can email", async () => {
  const db = await fixture();
  const rows = await runRows(db);
  const byKind = Object.fromEntries(rows.map((row) => [row.kind, row]));
  assert.equal(byKind.identity.user_id, LATE_USER);
  assert.equal(byKind.identity.label, "Lara Late");
  assert.equal(byKind.identity.target_hours, 24);
  assert.equal(byKind.vehicle.subject_id, LATE_CAR);
  assert.equal(byKind.vehicle.user_id, FRESH_USER, "the vehicle's owner is the one emailed");
  assert.equal(byKind.vehicle.label, "ABC 1234");
  assert.ok(byKind.vehicle.submitted_at instanceof Date);
});

test("CHAPTER 117's verification query reads the new row shape", async () => {
  const db = await fixture();
  const { rows } = await db.query(`
    select string_agg(a, ',' order by n) as result from pg_proc p,
      unnest(p.proargnames, p.proargmodes::text[]) with ordinality as x(a, m, n)
     where p.proname = 'notify_overdue_reviews' and m = 't'`);
  assert.equal(rows[0].result, "kind,subject_id,user_id,label,submitted_at,target_hours");
});
