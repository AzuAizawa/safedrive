// CHAPTER 131 - a car can be reported, disabled, and cleared to rent again
// (panel feedback #1, #2 and the clearance suggestion).
//
// The chapter is applied verbatim to real PostgreSQL (PGlite) on top of
// stand-ins for the tables and helpers it builds on, then driven the way
// api/vehicle-moderation.ts, the lister's renewal page and the admin pages do.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const HEADING = "-- CHAPTER 131 - A car can be reported, disabled, and cleared to rent again";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const LISTER = "22222222-2222-4222-8222-222222222222";
const RENTER = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";
const CAR = "55555555-5555-4555-8555-555555555555";
const OTHER_CAR = "66666666-6666-4666-8666-666666666666";
const BOOKING = "77777777-7777-4777-8777-777777777777";

const TERMS =
  "<h2>7. Insurance and Liability</h2>\n<p><strong>7.5 Lost, Missing, or Stolen Vehicles:</strong> ...</p>\n\n<h2>8. User Conduct</h2>\n<p>Users agree...</p>";

const chapterText = async () => {
  const master = await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  );
  const body = master.split(HEADING)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, "CHAPTER 131 exists in the master file");
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema storage;
    create table storage.objects(bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql immutable
      as $$ select string_to_array(name, '/') $$;

    create table public.profiles(
      id uuid primary key, role text not null default 'user', deleted_at timestamptz);
    insert into public.profiles(id, role) values
      ('${ADMIN}', 'admin'), ('${LISTER}', 'user'), ('${RENTER}', 'user'), ('${OUTSIDER}', 'user');
    create function public.is_admin() returns boolean language sql stable
      as $$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','super_admin')) $$;
    create function public.admin_can(p_key text) returns boolean language sql stable
      as $$ select public.is_admin() $$;
    create function public.admin_can_for(p_uid uuid, p_key text) returns boolean language sql stable
      as $$ select exists(select 1 from public.profiles where id = p_uid and role in ('admin','super_admin')) $$;

    create table public.platform_settings(id text primary key, slots integer not null default 3);
    insert into public.platform_settings values ('default', 3);
    create function public.vehicle_slot_allowance(p_owner uuid) returns integer language sql stable
      as $$ select slots from public.platform_settings where id = 'default' $$;

    create table public.cars(
      id uuid primary key,
      owner_id uuid not null,
      plate_number text not null,
      status text default 'pending'
        check (status in ('pending', 'approved', 'rejected', 'active', 'inactive', 'renewal_required')),
      deleted_at timestamptz,
      removal_scheduled_at timestamptz,
      compliance_previously_approved boolean not null default false,
      price_per_day numeric,
      updated_at timestamptz default now(),
      created_at timestamptz default now());
    insert into public.cars(id, owner_id, plate_number, status, compliance_previously_approved) values
      ('${CAR}', '${LISTER}', 'ABC 1234', 'approved', true),
      ('${OTHER_CAR}', '${LISTER}', 'XYZ 9876', 'approved', true);
    create function public.vehicle_label(p_car_id uuid) returns text language sql stable
      as $$ select 'Toyota Vios (' || plate_number || ')' from public.cars where id = p_car_id $$;

    -- Stand-in for the real compliance refresh: approved when the test says
    -- the papers still cover today, renewal_required when they lapsed.
    create table public.test_compliance(car_id uuid primary key, ok boolean not null);
    create function public.refresh_vehicle_compliance(p_car_id uuid) returns void language plpgsql as $$
    begin
      update public.cars set status = case
        when status in ('approved','active','renewal_required') then
          case when coalesce((select ok from public.test_compliance where car_id = p_car_id), true)
               then 'approved' else 'renewal_required' end
        else status end
      where id = p_car_id;
    end $$;

    create table public.bookings(id uuid primary key, car_id uuid, renter_id uuid, owner_id uuid, status text);
    insert into public.bookings values ('${BOOKING}', '${CAR}', '${RENTER}', '${LISTER}', 'active');
    create table public.booking_extensions(
      id uuid primary key default gen_random_uuid(), booking_id uuid, renter_id uuid,
      status text not null, owner_decision_note text);
    create table public.notifications(
      id bigserial primary key, user_id uuid, title text, message text, type text, link text);
    create table public.audit_log(
      id bigserial primary key, user_id uuid, action text not null,
      entity_type text, entity_id text, details jsonb);
    create table public.trip_condition_photos(storage_path text);
    create table public.image_authenticity_checks(
      id bigserial primary key,
      subject_kind text constraint image_authenticity_checks_subject_kind_check
        check (subject_kind in ('identity', 'vehicle_photo', 'vehicle_document')));
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text, version_number integer, content_html text, status text);
  `);
  await db.query(
    "insert into public.legal_document_versions(document_key, version_number, content_html, status) values ('terms_of_service', 8, $1, 'published')",
    [TERMS],
  );
  await db.exec(await chapterText());
  return db;
}

const as = (db, uid) => db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
const car = async (db, id = CAR) =>
  (await db.query("select * from public.cars where id = $1", [id])).rows[0];
const disable = (db, type = "clearance", reason = "Photo of the repaired left door", reportId = null) =>
  db.query("select public.disable_vehicle_for($1, $2, $3, $4, $5) as r", [ADMIN, CAR, type, reason, reportId]);
const fileReport = async (db) =>
  (
    await db.query(
      "insert into public.vehicle_reports(booking_id, car_id, reporter_id, reporter_role, phase, message) values ($1, $2, $3, 'renter', 'pickup', 'Dent on the left rear door') returning id",
      [BOOKING, CAR, RENTER],
    )
  ).rows[0].id;
const upload = (db, path) =>
  db.query("insert into storage.objects(bucket_id, name) values ('vehicle-private-documents', $1)", [path]);
const submitClearance = (db, paths, note = "Door repaired") =>
  db.query("select public.submit_vehicle_clearance($1, $2, $3) as id", [CAR, note, paths]);

test("a report is one per booking side, with a real description, and the roles cannot be swapped", async () => {
  const db = await fixture();
  await fileReport(db);
  await assert.rejects(fileReport(db), /unique|duplicate/i, "one pickup report per renter per booking");
  await assert.rejects(
    db.query(
      "insert into public.vehicle_reports(booking_id, car_id, reporter_id, reporter_role, phase, message) values ($1, $2, $3, 'renter', 'return', 'Something at the return')",
      [BOOKING, CAR, RENTER],
    ),
    /check/i,
    "the renter reports at pickup, the lister at return",
  );
  await assert.rejects(
    db.query(
      "insert into public.vehicle_reports(booking_id, car_id, reporter_id, reporter_role, phase, message) values ($1, $2, $3, 'lister', 'return', 'short')",
      [BOOKING, CAR, LISTER],
    ),
    /check/i,
  );
});

test("disabling for clearance hides the car, keeps what it was, tells the lister, and closes the report", async () => {
  const db = await fixture();
  const reportId = await fileReport(db);
  await db.query(
    "insert into public.booking_extensions(booking_id, renter_id, status) values ($1, $2, 'pending'), ($1, $2, 'rejected')",
    [BOOKING, RENTER],
  );
  const { rows } = await disable(db, "clearance", "Photo of the repaired left door", reportId);
  assert.equal(rows[0].r.owner_id, LISTER);
  assert.match(rows[0].r.message, /What to submit: Photo of the repaired left door/);

  const after = await car(db);
  assert.equal(after.status, "disabled");
  assert.equal(after.status_before_disable, "approved");
  assert.equal(after.disabled_type, "clearance");
  assert.equal(after.disabled_by, ADMIN);
  assert.equal(after.disabled_report_id, reportId);

  const report = (await db.query("select status, admin_note from public.vehicle_reports where id = $1", [reportId])).rows[0];
  assert.equal(report.status, "reviewed");
  const extensions = (await db.query("select status from public.booking_extensions order by status")).rows;
  assert.deepEqual(extensions.map((row) => row.status), ["cancelled", "rejected"], "the open extension is cancelled");
  const notices = (await db.query("select user_id, title from public.notifications order by id")).rows;
  assert.deepEqual(
    notices.map((row) => [row.user_id, row.title]),
    [
      [RENTER, "Extension cancelled"],
      [LISTER, "Your vehicle was disabled - clearance needed"],
    ],
  );
  await assert.rejects(disable(db), /already disabled/);
});

test("only a vehicle reviewer disables, with a real reason, an approved car", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query("select public.disable_vehicle_for($1, $2, 'other', 'A long enough reason', null)", [LISTER, CAR]),
    /vehicles\.review permission/,
  );
  await assert.rejects(disable(db, "other", "short"), /at least 10 characters/);
  await assert.rejects(disable(db, "maybe"), /clearance or is disabled for another reason/);
  await db.query("update public.cars set status = 'pending' where id = $1", [CAR]);
  await assert.rejects(disable(db), /Only an approved vehicle/);
});

test("nobody slips a car in or out of disabled on the side", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query("update public.cars set status = 'disabled' where id = $1", [CAR]),
    /disabled only from Vehicle Management/,
  );
  await disable(db, "other", "Repeated damage under evaluation");
  await assert.rejects(
    db.query("update public.cars set status = 'approved' where id = $1", [CAR]),
    /disabled by SafeDrive/,
    "an admin approving it from another screen is refused",
  );
  await db.query("update public.cars set status = 'inactive' where id = $1", [CAR]);
  assert.equal((await car(db)).status, "inactive", "removal parks it inactive, which is allowed");
});

test("a lister cannot edit a disabled car or touch the disable fields", async () => {
  const db = await fixture();
  // As on Supabase: a member's request runs as `authenticated`, which can call auth.uid().
  await db.exec(`
    grant all on all tables in schema public to authenticated;
    grant usage on schema auth to authenticated;
    grant execute on all functions in schema auth to authenticated;
  `);
  await as(db, LISTER);
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("update public.cars set disabled_reason = 'nothing' where id = $1", [CAR]),
    /Only SafeDrive can disable or enable/,
  );
  await db.exec("reset role");
  await disable(db, "other", "Repeated damage under evaluation");
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("update public.cars set price_per_day = 999 where id = $1", [CAR]),
    /cannot be edited until it is enabled/,
  );
  await db.exec("reset role");
});

test("enabling brings a car back through the compliance refresh, as a renewal does", async () => {
  const db = await fixture();
  await disable(db, "other", "Repeated damage under evaluation");
  const { rows } = await db.query("select public.enable_vehicle_for($1, $2) as r", [ADMIN, CAR]);
  assert.equal(rows[0].r.status, "approved");
  const after = await car(db);
  assert.equal(after.status, "approved");
  assert.equal(after.disabled_type, null);
  assert.equal(after.status_before_disable, null);
  assert.match(
    (await db.query("select message from public.notifications where title = 'Your vehicle was enabled'")).rows[0].message,
    /back on Browse/,
  );
});

test("papers that lapsed while disabled bring the car back as renewal_required", async () => {
  const db = await fixture();
  await disable(db, "other", "Repeated damage under evaluation");
  await db.query("insert into public.test_compliance values ($1, false)", [CAR]);
  await db.query("select public.enable_vehicle_for($1, $2)", [ADMIN, CAR]);
  assert.equal((await car(db)).status, "renewal_required");
});

test("over the plan's slots the car comes back inactive; a car that was off comes back off", async () => {
  const db = await fixture();
  await disable(db, "other", "Repeated damage under evaluation");
  await db.query("update public.platform_settings set slots = 1");
  await db.query("select public.enable_vehicle_for($1, $2)", [ADMIN, CAR]);
  assert.equal((await car(db)).status, "inactive", "OTHER_CAR already fills the one slot");

  await db.query("update public.platform_settings set slots = 3");
  await db.query("update public.cars set status = 'inactive' where id = $1", [OTHER_CAR]);
  await db.query("select public.disable_vehicle_for($1, $2, 'other', 'Repeated damage under evaluation', null)", [ADMIN, OTHER_CAR]);
  await db.query("select public.enable_vehicle_for($1, $2)", [ADMIN, OTHER_CAR]);
  assert.equal((await car(db, OTHER_CAR)).status, "inactive");
});

test("a car waiting for a clearance is enabled only by approving it", async () => {
  const db = await fixture();
  await disable(db);
  await assert.rejects(
    db.query("select public.enable_vehicle_for($1, $2)", [ADMIN, CAR]),
    /waiting for a clearance/,
  );
});

test("the lister files a clearance: own car, 1-4 photos in the car's clearance folder", async () => {
  const db = await fixture();
  const folder = `${LISTER}/${CAR}/clearance-1`;
  await upload(db, `${folder}/1.jpg`);
  await upload(db, `${folder}/2.png`);
  await upload(db, `${folder}/receipt.pdf`);

  await as(db, LISTER);
  await assert.rejects(submitClearance(db, [`${folder}/1.jpg`]), /does not need a clearance/, "not disabled yet");
  await disable(db);

  await as(db, OUTSIDER);
  await assert.rejects(submitClearance(db, [`${folder}/1.jpg`]), /Only the vehicle owner/);
  await as(db, LISTER);
  await assert.rejects(submitClearance(db, []), /1 to 4 images/);
  await assert.rejects(submitClearance(db, Array(5).fill(`${folder}/1.jpg`)), /1 to 4 images/);
  await assert.rejects(submitClearance(db, [`${folder}/receipt.pdf`]), /photo uploaded/, "images only");
  await assert.rejects(submitClearance(db, [`${folder}/missing.jpg`]), /photo uploaded/, "must really be uploaded");
  await assert.rejects(submitClearance(db, [`${LISTER}/${CAR}/docs/1.jpg`]), /photo uploaded/, "only the clearance folder");

  const { rows } = await submitClearance(db, [`${folder}/1.jpg`, `${folder}/2.png`]);
  const images = (await db.query("select storage_path from public.vehicle_clearance_images where clearance_id = $1", [rows[0].id])).rows;
  assert.equal(images.length, 2);
  await assert.rejects(submitClearance(db, [`${folder}/1.jpg`]), /already waiting for review/);
  const adminNotice = (await db.query("select user_id from public.notifications where title = 'Vehicle clearance submitted'")).rows;
  assert.deepEqual(adminNotice.map((row) => row.user_id), [ADMIN]);
});

test("staff reject a clearance with a reason, then approve the next one and the car is back", async () => {
  const db = await fixture();
  const folder = `${LISTER}/${CAR}/clearance-1`;
  await upload(db, `${folder}/1.jpg`);
  await disable(db);
  await as(db, LISTER);
  const first = (await submitClearance(db, [`${folder}/1.jpg`])).rows[0].id;
  const review = (id, approve, reason = null) =>
    db.query("select public.review_vehicle_clearance_for($1, $2, $3, $4) as r", [ADMIN, id, approve, reason]);

  await assert.rejects(review(first, false, ""), /Say why/);
  const rejected = (await review(first, false, "Photo is blurry")).rows[0].r;
  assert.equal(rejected.status, "disabled");
  assert.match(rejected.message, /Reason: Photo is blurry/);
  assert.equal((await car(db)).status, "disabled", "still disabled");
  await assert.rejects(review(first, true), /not waiting for review/);

  await upload(db, `${LISTER}/${CAR}/clearance-2/1.jpg`);
  const second = (await submitClearance(db, [`${LISTER}/${CAR}/clearance-2/1.jpg`])).rows[0].id;
  const approved = (await review(second, true)).rows[0].r;
  assert.equal(approved.status, "approved");
  assert.equal(approved.title, "Clearance approved - your vehicle is enabled");
  assert.equal((await car(db)).status, "approved");
  const audit = (await db.query("select action from public.audit_log order by id")).rows.map((row) => row.action);
  assert.ok(audit.includes("vehicle_clearance_rejected") && audit.includes("vehicle_clearance_approved"));
});

test("staff mark a report reviewed or dismissed; nobody else can", async () => {
  const db = await fixture();
  const id = await fileReport(db);
  const review = (status, note) =>
    db.query("select public.review_vehicle_report($1, $2, $3) as r", [id, status, note]);
  await as(db, RENTER);
  await assert.rejects(review("dismissed", "no"), /Vehicle review permission required/);
  await as(db, ADMIN);
  await assert.rejects(review("open", ""), /reviewed or dismissed/);
  await review("dismissed", "Old scratch, already on the listing photos");
  const row = (await db.query("select status, admin_note, reviewed_by from public.vehicle_reports where id = $1", [id])).rows[0];
  assert.deepEqual([row.status, row.admin_note, row.reviewed_by], ["dismissed", "Old scratch, already on the listing photos", ADMIN]);
});

test("the AI image check accepts report photos and clearance images", async () => {
  const db = await fixture();
  await db.query("insert into public.image_authenticity_checks(subject_kind) values ('vehicle_report_photo'), ('vehicle_clearance')");
  await assert.rejects(
    db.query("insert into public.image_authenticity_checks(subject_kind) values ('something_else')"),
    /subject_kind_check/,
  );
});

test("Terms 7.6 is published once, before Section 8", async () => {
  const db = await fixture();
  await db.exec(await chapterText());
  const { rows } = await db.query(
    "select version_number, status, content_html from public.legal_document_versions order by version_number",
  );
  assert.deepEqual(rows.map((row) => [row.version_number, row.status]), [[8, "superseded"], [9, "published"]]);
  const html = rows[1].content_html;
  assert.ok(html.indexOf("7.5 Lost") < html.indexOf("7.6 Vehicle Condition Reports"));
  assert.ok(html.indexOf("7.6 Vehicle Condition Reports") < html.indexOf("8. User Conduct"));
  assert.match(html, /does not hold the Lister's payout/);
});

// ---------------------------------------------------------------- the report window
// The same rules decide whether the booking card shows "Report an issue" and
// whether api/submit-vehicle-report.ts accepts it.

test("the server and the booking cards use the same report rules", async () => {
  const [server, browser] = await Promise.all([
    readFile(new URL("../server/vehicleReports.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/vehicleReports.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(server.replace(/\r\n/g, "\n"), browser.replace(/\r\n/g, "\n"));
});

test("the renter reports from the hand-over until the trip is over; the lister from the return check-in until receipt", async () => {
  const { reportWindowProblem } = await import("../server/vehicleReports.ts");
  const open = (booking, role) => reportWindowProblem(booking, role) === null;
  const handedOver = "2026-10-26T01:00:00Z";
  // Renter
  assert.equal(open({ status: "fully_paid", lister_handover_confirmed_at: null }, "renter"), false, "before the hand-over");
  assert.equal(open({ status: "fully_paid", lister_handover_confirmed_at: handedOver }, "renter"), true, "at the hand-over");
  assert.equal(open({ status: "active", lister_handover_confirmed_at: handedOver }, "renter"), true, "during the trip");
  assert.equal(open({ status: "completed", lister_handover_confirmed_at: handedOver }, "renter"), false, "after the trip");
  // Lister
  assert.equal(open({ status: "active", lister_return_arrived_at: null }, "lister"), false, "before the return check-in");
  assert.equal(open({ status: "active", lister_return_arrived_at: handedOver }, "lister"), true, "at the return");
  assert.equal(
    open({ status: "active", lister_return_arrived_at: handedOver, owner_completed: true }, "lister"),
    false,
    "after confirming receipt",
  );
});

test("a report never holds a payout: it is not a support ticket", async () => {
  const api = await readFile(new URL("../api/submit-vehicle-report.ts", import.meta.url), "utf8");
  assert.ok(!api.includes("support_tickets"), "the report API opens no support case");
  const payout = await readFile(new URL("../server/payoutAutomation.ts", import.meta.url), "utf8");
  assert.ok(!payout.includes("vehicle_reports"), "the payout never looks at vehicle reports");
});

test("every embed of cars from vehicle_reports names its link (cars.disabled_report_id is a second one)", async () => {
  // Without the hint PostgREST refuses the query (PGRST201: more than one
  // relationship), and Vehicle Reports showed nothing.
  const { execSync } = await import("node:child_process");
  let output = "";
  try {
    output = execSync('git grep -n "vehicle_reports" -- src api server', {
      encoding: "utf8",
      cwd: new URL("..", import.meta.url),
    });
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  const files = [...new Set(output.split("\n").filter(Boolean).map((line) => line.split(":")[0]))];
  let checked = 0;
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    // Only the select of a vehicle_reports query: .from("vehicle_reports") ... .select("...").
    for (const match of source.matchAll(/from\("vehicle_reports"\)\s*\.select\(\s*["'`]([^"'`]*)/g)) {
      checked += 1;
      assert.ok(
        !/(^|[\s,])cars\(/.test(match[1]),
        `${file} embeds cars( from vehicle_reports without !vehicle_reports_car_id_fkey`,
      );
    }
  }
  assert.ok(checked > 0, "the vehicle_reports selects were found");
});
