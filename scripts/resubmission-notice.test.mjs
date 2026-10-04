// CHAPTER 122 - the admin is told which document came back.
//
// Proved against real PostgreSQL (PGlite) with the chapter applied verbatim:
// the admins' notice waits for the end of the transaction, so it names the
// documents filed after the renewal row; it says "corrected" for a car in
// review and "updated" for a live one; and a submission with no documents
// left notifies nobody.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const SUPER = "33333333-3333-4333-8333-333333333333";
const CAR = "44444444-4444-4444-8444-444444444444";

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

async function fixture(status) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.profiles(id uuid primary key, full_name text, role text, deleted_at timestamptz);
    create table public.cars(id uuid primary key, owner_id uuid, plate_number text, status text);
    create table public.car_renewals(id uuid primary key default gen_random_uuid(), car_id uuid);
    create table public.car_documents(
      id uuid primary key default gen_random_uuid(), car_id uuid, document_type text, renewal_id uuid);
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, title text, message text, type text, link text);
    insert into public.profiles values
      ('${OWNER}', 'Ana Cruz', 'user', null),
      ('${ADMIN}', 'An Admin', 'admin', null),
      ('${SUPER}', 'A Super', 'super_admin', null);
    insert into public.cars values ('${CAR}', '${OWNER}', 'ABC 1234', '${status}');
  `);
  await db.exec(await chapter("-- CHAPTER 122 - The admin is told which document came back"));
  return db;
}

/** One submission, as submit_vehicle_document_update files it: the renewal first, then its documents. */
async function submit(db, ...types) {
  await db.exec("begin");
  const { rows } = await db.query(`insert into public.car_renewals(car_id) values ($1) returning id`, [CAR]);
  for (const type of types) {
    await db.query(
      `insert into public.car_documents(car_id, document_type, renewal_id) values ($1, $2, $3)`,
      [CAR, type, rows[0].id],
    );
  }
  await db.exec("commit");
  return rows[0].id;
}

const notices = async (db) =>
  (await db.query(`select user_id, title, message, link from public.notifications order by user_id`)).rows;

test("a correction on a car in review names the document and the car, to every admin", async () => {
  const db = await fixture("pending");
  await submit(db, "ctpl");
  const rows = await notices(db);
  assert.deepEqual(rows.map((r) => r.user_id), [ADMIN, SUPER]);
  assert.equal(rows[0].title, "Corrected document submitted");
  assert.equal(
    rows[0].message,
    "Ana Cruz sent a corrected CTPL insurance for ABC 1234, a vehicle still in review. Review it in Vehicle Approval.",
  );
  assert.equal(rows[0].link, "/admin/vehicle-approval?tab=pending");
});

test("an update to a live listing says so and lists every document sent", async () => {
  const db = await fixture("approved");
  const renewal = await submit(db, "dti", "bir");
  const rows = await notices(db);
  assert.equal(rows[0].title, "Updated documents submitted");
  assert.equal(
    rows[0].message,
    "Ana Cruz sent an updated BIR Certificate of Registration, DTI business name registration for ABC 1234, a live listing. Review it in Vehicle Approval.",
  );
  const { rows: notice } = await db.query(`select * from public.vehicle_resubmission_notice($1)`, [renewal]);
  assert.equal(notice[0].message, rows[0].message, "the email reads the same words");
});

test("a submission with no documents left notifies nobody", async () => {
  const db = await fixture("pending");
  await submit(db);
  assert.equal((await notices(db)).length, 0);
});
