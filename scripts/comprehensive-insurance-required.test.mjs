// CHAPTER 103 - comprehensive insurance is required again, for new listings.
//
// This reverses CHAPTER 78, so the test is weighted toward the half that must
// NOT change: every vehicle already on the platform keeps its listing whatever
// it carries, today and at renewal. The new requirement is proved on a vehicle
// submitted after the chapter, and the exemption is proved to be permanent
// rather than a grace period. Run against real PostgreSQL (PGlite) with the
// chapter applied verbatim from the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OLD_CAR = "11111111-1111-4111-8111-111111111111";
const NEW_CAR = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

const REQUIRED = ["or", "cr", "ctpl", "dti", "mayors_permit", "bir"];

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

    create table public.profiles(id uuid primary key);
    create table public.cars(
      id uuid primary key,
      owner_id uuid references public.profiles(id),
      plate_number text,
      status text default 'pending',
      deleted_at timestamptz,
      created_at timestamptz default clock_timestamp());
    create table public.car_documents(
      id uuid primary key default gen_random_uuid(),
      car_id uuid references public.cars(id) not null,
      document_type text not null,
      compliance_status text not null default 'pending',
      valid_from timestamptz,
      valid_until timestamptz,
      superseded_at timestamptz,
      rental_use_verified boolean not null default false);
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text not null,
      version_number integer not null,
      content_html text not null,
      status text not null default 'published');
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);

    insert into public.profiles(id) values('${OWNER}');
    insert into public.cars(id, owner_id, plate_number, status) values
      ('${OLD_CAR}', '${OWNER}', 'OLD 1111', 'approved');

    insert into public.legal_document_versions(document_key, version_number, content_html)
      values('platform_agreement', 4,
        '<h2>5. Vehicle Listing Standards</h2><ul>' ||
        '<li><strong>Accepted Vehicles:</strong> Only models and body types present in the admin-approved catalogue may be submitted. Approval also requires current ownership/registration evidence, roadworthiness, insurance declarations, images, and a vehicle-specific rental agreement.</li>' ||
        '<li><strong>No unimplemented age promise:</strong> The current schema does not enforce a vehicle-age limit.</li></ul>');
  `);

  // The pre-chapter function: comprehensive deliberately absent (CHAPTER 78).
  await db.exec(`
    create or replace function public.vehicle_compliance_summary(
      p_car_id uuid, p_start timestamptz default now(), p_end timestamptz default now()
    ) returns jsonb language plpgsql stable security definer set search_path = public as $vc$
    declare
      c public.cars%rowtype; k text; keys text[]; r record;
      covered_until timestamptz; limit_at timestamptz := 'infinity';
      reasons text[] := '{}'; s timestamptz := coalesce(p_start,now());
      e timestamptz := coalesce(p_end,p_start,now());
    begin
      select * into c from public.cars where id=p_car_id;
      if not found or e<s then
        return jsonb_build_object('eligible',false,'valid_until',null,'reasons',array['invalid_vehicle_or_dates']);
      end if;
      keys := array['or','cr','ctpl','dti','mayors_permit','bir'];
      foreach k in array keys loop
        covered_until:=null;
        for r in
          select coalesce(d.valid_from,'-infinity'::timestamptz) as a,
            least(coalesce(d.valid_until,'infinity'::timestamptz),coalesce(d.superseded_at,'infinity'::timestamptz)) as z
          from public.car_documents d
          where d.car_id=p_car_id and d.compliance_status='approved'
            and (d.document_type=k or (k in ('or','cr') and d.document_type='orcr'))
            and (k not in ('or','ctpl','dti','mayors_permit') or d.valid_until is not null)
          order by coalesce(d.valid_from,'-infinity'::timestamptz),coalesce(d.valid_until,'infinity'::timestamptz)
        loop
          if r.z<s then continue; end if;
          if covered_until is null then
            if r.a>s then exit; end if;
            covered_until:=r.z;
          elsif r.a<=covered_until + interval '1 millisecond' then
            covered_until:=greatest(covered_until,r.z);
          else exit; end if;
        end loop;
        if covered_until is null or covered_until<e then reasons:=array_append(reasons,k||'_coverage_required'); end if;
        limit_at:=least(limit_at,coalesce(covered_until,s-interval '1 millisecond'));
      end loop;
      return jsonb_build_object('eligible',cardinality(reasons)=0,
        'valid_until',case when limit_at='infinity'::timestamptz then null else limit_at end,'reasons',reasons);
    end;
    $vc$;
  `);

  // The old car is fully papered under the old rules - and carries no
  // comprehensive policy at all, which was allowed.
  for (const type of REQUIRED) await approveDoc(db, OLD_CAR, type);

  await db.exec(await chapter("-- CHAPTER 103 - Comprehensive insurance is required again, for new listings"));
  return db;
}

const approveDoc = (db, carId, type, { until = "2 years", from = "-1 year" } = {}) =>
  db.query(
    `insert into public.car_documents(car_id, document_type, compliance_status, valid_from, valid_until)
     values($1, $2, 'approved', now() + $3::interval, now() + $4::interval)`,
    [carId, type, from, until],
  );

const summary = async (db, carId) =>
  (await db.query("select public.vehicle_compliance_summary($1) as s", [carId])).rows[0].s;

const listNewCar = async (db) => {
  await db.query("insert into public.cars(id, owner_id, plate_number) values($1, $2, 'NEW 0001')", [
    NEW_CAR,
    OWNER,
  ]);
  for (const type of REQUIRED) await approveDoc(db, NEW_CAR, type);
};

test("a vehicle listed after the chapter must carry comprehensive insurance", async () => {
  const db = await fixture();
  await listNewCar(db);

  const before = await summary(db, NEW_CAR);
  assert.equal(before.eligible, false, "every other document is in order, and it still fails");
  assert.deepEqual(before.reasons, ["comprehensive_insurance_coverage_required"]);

  await approveDoc(db, NEW_CAR, "comprehensive_insurance");
  const after = await summary(db, NEW_CAR);
  assert.equal(after.eligible, true);
  assert.deepEqual(after.reasons, []);
});

test("a vehicle already listed keeps its listing with no comprehensive policy", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    "select comprehensive_insurance_required from public.cars where id = $1",
    [OLD_CAR],
  );
  assert.equal(rows[0].comprehensive_insurance_required, false, "exempt, explicitly");

  const result = await summary(db, OLD_CAR);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
});

test("the exemption does not expire - it still holds at renewal", async () => {
  const db = await fixture();
  // A renewal resubmits the yearly documents. Nothing about that re-opens the
  // question of comprehensive cover for a vehicle listed before the rule.
  await db.query("update public.cars set status = 'renewal_required' where id = $1", [OLD_CAR]);
  await approveDoc(db, OLD_CAR, "or", { from: "0 days", until: "3 years" });
  await db.query("update public.cars set status = 'approved' where id = $1", [OLD_CAR]);

  const result = await summary(db, OLD_CAR);
  assert.equal(result.eligible, true, "still no comprehensive policy, still listed");
});

test("every other required document still behaves exactly as before", async () => {
  const db = await fixture();
  await db.query("insert into public.cars(id, owner_id, plate_number) values($1, $2, 'NEW 0002')", [
    NEW_CAR,
    OWNER,
  ]);
  const bare = await summary(db, NEW_CAR);
  assert.deepEqual(
    bare.reasons.sort(),
    [...REQUIRED, "comprehensive_insurance"].map((k) => `${k}_coverage_required`).sort(),
    "the new requirement is added to the old list, not swapped into it",
  );
});

test("a comprehensive policy with no expiry does not count", async () => {
  const db = await fixture();
  await listNewCar(db);
  await db.query(
    `insert into public.car_documents(car_id, document_type, compliance_status, valid_from, valid_until)
     values($1, 'comprehensive_insurance', 'approved', now() - interval '1 year', null)`,
    [NEW_CAR],
  );
  const result = await summary(db, NEW_CAR);
  assert.equal(result.eligible, false, "an open-ended policy is not proof of current cover");
});

test("an expired comprehensive policy stops the listing the way CTPL does", async () => {
  const db = await fixture();
  await listNewCar(db);
  await db.query(
    `insert into public.car_documents(car_id, document_type, compliance_status, valid_from, valid_until)
     values($1, 'comprehensive_insurance', 'approved', now() - interval '2 years', now() - interval '1 day')`,
    [NEW_CAR],
  );
  const result = await summary(db, NEW_CAR);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["comprehensive_insurance_coverage_required"]);
});

test("a policy still awaiting review does not count", async () => {
  const db = await fixture();
  await listNewCar(db);
  await db.query(
    `insert into public.car_documents(car_id, document_type, compliance_status, valid_from, valid_until)
     values($1, 'comprehensive_insurance', 'pending', now() - interval '1 year', now() + interval '1 year')`,
    [NEW_CAR],
  );
  assert.equal((await summary(db, NEW_CAR)).eligible, false);
});

test("rental-use verification is not resurrected as a second gate", async () => {
  const db = await fixture();
  await listNewCar(db);
  // rental_use_verified stays false, as CHAPTER 78 left it. The document alone
  // is the evidence; the reviewer's approval and rejection are already audited.
  await approveDoc(db, NEW_CAR, "comprehensive_insurance");
  const { rows } = await db.query(
    "select rental_use_verified from public.car_documents where car_id = $1 and document_type = 'comprehensive_insurance'",
    [NEW_CAR],
  );
  assert.equal(rows[0].rental_use_verified, false);
  assert.equal((await summary(db, NEW_CAR)).eligible, true, "not blocked by an unticked box");
});

test("the platform agreement publishes the rule as a new version", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select version_number, status, content_html from public.legal_document_versions
      where document_key = 'platform_agreement' order by version_number`,
  );
  assert.equal(rows.length, 2, "a new version, not an edit of the old one");
  assert.equal(rows[0].status, "superseded");
  assert.equal(rows[1].status, "published");
  assert.equal(rows[1].version_number, 5);
  assert.ok(rows[1].content_html.includes("Comprehensive insurance:"), "the rule is published");
  assert.ok(
    rows[1].content_html.includes("Vehicles already listed before this requirement took effect keep their listing"),
    "and so is the exemption",
  );
});

test("the age-limit clause is left exactly as it was", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select content_html from public.legal_document_versions
      where document_key = 'platform_agreement' and status = 'published'`,
  );
  assert.ok(
    rows[0].content_html.includes("No unimplemented age promise"),
    "SafeDrive still imposes no vehicle-age limit, and the terms still say so",
  );
});

test("applying the chapter twice changes nothing", async () => {
  const db = await fixture();
  await db.exec(await chapter("-- CHAPTER 103 - Comprehensive insurance is required again, for new listings"));
  const { rows } = await db.query(
    "select count(*)::int as n from public.legal_document_versions where document_key = 'platform_agreement'",
  );
  assert.equal(rows[0].n, 2, "no third version from a second run");
});
