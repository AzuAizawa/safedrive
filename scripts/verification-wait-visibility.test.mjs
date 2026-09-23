// CHAPTER 104 - a review that is late is visible as late.
//
// The whole value of the column is that it answers "how long has this person
// been waiting", so the test is mostly about what must NOT move it: an
// unrelated edit while already pending, and the admin's own decision. A clock
// that silently restarts is worse than no clock, because the queue would then
// look healthy exactly when it is not. Proved against real PostgreSQL (PGlite)
// with the chapter applied verbatim from the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const WAITING = "11111111-1111-4111-8111-111111111111";
const FRESH = "22222222-2222-4222-8222-222222222222";
const SETTLED = "33333333-3333-4333-8333-333333333333";

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
      updated_at timestamptz not null default now());
    insert into public.platform_settings(id) values('default');

    create table public.profiles(
      id uuid primary key,
      email text,
      verified_status text default 'unverified'
        check (verified_status in ('unverified','pending','verified','rejected')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now());

    -- Already queued when the chapter runs: submitted three days ago, and the
    -- only record of it is updated_at.
    insert into public.profiles(id, email, verified_status, created_at, updated_at) values
      ('${WAITING}', 'waiting@gmail.com', 'pending', now() - interval '30 days', now() - interval '3 days'),
      ('${SETTLED}', 'settled@gmail.com', 'verified', now() - interval '60 days', now() - interval '10 days');
  `);
  await db.exec(await chapter("-- CHAPTER 104 - A review that is late is visible as late"));
  return db;
}

const waitHours = async (db, id) => {
  const { rows } = await db.query(
    `select round(extract(epoch from (now() - verification_submitted_at)) / 3600) as h
       from public.profiles where id = $1`,
    [id],
  );
  return rows[0].h === null ? null : Number(rows[0].h);
};

const submittedAt = async (db, id) =>
  (await db.query("select verification_submitted_at as t from public.profiles where id = $1", [id]))
    .rows[0].t;

test("the target is 24 hours, matching the message shown to the person waiting", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    "select verification_review_target_hours as h from public.platform_settings where id = 'default'",
  );
  assert.equal(rows[0].h, 24);
});

test("someone already in the queue is backfilled, not left blank", async () => {
  const db = await fixture();
  const hours = await waitHours(db, WAITING);
  assert.ok(hours >= 71 && hours <= 73, `about three days, got ${hours}h`);
});

test("a profile that is not pending is left alone", async () => {
  const db = await fixture();
  assert.equal(await submittedAt(db, SETTLED), null);
});

test("submitting stamps the clock", async () => {
  const db = await fixture();
  await db.query(
    "insert into public.profiles(id, email, verified_status) values($1, 'fresh@gmail.com', 'unverified')",
    [FRESH],
  );
  assert.equal(await submittedAt(db, FRESH), null, "not waiting yet");

  await db.query("update public.profiles set verified_status = 'pending' where id = $1", [FRESH]);
  assert.equal(await waitHours(db, FRESH), 0);
});

test("an unrelated edit while pending does NOT restart the wait", async () => {
  const db = await fixture();
  const before = await submittedAt(db, WAITING);

  await db.query("update public.profiles set email = 'changed@gmail.com' where id = $1", [WAITING]);
  assert.deepEqual(await submittedAt(db, WAITING), before, "still waiting three days");

  // Even an explicit write of the same status must not move it.
  await db.query("update public.profiles set verified_status = 'pending' where id = $1", [WAITING]);
  assert.deepEqual(await submittedAt(db, WAITING), before);
});

test("the decision does not erase when the submission arrived", async () => {
  const db = await fixture();
  const before = await submittedAt(db, WAITING);
  await db.query("update public.profiles set verified_status = 'verified' where id = $1", [WAITING]);
  assert.deepEqual(
    await submittedAt(db, WAITING),
    before,
    "so 'that one took three days' is still answerable afterwards",
  );
});

test("a resubmission after a rejection starts a new clock", async () => {
  const db = await fixture();
  const first = await submittedAt(db, WAITING);

  await db.query("update public.profiles set verified_status = 'rejected' where id = $1", [WAITING]);
  await db.query("update public.profiles set verified_status = 'pending' where id = $1", [WAITING]);

  const second = await submittedAt(db, WAITING);
  assert.notDeepEqual(second, first, "the new attempt is not charged the old wait");
  assert.equal(await waitHours(db, WAITING), 0);
});

test("a profile created straight into pending is stamped on insert", async () => {
  const db = await fixture();
  await db.query(
    "insert into public.profiles(id, email, verified_status) values($1, 'direct@gmail.com', 'pending')",
    [FRESH],
  );
  assert.equal(await waitHours(db, FRESH), 0);
});

test("overdue is answerable from the setting, without hardcoding 24 anywhere else", async () => {
  const db = await fixture();
  const { rows } = await db.query(`
    select p.id,
           extract(epoch from (now() - p.verification_submitted_at)) / 3600
             > s.verification_review_target_hours as overdue
      from public.profiles p
      cross join public.platform_settings s
     where p.verified_status = 'pending' and s.id = 'default'
  `);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].overdue, true, "three days against a 24-hour target");

  await db.query(
    "update public.platform_settings set verification_review_target_hours = 168 where id = 'default'",
  );
  const { rows: relaxed } = await db.query(`
    select extract(epoch from (now() - p.verification_submitted_at)) / 3600
             > s.verification_review_target_hours as overdue
      from public.profiles p
      cross join public.platform_settings s
     where p.verified_status = 'pending' and s.id = 'default'
  `);
  assert.equal(relaxed[0].overdue, false, "raising the target changes the answer, with no deploy");
});

test("the target cannot be set to something meaningless", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query("update public.platform_settings set verification_review_target_hours = 0 where id = 'default'"),
    /verification_review_target_hours_check/,
  );
  await assert.rejects(
    db.query("update public.platform_settings set verification_review_target_hours = 5000 where id = 'default'"),
    /verification_review_target_hours_check/,
  );
});

test("applying the chapter twice changes nothing", async () => {
  const db = await fixture();
  const before = await submittedAt(db, WAITING);
  await db.exec(await chapter("-- CHAPTER 104 - A review that is late is visible as late"));
  assert.deepEqual(await submittedAt(db, WAITING), before, "the backfill does not run again");
});
