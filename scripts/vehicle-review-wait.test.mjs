// CHAPTER 105 - a vehicle waiting for review shows how long it has waited.
//
// Same shape as CHAPTER 104, on the other queue, so the test is again mostly
// about what must NOT move the clock. The case that matters most here is the
// resubmitted vehicle: a car listed months ago, rejected, and sent back today
// must show today's wait, not its age. Proved against real PostgreSQL (PGlite)
// with the chapter applied verbatim from the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const QUEUED = "22222222-2222-4222-8222-222222222222";
const LIVE = "33333333-3333-4333-8333-333333333333";
const FRESH = "44444444-4444-4444-8444-444444444444";

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
    create table public.platform_settings(
      id text primary key default 'default',
      verification_review_target_hours integer not null default 24,
      updated_at timestamptz not null default now());
    insert into public.platform_settings(id) values('default');

    create table public.profiles(id uuid primary key);
    insert into public.profiles(id) values('${OWNER}');

    create table public.cars(
      id uuid primary key,
      owner_id uuid references public.profiles(id) not null,
      plate_number text,
      status text default 'pending'
        check (status in ('pending','approved','rejected','active','inactive','renewal_required')),
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now());

    -- Listed long ago, resubmitted two days ago: the age of the row and the
    -- age of the review are nothing like each other.
    insert into public.cars(id, owner_id, plate_number, status, created_at, updated_at) values
      ('${QUEUED}', '${OWNER}', 'OLD 1111', 'pending', now() - interval '120 days', now() - interval '2 days'),
      ('${LIVE}',   '${OWNER}', 'RUN 2222', 'approved', now() - interval '90 days', now() - interval '80 days');
  `);
  await db.exec(await chapter("-- CHAPTER 105 - A vehicle waiting for review shows how long it has waited"));
  return db;
}

const submittedAt = async (db, id) =>
  (await db.query("select review_submitted_at as t from public.cars where id = $1", [id])).rows[0].t;

const waitHours = async (db, id) => {
  const { rows } = await db.query(
    `select round(extract(epoch from (now() - review_submitted_at)) / 3600) as h
       from public.cars where id = $1`,
    [id],
  );
  return rows[0].h === null ? null : Number(rows[0].h);
};

test("the vehicle target is its own setting, separate from the identity one", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select verification_review_target_hours as identity, vehicle_review_target_hours as vehicle
       from public.platform_settings where id = 'default'`,
  );
  assert.equal(rows[0].vehicle, 24);
  assert.equal(rows[0].identity, 24, "same default, so nothing changes until someone decides it should");

  await db.query("update public.platform_settings set vehicle_review_target_hours = 72 where id = 'default'");
  const { rows: after } = await db.query(
    `select verification_review_target_hours as identity, vehicle_review_target_hours as vehicle
       from public.platform_settings where id = 'default'`,
  );
  assert.equal(after[0].vehicle, 72);
  assert.equal(after[0].identity, 24, "moving one queue's target does not move the other");
});

test("the wait is measured from the submission, not from when the car was listed", async () => {
  const db = await fixture();
  const hours = await waitHours(db, QUEUED);
  assert.ok(hours >= 47 && hours <= 49, `about two days, got ${hours}h`);

  const { rows } = await db.query(
    "select round(extract(epoch from (now() - created_at)) / 86400) as d from public.cars where id = $1",
    [QUEUED],
  );
  assert.ok(Number(rows[0].d) >= 119, "while the row itself is 120 days old");
});

test("a vehicle that is not pending is left alone", async () => {
  const db = await fixture();
  assert.equal(await submittedAt(db, LIVE), null);
});

test("a newly listed vehicle is stamped on insert", async () => {
  const db = await fixture();
  await db.query(
    "insert into public.cars(id, owner_id, plate_number) values($1, $2, 'NEW 0001')",
    [FRESH, OWNER],
  );
  assert.equal(await waitHours(db, FRESH), 0);
});

test("an unrelated edit while pending does NOT restart the wait", async () => {
  const db = await fixture();
  const before = await submittedAt(db, QUEUED);
  await db.query("update public.cars set plate_number = 'EDIT 999' where id = $1", [QUEUED]);
  assert.deepEqual(await submittedAt(db, QUEUED), before);

  await db.query("update public.cars set status = 'pending' where id = $1", [QUEUED]);
  assert.deepEqual(await submittedAt(db, QUEUED), before, "even writing the same status");
});

test("the decision keeps the record of when the submission arrived", async () => {
  const db = await fixture();
  const before = await submittedAt(db, QUEUED);
  await db.query("update public.cars set status = 'approved' where id = $1", [QUEUED]);
  assert.deepEqual(await submittedAt(db, QUEUED), before);
});

test("a rejected vehicle sent back starts a fresh wait", async () => {
  const db = await fixture();
  const first = await submittedAt(db, QUEUED);
  await db.query("update public.cars set status = 'rejected' where id = $1", [QUEUED]);
  await db.query("update public.cars set status = 'pending' where id = $1", [QUEUED]);
  assert.notDeepEqual(await submittedAt(db, QUEUED), first);
  assert.equal(await waitHours(db, QUEUED), 0, "not charged the two days it already waited once");
});

test("a vehicle sent back for renewal and resubmitted is treated the same way", async () => {
  const db = await fixture();
  await db.query("update public.cars set status = 'renewal_required' where id = $1", [QUEUED]);
  const parked = await submittedAt(db, QUEUED);
  await db.query("update public.cars set status = 'pending' where id = $1", [QUEUED]);
  assert.notDeepEqual(await submittedAt(db, QUEUED), parked);
  assert.equal(await waitHours(db, QUEUED), 0);
});

test("overdue comes from the setting, with nothing hardcoded beside it", async () => {
  const db = await fixture();
  const overdue = async () =>
    (
      await db.query(`
        select extract(epoch from (now() - c.review_submitted_at)) / 3600
                 > s.vehicle_review_target_hours as late
          from public.cars c cross join public.platform_settings s
         where c.id = $1 and s.id = 'default'
      `, [QUEUED])
    ).rows[0].late;

  assert.equal(await overdue(), true, "two days against a 24-hour target");
  await db.query("update public.platform_settings set vehicle_review_target_hours = 168 where id = 'default'");
  assert.equal(await overdue(), false, "raising the target changes the answer, with no deploy");
});

test("the target cannot be set to something meaningless", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query("update public.platform_settings set vehicle_review_target_hours = 0 where id = 'default'"),
    /vehicle_review_target_hours_check/,
  );
  await assert.rejects(
    db.query("update public.platform_settings set vehicle_review_target_hours = 1000 where id = 'default'"),
    /vehicle_review_target_hours_check/,
  );
});

test("applying the chapter twice changes nothing", async () => {
  const db = await fixture();
  const before = await submittedAt(db, QUEUED);
  await db.exec(await chapter("-- CHAPTER 105 - A vehicle waiting for review shows how long it has waited"));
  assert.deepEqual(await submittedAt(db, QUEUED), before, "the backfill does not run again");
});
