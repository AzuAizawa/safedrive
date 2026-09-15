// CHAPTER 98 - once the car is handed over, nothing paid is refunded.
//
// The Platform Agreement is republished and a goodwill refund can never be
// recorded on an early return. Proved against real PostgreSQL (PGlite), with
// the chapter applied verbatim out of the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OLD_CLAUSE =
  "<li><strong>Early Return:</strong> A renter may request, through the booking, to return the vehicle before the booked end date. The booked rental period belongs to the renter, so an early return does <em>not</em> entitle the renter to any refund for the unused days. If the lister approves the early return, the lister may - at their sole discretion - grant a goodwill refund of an amount they choose; any such goodwill refund is released only after SafeDrive support review. The lister may also decline the request, in which case the original return date and full booking amount stand.</li>";

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text, version_number integer, content_html text, status text);
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);
    create table public.booking_early_returns(
      id uuid primary key default gen_random_uuid(),
      status text default 'pending',
      goodwill_refund_amount numeric not null default 0 check (goodwill_refund_amount >= 0));
  `);
  await db.query(
    `insert into public.legal_document_versions(document_key, version_number, content_html, status)
     values ('platform_agreement', 3, $1, 'published')`,
    [`<ul><li>Extensions ...</li>${OLD_CLAUSE}<li>No Car at Pickup ...</li></ul>`],
  );

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 98 - Once the car is handed over, nothing paid is refunded")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 98 exists in the master file");
  await db.exec("-- CHAPTER 98\n" + chapter.slice(chapter.indexOf("\n")));
  return db;
}

const published = async (db) =>
  (await db.query(
    "select version_number, content_html from public.legal_document_versions where status = 'published' and document_key = 'platform_agreement'",
  )).rows;

test("the Platform Agreement says no refund after handover, keeps the unapplied-extension exception, and publishes once", async () => {
  const db = await fixture();
  let docs = await published(db);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].version_number, 4);
  const html = docs[0].content_html;
  assert.ok(!html.includes("goodwill refund"), "the goodwill exception is gone");
  assert.match(html, /once the vehicle has been handed over <em>no refund is given<\/em>/);
  assert.match(html, /extension days already paid for, whatever the reason/);
  assert.match(html, /extension payment that SafeDrive could not apply/);
  assert.ok(html.includes("<li>Extensions ...</li>") && html.includes("<li>No Car at Pickup ...</li>"), "the rest is untouched");

  const { rows: superseded } = await db.query(
    "select count(*)::int as n from public.legal_document_versions where status = 'superseded'",
  );
  assert.equal(superseded[0].n, 1, "version 3 stays in the history");

  await db.exec("-- CHAPTER 98\n" + chapter.slice(chapter.indexOf("\n")));
  docs = await published(db);
  assert.equal(docs[0].version_number, 4, "running it again changes nothing");
});

test("a goodwill refund can never be recorded on an early return", async () => {
  const db = await fixture();
  await db.query("insert into public.booking_early_returns(status) values ('pending')");
  await db.query("update public.booking_early_returns set status = 'approved'");

  await assert.rejects(
    db.query("insert into public.booking_early_returns(status, goodwill_refund_amount) values ('approved', 500)"),
    /booking_early_returns_no_goodwill_refund/,
  );
  await assert.rejects(
    db.query("update public.booking_early_returns set goodwill_refund_amount = 1"),
    /booking_early_returns_no_goodwill_refund/,
  );
});
