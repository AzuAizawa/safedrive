// CHAPTER 90 - an inquiry sent while signed in belongs to the account.
//
// The floating Inquiry button never sent the session, so every inquiry was
// stored as a guest's. The chapter links past ones to the account that owns
// the email, and only when that ownership is proven. Proved against real
// PostgreSQL (PGlite) with the chapter applied verbatim; the reference numbers
// shown for inquiries and tickets are pinned at the end.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  getBookingReference,
  getInquiryReference,
  getTicketReference,
} from "../src/lib/bookingReference.ts";
import { inquiryReference } from "../server/email.ts";

const ANA = "11111111-1111-4111-8111-111111111111"; // verified
const BEN = "22222222-2222-4222-8222-222222222222"; // never confirmed the email
const CARL = "33333333-3333-4333-8333-333333333333"; // deleted account
const DINA = "44444444-4444-4444-8444-444444444444"; // verified, already owns an inquiry

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create table public.profiles(id uuid primary key, deleted_at timestamptz);
    create table public.guest_inquiries(
      id uuid primary key default gen_random_uuid(),
      email text not null,
      submitted_by_user_id uuid);

    insert into auth.users values
      ('${ANA}', 'Ana.Reyes@Example.com', now()),
      ('${BEN}', 'ben@example.com', null),
      ('${CARL}', 'carl@example.com', now()),
      ('${DINA}', 'dina@example.com', now());
    insert into public.profiles values
      ('${ANA}', null), ('${BEN}', null), ('${CARL}', now()), ('${DINA}', null);

    insert into public.guest_inquiries(email, submitted_by_user_id) values
      ('ana.reyes@example.com', null),
      (' ANA.REYES@example.com ', null),
      ('ben@example.com', null),
      ('carl@example.com', null),
      ('dina@example.com', '${ANA}'),
      ('stranger@example.com', null);
  `);

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 90 - An inquiry sent while signed in belongs to the account")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 90 exists in the master file");
  await db.exec("-- CHAPTER 90\n" + chapter.slice(chapter.indexOf("\n")));
  return db;
}

const ownersByEmail = async (db) => {
  const { rows } = await db.query(
    "select email, submitted_by_user_id from public.guest_inquiries order by email",
  );
  return rows.map((r) => [r.email.trim().toLowerCase(), r.submitted_by_user_id]);
};

test("an inquiry is linked to the verified account that owns its email, in any case", async () => {
  const db = await fixture();
  const owners = await ownersByEmail(db);
  const ana = owners.filter(([email]) => email === "ana.reyes@example.com");
  assert.equal(ana.length, 2);
  assert.ok(ana.every(([, owner]) => owner === ANA));
});

test("an unverified or deleted account does not get an inquiry", async () => {
  const db = await fixture();
  const owners = Object.fromEntries(await ownersByEmail(db));
  assert.equal(owners["ben@example.com"], null, "email never confirmed");
  assert.equal(owners["carl@example.com"], null, "account deleted");
});

test("an inquiry with an owner is never moved, and one with no account stays a guest's", async () => {
  const db = await fixture();
  const owners = Object.fromEntries(await ownersByEmail(db));
  assert.equal(owners["dina@example.com"], ANA, "already linked - left exactly as it was");
  assert.equal(owners["stranger@example.com"], null);
});

test("running the chapter twice changes nothing more", async () => {
  const db = await fixture();
  const before = await ownersByEmail(db);
  await db.exec("-- CHAPTER 90 again\n" + chapter.slice(chapter.indexOf("\n")));
  assert.deepEqual(await ownersByEmail(db), before);
});

test("inquiries and tickets carry references that cannot be mistaken for each other", () => {
  const id = "1a2b3c4d-0000-4000-8000-000000000000";
  assert.equal(getInquiryReference(id), "SD-IN-1A2B3C4D");
  assert.equal(getTicketReference(id), "SD-TK-1A2B3C4D");
  assert.equal(getBookingReference(id), "SD-BK-1A2B3C4D");
  assert.equal(inquiryReference(id), getInquiryReference(id), "emails quote the same number the app shows");
});
