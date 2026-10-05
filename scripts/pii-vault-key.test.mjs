// CHAPTER 123 - identity numbers are locked with a key kept in the Vault.
//
// Proved against real PostgreSQL (PGlite) with real pgcrypto in the
// extensions schema, as on Supabase, and a stand-in for Supabase Vault. The
// numbers stored with the old fallback key are moved to the Vault key and
// still read back the same; only an admin can read them; a new number is
// stored on the Vault key; running the chapter again changes nothing; and
// without the Vault the chapter changes nothing at all.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const LEGACY = "safedrive-dev-secret-key-fallback";

let master;
async function chapter() {
  const header = "-- CHAPTER 123 - Identity numbers are locked with a key kept in the Vault";
  master ??= await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  );
  const body = master.split(header)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, `${header} exists in the master file`);
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
}

async function fixture({ vault = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions;
    create extension pgcrypto schema extensions;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.profiles(
      id uuid primary key, role text, driver_license text, national_id text);
    create function public.is_admin() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin')) $$;
    -- The live trigger: every write of a number goes through encrypt_pii.
    create function public.handle_pii_encryption() returns trigger language plpgsql as $$
    begin
      new.driver_license := public.encrypt_pii(new.driver_license);
      new.national_id := public.encrypt_pii(new.national_id);
      return new;
    end $$;
    create function public.encrypt_pii(content text) returns text language sql as $$ select content $$;
    create trigger encrypt_pii before insert or update on public.profiles
      for each row execute function public.handle_pii_encryption();
  `);
  if (vault) {
    await db.exec(`
      create schema vault;
      create table vault.secrets(
        id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
      create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
      create function vault.create_secret(new_secret text, new_name text, new_description text)
        returns uuid language sql as $$
        insert into vault.secrets(secret, name, description) values ($1, $2, $3) returning id $$;
    `);
  }
  // Stored the way the live project stored them: with the fallback key.
  const legacy = (value) =>
    `'pgp:' || encode(extensions.pgp_sym_encrypt('${value}', '${LEGACY}'), 'base64')`;
  await db.exec(`
    insert into public.profiles values
      ('${ADMIN}', 'admin', null, null),
      ('${MEMBER}', 'user', ${legacy("N23-25-005607")}, ${legacy("PSN-1234")});
  `);
  return db;
}

const as = (db, uid) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
const stored = async (db) =>
  (await db.query(`select driver_license, national_id from public.profiles where id = $1`, [MEMBER])).rows[0];
const read = async (db, value) =>
  (await db.query(`select public.decrypt_pii($1) as v`, [value])).rows[0].v;

test("numbers move from the fallback key to the Vault key and read back the same, for admins only", async () => {
  const db = await fixture();
  const before = await stored(db);
  await db.exec(await chapter());
  const after = await stored(db);
  assert.notEqual(after.driver_license, before.driver_license, "re-encrypted");
  assert.match(after.driver_license, /^pgp:/);

  await as(db, ADMIN);
  assert.equal(await read(db, after.driver_license), "N23-25-005607");
  assert.equal(await read(db, after.national_id), "PSN-1234");

  await as(db, MEMBER);
  assert.equal(await read(db, after.driver_license), null, "a non-admin reads nothing");

  await assert.rejects(
    db.query(
      `select extensions.pgp_sym_decrypt(decode(substring($1 from 5), 'base64'), $2)`,
      [after.driver_license, LEGACY],
    ),
    "the fallback key in the source no longer opens it",
  );
});

test("a new number is stored on the Vault key, and running the chapter again changes nothing", async () => {
  const db = await fixture();
  await db.exec(await chapter());
  await db.query(`update public.profiles set driver_license = 'D01-23-456789' where id = $1`, [MEMBER]);
  const first = await stored(db);
  await db.exec(await chapter());
  assert.deepEqual(await stored(db), first);
  assert.equal((await db.query(`select count(*)::int as n from vault.secrets`)).rows[0].n, 1, "one key, made once");

  await as(db, ADMIN);
  assert.equal(await read(db, first.driver_license), "D01-23-456789");
});

test("without the Vault the chapter stops and changes nothing", async () => {
  const db = await fixture({ vault: false });
  const before = await stored(db);
  await assert.rejects(db.exec(await chapter()), /Supabase Vault is not enabled/);
  await db.exec("rollback");
  assert.deepEqual(await stored(db), before);
});
