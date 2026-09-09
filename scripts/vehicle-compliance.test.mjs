import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { expiryDateToIso, manilaInputToIso } from "../src/lib/vehicleCompliance.ts";

const OWNER="11111111-1111-4111-8111-111111111111";
const ADMIN="22222222-2222-4222-8222-222222222222";
const RENTER="33333333-3333-4333-8333-333333333333";
const CAR="44444444-4444-4444-8444-444444444444";
const CAR2="55555555-5555-4555-8555-555555555555";
let migration;

async function fixture() {
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    create function public.admin_can(text) returns boolean language sql stable as $$ select coalesce(current_setting('test.reviewer',true),'false')='true' $$;
    create table public.profiles(id uuid primary key,role text,deleted_at timestamptz);
    create table public.cars(id uuid primary key,owner_id uuid,plate_number text,status text default 'pending',
      registration_expiry date,ctpl_expiry date,comprehensive_insurance_expiry date,insurer_rental_use_confirmed boolean default false,insurance_verification_status text default 'pending');
    create table public.car_renewals(id uuid primary key default gen_random_uuid(),car_id uuid,lister_id uuid,
      orcr_document_path text not null,current_mileage numeric not null,status text default 'pending',reviewed_at timestamptz,
      ctpl_document_path text,comprehensive_document_path text);
    create table public.car_documents(id uuid primary key default gen_random_uuid(),car_id uuid,document_type text,storage_path text,
      reviewed_by uuid,reviewed_at timestamptz,review_reason text,created_at timestamptz default now(),
      content_sha256 text,
      provenance_status text not null default 'unknown'
        check (provenance_status in ('unknown','credential_present','credential_missing','credential_invalid')),
      provenance_source text, provenance_summary text,
      ai_suspicion_score numeric check (ai_suspicion_score is null or (ai_suspicion_score >= 0 and ai_suspicion_score <= 1)),
      ai_detector_name text, ai_detector_version text,
      review_flag text not null default 'none'
        check (review_flag in ('none','needs_admin_review','approved_after_review','rejected_after_review')));
    create table public.bookings(id uuid primary key default gen_random_uuid(),car_id uuid,owner_id uuid,renter_id uuid,
      start_date date,end_date date,pickup_time time,dropoff_time time,status text default 'pending',
      lister_handover_confirmed_at timestamptz,renter_handover_received_at timestamptz,
      payment_deadline timestamptz,owner_response_deadline timestamptz,balance_deadline timestamptz);
    create table public.notifications(id uuid default gen_random_uuid(),user_id uuid,title text,message text,type text,link text);
    create table public.audit_log(user_id uuid,action text,entity_type text,entity_id text,details jsonb);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    create table storage.buckets(id text primary key,public boolean);
    insert into cars(id,owner_id,plate_number) values('${CAR}','${OWNER}','ABC1234'),('${CAR2}','${OWNER}','XYZ1234');
  `);
  migration ??= (await readFile(new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql",import.meta.url),"utf8")).split("-- CHAPTER 70 - Per-vehicle compliance")[1]?.split("-- CHAPTER 71")[0];
  assert.ok(migration,"Migration chapter exists");
  await db.exec("-- CHAPTER 70 - Per-vehicle compliance"+migration);
  // Exercise compatibility with the real legacy insurance approval trigger.
  const master=await readFile(new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql",import.meta.url),"utf8");
  const insurance=master.match(/create or replace function public\.enforce_vehicle_insurance_approval\(\)[\s\S]*?\$\$;/i)?.[0];
  assert.ok(insurance);
  await db.exec(insurance+"\ncreate trigger enforce_vehicle_insurance_approval before update of status on cars for each row execute function public.enforce_vehicle_insurance_approval();");
  // CHAPTER 75 removes the LTFRB classification gate and the DTI/SEC choice,
  // and CHAPTER 74 before it widened submit_vehicle_document_update. Applying
  // the chapter wholesale keeps this fixture honest about what production runs.
  const chapter75=master.split("-- CHAPTER 75 - Seven documents")[1]?.split("-- Read-only verification")[0];
  assert.ok(chapter75,"CHAPTER 75 exists");
  await db.exec(chapter75.slice(chapter75.indexOf("begin;")));
  await reviewer(db);
  return db;
}
async function reviewer(db) {
  await db.exec(`select set_config('request.jwt.claim.sub','${ADMIN}',false),set_config('request.jwt.claim.role','authenticated',false),set_config('test.reviewer','true',false)`);
}
async function coverage(db,start="2030-10-20T09:00:00+08:00",end="2030-10-25T09:00:00+08:00",car=CAR) {
  return (await db.query("select public.vehicle_compliance_summary($1,$2,$3) as result",[car,start,end])).rows[0].result;
}
async function approveDocument(db,type,end="2030-10-31T23:59:59.999+08:00",start="2020-01-01T00:00:00+08:00",car=CAR,renewal=null) {
  const {rows}=await db.query("insert into car_documents(car_id,document_type,storage_path,renewal_id) values($1,$2,$3,$4) returning id",[car,type,`${OWNER}/${car}/${type}_${crypto.randomUUID()}.pdf`,renewal]);
  const exp=["or","ctpl","comprehensive_insurance","dti","mayors_permit"].includes(type);
  await db.query("select public.review_vehicle_documents($1,$2::jsonb)",[car,JSON.stringify([{id:rows[0].id,status:"approved",valid_from:start,valid_until:exp?end:null,rental_use_verified:true}])]);
  return rows[0].id;
}
async function completeDocuments(db) {
  for(const type of ["or","cr","ctpl","comprehensive_insurance","dti","mayors_permit","bir"]) await approveDocument(db,type,type==="mayors_permit"?undefined:"2032-12-31T23:59:59.999+08:00");
  // No classification step: the seven approved documents are enough on their own.
  await db.query("update cars set status='approved' where id=$1",[CAR]);
}

test("Manila expiry conversion is independent of the machine timezone",()=>{
  assert.equal(expiryDateToIso("2030-10-31"),"2030-10-31T15:59:59.999Z");
  assert.equal(expiryDateToIso("2030-10-31","12:00"),"2030-10-31T04:00:00.000Z");
  assert.equal(manilaInputToIso(""),null);
});

test("migration executes; every car independently needs its own approved documents",async()=>{
  const db=await fixture();try {
    assert.equal((await coverage(db)).eligible,false);
    await completeDocuments(db);
    assert.equal((await coverage(db)).eligible,true);
    assert.equal((await coverage(db,undefined,undefined,CAR2)).eligible,false);
    await assert.rejects(db.query("update cars set status='approved' where id=$1",[CAR2]),/Review all required|Current registration expiry/);
  }finally{await db.close();}
});

test("October permit blocks crossing and November trips; exact expiry is inclusive",async()=>{
  const db=await fixture();try {
    await completeDocuments(db);
    assert.equal((await coverage(db)).eligible,true);
    assert.equal((await coverage(db,"2030-10-30T09:00:00+08:00","2030-11-02T09:00:00+08:00")).eligible,false);
    assert.equal((await coverage(db,"2030-11-05T09:00:00+08:00","2030-11-10T09:00:00+08:00")).eligible,false);
    assert.equal((await coverage(db,"2030-10-30T09:00:00+08:00","2030-10-31T23:59:59.999+08:00")).eligible,true);
    assert.equal((await coverage(db,"2030-10-30T09:00:00+08:00","2030-11-01T00:00:00+08:00")).eligible,false);
  }finally{await db.close();}
});

test("approved continuous advance renewal unlocks November; a coverage gap does not",async()=>{
  const db=await fixture();try {
    await completeDocuments(db);
    const id=await approveDocument(db,"mayors_permit","2031-12-31T23:59:59.999+08:00","2030-11-02T00:00:00+08:00");
    assert.equal((await coverage(db,"2030-10-30T09:00:00+08:00","2030-11-05T09:00:00+08:00")).eligible,false);
    await db.query("select public.review_vehicle_documents($1,$2::jsonb)",[CAR,JSON.stringify([{id,status:"approved",valid_from:"2030-11-01T00:00:00+08:00",valid_until:"2031-12-31T23:59:59.999+08:00"}])]);
    assert.equal((await coverage(db,"2030-10-30T09:00:00+08:00","2030-11-05T09:00:00+08:00")).eligible,true);
  }finally{await db.close();}
});

test("partial BIR resubmission needs no expiry or unrelated files; rejection retains approved version",async()=>{
  const db=await fixture();try {
    await completeDocuments(db);
    await db.exec(`select set_config('request.jwt.claim.sub','${OWNER}',false),set_config('test.reviewer','false',false)`);
    const path=`${OWNER}/${CAR}/bir_update.pdf`;
    await db.query("insert into storage.objects(bucket_id,name) values('vehicle-private-documents',$1)",[path]);
    const {rows}=await db.query("select public.submit_vehicle_document_update($1,$2::jsonb) as id",[CAR,JSON.stringify([{document_type:"bir",storage_path:path}])]);
    const rid=rows[0].id;
    assert.equal((await coverage(db)).eligible,true);
    const doc=(await db.query("select id from car_documents where renewal_id=$1",[rid])).rows[0];
    await assert.rejects(db.query("select public.review_vehicle_documents($1,'[]')",[CAR]),/permission/);
    await reviewer(db);
    await db.query("select public.review_vehicle_documents($1,$2::jsonb)",[CAR,JSON.stringify([{id:doc.id,status:"rejected",reason:"Unreadable"}])]);
    assert.equal((await coverage(db)).eligible,true);
    assert.equal((await db.query("select status from car_renewals where id=$1",[rid])).rows[0].status,"rejected");
  }finally{await db.close();}
});

test("database blocks date bypass; revoked permit flags existing booking and prevents handover",async()=>{
  const db=await fixture();try {
    await completeDocuments(db);
    await assert.rejects(db.query("insert into bookings(car_id,owner_id,renter_id,start_date,end_date) values($1,$2,$3,'2030-11-05','2030-11-10')",[CAR,OWNER,RENTER]),/VEHICLE_DOCUMENTS_REQUIRED/);
    const b=(await db.query("insert into bookings(car_id,owner_id,renter_id,start_date,end_date,status) values($1,$2,$3,'2030-10-20','2030-10-25','fully_paid') returning id",[CAR,OWNER,RENTER])).rows[0];
    const pending=(await db.query("insert into bookings(car_id,owner_id,renter_id,start_date,end_date) values($1,$2,$3,'2030-10-20','2030-10-25') returning id",[CAR,OWNER,RENTER])).rows[0];
    const d=(await db.query("select id from car_documents where document_type='mayors_permit' and car_id=$1",[CAR])).rows[0];
    await db.query("select public.review_vehicle_documents($1,$2::jsonb)",[CAR,JSON.stringify([{id:d.id,status:"revoked",reason:"Permit withdrawn"}])]);
    assert.equal((await db.query("select compliance_hold from bookings where id=$1",[b.id])).rows[0].compliance_hold,true);
    await assert.rejects(db.query("update bookings set status='confirmed' where id=$1",[pending.id]),/VEHICLE_DOCUMENTS_REQUIRED/);
    await assert.rejects(db.query("update bookings set lister_handover_confirmed_at=now() where id=$1",[b.id]),/VEHICLE_DOCUMENTS_REQUIRED/);
    // Actual payment callbacks remain recordable without authorizing pickup.
    await db.query("update bookings set status='fully_paid' where id=$1",[b.id]);
    assert.equal((await db.query("select status from bookings where id=$1",[b.id])).rows[0].status,"fully_paid");
  }finally{await db.close();}
});


test("invalid multi-document review rolls back; approving a replacement removes fallback to outdated BIR",async()=>{
  const db=await fixture();try {
    await completeDocuments(db);
    const bir=(await db.query("select id from car_documents where car_id=$1 and document_type='bir'",[CAR])).rows[0];
    await assert.rejects(db.query("select review_vehicle_documents($1,$2::jsonb)",[CAR,JSON.stringify([
      {id:bir.id,status:"revoked",reason:"Changed"},
      {id:crypto.randomUUID(),status:"approved"},
    ])]),/Document not found/);
    assert.equal((await coverage(db)).eligible,true);
    const fresh=await approveDocument(db,"bir",undefined,"2030-01-01T00:00:00+08:00");
    await db.query("select review_vehicle_documents($1,$2::jsonb)",[CAR,JSON.stringify([{id:fresh,status:"revoked",reason:"Invalid replacement"}])]);
    assert.equal((await coverage(db)).eligible,false);
    assert.equal((await coverage(db,"2029-10-20T09:00:00+08:00","2029-10-25T09:00:00+08:00")).eligible,true);
  }finally{await db.close();}
});

test("owner uploads cannot forge approval or overwrite referenced evidence",async()=>{
  const db=await fixture();try {
    await db.exec(`select set_config('request.jwt.claim.sub','${OWNER}',false),set_config('test.reviewer','false',false)`);
    const d=(await db.query("insert into car_documents(car_id,document_type,storage_path,compliance_status,rental_use_verified) values($1,'bir','test.pdf','approved',true) returning id,compliance_status,rental_use_verified",[CAR])).rows[0];
    assert.equal(d.compliance_status,"pending");assert.equal(d.rental_use_verified,false);
    await assert.rejects(db.query("update car_documents set storage_path='replacement.pdf' where id=$1",[d.id]),/Upload a replacement/);
  }finally{await db.close();}
});

test("expiry reminders and booking hold notifications are deduplicated",async()=>{
  const db=await fixture();try {
    await completeDocuments(db);
    await db.query("update car_documents set valid_until=((now() at time zone 'Asia/Manila')::date+30+time '23:59:59') at time zone 'Asia/Manila' where car_id=$1 and document_type='mayors_permit'",[CAR]);
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    await db.exec("select * from flag_vehicles_needing_renewal(); select * from flag_vehicles_needing_renewal();");
    const count=(await db.query("select count(*)::integer as n from notifications where title='Vehicle documents expire soon'")).rows[0].n;
    assert.equal(count,1);
    // A capture after coverage changed must create the same visible review hold.
    await approveDocument(db,"mayors_permit","2031-12-31T23:59:59.999+08:00");
    const b=(await db.query("insert into bookings(car_id,owner_id,renter_id,start_date,end_date,status) values($1,$2,$3,'2030-10-20','2030-10-25','awaiting_payment') returning id",[CAR,OWNER,RENTER])).rows[0];
    await db.query("update car_documents set compliance_status='revoked' where car_id=$1 and document_type='mayors_permit'",[CAR]);
    await db.query("update bookings set status='fully_paid' where id=$1",[b.id]);
    await db.exec("select * from flag_vehicles_needing_renewal(); select * from flag_vehicles_needing_renewal();");
    assert.equal((await db.query("select count(*)::integer as n from notifications where title='Booking documents need review'")).rows[0].n,2);
  }finally{await db.close();}
});

test("Storage RLS freezes referenced files while allowing orphan cleanup",async()=>{
  const db=await fixture();try {
    const path=`${OWNER}/${CAR}/bir.pdf`;
    await db.query("insert into car_documents(car_id,document_type,storage_path) values($1,'bir',$2)",[CAR,path]);
    await db.query("insert into storage.objects(bucket_id,name) values('vehicle-private-documents',$1),('vehicle-private-documents','orphan.pdf')",[path]);
    await db.exec(`
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,update,delete on storage.objects to authenticated;
      grant select on public.car_documents to authenticated;
      create policy owner_fixture on storage.objects for all to authenticated using(true) with check(true);
      set role authenticated;
    `);
    assert.equal((await db.query("update storage.objects set name='overwritten.pdf' where name=$1 returning id",[path])).rows.length,0);
    assert.equal((await db.query("delete from storage.objects where name=$1 returning id",[path])).rows.length,0);
    assert.equal((await db.query("delete from storage.objects where name='orphan.pdf' returning id")).rows.length,1);
  }finally{await db.close();}
});

test("a resubmission carries its authenticity evidence, and out-of-range values are clamped",async()=>{
  const db=await fixture();try {
    await completeDocuments(db);
    // Only the owner may resubmit, and protect_compliance_document must not
    // strip the provenance while it forces the row back to 'pending'.
    await db.exec(`select set_config('request.jwt.claim.sub','${OWNER}',false),set_config('test.reviewer','false',false)`);

    const good=`${OWNER}/${CAR}/bir_${crypto.randomUUID()}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name) values('vehicle-private-documents',$1)",[good]);
    await db.query("select public.submit_vehicle_document_update($1,$2::jsonb)",[CAR,JSON.stringify([{
      document_type:"bir",storage_path:good,content_sha256:"abc123",
      provenance_status:"credential_present",provenance_source:"c2pa",provenance_summary:"signed",
      ai_suspicion_score:0.25,ai_detector_name:"detector",ai_detector_version:"1.0",
      review_flag:"needs_admin_review",
    }])]);
    const kept=(await db.query("select compliance_status,content_sha256,provenance_status,provenance_source,ai_suspicion_score,ai_detector_name,review_flag from car_documents where storage_path=$1",[good])).rows[0];
    assert.equal(kept.compliance_status,"pending");
    assert.equal(kept.content_sha256,"abc123");
    assert.equal(kept.provenance_status,"credential_present");
    assert.equal(kept.provenance_source,"c2pa");
    assert.equal(Number(kept.ai_suspicion_score),0.25);
    assert.equal(kept.ai_detector_name,"detector");
    assert.equal(kept.review_flag,"needs_admin_review");

    // A value outside the check constraints must land on the safe default
    // rather than aborting the whole resubmission with a constraint error the
    // lister cannot act on.
    const bogus=`${OWNER}/${CAR}/ctpl_${crypto.randomUUID()}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name) values('vehicle-private-documents',$1)",[bogus]);
    await db.query("select public.submit_vehicle_document_update($1,$2::jsonb)",[CAR,JSON.stringify([{
      document_type:"ctpl",storage_path:bogus,
      provenance_status:"totally-made-up",ai_suspicion_score:"not-a-number",review_flag:"nonsense",
    }])]);
    const clamped=(await db.query("select provenance_status,ai_suspicion_score,review_flag from car_documents where storage_path=$1",[bogus])).rows[0];
    assert.equal(clamped.provenance_status,"unknown");
    assert.equal(clamped.ai_suspicion_score,null);
    assert.equal(clamped.review_flag,"none");

    // Everything CHAPTER 70 guarded still holds.
    await assert.rejects(db.query("select public.submit_vehicle_document_update($1,$2::jsonb)",[CAR,JSON.stringify([{document_type:"bir",storage_path:`${ADMIN}/${CAR}/bir.pdf`}])]),/private folder/);
  }finally{await db.close();}
});

test("the seven approved documents are enough - no classification step remains",async()=>{
  const db=await fixture();try {
    // CHAPTER 70 shipped an LTFRB gate that no listing could pass: while
    // ltfrb_requirement was 'pending' the summary always carried a reason, so
    // eligible could never be true and every car fell to renewal_required.
    assert.equal((await coverage(db)).eligible,false);
    await completeDocuments(db);
    const summary=await coverage(db);
    assert.equal(summary.eligible,true,JSON.stringify(summary.reasons));
    assert.deepEqual(summary.reasons,[],"no reason may survive a complete document set");

    // The retired columns and document types are gone for good.
    assert.equal((await db.query(`select count(*)::int as n from information_schema.columns
      where table_schema='public' and table_name='cars' and column_name in
      ('ltfrb_requirement','ltfrb_review_note','business_registration_type')`)).rows[0].n,0);
    await db.exec(`select set_config('request.jwt.claim.sub','${OWNER}',false),set_config('test.reviewer','false',false)`);
    await db.query("insert into storage.objects(bucket_id,name) values('vehicle-private-documents',$1)",[`${OWNER}/${CAR}/cpc.pdf`]);
    await assert.rejects(
      db.query("select public.submit_vehicle_document_update($1,$2::jsonb)",[CAR,JSON.stringify([{document_type:"cpc",storage_path:`${OWNER}/${CAR}/cpc.pdf`}])]),
      /Unsupported document type/,
    );
  }finally{await db.close();}
});
