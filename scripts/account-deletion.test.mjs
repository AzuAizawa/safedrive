// CHAPTER 96 - a member can delete their own account, with time to change their mind.
//
// Deleting an account erases a person, so every guard is proved against real
// PostgreSQL (PGlite). The fixture builds only what the chapter touches and
// applies the chapter verbatim out of the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SUPER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const CAR = "55555555-5555-4555-8555-555555555555";

const PRIVACY_62 =
  "<p><strong>6.2 Requests:</strong> An account-closure or deletion request starts an identity and scope review; it is not a promise of instant blanket deletion. Approved deletion may use erasure, blocking, restricted archival, or anonymization depending on the record and applicable obligation.</p>";
const PRIVACY_CONTACT =
  "<p>For a privacy question or security concern, use the contact below. Registered users may also submit and track an access, correction, restriction, anonymization, or deletion request from the Data Requests page. SafeDrive's formal DPO designation remains a launch requirement.</p>";
const TERMS_9 =
  "<p>The browser applies a sign-in throttle. SafeDrive may restrict or terminate an account after authorized review of fraud, safety, security, or repeated Terms violations, with reasons and audit evidence where appropriate.</p>";

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create schema storage;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.admin_can(text) returns boolean language sql stable as
      $$ select coalesce(current_setting('test.admin_can', true), 'false') = 'true' $$;
    create function public.is_admin() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.is_admin', true), 'false') = 'true' $$;
    create function public.is_super_admin() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.is_super_admin', true), 'false') = 'true' $$;
    create function public.is_trusted_server_context() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.server', true), 'false') = 'true' $$;
    create table storage.objects(bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;

    create table public.platform_settings(id text primary key, dormant_account_days integer default 365);
    insert into public.platform_settings(id) values ('default');

    create table public.profiles(
      id uuid primary key,
      email text unique not null,
      full_name text, first_name text, middle_name text, last_name text,
      phone text, secondary_phone text, address text, birthday date,
      driver_license text, national_id text, secondary_id_type text,
      avatar_url text, gender text,
      payout_method text, payout_account_name text, payout_account_number text,
      emergency_contact_number text,
      role text default 'user',
      verified_status text default 'verified',
      rejection_reason text,
      login_blocked_until timestamptz, login_block_reason text,
      suspended_at timestamptz, suspension_reason text, suspended_by uuid,
      license_expiry date, license_transmission text, license_expiry_notified_at timestamptz,
      license_update_pending boolean default false,
      is_lister boolean default false,
      admin_disabled_at timestamptz,
      deleted_at timestamptz,
      updated_at timestamptz default now());

    create table public.cars(
      id uuid primary key, owner_id uuid, status text default 'approved',
      contact_number text, additional_info text, updated_at timestamptz);
    create table public.bookings(
      id uuid primary key default gen_random_uuid(),
      car_id uuid, renter_id uuid, owner_id uuid, status text,
      renter_arrival_latitude numeric, renter_arrival_longitude numeric,
      renter_arrival_accuracy_meters numeric, renter_arrival_location_captured_at timestamptz,
      renter_arrival_photo_url text,
      lister_arrival_latitude numeric, lister_arrival_longitude numeric,
      lister_arrival_accuracy_meters numeric, lister_arrival_location_captured_at timestamptz,
      lister_arrival_photo_url text);
    create table public.payments(
      id uuid primary key default gen_random_uuid(),
      booking_id uuid, payment_type text, status text);
    create table public.support_tickets(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, participant_user_id uuid, booking_id uuid, status text default 'open');
    create table public.verification_images(user_id uuid);
    create table public.trip_condition_reports(
      reporter_id uuid, latitude numeric, longitude numeric,
      location_accuracy_meters numeric, damage_notes text);
    create table public.booking_reviews(reviewer_id uuid, reviewee_id uuid, feedback text);
    create table public.ticket_messages(sender_id uuid);
    create table public.guest_inquiries(submitted_by_user_id uuid);
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, title text, message text, type text, link text,
      created_at timestamptz default clock_timestamp());
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb,
      created_at timestamptz default clock_timestamp());
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
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text, version_number integer, content_html text, status text);

    insert into public.profiles(id, email, full_name, role, phone, payout_account_number) values
      ('${MEMBER}', 'member@example.com', 'A Member', 'user', '09170000000', '09171234567'),
      ('${OTHER}', 'other@example.com', 'Another Member', 'user', null, null),
      ('${SUPER}', 'super@example.com', 'Super Admin', 'super_admin', null, null),
      ('${ADMIN}', 'admin@example.com', 'Plain Admin', 'admin', null, null);
    insert into public.cars(id, owner_id) values ('${CAR}', '${MEMBER}');
  `);
  await db.query(
    `insert into public.legal_document_versions(document_key, version_number, content_html, status) values
       ('privacy_policy', 1, $1, 'published'),
       ('terms_of_service', 4, $2, 'published')`,
    [`<h2>6</h2>${PRIVACY_62}<h2>9</h2>${PRIVACY_CONTACT}`, `<h2>9</h2>${TERMS_9}`],
  );

  const source = await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  );
  chapter ??= source
    .split("-- CHAPTER 96 - A member can delete their own account")[1]
    ?.split("-- Read-only verification")[0];
  const chapter97 = source
    .split("-- CHAPTER 97 - A suspension during the grace period")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 96 exists in the master file");
  assert.ok(chapter97, "CHAPTER 97 exists in the master file");
  // Applied in order, as they are pasted.
  await db.exec("-- CHAPTER 96\n" + chapter.slice(chapter.indexOf("\n")));
  await db.exec("-- CHAPTER 97\n" + chapter97.slice(chapter97.indexOf("\n")));
  await asServer(db);
  return db;
}

async function setContext(db, { uid = "", server = false, admin = false, superAdmin = false } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.query("select set_config('test.server', $1, false)", [String(server)]);
  await db.query("select set_config('test.is_admin', $1, false)", [String(admin || superAdmin)]);
  await db.query("select set_config('test.is_super_admin', $1, false)", [String(superAdmin)]);
}
const asServer = (db) => setContext(db, { server: true });
const asMember = (db, uid = MEMBER) => setContext(db, { uid });

const schedule = (db, uid = MEMBER, reason = null) =>
  db.query("select public.schedule_account_deletion($1, $2) as result", [uid, reason]);
const cancel = (db, uid = MEMBER) =>
  db.query("select public.cancel_account_deletion($1) as result", [uid]);
const runDue = (db) => db.query("select * from public.run_due_account_deletions()");

const profileOf = async (db, id = MEMBER) =>
  (await db.query("select * from public.profiles where id = $1", [id])).rows[0];
const requestOf = async (db, id) =>
  (await db.query("select * from public.data_retention_requests where id = $1", [id])).rows[0];
const makeDue = (db, id = MEMBER) =>
  db.query("update public.profiles set deletion_scheduled_for = now() - interval '1 minute' where id = $1", [id]);
const addBooking = (db, status, { renter = OTHER, owner = MEMBER } = {}) =>
  db
    .query(
      "insert into public.bookings(car_id, renter_id, owner_id, status) values($1, $2, $3, $4) returning id",
      [CAR, renter, owner, status],
    )
    .then((r) => r.rows[0].id);

test("the chapter adds the setting and columns, deletes nobody, and republishes the legal text once", async () => {
  const db = await fixture();
  const { rows: setting } = await db.query("select account_deletion_grace_days from public.platform_settings");
  assert.equal(setting[0].account_deletion_grace_days, 30);

  const { rows: deleted } = await db.query(
    "select count(*)::int as n from public.profiles where deleted_at is not null or deletion_scheduled_for is not null",
  );
  assert.equal(deleted[0].n, 0);

  const published = async () =>
    (await db.query(
      "select document_key, version_number, content_html from public.legal_document_versions where status = 'published' order by document_key",
    )).rows;
  let docs = await published();
  assert.deepEqual(docs.map((d) => `${d.document_key} v${d.version_number}`), ["privacy_policy v2", "terms_of_service v5"]);
  assert.match(docs[0].content_html, /6\.2 Deleting your account:/);
  assert.ok(!docs[0].content_html.includes("it is not a promise of instant blanket deletion. Approved"));
  assert.match(docs[0].content_html, /can delete their own account from their account settings\./);
  assert.match(docs[1].content_html, /You may delete your own account from your account settings/);

  // Running the chapter again changes nothing.
  await db.exec("-- CHAPTER 96\n" + chapter.slice(chapter.indexOf("\n")));
  docs = await published();
  assert.deepEqual(docs.map((d) => `${d.document_key} v${d.version_number}`), ["privacy_policy v2", "terms_of_service v5"]);
});

test("the grace period is a platform setting of 7 to 90 whole days", async () => {
  const db = await fixture();
  const validate = (value) =>
    db.query("select public.validate_platform_setting_change($1::jsonb)", [
      JSON.stringify({ account_deletion_grace_days: value }),
    ]);
  await validate(7);
  await validate(90);
  for (const bad of [6, 91, 14.5]) {
    await assert.rejects(validate(bad), /account_deletion_grace_days must be a whole number 7-90/);
  }
  // An existing key still validates exactly as before.
  await db.query("select public.validate_platform_setting_change('{\"min_booking_notice_hours\": 12}'::jsonb)");
});

test("a member schedules deletion: hidden for the grace period, recorded as a request", async () => {
  const db = await fixture();
  await db.query("update public.platform_settings set account_deletion_grace_days = 14");

  const { rows } = await schedule(db, MEMBER, "Moving abroad");
  const result = rows[0].result;
  assert.equal(result.grace_days, 14);

  const profile = await profileOf(db);
  assert.ok(profile.deletion_requested_at);
  const days = (new Date(profile.deletion_scheduled_for) - new Date(profile.deletion_requested_at)) / 86_400_000;
  assert.ok(Math.abs(days - 14) < 0.01, "scheduled grace days ahead");
  assert.equal(profile.deleted_at, null, "nothing is erased yet");
  assert.equal(profile.email, "member@example.com");

  const request = await requestOf(db, profile.deletion_request_id);
  assert.equal(request.request_type, "deletion");
  assert.equal(request.status, "approved");
  assert.match(request.request_details, /Self-service account deletion.*Moving abroad/);
  assert.equal(new Date(request.due_at).getTime(), new Date(profile.deletion_scheduled_for).getTime());

  const { rows: notes } = await db.query("select title from public.notifications where user_id = $1", [MEMBER]);
  assert.deepEqual(notes.map((n) => n.title), ["Your account is scheduled for deletion"]);
  const { rows: audit } = await db.query("select action from public.audit_log where entity_id = $1", [MEMBER]);
  assert.deepEqual(audit.map((a) => a.action), ["account_deletion_scheduled"]);
});

test("scheduling is refused while money, a trip or a booking case is still open", async () => {
  const cases = [
    ["a booking not finished", async (db) => addBooking(db, "confirmed", { renter: MEMBER, owner: OTHER }), /booking that has not finished/],
    ["a pending booking request as owner", async (db) => addBooking(db, "pending"), /booking that has not finished/],
    ["a refund not completed", async (db) => {
      const id = await addBooking(db, "cancelled", { renter: MEMBER, owner: OTHER });
      await db.query("insert into public.payments(booking_id, payment_type, status) values($1, 'refund', 'pending')", [id]);
    }, /refund to you has not been completed/],
    ["a failed payout", async (db) => {
      const id = await addBooking(db, "cancelled");
      await db.query("insert into public.payments(booking_id, payment_type, status) values($1, 'payout', 'failed')", [id]);
    }, /payout to you has not been completed/],
    ["a completed trip not yet paid out", async (db) => addBooking(db, "completed"), /payout to you has not been completed/],
    ["an open booking support case", async (db) => {
      const id = await addBooking(db, "completed", { renter: MEMBER, owner: OTHER });
      await db.query("insert into public.support_tickets(user_id, booking_id, status) values($1, $2, 'in_progress')", [OTHER, id]);
      await db.query("update public.support_tickets set participant_user_id = $1", [MEMBER]);
    }, /support case about one of your bookings/],
  ];
  for (const [label, arrange, message] of cases) {
    const db = await fixture();
    await arrange(db);
    await assert.rejects(schedule(db), message, label);
    const profile = await profileOf(db);
    assert.equal(profile.deletion_scheduled_for, null, `${label}: not scheduled`);
    const { rows } = await db.query("select count(*)::int as n from public.data_retention_requests");
    assert.equal(rows[0].n, 0, `${label}: no request filed`);
  }
});

test("settled history does not stand in the way", async () => {
  const db = await fixture();
  const trip = await addBooking(db, "completed");
  await db.query("insert into public.payments(booking_id, payment_type, status) values($1, 'payout', 'completed')", [trip]);
  const refunded = await addBooking(db, "cancelled", { renter: MEMBER, owner: OTHER });
  await db.query("insert into public.payments(booking_id, payment_type, status) values($1, 'refund', 'completed')", [refunded]);
  await db.query("insert into public.support_tickets(user_id, booking_id, status) values($1, $2, 'resolved')", [MEMBER, trip]);
  await db.query("insert into public.support_tickets(user_id, status) values($1, 'open')", [MEMBER]);

  await schedule(db);
  assert.ok((await profileOf(db)).deletion_scheduled_for);
});

test("suspended, staff, already deleted and already scheduled accounts are refused", async () => {
  const db = await fixture();
  await db.query("update public.profiles set suspended_at = now() where id = $1", [OTHER]);
  await assert.rejects(schedule(db, OTHER), /suspended account cannot be deleted from settings/);
  await assert.rejects(schedule(db, SUPER), /Staff accounts are closed through admin management/);

  await schedule(db);
  await assert.rejects(schedule(db), /already scheduled for deletion on/);
});

test("only the server can schedule, cancel or run deletions", async () => {
  const db = await fixture();
  await asMember(db);
  await assert.rejects(schedule(db), /requested from account settings/);
  await assert.rejects(cancel(db), /done by signing in/);
  await assert.rejects(runDue(db), /Only the scheduled deletion job/);
});

test("a member cannot move, erase or fake their own schedule, and a plain admin cannot either", async () => {
  const db = await fixture();
  await schedule(db);

  await asMember(db);
  for (const statement of [
    "update public.profiles set deletion_scheduled_for = now() + interval '1 year' where id = $1",
    "update public.profiles set deletion_scheduled_for = null, deletion_request_id = null where id = $1",
    "update public.profiles set login_closed_at = now() where id = $1",
  ]) {
    await assert.rejects(db.query(statement, [MEMBER]), /only through account settings and sign-in/);
  }
  // An ordinary edit they are allowed to make still works.
  await db.query("update public.profiles set phone = '09990000000' where id = $1", [MEMBER]);

  await setContext(db, { uid: ADMIN, admin: true });
  await assert.rejects(
    db.query("update public.profiles set deletion_scheduled_for = null where id = $1", [MEMBER]),
    /Only a super admin can disable or delete an account/,
  );
  assert.ok((await profileOf(db)).deletion_scheduled_for, "still scheduled");
});

test("keeping the account cancels the schedule and closes the request", async () => {
  const db = await fixture();
  await schedule(db);
  const requestId = (await profileOf(db)).deletion_request_id;

  await cancel(db);
  const profile = await profileOf(db);
  assert.equal(profile.deletion_scheduled_for, null);
  assert.equal(profile.deletion_request_id, null);
  const request = await requestOf(db, requestId);
  assert.equal(request.status, "cancelled");
  assert.match(request.decision_reason, /kept the account/);

  await assert.rejects(cancel(db), /not scheduled for deletion/);
  // And it can be asked for again later.
  await schedule(db);
});

test("the daily run leaves a schedule alone until its date", async () => {
  const db = await fixture();
  await schedule(db);
  const { rows } = await runDue(db);
  assert.equal(rows.length, 0);
  assert.equal((await profileOf(db)).deleted_at, null);
});

test("on its date the account is anonymized, the request executed, and the old address returned for the notice", async () => {
  const db = await fixture();
  const trip = await addBooking(db, "completed");
  await db.query("insert into public.payments(booking_id, payment_type, status) values($1, 'payout', 'completed')", [trip]);
  await schedule(db);
  const requestId = (await profileOf(db)).deletion_request_id;
  await makeDue(db);

  const { rows } = await runDue(db);
  assert.deepEqual(rows.map((r) => [r.account_id, r.outcome, r.notice_email, r.notice_name]), [
    [MEMBER, "deleted", "member@example.com", "A Member"],
  ]);

  const profile = await profileOf(db);
  assert.ok(profile.deleted_at);
  assert.equal(profile.email, `deleted+${MEMBER.slice(0, 8)}@safedrive.invalid`, "the address is free again");
  assert.equal(profile.phone, null);
  assert.equal(profile.payout_account_number, null);
  assert.equal(profile.deletion_scheduled_for, null);
  assert.equal(profile.login_closed_at, null, "the login is closed by the server afterwards");

  const { rows: booking } = await db.query("select owner_id, status from public.bookings where id = $1", [trip]);
  assert.equal(booking[0].owner_id, MEMBER, "the booking record stays");

  const request = await requestOf(db, requestId);
  assert.equal(request.status, "executed");
  assert.ok(request.completed_at);
  assert.equal(request.requester_email, "redacted@safedrive.invalid");

  assert.equal((await runDue(db)).rows.length, 0, "nothing runs twice");
});

test("if something opened in the meantime, it waits on legal hold, tells super admins once, and runs when settled", async () => {
  const db = await fixture();
  await schedule(db);
  const requestId = (await profileOf(db)).deletion_request_id;
  const ticket = await db.query(
    "insert into public.support_tickets(user_id, booking_id, status) values($1, $2, 'open') returning id",
    [OTHER, await addBooking(db, "cancelled", { renter: MEMBER, owner: OTHER })],
  );
  await db.query("update public.support_tickets set participant_user_id = $1", [MEMBER]);
  await makeDue(db);

  let { rows } = await runDue(db);
  assert.deepEqual(rows.map((r) => r.outcome), ["waiting"]);
  assert.match(rows[0].detail, /support case/);
  assert.equal((await profileOf(db)).deleted_at, null);
  assert.equal((await requestOf(db, requestId)).status, "legal_hold");

  await runDue(db);
  const { rows: alerts } = await db.query(
    "select count(*)::int as n from public.notifications where user_id = $1 and title = 'Scheduled account deletion is waiting'",
    [SUPER],
  );
  assert.equal(alerts[0].n, 1, "super admins are told once, not every day");

  // While it waits, the member can still keep the account...
  // ...or the case closes and the next run carries it out.
  await db.query("update public.support_tickets set status = 'resolved' where id = $1", [ticket.rows[0].id]);
  ({ rows } = await runDue(db));
  assert.deepEqual(rows.map((r) => r.outcome), ["deleted"]);
  const request = await requestOf(db, requestId);
  assert.equal(request.status, "executed");
  assert.equal(request.legal_hold_reason, null);
});

test("a member can keep an account whose deletion is waiting", async () => {
  const db = await fixture();
  await schedule(db);
  const requestId = (await profileOf(db)).deletion_request_id;
  await addBooking(db, "pending", { renter: OTHER, owner: MEMBER });
  await makeDue(db);
  await runDue(db);
  assert.equal((await requestOf(db, requestId)).status, "legal_hold");

  await cancel(db);
  assert.equal((await requestOf(db, requestId)).status, "cancelled");
  assert.equal((await profileOf(db)).deletion_scheduled_for, null);
});

test("a request a super admin denied drops the schedule instead of deleting", async () => {
  const db = await fixture();
  await schedule(db);
  const requestId = (await profileOf(db)).deletion_request_id;
  await db.query("update public.data_retention_requests set status = 'denied' where id = $1", [requestId]);
  await makeDue(db);

  const { rows } = await runDue(db);
  assert.deepEqual(rows.map((r) => r.outcome), ["cleared"]);
  const profile = await profileOf(db);
  assert.equal(profile.deleted_at, null);
  assert.equal(profile.deletion_scheduled_for, null);
});

test("anonymize_user runs for a super admin or the server, and for no one else", async () => {
  const db = await fixture();
  await asMember(db);
  await assert.rejects(
    db.query("select public.anonymize_user($1, null)", [OTHER]),
    /Only a super admin can anonymize a user/,
  );

  await setContext(db, { uid: SUPER, superAdmin: true });
  await db.query("select public.anonymize_user($1, null)", [OTHER]);
  assert.ok((await profileOf(db, OTHER)).deleted_at);

  await asServer(db);
  await db.query("select public.anonymize_user($1, null)", [MEMBER]);
  assert.ok((await profileOf(db, MEMBER)).deleted_at);
});

// CHAPTER 97.
test("an account suspended during its grace period waits for review instead of being erased", async () => {
  const db = await fixture();
  await schedule(db);
  const requestId = (await profileOf(db)).deletion_request_id;
  await db.query(
    "update public.profiles set suspended_at = now(), suspension_reason = 'Fraud report under review' where id = $1",
    [MEMBER],
  );
  await makeDue(db);

  let { rows } = await runDue(db);
  assert.deepEqual(rows.map((r) => r.outcome), ["waiting"]);
  assert.match(rows[0].detail, /suspended/);
  assert.equal((await profileOf(db)).deleted_at, null, "the identity under review is kept");
  assert.equal((await requestOf(db, requestId)).status, "legal_hold");

  // Once the suspension is lifted, the next run carries the deletion out.
  await db.query(
    "update public.profiles set suspended_at = null, suspension_reason = null where id = $1",
    [MEMBER],
  );
  ({ rows } = await runDue(db));
  assert.deepEqual(rows.map((r) => r.outcome), ["deleted"]);
});
