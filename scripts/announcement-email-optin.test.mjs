// CHAPTER 101 - an announcement can also reach the inbox, when it is asked to.
//
// The function's return type changes while it is live, so the swap itself is
// the thing to prove: the old integer version is created first, exactly as the
// database already has it, and the chapter has to replace it cleanly and keep
// every rule it enforced - super admin only, the length and audience checks,
// and an audience decided by who owns a car. Proved against real PostgreSQL
// (PGlite) with the chapter applied verbatim from the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const BOSS = "11111111-1111-4111-8111-111111111111";
const LISTER = "22222222-2222-4222-8222-222222222222";
const RENTER = "33333333-3333-4333-8333-333333333333";
const CLOSED = "44444444-4444-4444-8444-444444444444";

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
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.is_super_admin() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.super', true), 'false') = 'true' $$;

    create table public.profiles(
      id uuid primary key,
      role text default 'user',
      deleted_at timestamptz);
    create table public.cars(
      id uuid primary key default gen_random_uuid(),
      owner_id uuid references public.profiles(id) not null);
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid references public.profiles(id) not null,
      title text, message text, type text, link text,
      created_at timestamptz default clock_timestamp());
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);

    create table if not exists public.platform_announcements (
      id uuid primary key default gen_random_uuid(),
      title text not null check (char_length(btrim(title)) between 1 and 120),
      message text not null check (char_length(btrim(message)) between 1 and 2000),
      audience text not null check (audience in ('all', 'listers', 'renters')),
      recipient_count integer not null default 0,
      created_by uuid not null references public.profiles(id) on delete restrict,
      created_at timestamptz not null default now()
    );

    insert into public.profiles(id, role, deleted_at) values
      ('${BOSS}', 'super_admin', null),
      ('${LISTER}', 'user', null),
      ('${RENTER}', 'user', null),
      ('${CLOSED}', 'user', now());
    insert into public.cars(owner_id) values('${LISTER}');
  `);

  // The pre-chapter function, as the live database has it: returns integer.
  await db.exec(`
    create function public.send_platform_announcement(
      p_title text, p_message text, p_audience text
    ) returns integer language plpgsql security definer set search_path = public
    as $old$
    begin
      if not public.is_super_admin() then
        raise exception 'Only a super admin can send an announcement';
      end if;
      return 0;
    end;
    $old$;
  `);
  // An announcement that existed before the chapter, to prove it is left alone.
  await db.query(
    `insert into public.platform_announcements(title, message, audience, recipient_count, created_by)
     values('Old notice', 'Sent before CHAPTER 101', 'all', 3, $1)`,
    [BOSS],
  );

  await db.exec(await chapter("-- CHAPTER 101 - An announcement can also reach the inbox, when it is asked to"));
  return db;
}

const asSuperAdmin = async (db, uid = BOSS, { boss = true } = {}) => {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.query("select set_config('test.super', $1, false)", [boss ? "true" : "false"]);
};

const announce = (db, audience = "all", title = "Updated Terms", message = "Please review.") =>
  db.query("select public.send_platform_announcement($1, $2, $3) as result", [title, message, audience]);

test("the function returns the new announcement's id with the recipient count", async () => {
  const db = await fixture();
  await asSuperAdmin(db);
  const { rows } = await announce(db);
  const result = rows[0].result;
  assert.ok(result.id, "an id the browser can ask to email");
  assert.equal(result.recipients, 2, "both live members, not the closed account");

  // The id is the row that was just written - not whatever happens to be newest.
  const { rows: saved } = await db.query(
    "select title, audience, recipient_count from public.platform_announcements where id = $1",
    [result.id],
  );
  assert.equal(saved[0].title, "Updated Terms");
  assert.equal(saved[0].audience, "all");
  assert.equal(saved[0].recipient_count, 2);
});

test("only one send_platform_announcement survives the swap", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select count(*)::int as n, min(pg_get_function_result(oid)) as result_type
       from pg_proc where proname = 'send_platform_announcement'
        and pronamespace = 'public'::regnamespace`,
  );
  assert.equal(rows[0].n, 1, "the old integer version is gone, not left beside the new one");
  assert.equal(rows[0].result_type, "jsonb");
});

test("the bell notification still goes out, unchanged", async () => {
  const db = await fixture();
  await asSuperAdmin(db);
  await announce(db);
  const { rows } = await db.query(
    "select user_id, title, type, link from public.notifications order by user_id",
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.user_id), [LISTER, RENTER]);
  assert.equal(rows[0].type, "announcement");
  assert.equal(rows[0].link, "/notifications");
});

test("a closed account is never a recipient", async () => {
  const db = await fixture();
  await asSuperAdmin(db);
  await announce(db);
  const { rows } = await db.query("select count(*)::int as n from public.notifications where user_id = $1", [CLOSED]);
  assert.equal(rows[0].n, 0);
});

test("audience is still decided by who owns a car", async () => {
  const db = await fixture();
  await asSuperAdmin(db);

  const listers = (await announce(db, "listers")).rows[0].result;
  assert.equal(listers.recipients, 1);
  const renters = (await announce(db, "renters")).rows[0].result;
  assert.equal(renters.recipients, 1);

  const { rows } = await db.query(
    "select distinct user_id from public.notifications where title = 'Updated Terms' order by user_id",
  );
  assert.deepEqual(rows.map((r) => r.user_id), [LISTER, RENTER]);
});

test("an admin who is not a super admin still cannot announce", async () => {
  const db = await fixture();
  await asSuperAdmin(db, LISTER, { boss: false });
  await assert.rejects(announce(db), /Only a super admin can send an announcement/i);
  const { rows } = await db.query("select count(*)::int as n from public.notifications");
  assert.equal(rows[0].n, 0, "nothing was sent");
});

test("the length and audience rules are still enforced", async () => {
  const db = await fixture();
  await asSuperAdmin(db);
  await assert.rejects(announce(db, "all", "   ", "body"), /Title must be 1-120 characters/i);
  await assert.rejects(announce(db, "all", "x".repeat(121), "body"), /Title must be 1-120 characters/i);
  await assert.rejects(announce(db, "all", "Title", "  "), /Message must be 1-2000 characters/i);
  await assert.rejects(announce(db, "everyone"), /Audience must be all, listers or renters/i);
});

test("a new announcement is bell-only until emails are actually attempted", async () => {
  const db = await fixture();
  await asSuperAdmin(db);
  const { id } = (await announce(db)).rows[0].result;
  const { rows } = await db.query(
    "select emailed_at, email_sent_count from public.platform_announcements where id = $1",
    [id],
  );
  assert.equal(rows[0].emailed_at, null, "opt-in: nothing is emailed by default");
  assert.equal(rows[0].email_sent_count, null);
});

test("announcements sent before the chapter are left bell-only, not backdated", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    "select emailed_at, email_sent_count, recipient_count from public.platform_announcements where title = 'Old notice'",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].emailed_at, null);
  assert.equal(rows[0].email_sent_count, null);
  assert.equal(rows[0].recipient_count, 3, "its own history is untouched");
});

test("the delivery outcome can be recorded against the announcement", async () => {
  const db = await fixture();
  await asSuperAdmin(db);
  const { id } = (await announce(db)).rows[0].result;
  await db.query(
    "update public.platform_announcements set emailed_at = now(), email_sent_count = $2 where id = $1",
    [id, 2],
  );
  const { rows } = await db.query(
    "select emailed_at is not null as attempted, email_sent_count from public.platform_announcements where id = $1",
    [id],
  );
  assert.equal(rows[0].attempted, true);
  assert.equal(rows[0].email_sent_count, 2);
});

test("the audit entry still records the send", async () => {
  const db = await fixture();
  await asSuperAdmin(db);
  const { id } = (await announce(db)).rows[0].result;
  const { rows } = await db.query(
    "select user_id, action, entity_id, details from public.audit_log where action = 'platform_announcement_sent'",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, BOSS);
  assert.equal(rows[0].entity_id, id);
  assert.equal(rows[0].details.recipients, 2);
});
