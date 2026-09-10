// CHAPTER 83 - a deleted notification waits 30 days, then is gone.
//
// The window and the purge live in SQL, so they are proved against real
// PostgreSQL (PGlite) rather than trusted. The fixture builds only what the
// chapter touches and applies the chapter verbatim out of the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const USER = "11111111-1111-4111-8111-111111111111";

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;

    create table public.profiles(id uuid primary key);
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      title text not null,
      message text not null,
      type text default 'info',
      read boolean default false,
      link text,
      created_at timestamptz default now());
    create table public.retention_policy_rules(
      record_category text primary key,
      retention_days integer,
      rationale text not null,
      active boolean not null default true,
      updated_at timestamptz not null default now());

    insert into public.profiles(id) values('${USER}');
  `);

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 83 - A deleted notification waits 30 days, then is gone")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 83 exists in the master file");
  await db.exec("-- CHAPTER 83\n" + chapter);

  return db;
}

/** Insert one notification, optionally deleted `deletedDaysAgo` days ago. */
async function notify(db, title, deletedDaysAgo = null) {
  const { rows } = await db.query(
    `insert into public.notifications(user_id, title, message, deleted_at)
     values($1, $2, 'body', case when $3::int is null then null
                                 else now() - make_interval(days => $3::int) end)
     returning id`,
    [USER, title, deletedDaysAgo],
  );
  return rows[0].id;
}

const titlesLeft = async (db) => {
  const { rows } = await db.query("select title from public.notifications order by title");
  return rows.map((r) => r.title);
};

test("the chapter adds the column, the rule, and no way for a browser to delete", async () => {
  const db = await fixture();

  const { rows: cols } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'notifications'
        and column_name = 'deleted_at'`,
  );
  assert.equal(cols.length, 1, "notifications.deleted_at exists");

  const { rows: rule } = await db.query(
    "select retention_days, active from public.retention_policy_rules where record_category = 'deleted_notification'",
  );
  assert.equal(rule.length, 1, "the retention decision is declared in the rules table");
  assert.equal(rule[0].retention_days, 30);
  assert.equal(rule[0].active, true);

  const { rows: policies } = await db.query(
    "select count(*)::int as n from pg_policies where schemaname='public' and tablename='notifications' and cmd='DELETE'",
  );
  assert.equal(policies[0].n, 0, "no DELETE policy: only the service role can destroy a row");
});

test("a fresh delete is kept, one past the window is gone, an undeleted one is never touched", async () => {
  const db = await fixture();
  await notify(db, "kept - never deleted");
  await notify(db, "kept - deleted yesterday", 1);
  await notify(db, "kept - deleted 29 days ago", 29);
  await notify(db, "gone - deleted 31 days ago", 31);

  const { rows } = await db.query("select public.purge_deleted_notifications() as removed");
  assert.equal(rows[0].removed, 1, "exactly the one past the window");

  assert.deepEqual(await titlesLeft(db), [
    "kept - deleted 29 days ago",
    "kept - deleted yesterday",
    "kept - never deleted",
  ]);
});

test("the boundary belongs to the owner: 30 days is still theirs", async () => {
  const db = await fixture();
  // Just inside - a minute short of the full 30 days.
  await db.query(
    `insert into public.notifications(user_id, title, message, deleted_at)
     values($1, 'kept - a minute short of 30 days', 'body', now() - interval '30 days' + interval '1 minute')`,
    [USER],
  );
  const { rows } = await db.query("select public.purge_deleted_notifications() as removed");
  assert.equal(rows[0].removed, 0);
  assert.deepEqual(await titlesLeft(db), ["kept - a minute short of 30 days"]);
});

test("restoring puts it back out of reach of the purge", async () => {
  const db = await fixture();
  const id = await notify(db, "restored", 45);

  await db.query("update public.notifications set deleted_at = null where id = $1", [id]);
  const { rows } = await db.query("select public.purge_deleted_notifications() as removed");

  assert.equal(rows[0].removed, 0, "an undeleted notification is not on the purge list");
  assert.deepEqual(await titlesLeft(db), ["restored"]);
});

test("the window is read from the rules table, not baked into the job", async () => {
  const db = await fixture();
  await notify(db, "gone - deleted 8 days ago", 8);
  await notify(db, "kept - deleted 3 days ago", 3);

  await db.query(
    "update public.retention_policy_rules set retention_days = 7 where record_category = 'deleted_notification'",
  );
  const { rows } = await db.query("select public.purge_deleted_notifications() as removed");

  assert.equal(rows[0].removed, 1, "a shorter window takes effect without a code change");
  assert.deepEqual(await titlesLeft(db), ["kept - deleted 3 days ago"]);
});

test("a removed or switched-off rule falls back to 30 days, never to keeping forever", async () => {
  const db = await fixture();
  await notify(db, "gone - deleted 31 days ago", 31);
  await notify(db, "kept - deleted 10 days ago", 10);

  await db.query(
    "update public.retention_policy_rules set active = false where record_category = 'deleted_notification'",
  );
  let { rows } = await db.query("select public.purge_deleted_notifications() as removed");
  assert.equal(rows[0].removed, 1, "an inactive rule still means 30 days, not forever");
  assert.deepEqual(await titlesLeft(db), ["kept - deleted 10 days ago"]);

  await db.query("delete from public.retention_policy_rules");
  await notify(db, "gone - also 31 days ago", 31);
  ({ rows } = await db.query("select public.purge_deleted_notifications() as removed"));
  assert.equal(rows[0].removed, 1, "a missing rule behaves the same way");
});

test("the purge is not something a signed-in browser can run", async () => {
  const db = await fixture();
  await db.exec("set role authenticated;");
  await assert.rejects(
    db.query("select public.purge_deleted_notifications()"),
    /permission denied/i,
  );
  await db.exec("reset role;");
});
