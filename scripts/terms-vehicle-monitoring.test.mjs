// CHAPTER 125 - the Terms say SafeDrive does not track or recover vehicles.
//
// Proved against real PostgreSQL (PGlite) with the chapter applied verbatim:
// 7.4 and 7.5 are added once, after 7.3 and before Section 8, as a new
// published version; running the chapter again publishes nothing.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const TERMS =
  "<h2>7. Insurance and Liability</h2>\n<p><strong>7.3 Responsibility and non-waivable rights:</strong> ...</p>\n\n\n<h2>8. User Conduct</h2>\n<p>Users must not...</p>";

let master;
async function chapter() {
  const header = "-- CHAPTER 125 - The Terms say SafeDrive does not track or recover vehicles";
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
    create table public.legal_document_versions(
      id uuid primary key default gen_random_uuid(),
      document_key text, version_number integer, content_html text, status text);
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      user_id uuid, action text, entity_type text, entity_id text, details jsonb);
  `);
  await db.query(
    `insert into public.legal_document_versions(document_key, version_number, content_html, status)
     values ('terms_of_service', 7, $1, 'published')`,
    [TERMS],
  );
  await db.exec(await chapter());
  return db;
}

test("7.4 and 7.5 are published once, between 7.3 and Section 8", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select version_number, status, content_html from public.legal_document_versions order by version_number`,
  );
  assert.deepEqual(rows.map((r) => [r.version_number, r.status]), [[7, "superseded"], [8, "published"]]);
  const html = rows[1].content_html;
  const order = ["7.3 Responsibility", "7.4 Vehicle Monitoring", "7.5 Lost, Missing, or Stolen Vehicles", "8. User Conduct"]
    .map((marker) => html.indexOf(marker));
  assert.ok(order.every((at) => at >= 0), "every clause is there");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in order");
  assert.match(html, /does not provide GPS tracking or real-time vehicle location monitoring/);
  assert.match(html, /Philippine National Police/);
  assert.match(html, /Republic Act No\. 10173/);
});

test("running the chapter again publishes nothing new", async () => {
  const db = await fixture();
  await db.exec(await chapter());
  const { rows } = await db.query(`select count(*)::int as n from public.legal_document_versions`);
  assert.equal(rows[0].n, 2);
});
