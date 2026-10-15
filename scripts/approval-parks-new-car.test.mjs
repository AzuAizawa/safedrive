// CHAPTER 127 - a newly approved car waits in Inactive; slots cap live cars.
//
// Proved against real PostgreSQL (PGlite) with the chapter and the live-slot
// trigger applied verbatim from the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CARS = [
  "33333333-3333-4333-8333-333333333331",
  "33333333-3333-4333-8333-333333333332",
  "33333333-3333-4333-8333-333333333333",
];

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

// The newest definition of the live-slot trigger function, as the database has it.
async function liveSlotFunction() {
  const text = await readMaster();
  const start = text.lastIndexOf("create or replace function public.trg_enforce_live_car_limit()");
  assert.ok(start >= 0, "live-slot function exists");
  return text.slice(start, text.indexOf("$$;", start) + 3);
}

async function fixture({ withChapter = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.cars(
      id uuid primary key,
      owner_id uuid not null,
      status text not null default 'pending',
      papers_reviewed boolean not null default true,
      compliance_previously_approved boolean not null default false,
      deleted_at timestamptz,
      created_at timestamptz not null default now());
    create table public.approval_effects(car_id uuid, saw_status text);

    create function public.vehicle_slot_allowance(uuid) returns integer
      language sql as $$ select 2 $$;

    -- Stand-in for the approval guards (documents reviewed, papers current):
    -- they refuse an approval that is not earned and mark one that is.
    create function public.approval_guard() returns trigger language plpgsql as $$
    begin
      if new.status in ('approved', 'active') then
        if not new.papers_reviewed then
          raise exception 'Review all required vehicle and business documents before approval';
        end if;
        new.compliance_previously_approved := true;
      end if;
      return new;
    end $$;
    create trigger vehicle_compliance_guard before update on public.cars
      for each row execute function public.approval_guard();

    -- Stand-in for approve_latest_car_agreement_with_vehicle: an AFTER effect
    -- that must still see the approval.
    create function public.record_approval() returns trigger language plpgsql as $$
    begin
      if new.status = 'approved' and old.status is distinct from new.status then
        insert into public.approval_effects values (new.id, new.status);
      end if;
      return null;
    end $$;
    create trigger approve_latest_car_agreement_with_vehicle after update of status on public.cars
      for each row execute function public.record_approval();
  `);
  await db.exec(await liveSlotFunction());
  await db.exec(`
    create trigger enforce_live_car_limit before update on public.cars
      for each row execute function public.trg_enforce_live_car_limit();
  `);
  if (withChapter) await db.exec(await chapter("-- CHAPTER 127 - A newly approved car waits in Inactive for its lister"));
  for (const id of CARS) await db.query("insert into public.cars(id, owner_id) values ($1, $2)", [id, OWNER]);
  return db;
}

const statusOf = async (db, id) =>
  (await db.query("select status from public.cars where id = $1", [id])).rows[0].status;
const approve = (db, id) => db.query("update public.cars set status = 'approved' where id = $1", [id]);

test("a car approved for the first time lands in inactive", async () => {
  const db = await fixture();
  await approve(db, CARS[0]);
  assert.equal(await statusOf(db, CARS[0]), "inactive");
});

test("without the chapter it went straight live (the test can fail)", async () => {
  const db = await fixture({ withChapter: false });
  await approve(db, CARS[0]);
  assert.equal(await statusOf(db, CARS[0]), "approved");
});

test("the approval's own effects still see 'approved'", async () => {
  const db = await fixture();
  await approve(db, CARS[0]);
  const { rows } = await db.query("select saw_status from public.approval_effects where car_id = $1", [CARS[0]]);
  assert.deepEqual(rows, [{ saw_status: "approved" }]);
});

test("an approval the guards refuse is still refused", async () => {
  const db = await fixture();
  await db.query("update public.cars set papers_reviewed = false where id = $1", [CARS[0]]);
  await assert.rejects(approve(db, CARS[0]), /Review all required vehicle and business documents/);
  assert.equal(await statusOf(db, CARS[0]), "pending");
});

test("a car approved before and sent back to review returns to live", async () => {
  const db = await fixture();
  await approve(db, CARS[0]);
  await db.query("update public.cars set status = 'approved' where id = $1", [CARS[0]]); // lister turns it on
  await db.query("update public.cars set status = 'pending' where id = $1", [CARS[0]]); // material edit
  await approve(db, CARS[0]);
  assert.equal(await statusOf(db, CARS[0]), "approved");
});

test("any number can be approved; only as many as the slots can be turned on", async () => {
  const db = await fixture();
  for (const id of CARS) await approve(db, id);
  for (const id of CARS) assert.equal(await statusOf(db, id), "inactive");

  await db.query("update public.cars set status = 'approved' where id = $1", [CARS[0]]);
  await db.query("update public.cars set status = 'approved' where id = $1", [CARS[1]]);
  await assert.rejects(
    db.query("update public.cars set status = 'approved' where id = $1", [CARS[2]]),
    /Vehicle slot limit reached/,
  );

  // Turning one off frees the slot for the third.
  await db.query("update public.cars set status = 'inactive' where id = $1", [CARS[0]]);
  await db.query("update public.cars set status = 'approved' where id = $1", [CARS[2]]);
  assert.equal(await statusOf(db, CARS[2]), "approved");
});

// CHAPTER 129 - the audit trail names the move instead of calling it a disable.
async function auditedFixture() {
  const db = await fixture();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create function public.is_admin() returns boolean language sql as $$ select false $$;
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(), user_id uuid, action text,
      entity_type text, entity_id uuid, details jsonb, created_at timestamptz default clock_timestamp());
    alter table public.cars add column plate_number text, add column price_per_day numeric;
  `);
  const text = await readMaster();
  const start = text.indexOf("create or replace function public.audit_vehicle_lifecycle()");
  const triggerEnd = "execute function public.audit_vehicle_lifecycle();";
  await db.exec(text.slice(start, text.indexOf(triggerEnd, start) + triggerEnd.length));
  await db.exec(await chapter("-- CHAPTER 129 - The audit trail says why a newly approved car is inactive"));
  return db;
}
const actions = async (db, id) =>
  (await db.query("select action from public.audit_log where entity_id = $1 order by created_at", [id])).rows.map(
    (r) => r.action,
  );

test("a first approval is audited as parked, not as disabled", async () => {
  const db = await auditedFixture();
  await approve(db, CARS[0]);
  assert.equal(await statusOf(db, CARS[0]), "inactive");
  assert.deepEqual(await actions(db, CARS[0]), ["vehicle_parked_after_approval"]);
});

test("turning a car off is still audited as disabled", async () => {
  const db = await auditedFixture();
  await approve(db, CARS[0]);
  await db.query("update public.cars set status = 'approved' where id = $1", [CARS[0]]);
  await db.query("update public.cars set status = 'inactive' where id = $1", [CARS[0]]);
  assert.deepEqual(await actions(db, CARS[0]), [
    "vehicle_parked_after_approval",
    "vehicle_enabled",
    "vehicle_disabled",
  ]);
});
