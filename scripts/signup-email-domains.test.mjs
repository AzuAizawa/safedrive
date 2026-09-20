// CHAPTER 102 - registration accepts real mailboxes, from a list you control.
//
// The form check is the part a stranger can skip, so the rule has to hold at
// the profile insert: without a profile row an account can do nothing, which
// makes that insert the real gate. What matters most here is who it must NOT
// stop - accounts an admin creates through the service role, and every account
// that already existed before the list did. Proved against real PostgreSQL
// (PGlite) with the chapter applied verbatim from the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OLD_ACCOUNT = "11111111-1111-4111-8111-111111111111";
const GMAIL = "22222222-2222-4222-8222-222222222222";
const SCHOOL = "33333333-3333-4333-8333-333333333333";
const INVENTED = "44444444-4444-4444-8444-444444444444";
const BY_ADMIN = "55555555-5555-4555-8555-555555555555";
const NO_EMAIL = "66666666-6666-4666-8666-666666666666";

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
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.is_super_admin() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.super', true), 'false') = 'true' $$;
    -- The real helper reports "no PostgREST request behind this" as trusted, so
    -- the fixture models the flag the same way the browser/service split does.
    create function public.is_trusted_server_context() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.server', true), 'false') = 'true' $$;

    create table public.platform_settings(
      id text primary key default 'default',
      updated_at timestamptz not null default now());
    insert into public.platform_settings(id) values('default');

    create table public.profiles(
      id uuid primary key,
      email text,
      role text default 'user',
      verified_status text default 'unverified',
      deleted_at timestamptz);
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);

    insert into auth.users(id, email) values
      ('${OLD_ACCOUNT}', 'early.adopter@hellostevekel.com'),
      ('${GMAIL}', 'someone@gmail.com'),
      ('${SCHOOL}', 'student@up.edu.ph'),
      ('${INVENTED}', 'hello@hellostevekel.com'),
      ('${BY_ADMIN}', 'safedrive-role-test@example.com'),
      ('${NO_EMAIL}', null);
  `);

  // An account that existed before the rule did, on a domain the rule refuses.
  await db.query("insert into public.profiles(id, email) values($1, $2)", [
    OLD_ACCOUNT,
    "early.adopter@hellostevekel.com",
  ]);

  await db.exec(await chapter("-- CHAPTER 102 - Registration accepts real mailboxes, from a list you control"));
  return db;
}

/** Act as the browser: a stranger at the registration form. */
const asBrowser = (db) => db.query("select set_config('test.server', 'false', false)");
/** Act as the server (service role): admin-created accounts and imports. */
const asServer = (db) => db.query("select set_config('test.server', 'true', false)");

const createProfile = (db, id, email) =>
  db.query("insert into public.profiles(id, email) values($1, $2) returning id", [id, email]);

const allowed = async (db, email) =>
  (await db.query("select public.is_allowed_signup_email($1) as ok", [email])).rows[0].ok;

test("the seeded list accepts the mainstream providers", async () => {
  const db = await fixture();
  for (const email of [
    "someone@gmail.com",
    "someone@googlemail.com",
    "someone@yahoo.com",
    "someone@yahoo.com.ph",
    "someone@outlook.com",
    "someone@hotmail.com",
    "someone@icloud.com",
    "someone@proton.me",
  ]) {
    assert.equal(await allowed(db, email), true, email);
  }
});

test("a leading dot covers every school and government domain under it", async () => {
  const db = await fixture();
  assert.equal(await allowed(db, "student@up.edu.ph"), true);
  assert.equal(await allowed(db, "student@dlsu.edu.ph"), true);
  assert.equal(await allowed(db, "someone@my.school.edu.ph"), true, "any depth");
  assert.equal(await allowed(db, "clerk@lto.gov.ph"), true);
  assert.equal(await allowed(db, "someone@edu.ph"), true, "the bare domain too");
  assert.equal(await allowed(db, "someone@notedu.ph"), false, "not a loose substring");
});

test("an invented domain is refused, and so is a malformed address", async () => {
  const db = await fixture();
  assert.equal(await allowed(db, "hello@hellostevekel.com"), false);
  assert.equal(await allowed(db, "gmail.com"), false, "no @ at all");
  assert.equal(await allowed(db, "someone@"), false);
  assert.equal(await allowed(db, ""), false);
  assert.equal(await allowed(db, null), false);
});

test("case and stray spacing do not get anyone past or blocked", async () => {
  const db = await fixture();
  assert.equal(await allowed(db, "  SomeOne@GMAIL.com  "), true);
  assert.equal(await allowed(db, "Hello@HelloStevekel.COM"), false);
});

test("a stranger with an invented domain cannot create a profile", async () => {
  const db = await fixture();
  await asBrowser(db);
  await assert.rejects(
    createProfile(db, INVENTED, "hello@hellostevekel.com"),
    /SafeDrive does not accept registrations from hellostevekel\.com/i,
  );
});

test("the judged address is the authenticated one, not what the browser typed", async () => {
  const db = await fixture();
  await asBrowser(db);
  // auth.users says hellostevekel.com; the insert claims gmail.com.
  await assert.rejects(
    createProfile(db, INVENTED, "someone@gmail.com"),
    /does not accept registrations from hellostevekel\.com/i,
  );
});

test("gmail and school registrations go through", async () => {
  const db = await fixture();
  await asBrowser(db);
  assert.equal((await createProfile(db, GMAIL, "someone@gmail.com")).rows.length, 1);
  assert.equal((await createProfile(db, SCHOOL, "student@up.edu.ph")).rows.length, 1);
});

test("an account an admin creates through the service role is never blocked", async () => {
  const db = await fixture();
  await asServer(db);
  const { rows } = await createProfile(db, BY_ADMIN, "safedrive-role-test@example.com");
  assert.equal(rows.length, 1, "api/admin-create.ts and the role-matrix script keep working");
});

test("an account with no authenticated email is left alone", async () => {
  const db = await fixture();
  await asBrowser(db);
  const { rows } = await createProfile(db, NO_EMAIL, "");
  assert.equal(rows.length, 1);
});

test("accounts that already existed keep working, refused domain or not", async () => {
  const db = await fixture();
  await asBrowser(db);
  const { rows } = await db.query("select email from public.profiles where id = $1", [OLD_ACCOUNT]);
  assert.equal(rows.length, 1, "still there");

  // The trigger is INSERT only: signing in, editing and closing still work.
  await db.query("update public.profiles set verified_status = 'verified' where id = $1", [OLD_ACCOUNT]);
  await db.query("update public.profiles set deleted_at = now() where id = $1", [OLD_ACCOUNT]);
  const { rows: after } = await db.query(
    "select verified_status, deleted_at from public.profiles where id = $1",
    [OLD_ACCOUNT],
  );
  assert.equal(after[0].verified_status, "verified");
  assert.ok(after[0].deleted_at);
});

test("a super admin can add a domain and it takes effect immediately", async () => {
  const db = await fixture();
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [GMAIL]);
  await db.query("select set_config('test.super', 'true', false)");
  await db.query("select public.set_signup_email_domains($1)", [
    ["gmail.com", ".edu.ph", "hellostevekel.com"],
  ]);

  assert.equal(await allowed(db, "hello@hellostevekel.com"), true, "added");
  assert.equal(await allowed(db, "someone@yahoo.com"), false, "removed with the rest");

  await asBrowser(db);
  assert.equal((await createProfile(db, INVENTED, "hello@hellostevekel.com")).rows.length, 1);
});

test("only a super admin can change the list", async () => {
  const db = await fixture();
  await db.query("select set_config('test.super', 'false', false)");
  await assert.rejects(
    db.query("select public.set_signup_email_domains($1)", [["gmail.com"]]),
    /Only a super admin can change the accepted signup email domains/i,
  );
});

test("the list refuses entries that could never match anyone", async () => {
  const db = await fixture();
  await db.query("select set_config('test.super', 'true', false)");
  for (const bad of ["gmail", "not a domain.com", "user@gmail.com", ".com"]) {
    await assert.rejects(
      db.query("select public.set_signup_email_domains($1)", [[bad]]),
      /Not a valid domain/i,
      bad,
    );
  }
  await assert.rejects(
    db.query("select public.set_signup_email_domains($1)", [[" ", ""]]),
    /Provide at least one domain/i,
  );
});

test("saving the list tidies it and records who changed it", async () => {
  const db = await fixture();
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [GMAIL]);
  await db.query("select set_config('test.super', 'true', false)");
  const { rows } = await db.query("select public.set_signup_email_domains($1) as saved", [
    ["  GMAIL.com ", "gmail.com", ".EDU.ph", ""],
  ]);
  assert.deepEqual(rows[0].saved, ["gmail.com", ".edu.ph"], "lowercased, trimmed, de-duplicated");

  const { rows: audit } = await db.query(
    "select user_id, action, details from public.audit_log where action = 'signup_email_domains_updated'",
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, GMAIL);
  assert.equal(audit[0].details.count, 2);
});

test("an empty list opens the door rather than sealing it shut", async () => {
  const db = await fixture();
  // Not reachable through the setter, which refuses an empty list - this is
  // the setting being cleared some other way. Refusing everyone would take
  // registration down entirely, which is the worse failure.
  await db.query("update public.platform_settings set signup_email_domains = array[]::text[] where id = 'default'");
  assert.equal(await allowed(db, "hello@hellostevekel.com"), true);
  await asBrowser(db);
  assert.equal((await createProfile(db, INVENTED, "hello@hellostevekel.com")).rows.length, 1);
});
