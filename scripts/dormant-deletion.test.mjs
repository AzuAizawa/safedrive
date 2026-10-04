// CHAPTER 121 - a dormant account is deleted the way a member deletes one.
//
// Proved against real PostgreSQL (PGlite) with the chapter applied verbatim
// from the master file: an account nobody signed in to past the limit is
// scheduled for deletion after the grace period and its owner is notified;
// active, suspended, staff, blocked and already-scheduled accounts are left
// alone; a second run adds nothing; CHAPTER 58's unanswered requests are
// closed; and the Privacy Policy is republished once.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const DORMANT = "11111111-1111-4111-8111-111111111111";
const ACTIVE = "22222222-2222-4222-8222-222222222222";
const SUSPENDED = "33333333-3333-4333-8333-333333333333";
const BUSY = "44444444-4444-4444-8444-444444444444";
const STAFF = "55555555-5555-4555-8555-555555555555";
const SCHEDULED = "66666666-6666-4666-8666-666666666666";
const OLD_FLAG = "77777777-7777-4777-8777-777777777777";

const OLD_62 =
  "<p><strong>6.2 Deleting your account:</strong> ... and a suspended account is reviewed through a privacy request instead. Other deletion or erasure requests start an identity and scope review; approved deletion may use erasure, blocking, restricted archival, or anonymization depending on the record and applicable obligation.</p>";
const OLD_CONTACT =
  "<p>For a privacy question or security concern, use the contact below. Registered users may also submit and track an access, correction, restriction, anonymization, or deletion request from the Data Requests page, and can delete their own account from their account settings. SafeDrive's formal DPO designation remains a launch requirement.</p>";

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
      id text primary key, dormant_account_days integer, account_deletion_grace_days integer);
    insert into public.platform_settings values ('default', 365, 30);

    create table public.profiles(
      id uuid primary key, email text, full_name text, role text default 'user',
      deleted_at timestamptz, suspended_at timestamptz,
      deletion_requested_at timestamptz, deletion_scheduled_for timestamptz, deletion_request_id uuid,
      active_session_started_at timestamptz, created_at timestamptz default now(),
      updated_at timestamptz default now());
    create table public.bookings(renter_id uuid, owner_id uuid, status text);
    -- CHAPTER 96's guard, reduced to the one case this test needs.
    create function public.account_deletion_blockers(uuid) returns text[] language sql stable as $$
      select case when exists (select 1 from public.bookings b
        where (b.renter_id = $1 or b.owner_id = $1) and b.status = 'active')
        then array['You have a booking that has not finished.'] else '{}'::text[] end $$;
    create table public.data_retention_requests (
      id uuid primary key default gen_random_uuid(),
      subject_user_id uuid,
      requester_email text not null,
      request_type text not null check (request_type in ('access', 'correction', 'deletion', 'anonymization', 'restriction')),
      status text not null default 'submitted'
        check (status in ('submitted', 'under_review', 'identity_check', 'approved', 'executed', 'denied', 'cancelled', 'legal_hold')),
      request_details text not null,
      decision_reason text, legal_hold_reason text,
      due_at timestamptz, completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now());
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, title text, message text, type text, link text);
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text, version_number integer, content_html text, status text);

    insert into public.profiles(id, email, full_name, role, active_session_started_at, suspended_at, deletion_scheduled_for) values
      ('${DORMANT}', 'dormant@example.com', 'Dormant Member', 'user', now() - interval '400 days', null, null),
      ('${ACTIVE}', 'active@example.com', 'Active Member', 'user', now() - interval '10 days', null, null),
      ('${SUSPENDED}', 'suspended@example.com', null, 'user', now() - interval '400 days', now(), null),
      ('${BUSY}', 'busy@example.com', null, 'user', now() - interval '400 days', null, null),
      ('${STAFF}', 'staff@example.com', null, 'admin', now() - interval '400 days', null, null),
      ('${SCHEDULED}', 'scheduled@example.com', null, 'user', now() - interval '400 days', null, now() + interval '5 days'),
      ('${OLD_FLAG}', 'old@example.com', null, 'user', now() - interval '400 days', null, null);
    insert into public.bookings values ('${BUSY}', null, 'active');
    insert into public.data_retention_requests(subject_user_id, requester_email, request_type, status, request_details)
      values ('${OLD_FLAG}', 'old@example.com', 'deletion', 'submitted',
        'System-flagged: no login activity for 400 days (threshold: 365 days).');
  `);
  await db.query(
    `insert into public.legal_document_versions(document_key, version_number, content_html, status)
     values ('privacy_policy', 4, $1, 'published')`,
    [OLD_62 + OLD_CONTACT],
  );
  await db.exec(await chapter("-- CHAPTER 121 - A dormant account is deleted"));
  return db;
}

const flag = (db) => db.query("select * from public.flag_dormant_accounts() order by email");

test("an account past the limit is scheduled for deletion after the grace period, and told", async () => {
  const db = await fixture();
  const { rows } = await flag(db);
  assert.deepEqual(rows.map((r) => r.email), ["dormant@example.com", "old@example.com"]);
  const dormant = rows[0];
  assert.equal(dormant.idle_days, 400);
  const days = (new Date(dormant.scheduled_for) - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days <= 30, `scheduled ${days} days ahead`);

  const profile = (await db.query(`select * from public.profiles where id = $1`, [DORMANT])).rows[0];
  assert.equal(profile.deletion_request_id, dormant.request_id);
  assert.ok(profile.deletion_scheduled_for);

  const request = (await db.query(`select * from public.data_retention_requests where id = $1`, [dormant.request_id])).rows[0];
  assert.equal(request.status, "approved");
  assert.match(request.request_details, /^Dormant account: no sign-in for 400 days \(limit: 365 days\)\.$/);

  const notice = (await db.query(`select title, message, link from public.notifications where user_id = $1`, [DORMANT])).rows;
  assert.equal(notice.length, 1);
  assert.equal(notice[0].title, "Your account is scheduled for deletion");
  assert.match(notice[0].message, /not signed in to SafeDrive for 400 days/);
  assert.match(notice[0].message, /choose to keep your account/);
  assert.equal(notice[0].link, "/verify");

  const audit = (await db.query(`select action from public.audit_log where entity_id = $1`, [DORMANT])).rows;
  assert.deepEqual(audit.map((a) => a.action), ["dormant_account_deletion_scheduled"]);
});

test("active, suspended, staff, busy and already scheduled accounts are left alone; a rerun adds nothing", async () => {
  const db = await fixture();
  await flag(db);
  for (const id of [ACTIVE, SUSPENDED, BUSY, STAFF]) {
    const p = (await db.query(`select deletion_scheduled_for from public.profiles where id = $1`, [id])).rows[0];
    assert.equal(p.deletion_scheduled_for, null, id);
  }
  const before = (await db.query(`select count(*)::int as n from public.data_retention_requests`)).rows[0].n;
  assert.equal((await flag(db)).rows.length, 0);
  const after = (await db.query(`select count(*)::int as n from public.data_retention_requests`)).rows[0].n;
  assert.equal(after, before);
});

test("requests CHAPTER 58 filed and nobody answered are closed", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select status, decision_reason from public.data_retention_requests where request_details like 'System-flagged%'`,
  );
  assert.equal(rows[0].status, "cancelled");
  assert.match(rows[0].decision_reason, /Closed by CHAPTER 121/);
});

test("the Privacy Policy is republished once, pointing at Your Data and a support ticket", async () => {
  const db = await fixture();
  const docs = (await db.query(
    `select version_number, status, content_html from public.legal_document_versions order by version_number`,
  )).rows;
  assert.deepEqual(docs.map((d) => [d.version_number, d.status]), [[4, "superseded"], [5, "published"]]);
  const html = docs[1].content_html;
  assert.match(html, /reviewed through a support ticket instead/);
  assert.match(html, /currently 365 by default/);
  assert.match(html, /download a copy of their own data from the Your Data page/);
  assert.match(html, /support ticket tagged Privacy \/ Data/);
  assert.doesNotMatch(html, /Data Requests page/);

  await db.exec(await chapter("-- CHAPTER 121 - A dormant account is deleted"));
  const count = (await db.query(`select count(*)::int as n from public.legal_document_versions`)).rows[0].n;
  assert.equal(count, 2, "running the chapter again publishes nothing new");
});
