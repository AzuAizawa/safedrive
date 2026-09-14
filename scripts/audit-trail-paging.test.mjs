// CHAPTER 89 - the audit trail pages through every entry.
//
// The page used to load the newest 200 entries, so anything older could not be
// reached and search only looked inside those 200. Paging, filtering and search
// now happen in the database; this proves them against real PostgreSQL
// (PGlite), with the chapter applied verbatim out of the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { pageRange, serverPageInfo } from "../src/lib/pagination.ts";

const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";

let chapter;

// 25 vehicle approvals by Ana, 10 system payouts, 2 refunds by Ben,
// 6 empty return-reminder sweeps (routine) and 2 that did something: 45 rows.
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create function public.admin_can(p_key text) returns boolean language sql stable as
      $$ select p_key = 'audit.view' and coalesce(current_setting('test.audit', true), 'false') = 'true' $$;

    create table public.profiles(id uuid primary key, full_name text, email text);
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid references public.profiles(id),
      action text not null,
      entity_type text,
      entity_id text,
      details jsonb,
      created_at timestamptz default now());

    insert into public.profiles values
      ('${ANA}', 'Ana Reyes', 'ana@safedrive.test'),
      ('${BEN}', 'Ben 100% Cruz', 'ben@safedrive.test');

    insert into public.audit_log(user_id, action, created_at)
      select '${ANA}', 'admin_approved_vehicle', timestamptz '2030-01-01' + (n || ' minutes')::interval
      from generate_series(1, 25) n;
    insert into public.audit_log(user_id, action, created_at)
      select null, 'payout_sent', timestamptz '2030-01-02' + (n || ' minutes')::interval
      from generate_series(1, 10) n;
    insert into public.audit_log(user_id, action, created_at)
      select '${BEN}', 'refund_marked_manual', timestamptz '2030-01-03' + (n || ' minutes')::interval
      from generate_series(1, 2) n;
    insert into public.audit_log(action, details, created_at)
      select 'return_reminder_sweep', '{"checked": 0, "email_reminders": 0, "notifications_created": 0}',
             timestamptz '2030-01-04' + (n || ' minutes')::interval
      from generate_series(1, 6) n;
    insert into public.audit_log(action, details, created_at)
      select 'return_reminder_sweep', '{"checked": 3, "email_reminders": 1, "notifications_created": 1}',
             timestamptz '2030-01-05' + (n || ' minutes')::interval
      from generate_series(1, 2) n;

    select set_config('test.audit', 'true', false);
  `);

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 89 - The audit trail pages through every entry")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 89 exists in the master file");
  await db.exec("-- CHAPTER 89\n" + chapter.slice(chapter.indexOf("\n")));
  return db;
}

const pageOf = async (db, options = {}) => {
  const {
    search = null,
    actions = null,
    searchActions = null,
    includeRoutine = false,
    limit = 20,
    offset = 0,
  } = options;
  const { rows } = await db.query(
    "select * from public.admin_audit_log_page($1, $2, $3, $4, $5, $6)",
    [search, actions, searchActions, includeRoutine, limit, offset],
  );
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
};

test("the chapter changes no rows", async () => {
  const db = await fixture();
  const { rows } = await db.query("select count(*)::int as n from public.audit_log");
  assert.equal(rows[0].n, 45);
});

test("every entry is reachable, newest first, one page at a time", async () => {
  const db = await fixture();
  const seen = [];
  let total = 0;
  for (let page = 1; page <= 3; page += 1) {
    const { from } = pageRange(page, 20);
    const result = await pageOf(db, { offset: from });
    if (page === 1) total = result.total;
    seen.push(...result.rows);
  }
  assert.equal(total, 39, "45 entries minus 6 routine sweeps");
  assert.equal(seen.length, 39, "pages 1-3 hold 20 + 19 + 0");
  assert.equal(new Set(seen.map((r) => r.id)).size, 39, "no entry appears twice");
  const times = seen.map((r) => new Date(r.created_at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first across pages");
  assert.equal(seen.at(-1).action, "admin_approved_vehicle", "the oldest entry is on the last page");
  assert.equal((await pageOf(db, { offset: 40 })).rows.length, 0, "a page past the end is empty, so the page returns to page 1");
});

test("routine sweeps are hidden unless asked for", async () => {
  const db = await fixture();
  assert.equal((await pageOf(db, { includeRoutine: true })).total, 45);
  const { rows } = await pageOf(db, { actions: ["return_reminder_sweep"] });
  assert.equal(rows.length, 2, "only the sweeps that did something");
});

test("an action filter and a category (a list of actions) narrow the whole trail", async () => {
  const db = await fixture();
  assert.equal((await pageOf(db, { actions: ["payout_sent"] })).total, 10);
  assert.equal((await pageOf(db, { actions: ["payout_sent", "refund_marked_manual"] })).total, 12);
  assert.equal((await pageOf(db, { actions: [] })).total, 0, "a category with no actions shows nothing");
});

test("search finds the actor, the action and the on-screen label across every page", async () => {
  const db = await fixture();
  assert.equal((await pageOf(db, { search: "ana" })).total, 25, "by name");
  assert.equal((await pageOf(db, { search: "BEN@SAFEDRIVE" })).total, 2, "by email, any case");
  assert.equal((await pageOf(db, { search: "approved vehicle" })).total, 25, "by the action's words");
  assert.equal((await pageOf(db, { search: "admin_approved" })).total, 25, "by the raw action name");
  assert.equal(
    (await pageOf(db, { search: "owner payout", searchActions: ["payout_sent"] })).total,
    10,
    "by a label the page resolved ('Sent owner payout')",
  );
  assert.equal((await pageOf(db, { search: "nobody" })).total, 0);
});

test("what is typed is literal text, not a wildcard", async () => {
  const db = await fixture();
  assert.equal((await pageOf(db, { search: "%" })).total, 2, "only Ben's name has a %");
});

test("a page is never larger than 100 rows or smaller than 1", async () => {
  const db = await fixture();
  assert.equal((await pageOf(db, { includeRoutine: true, limit: 1000 })).rows.length, 45);
  assert.equal((await pageOf(db, { limit: 0 })).rows.length, 1);
  assert.equal((await pageOf(db, { offset: -5 })).rows.length, 20);
});

test("action counts drive the filter list and the category counts", async () => {
  const db = await fixture();
  const { rows } = await db.query("select * from public.admin_audit_log_actions()");
  const byAction = Object.fromEntries(rows.map((r) => [r.action, [Number(r.entries), Number(r.routine_entries)]]));
  assert.deepEqual(byAction, {
    admin_approved_vehicle: [25, 0],
    payout_sent: [10, 0],
    refund_marked_manual: [2, 0],
    return_reminder_sweep: [8, 6],
  });
});

test("the routine rule matches the page's", async () => {
  const db = await fixture();
  const check = async (action, details) =>
    (await db.query("select public.is_routine_audit_entry($1, $2::jsonb) as r", [action, details])).rows[0].r;
  assert.equal(await check("return_reminder_sweep", null), true, "no details: nothing was done");
  assert.equal(await check("return_reminder_sweep", '{"bookings_checked": 0, "gmail_reminders": 0}'), true);
  assert.equal(await check("return_reminder_sweep", '{"checked": 0, "notifications_created": 2}'), false);
  assert.equal(await check("payout_sent", null), false, "only sweeps are ever routine");
});

test("only someone who may read the audit log gets anything", async () => {
  const db = await fixture();
  await db.query("select set_config('test.audit', 'false', false)");
  await assert.rejects(pageOf(db), /audit\.view permission/i);
  const { rows } = await db.query("select * from public.admin_audit_log_actions()");
  assert.equal(rows.length, 0);

  const { rows: grants } = await db.query(`
    select has_function_privilege('anon', 'public.admin_audit_log_page(text,text[],text[],boolean,integer,integer)', 'execute') as anon_page,
           has_function_privilege('anon', 'public.admin_audit_log_actions()', 'execute') as anon_actions`);
  assert.deepEqual(grants[0], { anon_page: false, anon_actions: false });
});

test("the page footer's numbers for a database-paged list", () => {
  assert.deepEqual(serverPageInfo(1, 39, 20), { page: 1, pageCount: 2, startIndex: 0, endIndex: 20, total: 39 });
  assert.deepEqual(serverPageInfo(2, 39, 20), { page: 2, pageCount: 2, startIndex: 20, endIndex: 39, total: 39 });
  assert.equal(serverPageInfo(9, 39, 20).page, 2, "a page past the end shows the last one");
  assert.deepEqual(serverPageInfo(1, 0, 20), { page: 1, pageCount: 1, startIndex: 0, endIndex: 0, total: 0 });
  assert.deepEqual(pageRange(3, 20), { from: 40, to: 59 });
  assert.deepEqual(pageRange(0, 20), { from: 0, to: 19 });
});
