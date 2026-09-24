// CHAPTER 107 - a visitor can ask without giving a name or email.
//
// IT review: an inquiry is a question about the website, so it should not
// demand personal details first. Proved against real PostgreSQL (PGlite): the
// CHAPTER 10 table and its admin-alert trigger are built as shipped, then
// CHAPTER 107 is applied verbatim on top. The browser secret that stands in for
// the email, and the form's rules, are pinned at the end.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { createGuestInquiryToken, hashGuestInquiryToken } from "../server/guestInquiryToken.ts";
import { validateInquiryForm } from "../src/lib/inquiries.ts";

const ADMIN = "11111111-1111-4111-8111-111111111111";

let master;
const readMaster = async () =>
  (master ??= await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ));

async function fixture({ withChapter = true } = {}) {
  const sql = await readMaster();
  const db = new PGlite();
  await db.exec(`
    create table public.profiles(id uuid primary key, role text, deleted_at timestamptz);
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null, title text not null, message text not null, type text, link text);
    insert into public.profiles values ('${ADMIN}', 'admin', null);

    -- CHAPTER 10's table, as shipped.
    create table public.guest_inquiries (
      id uuid primary key default gen_random_uuid(),
      name text not null check (char_length(name) between 2 and 120),
      email text not null check (char_length(email) between 5 and 320),
      phone text,
      subject text not null check (char_length(subject) between 3 and 160),
      message text not null,
      request_fingerprint text not null
    );
  `);

  // CHAPTER 10's admin alert, verbatim from the master.
  const trigger = sql
    .split("create or replace function public.notify_admins_of_guest_inquiry()")[1]
    ?.split("for each row execute function public.notify_admins_of_guest_inquiry();")[0];
  assert.ok(trigger, "CHAPTER 10 alert trigger exists");
  await db.exec(
    "create or replace function public.notify_admins_of_guest_inquiry()" +
      trigger +
      "for each row execute function public.notify_admins_of_guest_inquiry();",
  );

  if (withChapter) {
    const chapter = sql
      .split("-- CHAPTER 107 - A visitor can ask without giving a name or email")[1]
      ?.split("-- Read-only verification")[0];
    assert.ok(chapter, "CHAPTER 107 exists");
    await db.exec(chapter);
  }
  return db;
}

const ask = (db, name, email) =>
  db.query(
    `insert into public.guest_inquiries(name, email, subject, message, request_fingerprint)
     values ($1, $2, 'Renting a vehicle', 'How much is a day?', 'fp') returning id`,
    [name, email],
  );

test("before the chapter, a question without a name or email is refused", async () => {
  const db = await fixture({ withChapter: false });
  await assert.rejects(ask(db, null, null), /null value/);
});

test("a visitor can ask with no name and no email, and admins are still alerted", async () => {
  const db = await fixture();
  await ask(db, null, null);
  const { rows } = await db.query("select message from public.notifications");
  assert.deepEqual(rows.map((row) => row.message), [
    "A guest asked about Renting a vehicle. Open Guest Inquiries to review it.",
  ]);
});

test("a name that is given still names the visitor in the alert", async () => {
  const db = await fixture();
  await ask(db, "Nena", null);
  const { rows } = await db.query("select message from public.notifications");
  assert.match(rows[0].message, /^Nena asked about/);
});

test("the old limits still guard the details that are given", async () => {
  const db = await fixture();
  await assert.rejects(ask(db, "N", null), /check constraint/);
  await assert.rejects(ask(db, null, "a@b"), /check constraint/);
});

test("the browser secret is stored as a hash column", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `insert into public.guest_inquiries(subject, message, request_fingerprint, guest_token_hash)
     values ('Other', 'Hello there', 'fp', 'abc') returning guest_token_hash`,
  );
  assert.equal(rows[0].guest_token_hash, "abc");
});

test("the browser secret is random, and only its hash matches it", async () => {
  const one = createGuestInquiryToken();
  const two = createGuestInquiryToken();
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.notEqual(one, two);
  assert.equal(await hashGuestInquiryToken(one), await hashGuestInquiryToken(one));
  assert.notEqual(await hashGuestInquiryToken(one), await hashGuestInquiryToken(two));
  assert.notEqual(await hashGuestInquiryToken(one), one);
});

test("the form asks only for a topic and a question", () => {
  assert.deepEqual(
    validateInquiryForm({ name: "", email: "", topics: ["Other"], message: "How do I list a car?" }),
    [],
  );
  // An email is optional, but one that is typed must be usable.
  assert.deepEqual(
    validateInquiryForm({ name: "", email: "nope", topics: ["Other"], message: "How do I list a car?" }).map(
      (error) => error.field,
    ),
    ["email"],
  );
});
