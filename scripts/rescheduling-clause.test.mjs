// CHAPTER 106 - the terms say what happens when someone wants a different date.
//
// A legal-text chapter, so the risks are textual: replacing the wrong thing,
// replacing it twice, editing a published version in place instead of
// superseding it, or writing a refusal so blunt it hides the two changes that
// ARE available. Each of those is asserted here. Proved against real PostgreSQL
// (PGlite) with the chapter applied verbatim from the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

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

const HEADER = "-- CHAPTER 106 - The terms say what happens when someone wants a different date";

// The shape of the live documents: the clause goes at the end of the
// cancellation section, which is found by the heading that follows it.
const TOS_V5 =
  "<h2>6. Cancellation, Refund, and No-Show Policy</h2>" +
  "<p><strong>6.4 No-Show and Disputes:</strong> Admin review may use arrival timestamps.</p>" +
  "<h2>7. Insurance and Liability</h2><p>Cover.</p>";

const PA_V5 =
  "<h2>4. Fees, Payments, and Cancellations</h2><ul>" +
  "<li><strong>Renter No-Show:</strong> The no-show is recorded against the Renter.</li>" +
  "</ul><h2>5. Vehicle Listing Standards</h2><ul><li>Accepted vehicles.</li></ul>";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text not null,
      version_number integer not null,
      content_html text not null,
      status text not null default 'published');
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);
  `);
  await db.query(
    `insert into public.legal_document_versions(document_key, version_number, content_html, status) values
       ('terms_of_service', 4, '<p>older terms</p>', 'superseded'),
       ('terms_of_service', 5, $1, 'published'),
       ('platform_agreement', 5, $2, 'published'),
       ('privacy_policy', 2, '<p>privacy</p>', 'published')`,
    [TOS_V5, PA_V5],
  );
  await db.exec(await chapter(HEADER));
  return db;
}

const published = async (db, key) =>
  (
    await db.query(
      "select version_number, content_html from public.legal_document_versions where document_key = $1 and status = 'published'",
      [key],
    )
  ).rows;

test("each document gains exactly one new published version", async () => {
  const db = await fixture();
  for (const key of ["terms_of_service", "platform_agreement"]) {
    const rows = await published(db, key);
    assert.equal(rows.length, 1, `${key}: one published version`);
    assert.equal(rows[0].version_number, 6, `${key}: v5 -> v6`);
  }
});

test("the previous versions are superseded, never edited", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select document_key, version_number, content_html, status
       from public.legal_document_versions
      where document_key = 'terms_of_service' order by version_number`,
  );
  assert.deepEqual(rows.map((r) => [r.version_number, r.status]), [
    [4, "superseded"],
    [5, "superseded"],
    [6, "published"],
  ]);
  assert.equal(rows[1].content_html, TOS_V5, "v5 is kept exactly as it was published");
});

test("the renter's terms say a booking cannot be moved", async () => {
  const db = await fixture();
  const [tos] = await published(db, "terms_of_service");
  assert.ok(tos.content_html.includes("6.5 Changing the Dates of a Booking"));
  assert.ok(tos.content_html.includes("cannot be moved to different dates"));
});

test("the refusal never stands alone - what IS available is named", async () => {
  const db = await fixture();
  for (const key of ["terms_of_service", "platform_agreement"]) {
    const [doc] = await published(db, key);
    assert.ok(/extension/i.test(doc.content_html), `${key}: extension named`);
    assert.ok(/early return/i.test(doc.content_html), `${key}: early return named`);
  }
});

test("it is stated as a platform decision, not as a legal requirement", async () => {
  const db = await fixture();
  const [pa] = await published(db, "platform_agreement");
  assert.ok(
    /platform decision rather than a legal requirement/i.test(pa.content_html),
    "no statute is claimed, because none has been cited",
  );
  const [tos] = await published(db, "terms_of_service");
  assert.ok(/convenience/i.test(tos.content_html), "remedy versus convenience is the reason given");
});

test("the clause lands at the end of the cancellation section, not somewhere else", async () => {
  const db = await fixture();
  const [tos] = await published(db, "terms_of_service");
  const clauseAt = tos.content_html.indexOf("6.5 Changing the Dates");
  const noShowAt = tos.content_html.indexOf("6.4 No-Show");
  const nextSectionAt = tos.content_html.indexOf("<h2>7. Insurance");
  assert.ok(noShowAt < clauseAt && clauseAt < nextSectionAt, "after 6.4 and before section 7");

  const [pa] = await published(db, "platform_agreement");
  const paClauseAt = pa.content_html.indexOf("No Rescheduling:");
  const paNextAt = pa.content_html.indexOf("<h2>5. Vehicle Listing");
  assert.ok(paClauseAt > 0 && paClauseAt < paNextAt, "inside section 4's list");
  assert.ok(
    pa.content_html.indexOf("</ul>") < paNextAt,
    "the list is still closed before the next heading",
  );
});

test("the privacy policy is not touched", async () => {
  const db = await fixture();
  const rows = await published(db, "privacy_policy");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version_number, 2);
  assert.equal(rows[0].content_html, "<p>privacy</p>");
});

test("the publication is recorded in the audit trail", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select details from public.audit_log
      where action = 'legal_document_published' order by details->>'document_key'`,
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.details.document_key),
    ["platform_agreement", "terms_of_service"],
  );
  assert.ok(rows.every((r) => r.details.source === "CHAPTER 106"));
});

test("applying the chapter twice adds nothing", async () => {
  const db = await fixture();
  await db.exec(await chapter(HEADER));
  const { rows } = await db.query(
    `select count(*)::int as n from public.legal_document_versions
      where document_key in ('terms_of_service', 'platform_agreement')`,
  );
  assert.equal(rows[0].n, 5, "v4+v5+v6 for the terms and v5+v6 for the agreement - no v7 from a second run");

  const [tos] = await published(db, "terms_of_service");
  const occurrences = tos.content_html.split("6.5 Changing the Dates").length - 1;
  assert.equal(occurrences, 1, "and the clause is not duplicated inside the text");
});

// CHAPTER 111 - the live Platform Agreement has a line break and a blank line
// between section 4's list and the section 5 heading. CHAPTER 106 looked for
// the two touching, so on the live document it silently changed nothing; the
// compact fixture above never showed it. This is the live shape.
const PA_LIVE = [
  "<h2>4. Fees, Payments, and Cancellations</h2>",
  "<ul>",
  "<li><strong>Renter No-Show:</strong> The no-show is recorded against the Renter.</li>",
  "</ul>",
  "",
  "<h2>5. Vehicle Listing Standards</h2>",
  "<ul>",
  "<li>Accepted vehicles.</li>",
  "</ul>",
].join("\r\n");

const PRIVACY_AFTER_110 = [
  "<h2>5. Third-Party Disclosures</h2>",
  "<ul>",
  "<li><strong>Walter Writes (Walter AI):</strong> AI-image detection.</li>",
  "<li><strong>Selected application host:</strong> Hosting is not yet selected. This notice and the vendor register must be updated before production deployment.</li>",
  "</ul>",
].join("\r\n");

async function liveFixture({ privacy = PRIVACY_AFTER_110 } = {}) {
  const db = new PGlite();
  await db.exec(`
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text not null, version_number integer not null,
      content_html text not null, status text not null default 'published');
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);
  `);
  await db.query(
    `insert into public.legal_document_versions(document_key, version_number, content_html, status) values
       ('platform_agreement', 5, $1, 'published'),
       ('privacy_policy', 3, $2, 'published')`,
    [PA_LIVE, privacy],
  );
  return db;
}

const HEADER_111 = "-- CHAPTER 111 - The lister's agreement says \"no rescheduling\" too, and the host is named";

test("on the live shape CHAPTER 106 missed the Platform Agreement", async () => {
  const db = await liveFixture();
  await db.exec(await chapter(HEADER));
  const [pa] = await published(db, "platform_agreement");
  assert.equal(pa.version_number, 5, "unchanged - the bug CHAPTER 111 fixes");
});

test("CHAPTER 111 adds No Rescheduling to the end of section 4, once", async () => {
  const db = await liveFixture();
  await db.exec(await chapter(HEADER));
  const ch111 = await chapter(HEADER_111);
  await db.exec(ch111);
  await db.exec(ch111);
  const [pa] = await published(db, "platform_agreement");
  assert.equal(pa.version_number, 6);
  const html = pa.content_html;
  assert.equal(html.split("No Rescheduling:").length, 2, "exactly once");
  const at = html.indexOf("No Rescheduling:");
  assert.ok(html.indexOf("Renter No-Show") < at && at < html.indexOf("<h2>5."), "inside section 4, after its last item");
  assert.match(html, /extension of the end date, or an early return/);
});

test("CHAPTER 111 names Vercel as the host in the Privacy Policy", async () => {
  const db = await liveFixture();
  await db.exec(await chapter(HEADER_111));
  const [policy] = await published(db, "privacy_policy");
  assert.equal(policy.version_number, 4);
  assert.match(policy.content_html, /<strong>Vercel:<\/strong> Application hosting/);
  assert.doesNotMatch(policy.content_html, /Hosting is not yet selected/);
  assert.match(policy.content_html, /Walter Writes/, "CHAPTER 110's item is kept");
});

test("CHAPTER 111 refuses to run before CHAPTER 110, changing nothing", async () => {
  const db = await liveFixture({ privacy: PRIVACY_AFTER_110.replace(/<li><strong>Walter[^\n]*\n/, "") });
  await assert.rejects(db.exec(await chapter(HEADER_111)), /apply CHAPTER 110 first/);
  await db.exec("rollback");
  const [pa] = await published(db, "platform_agreement");
  assert.equal(pa.version_number, 5, "the Platform Agreement was not published alone either");
});
