// CHAPTER 119 - one file per document, and no approval past a document that is
// not approved.
//
// Proved against real PostgreSQL (PGlite) with the chapter applied verbatim
// from the master file: a car in review cannot be approved while the newest
// file of any document is pending or sent back, whatever the screen allows; a
// live car's own status changes are untouched; and a resubmission replaces a
// file still waiting instead of stacking on it, keeping the rejected original.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CAR = "22222222-2222-4222-8222-222222222222";

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

async function fixture(status = "pending") {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${OWNER}'::uuid $$;
    create schema storage;
    create table storage.objects(bucket_id text, name text);

    create table public.cars(
      id uuid primary key, owner_id uuid not null, status text, deleted_at timestamptz);
    create table public.car_renewals(
      id uuid primary key default gen_random_uuid(), car_id uuid, lister_id uuid,
      status text, document_update boolean, reviewed_at timestamptz);
    create table public.car_documents(
      id uuid primary key default gen_random_uuid(), car_id uuid, document_type text,
      storage_path text, storage_bucket text, renewal_id uuid references public.car_renewals(id),
      valid_until timestamptz, compliance_status text default 'pending', review_reason text,
      content_sha256 text, provenance_status text, provenance_source text, provenance_summary text,
      ai_suspicion_score numeric, ai_detector_name text, ai_detector_version text, review_flag text,
      created_at timestamptz default clock_timestamp());
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(), user_id uuid, action text, entity_type text,
      entity_id text, details jsonb);

    insert into public.cars values ('${CAR}', '${OWNER}', '${status}', null);
  `);
  await db.exec(await chapter("-- CHAPTER 119 - One file per document"));
  return db;
}

async function file(db, type, status, minutesAgo, reason = null) {
  await db.query(
    `insert into public.car_documents(car_id, document_type, compliance_status, review_reason, created_at)
     values ($1, $2, $3, $4, now() - make_interval(mins => $5))`,
    [CAR, type, status, reason, minutesAgo],
  );
}

async function approve(db) {
  await db.exec(`update public.cars set status = 'approved' where id = '${CAR}'`);
  return (await db.query(`select status from public.cars where id = $1`, [CAR])).rows[0].status;
}

let uploads = 0;
async function resubmit(db, ...types) {
  const documents = [];
  for (const type of types) {
    const path = `${OWNER}/${CAR}/${type}_${++uploads}.jpg`;
    await db.query(`insert into storage.objects values ('vehicle-private-documents', $1)`, [path]);
    documents.push({ document_type: type, storage_path: path });
  }
  return (
    await db.query(`select public.submit_vehicle_document_update($1, $2::jsonb) as id`, [
      CAR,
      JSON.stringify(documents),
    ])
  ).rows[0].id;
}

test("a car in review is not approved while a document's newest file needs correction", async () => {
  const db = await fixture();
  await file(db, "or", "approved", 60);
  await file(db, "bir", "approved", 60);
  await file(db, "bir", "rejected", 10, "wrong exp date");
  await assert.rejects(approve(db), /BIR Certificate of Registration \(Form 2303\) needs correction/);
});

test("a document still waiting for review blocks approval too", async () => {
  const db = await fixture();
  await file(db, "or", "pending", 10);
  await file(db, "bir", "approved", 10);
  await assert.rejects(approve(db), /LTO registration \/ OR is still waiting for review/);
});

test("once every newest file is approved, the car is approved", async () => {
  const db = await fixture();
  await file(db, "bir", "rejected", 60, "wrong exp date");
  await file(db, "bir", "approved", 10);
  await file(db, "or", "approved", 10);
  assert.equal(await approve(db), "approved");
});

test("a live car returning to approved is not held by a renewal still in review", async () => {
  const db = await fixture("renewal_required");
  await file(db, "or", "approved", 60);
  await file(db, "or", "pending", 10);
  assert.equal(await approve(db), "approved");
});

test("a second resubmission replaces the first one still waiting", async () => {
  const db = await fixture();
  await file(db, "bir", "rejected", 60, "wrong exp date");
  const first = await resubmit(db, "bir");
  const second = await resubmit(db, "bir");

  const { rows } = await db.query(
    `select compliance_status, review_reason, renewal_id from public.car_documents
      where car_id = $1 order by created_at`,
    [CAR],
  );
  assert.deepEqual(
    rows.map((r) => [r.compliance_status, r.review_reason, r.renewal_id]),
    [
      ["rejected", "wrong exp date", null],
      ["pending", null, second],
    ],
  );
  const renewals = await db.query(`select id from public.car_renewals where id = $1`, [first]);
  assert.equal(renewals.rows.length, 0, "the emptied renewal is removed");
  const audit = await db.query(`select details from public.audit_log where action = 'vehicle_document_replaced'`);
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].details.document_type, "bir");
});

test("replacing one document leaves the rest of that renewal waiting", async () => {
  const db = await fixture("approved");
  const first = await resubmit(db, "bir", "cr");
  await resubmit(db, "bir");

  const left = await db.query(
    `select document_type from public.car_documents where renewal_id = $1`,
    [first],
  );
  assert.deepEqual(left.rows.map((r) => r.document_type), ["cr"]);
  const renewal = await db.query(`select status from public.car_renewals where id = $1`, [first]);
  assert.equal(renewal.rows[0].status, "pending");
  const pending = await db.query(
    `select count(*)::int as n from public.car_documents where document_type = 'bir' and compliance_status = 'pending'`,
  );
  assert.equal(pending.rows[0].n, 1);
});
