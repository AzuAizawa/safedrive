// CHAPTER 118 - a document sent back for correction tells the lister why.
//
// Proved against real PostgreSQL (PGlite) with the chapter applied verbatim
// from the master file: rejecting a document of a new listing notifies its
// owner once, with the reason; approving notifies nobody; and a document in a
// renewal still under review is left to that renewal's own notice.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CAR = "22222222-2222-4222-8222-222222222222";
const BIR = "33333333-3333-4333-8333-333333333333";
const OR_DOC = "44444444-4444-4444-8444-444444444444";
const RENEWAL = "55555555-5555-4555-8555-555555555555";
const RENEWAL_DOC = "66666666-6666-4666-8666-666666666666";

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
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create function public.admin_can(text) returns boolean language sql as $$ select true $$;
    create function public.refresh_vehicle_compliance(uuid) returns void language sql as $$ select $$;
    create function public.vehicle_compliance_summary(uuid, timestamptz, timestamptz)
      returns jsonb language sql as $$ select '{"eligible": false}'::jsonb $$;

    create table public.cars(id uuid primary key, owner_id uuid not null, plate_number text, status text default 'pending');
    create table public.car_renewals(
      id uuid primary key, car_id uuid, document_update boolean, status text, reviewed_at timestamptz);
    create table public.car_documents(
      id uuid primary key, car_id uuid, document_type text, compliance_status text default 'pending',
      valid_from timestamptz, valid_until timestamptz, rental_use_verified boolean default false,
      review_reason text, reviewed_by uuid, reviewed_at timestamptz, superseded_at timestamptz,
      renewal_id uuid);
    create table public.notifications(
      id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
      type text, link text);
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(), user_id uuid, action text, entity_type text,
      entity_id text, details jsonb);

    insert into public.cars values ('${CAR}', '${OWNER}', 'TES1234', 'pending');
    insert into public.car_renewals values ('${RENEWAL}', '${CAR}', true, 'pending', null);
    insert into public.car_documents(id, car_id, document_type) values
      ('${BIR}', '${CAR}', 'bir'), ('${OR_DOC}', '${CAR}', 'or');
    insert into public.car_documents(id, car_id, document_type, renewal_id) values
      ('${RENEWAL_DOC}', '${CAR}', 'ctpl', '${RENEWAL}');
  `);
  await db.exec(await chapter("-- CHAPTER 118 - A document sent back for correction tells the lister why"));
  return db;
}

const review = (db, id, status, reason = "") =>
  db.query("select public.review_vehicle_documents($1, $2::jsonb)", [
    CAR,
    JSON.stringify([{ id, status, reason }]),
  ]);
const notices = async (db) =>
  (await db.query("select title, message, link from public.notifications order by title")).rows;

test("a rejected document of a car in review is fixed from My Vehicles", async () => {
  const db = await fixture();
  await review(db, BIR, "rejected", "wrong expiration date");
  const rows = await notices(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "A vehicle document needs correction");
  assert.equal(
    rows[0].message,
    "Your BIR Certificate of Registration for TES1234 needs correction: wrong expiration date. Open My Vehicles and upload a corrected one.",
  );
  assert.equal(rows[0].link, `/my-vehicles?fix=${CAR}`);
});

test("a document revoked on a live car is renewed from Document Renewal & Updates", async () => {
  const db = await fixture();
  await db.exec(`update public.cars set status = 'approved'`);
  await review(db, OR_DOC, "revoked", "registration lapsed");
  const rows = await notices(db);
  assert.equal(rows.length, 1);
  assert.match(rows[0].message, /Upload a new one from Document Renewal & Updates\.$/);
  assert.equal(rows[0].link, `/car-renewals?car=${CAR}`);
});

test("approving a document says nothing", async () => {
  const db = await fixture();
  await db.exec(`update public.car_documents set valid_until = now() + interval '1 year' where id = '${OR_DOC}'`);
  await review(db, OR_DOC, "approved");
  assert.deepEqual(await notices(db), []);
});

test("a document in a renewal under review is left to the renewal's own notice", async () => {
  const db = await fixture();
  await review(db, RENEWAL_DOC, "rejected", "blurry");
  const rows = await notices(db);
  assert.equal(rows.length, 1, "one notice, not two");
  assert.equal(rows[0].title, "Document resubmission reviewed");
  assert.match(rows[0].message, /Open My Vehicles and choose Edit/, "the car is still in review");
  assert.equal(rows[0].link, `/my-vehicles?fix=${CAR}`);
});

test("a reason ending in a full stop is not doubled", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    "select public.vehicle_document_correction_message('or', 'ABC 1234', 'Blurry photo.', false) as m",
  );
  assert.equal(rows[0].m, "Your LTO registration / OR for ABC 1234 needs correction: Blurry photo. Upload a new one from Document Renewal & Updates.");
});

// The same rule, as My Vehicles reads it to decide what the card and Edit show.
test("My Vehicles names exactly the documents still waiting on the lister", async () => {
  const { documentsNeedingCorrection } = await import("../src/lib/vehicleCompliance.ts");
  const row = (document_type, compliance_status, created_at, review_reason = null) => ({
    document_type, compliance_status, created_at, review_reason,
  });
  const found = documentsNeedingCorrection([
    row("bir", "rejected", "2026-10-03T13:04:00Z", "wrong expiration date"),
    row("or", "approved", "2026-10-03T13:04:00Z"),
    row("ctpl", "rejected", "2026-10-03T13:04:00Z", "blurry"),
    row("ctpl", "pending", "2026-10-03T14:00:00Z"),
  ]);
  assert.deepEqual(
    found.map((item) => [item.type, item.waiting, item.reason]),
    [["ctpl", true, "blurry"], ["bir", false, "wrong expiration date"]],
  );
  assert.deepEqual(
    documentsNeedingCorrection([
      row("bir", "rejected", "2026-10-03T13:04:00Z", "old"),
      row("bir", "approved", "2026-10-03T13:16:00Z"),
    ]),
    [],
    "a corrected and approved document needs nothing more",
  );
});
