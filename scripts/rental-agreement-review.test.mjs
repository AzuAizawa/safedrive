// CHAPTER 128 - the rental agreement is reviewed like the other documents.
//
// Proved against real PostgreSQL (PGlite). The agreement triggers as they stood
// before (taken from the master file), CHAPTER 119 and CHAPTER 128 are applied
// verbatim, so each test runs on what the database will actually have.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CAR = "22222222-2222-4222-8222-222222222222";

let master;
const readMaster = async () =>
  (master ??= await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ));

async function chapter(header) {
  const body = (await readMaster()).split(header)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, `${header} exists in the master file`);
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
}

// The first (pre-CHAPTER 128) definition of a function and its trigger.
async function original(fn, triggerEnd) {
  const text = await readMaster();
  const start = text.indexOf(`create or replace function public.${fn}()`);
  assert.ok(start >= 0, `${fn} exists`);
  return text.slice(start, text.indexOf(triggerEnd, start) + triggerEnd.length);
}

async function fixture({ status = "approved", withChapter = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${OWNER}'::uuid $$;
    create schema storage;
    create table storage.objects(bucket_id text, name text);

    create table public.cars(
      id uuid primary key, owner_id uuid not null, status text, deleted_at timestamptz,
      last_verified_at timestamptz);
    create table public.car_renewals(
      id uuid primary key default gen_random_uuid(), car_id uuid, lister_id uuid,
      status text, document_update boolean, reviewed_at timestamptz);
    create table public.car_documents(
      id uuid primary key default gen_random_uuid(), car_id uuid, document_type text,
      storage_path text, storage_bucket text, renewal_id uuid references public.car_renewals(id),
      valid_until timestamptz, compliance_status text default 'pending', review_reason text,
      reviewed_at timestamptz,
      content_sha256 text, provenance_status text, provenance_source text, provenance_summary text,
      ai_suspicion_score numeric, ai_detector_name text, ai_detector_version text, review_flag text,
      created_at timestamptz default clock_timestamp());
    create table public.car_agreement_versions(
      id uuid primary key default gen_random_uuid(),
      car_id uuid not null references public.cars(id) on delete cascade,
      document_id uuid references public.car_documents(id) on delete set null,
      version_number integer not null, storage_path text not null, content_sha256 text,
      status text not null default 'pending', uploaded_by uuid, approved_by uuid,
      approved_at timestamptz, created_at timestamptz not null default now(),
      unique (car_id, version_number));
    create unique index car_agreement_one_approved_version
      on public.car_agreement_versions (car_id) where status = 'approved';
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(), user_id uuid, action text, entity_type text,
      entity_id text, details jsonb);

    insert into public.cars values ('${CAR}', '${OWNER}', '${status}', null, null);
  `);
  await db.exec(await original("queue_rental_agreement_version", "execute function public.queue_rental_agreement_version();"));
  await db.exec(await original("approve_latest_car_agreement_with_vehicle", "execute function public.approve_latest_car_agreement_with_vehicle();"));
  await db.exec(await chapter("-- CHAPTER 119 - One file per document"));
  return db;
}

const applyChapter = async (db) =>
  db.exec(await chapter("-- CHAPTER 128 - The rental agreement is reviewed like the other documents"));

let uploads = 0;
async function upload(db, type = "rental_agreement") {
  const path = `${OWNER}/${CAR}/${type}_${++uploads}.pdf`;
  await db.query(`insert into storage.objects values ('vehicle-private-documents', $1)`, [path]);
  return path;
}
async function submit(db, type = "rental_agreement") {
  const path = await upload(db, type);
  await db.query(`select public.submit_vehicle_document_update($1, $2::jsonb)`, [
    CAR,
    JSON.stringify([{ document_type: type, storage_path: path }]),
  ]);
  return (await db.query(`select id from public.car_documents where storage_path = $1`, [path])).rows[0].id;
}
// The agreement as it was filed when the car was added, before CHAPTER 128.
async function addedAgreement(db) {
  const path = await upload(db);
  return (
    await db.query(
      `insert into public.car_documents(car_id, document_type, storage_path, storage_bucket)
       values ($1, 'rental_agreement', $2, 'vehicle-private-documents') returning id`,
      [CAR, path],
    )
  ).rows[0].id;
}
const review = (db, id, status) =>
  db.query(`update public.car_documents set compliance_status = $2 where id = $1`, [id, status]);
const versions = async (db) =>
  (
    await db.query(
      `select version_number as v, status from public.car_agreement_versions where car_id = $1 order by version_number`,
      [CAR],
    )
  ).rows.map((r) => `${r.v}:${r.status}`);
const carStatus = async (db) =>
  (await db.query(`select status from public.cars where id = $1`, [CAR])).rows[0].status;

// A live car with one agreement in force, as the old triggers left it.
async function liveCarWithAgreement(options) {
  const db = await fixture({ status: "pending", ...options });
  const doc = await addedAgreement(db);
  await db.exec(`update public.cars set status = 'approved' where id = '${CAR}'`); // old: approves v1
  return { db, doc };
}

test("an agreement already in force is marked approved, and nothing else moves", async () => {
  const { db, doc } = await liveCarWithAgreement();
  await applyChapter(db);
  const { rows } = await db.query(`select compliance_status from public.car_documents where id = $1`, [doc]);
  assert.equal(rows[0].compliance_status, "approved");
  assert.deepEqual(await versions(db), ["1:approved"]);
  assert.equal(await carStatus(db), "approved");
});

test("a new agreement on a live car keeps the car listed and the old agreement in force", async () => {
  const { db } = await liveCarWithAgreement();
  await applyChapter(db);
  await submit(db);
  assert.equal(await carStatus(db), "approved");
  assert.deepEqual(await versions(db), ["1:approved", "2:pending"]);
});

test("before the chapter, the same upload took the car back to review (the test can fail)", async () => {
  const { db } = await liveCarWithAgreement();
  await addedAgreement(db);
  assert.equal(await carStatus(db), "pending");
  assert.deepEqual(await versions(db), ["1:superseded", "2:pending"]);
});

test("approving the new agreement puts it in force and retires the old one", async () => {
  const { db } = await liveCarWithAgreement();
  await applyChapter(db);
  const doc = await submit(db);
  await review(db, doc, "approved");
  assert.deepEqual(await versions(db), ["1:superseded", "2:approved"]);
});

test("sending the new agreement back leaves the old one in force", async () => {
  const { db } = await liveCarWithAgreement();
  await applyChapter(db);
  const doc = await submit(db);
  await review(db, doc, "rejected");
  assert.deepEqual(await versions(db), ["1:approved", "2:rejected"]);
});

test("a second upload while the first waits replaces it", async () => {
  const { db } = await liveCarWithAgreement();
  await applyChapter(db);
  await submit(db);
  await submit(db);
  assert.deepEqual(await versions(db), ["1:approved", "2:superseded", "3:pending"]);
});

test("a car in review is not approved while its agreement waits, and approving the car does not approve it", async () => {
  const db = await fixture({ status: "pending" });
  await applyChapter(db);
  const doc = await addedAgreement(db);
  await assert.rejects(
    db.exec(`update public.cars set status = 'approved' where id = '${CAR}'`),
    /Rental agreement is still waiting for review/,
  );
  assert.deepEqual(await versions(db), ["1:pending"]);

  await review(db, doc, "approved");
  await db.exec(`update public.cars set status = 'approved' where id = '${CAR}'`);
  assert.equal(await carStatus(db), "approved");
  assert.deepEqual(await versions(db), ["1:approved"]);
});
