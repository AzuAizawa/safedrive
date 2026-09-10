// CHAPTER 85 - an account can be suspended.
//
// Suspension is a moderation power that a suspended person must not be able to
// undo, so the guards are proved against real PostgreSQL (PGlite) rather than
// trusted. The fixture builds only what the chapter touches and applies the
// chapter verbatim out of the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MODERATOR = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";

const REASON = "Repeatedly cancelled trips after the renter arrived.";

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.admin_can(text) returns boolean language sql stable as
      $$ select coalesce(current_setting('test.moderate', true), 'false') = 'true' $$;
    create function public.is_admin() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.is_admin', true), 'false') = 'true' $$;
    create function public.is_super_admin() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.is_super_admin', true), 'false') = 'true' $$;
    create function public.is_trusted_server_context() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.server', true), 'false') = 'true' $$;

    create table public.profiles(
      id uuid primary key,
      email text,
      role text default 'user',
      rejection_reason text,
      login_blocked_until timestamptz,
      login_block_reason text,
      verified_status text default 'verified',
      first_name text, middle_name text, last_name text, full_name text,
      birthday date, driver_license text, national_id text, secondary_id_type text,
      license_expiry date, license_transmission text, license_expiry_notified_at timestamptz,
      license_update_pending boolean default false,
      is_lister boolean default false,
      deleted_at timestamptz,
      admin_disabled_at timestamptz,
      payout_method text, payout_account_name text, payout_account_number text,
      updated_at timestamptz default now());
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, title text, message text, type text, link text,
      created_at timestamptz default now());
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);

    insert into public.profiles(id, email, role, full_name) values
      ('${MEMBER}', 'member@example.com', 'user', 'A Member'),
      ('${OTHER}', 'other@example.com', 'user', 'Another Member'),
      ('${MODERATOR}', 'mod@example.com', 'admin', 'A Moderator'),
      ('${STAFF}', 'staff@example.com', 'admin', 'Staff Account');
  `);

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 85 - An account can be suspended")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 85 exists in the master file");
  // The chapter's own header line is a comment; re-attach one so the slice is
  // still valid SQL on its own.
  await db.exec("-- CHAPTER 85\n" + chapter.slice(chapter.indexOf("\n")));

  return db;
}

/** Act as a moderator, a plain admin without the permission, or a member. */
async function actAs(db, uid, { moderate = false, admin = false, superAdmin = false } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.query("select set_config('test.moderate', $1, false)", [moderate ? "true" : "false"]);
  await db.query("select set_config('test.is_admin', $1, false)", [admin ? "true" : "false"]);
  await db.query("select set_config('test.is_super_admin', $1, false)", [
    superAdmin ? "true" : "false",
  ]);
  await db.query("select set_config('test.server', 'false', false)");
}

const suspensionOf = async (db, id) => {
  const { rows } = await db.query(
    "select suspended_at, suspension_reason, suspended_by from public.profiles where id = $1",
    [id],
  );
  return rows[0];
};

test("the chapter adds the columns and suspends nobody", async () => {
  const db = await fixture();

  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('suspended_at', 'suspension_reason', 'suspended_by')
      order by column_name`,
  );
  assert.deepEqual(
    rows.map((r) => r.column_name),
    ["suspended_at", "suspended_by", "suspension_reason"],
  );

  const { rows: live } = await db.query(
    "select count(*)::int as n from public.profiles where suspended_at is not null",
  );
  assert.equal(live[0].n, 0);
});

test("a moderator suspends with a reason, and the person is told why", async () => {
  const db = await fixture();
  await actAs(db, MODERATOR, { moderate: true, admin: true });

  await db.query("select public.set_account_suspended($1, true, $2)", [MEMBER, REASON]);

  const state = await suspensionOf(db, MEMBER);
  assert.ok(state.suspended_at, "the account is suspended");
  assert.equal(state.suspension_reason, REASON);
  assert.equal(state.suspended_by, MODERATOR, "who did it is recorded");

  const { rows: notes } = await db.query(
    "select title, message from public.notifications where user_id = $1",
    [MEMBER],
  );
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /Repeatedly cancelled trips/);
  assert.match(notes[0].message, /already under way continues/, "and what still stands");

  const { rows: audit } = await db.query(
    "select action from public.audit_log where entity_id = $1",
    [MEMBER],
  );
  assert.deepEqual(audit.map((r) => r.action), ["admin_suspended_account"]);
});

test("suspending without a real reason is refused", async () => {
  const db = await fixture();
  await actAs(db, MODERATOR, { moderate: true, admin: true });

  for (const bad of [null, "", "   ", "too short"]) {
    await assert.rejects(
      db.query("select public.set_account_suspended($1, true, $2)", [MEMBER, bad]),
      /at least 10 characters/i,
    );
  }
  assert.equal((await suspensionOf(db, MEMBER)).suspended_at, null);
});

test("lifting clears the suspension and says so", async () => {
  const db = await fixture();
  await actAs(db, MODERATOR, { moderate: true, admin: true });

  await db.query("select public.set_account_suspended($1, true, $2)", [MEMBER, REASON]);
  await db.query("select public.set_account_suspended($1, false, null)", [MEMBER]);

  assert.deepEqual(await suspensionOf(db, MEMBER), {
    suspended_at: null,
    suspension_reason: null,
    suspended_by: null,
  });

  const { rows: notes } = await db.query(
    "select title from public.notifications where user_id = $1 order by created_at",
    [MEMBER],
  );
  assert.deepEqual(notes.map((r) => r.title), [
    "Your account is suspended",
    "Your account is active again",
  ]);
});

test("a suspended member cannot lift their own suspension", async () => {
  const db = await fixture();
  await actAs(db, MODERATOR, { moderate: true, admin: true });
  await db.query("select public.set_account_suspended($1, true, $2)", [MEMBER, REASON]);

  // Now act as the suspended person editing their own profile row.
  await actAs(db, MEMBER);
  await assert.rejects(
    db.query("update public.profiles set suspended_at = null where id = $1", [MEMBER]),
    /cannot lift their own suspension/i,
  );
  await assert.rejects(
    db.query("update public.profiles set suspension_reason = 'nothing happened' where id = $1", [
      MEMBER,
    ]),
    /cannot lift their own suspension/i,
  );

  assert.ok((await suspensionOf(db, MEMBER)).suspended_at, "still suspended");

  // An ordinary edit they are allowed to make still works.
  await db.query("update public.profiles set phone_checked = null where id = $1", [MEMBER]).catch(
    async () => {
      await db.query("update public.profiles set full_name = 'A Member' where id = $1", [MEMBER]);
    },
  );
});

test("suspension needs users.moderate, and cannot be routed around by a bare update", async () => {
  const db = await fixture();

  // A plain admin without the permission, calling the function.
  await actAs(db, MODERATOR, { moderate: false, admin: true });
  await assert.rejects(
    db.query("select public.set_account_suspended($1, true, $2)", [MEMBER, REASON]),
    /users\.moderate permission/i,
  );

  // Same admin, trying to write the column directly.
  await assert.rejects(
    db.query("update public.profiles set suspended_at = now() where id = $1", [MEMBER]),
    /requires the users\.moderate permission/i,
  );

  assert.equal((await suspensionOf(db, MEMBER)).suspended_at, null);
});

test("staff are disabled through admin management, not suspension", async () => {
  const db = await fixture();
  await actAs(db, MODERATOR, { moderate: true, admin: true });

  await assert.rejects(
    db.query("select public.set_account_suspended($1, true, $2)", [STAFF, REASON]),
    /Staff accounts are disabled through admin management/i,
  );
});

test("a missing account is reported rather than silently ignored", async () => {
  const db = await fixture();
  await actAs(db, MODERATOR, { moderate: true, admin: true });

  await assert.rejects(
    db.query("select public.set_account_suspended($1, true, $2)", [
      "99999999-9999-4999-8999-999999999999",
      REASON,
    ]),
    /User not found/i,
  );
});

test("suspending one member leaves everyone else alone", async () => {
  const db = await fixture();
  await actAs(db, MODERATOR, { moderate: true, admin: true });
  await db.query("select public.set_account_suspended($1, true, $2)", [MEMBER, REASON]);

  assert.equal((await suspensionOf(db, OTHER)).suspended_at, null);
});
