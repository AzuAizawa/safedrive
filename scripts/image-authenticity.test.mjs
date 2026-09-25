// CHAPTER 108 - every uploaded image is checked for AI generation or editing.
//
// Panel requirement: "Add API to detect AI images and edited images." Proved
// against real PostgreSQL (PGlite) with the chapter applied verbatim: only
// admins read the verdicts and nobody but the service role writes them, so an
// uploader can neither forge a clean score nor see one to tune a fake against.
// The detector's answers - including every way it can fail - are pinned after.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  classifyFile,
  interpretDetectorResponse,
  needsCheck,
} from "../server/imageAuthenticity.ts";
import { describeCheck } from "../src/lib/imageAuthenticityLabels.ts";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const LISTER = "22222222-2222-4222-8222-222222222222";
const CAR = "33333333-3333-4333-8333-333333333333";

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles(id uuid primary key, role text);
    insert into public.profiles values ('${ADMIN}', 'admin'), ('${LISTER}', 'user');
    create function public.is_admin() returns boolean language sql stable as
      $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin')) $$;
  `);
  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 108 - Every uploaded image is checked for AI generation or editing")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 108 exists");
  await db.exec(chapter);
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant select on public.profiles to authenticated;
    grant select, insert, update, delete on public.image_authenticity_checks to authenticated;
    insert into public.image_authenticity_checks
      (bucket, storage_path, subject_kind, subject_id, status, verdict, confidence, prob_real, prob_fake, prob_inpainting)
    values
      ('vehicle-private-documents', '${LISTER}/${CAR}/or_1.jpg', 'vehicle_document', '${CAR}',
       'checked', 'inpainting', 0.88, 0.1, 0.02, 0.88);
  `);
  return db;
}

const as = async (db, uid, sql) => {
  await db.exec("set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role;");
  }
};

test("an admin reads the verdict beside the upload", async () => {
  const db = await fixture();
  const { rows } = await as(db, ADMIN, "select verdict from public.image_authenticity_checks");
  assert.deepEqual(rows, [{ verdict: "inpainting" }]);
});

test("the uploader never sees a score to tune a fake against", async () => {
  const db = await fixture();
  const { rows } = await as(db, LISTER, "select * from public.image_authenticity_checks");
  assert.equal(rows.length, 0);
});

test("the uploader cannot forge a clean verdict, nor overwrite a flagged one", async () => {
  const db = await fixture();
  await assert.rejects(
    as(
      db,
      LISTER,
      `insert into public.image_authenticity_checks (bucket, storage_path, subject_kind, subject_id, status, verdict)
       values ('user-verification', '${LISTER}/selfie.jpg', 'identity', '${LISTER}', 'checked', 'real')`,
    ),
    /row-level security/,
  );
  await as(db, LISTER, "update public.image_authenticity_checks set verdict = 'real'");
  await as(db, ADMIN, "update public.image_authenticity_checks set verdict = 'real'");
  const { rows } = await db.query("select verdict from public.image_authenticity_checks");
  assert.deepEqual(rows, [{ verdict: "inpainting" }], "no signed-in user rewrites a verdict - not even an admin");
});

test("a check marked done must carry a verdict, and one file has one row", async () => {
  const db = await fixture();
  await assert.rejects(
    db.query(`insert into public.image_authenticity_checks (bucket, storage_path, subject_kind, subject_id, status)
              values ('user-verification', 'x.jpg', 'identity', '${LISTER}', 'checked')`),
    /check constraint/,
  );
  await assert.rejects(
    db.query(`insert into public.image_authenticity_checks (bucket, storage_path, subject_kind, subject_id, status, reason)
              values ('vehicle-private-documents', '${LISTER}/${CAR}/or_1.jpg', 'vehicle_document', '${CAR}', 'pending', 'rate_limited')`),
    /duplicate key/,
  );
});

test("the detector's three verdicts are kept with their probabilities", () => {
  const edited = interpretDetectorResponse(200, {
    prediction: "inpainting",
    confidence: 0.88,
    probabilities: { real: 0.1, fake: 0.02, inpainting: 0.88 },
    credits_charged: 8,
  });
  assert.equal(edited.status, "checked");
  assert.equal(edited.verdict, "inpainting");
  assert.equal(edited.prob_inpainting, 0.88);
  assert.equal(edited.credits_charged, 8);
  assert.equal(describeCheck({ ...edited, checked_at: "2026-09-25T00:00:00Z" }).label, "Possible AI edit · 88%");
  assert.equal(
    describeCheck({ ...interpretDetectorResponse(200, { prediction: "fake", confidence: 0.97, probabilities: {} }), checked_at: "x" }).tone,
    "danger",
  );
});

test("an expired trial or empty wallet says so, and stops spending calls", () => {
  for (const code of ["trial_expired", "insufficient_credits", "credits_exhausted"]) {
    const result = interpretDetectorResponse(403, { error: "x", code });
    assert.deepEqual([result.status, result.reason, result.stop], ["unavailable", code, true]);
  }
  const expired = describeCheck({ status: "unavailable", reason: "trial_expired", checked_at: "x" });
  assert.equal(expired.label, "Not checked · subscription expired");
  assert.equal(interpretDetectorResponse(401, {}).reason, "key_invalid");
  assert.equal(interpretDetectorResponse(503, {}).reason, "service_unavailable");
});

test("the per-minute limit leaves the rest waiting instead of failing them", () => {
  const limited = interpretDetectorResponse(429, {});
  assert.deepEqual([limited.status, limited.reason, limited.stop], ["pending", "rate_limited", true]);
});

test("a PDF or oversized file never spends a credit", () => {
  assert.equal(classifyFile("a/b/or.pdf", "application/pdf", 1000)?.reason, "pdf");
  assert.equal(classifyFile("a/b/or", "", 1000)?.reason, "file_type");
  assert.equal(classifyFile("a/b/or.jpg", "image/jpeg", 11 * 1024 * 1024)?.reason, "too_large");
  assert.equal(classifyFile("a/b/image_0", "image/jpeg", 1000), null, "a photo stored without an extension is still read");
});

test("a file is checked once, again only when it is replaced or still waiting", () => {
  const at = (iso, status = "checked") => ({ status, checked_at: iso });
  assert.equal(needsCheck(undefined, null, false), true);
  assert.equal(needsCheck(at("2026-09-25T10:00:00Z"), "2026-09-25T09:00:00Z", false), false);
  // Identity photos are re-uploaded under the same path.
  assert.equal(needsCheck(at("2026-09-25T10:00:00Z"), "2026-09-25T11:00:00Z", false), true);
  assert.equal(needsCheck(at("2026-09-25T10:00:00Z", "pending"), null, false), true);
  // Expired trial: only the reviewer's "Check again" tries it again.
  assert.equal(needsCheck(at("2026-09-25T10:00:00Z", "unavailable"), null, false), false);
  assert.equal(needsCheck(at("2026-09-25T10:00:00Z", "unavailable"), null, true), true);
  // "Check again" never re-spends a credit on an answer it already has.
  assert.equal(needsCheck(at("2026-09-25T10:00:00Z"), null, true), false);
});

test("a firewall page in front of the detector is not blamed on the key", () => {
  // Walter's API answered 403 from Vercel's Edge network while the same key
  // worked from a regular server; the body was not the API's own JSON.
  const blocked = interpretDetectorResponse(403, null);
  assert.deepEqual([blocked.status, blocked.reason, blocked.stop], ["unavailable", "blocked_by_provider", true]);
  assert.equal(describeCheck({ ...blocked, checked_at: "x" }).label, "Not checked · detector blocked the server");
  // A real 403 from the API, with its JSON, still reads as a key or scope problem.
  assert.equal(interpretDetectorResponse(403, { detail: "API key does not have required scope" }).reason, "key_missing_scope");
});
