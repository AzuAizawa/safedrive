// CHAPTER 109 - the terms say what happens to a faked document, even after
// approval. Proved against real PostgreSQL (PGlite) with the chapter applied
// verbatim to documents shaped like the live ones - including the newline
// between a list and the next heading that made CHAPTER 106's Platform
// Agreement edit silently miss.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const TOS = [
  "<h3>3.3 Accuracy</h3>",
  "<p>You must provide truthful and current information. Suspected falsification is reviewed.</p>",
  "",
  "",
  "<h2>4. Vehicle Listing and Requirements</h2>",
  "<p>Listing rules.</p>",
].join("\n");

const PA = [
  "<h2>2. Account Verification &amp; Eligibility</h2>",
  "<ul>",
  "<li><strong>Manual Verification:</strong> Reviewed by an admin.</li>",
  "</ul>",
  "",
  "<h2>3. Booking &amp; Reservation Policies</h2>",
  "<ul>",
  "<li>Booking rules.</li>",
  "</ul>",
].join("\n");

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text not null, version_number integer not null,
      content_html text not null, status text not null);
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);
  `);
  await db.query(
    `insert into public.legal_document_versions (document_key, version_number, content_html, status) values
       ('terms_of_service', 6, $1, 'published'),
       ('terms_of_service', 5, 'old', 'superseded'),
       ('platform_agreement', 5, $2, 'published'),
       ('privacy_policy', 2, '<p>privacy</p>', 'published')`,
    [TOS, PA],
  );
  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 109 - The terms say what happens to a faked document, even after approval")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 109 exists");
  return db;
}

const published = async (db, key) =>
  (
    await db.query(
      "select version_number, content_html from public.legal_document_versions where status = 'published' and document_key = $1",
      [key],
    )
  ).rows;

test("the Terms gain 3.4 right after 3.3, as a new version", async () => {
  const db = await fixture();
  await db.exec(chapter);
  const [tos] = await published(db, "terms_of_service");
  assert.equal(tos.version_number, 7);
  const html = tos.content_html;
  assert.ok(html.indexOf("3.3 Accuracy") < html.indexOf("3.4 Falsified"));
  assert.ok(html.indexOf("3.4 Falsified") < html.indexOf("<h2>4. Vehicle Listing"));
  assert.match(html, /including after your account or listing was approved/);
  assert.match(html, /never decides on its own/);
});

test("the Platform Agreement gains the item despite the newline before section 3", async () => {
  const db = await fixture();
  await db.exec(chapter);
  const [pa] = await published(db, "platform_agreement");
  assert.equal(pa.version_number, 6);
  const html = pa.content_html;
  const item = html.indexOf("Document Authenticity:");
  assert.ok(item > html.indexOf("Manual Verification"), "added to the verification list");
  assert.ok(item < html.indexOf("<h2>3. Booking"), "before section 3");
  assert.equal(html.split("Document Authenticity:").length, 2, "once, not in the booking list too");
});

test("older versions are kept, the privacy policy is untouched, and both are audited", async () => {
  const db = await fixture();
  await db.exec(chapter);
  const { rows } = await db.query(
    "select document_key, version_number, status from public.legal_document_versions order by document_key, version_number",
  );
  assert.deepEqual(
    rows.map((row) => `${row.document_key} v${row.version_number} ${row.status}`),
    [
      "platform_agreement v5 superseded",
      "platform_agreement v6 published",
      "privacy_policy v2 published",
      "terms_of_service v5 superseded",
      "terms_of_service v6 superseded",
      "terms_of_service v7 published",
    ],
  );
  const audit = await db.query("select details->>'source' as source from public.audit_log");
  assert.deepEqual(audit.rows.map((row) => row.source), ["CHAPTER 109", "CHAPTER 109"]);
});

test("running it again changes nothing", async () => {
  const db = await fixture();
  await db.exec(chapter);
  await db.exec(chapter);
  const { rows } = await db.query("select count(*)::int as n from public.legal_document_versions");
  assert.equal(rows[0].n, 6);
});
