// CHAPTER 124 - a review is a star rating, with no comment.
//
// Proved against real PostgreSQL (PGlite) with the chapter applied verbatim:
// comments already written are erased, ratings stay, and a new review is
// accepted with stars but refused with a comment.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

let master;
async function chapter() {
  const header = "-- CHAPTER 124 - A review is a star rating, with no comment";
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
    create table public.booking_reviews(
      id uuid primary key default gen_random_uuid(),
      booking_id uuid, rating integer check (rating between 1 and 5), feedback text);
    insert into public.booking_reviews(rating, feedback) values
      (1, 'an abusive comment'), (5, 'great car'), (4, null);
  `);
  await db.exec(await chapter());
  return db;
}

test("comments already written are erased and the ratings stay", async () => {
  const db = await fixture();
  const { rows } = await db.query(`select rating, feedback from public.booking_reviews order by rating`);
  assert.deepEqual(rows, [
    { rating: 1, feedback: null },
    { rating: 4, feedback: null },
    { rating: 5, feedback: null },
  ]);
});

test("a new review is stars only", async () => {
  const db = await fixture();
  await db.query(`insert into public.booking_reviews(rating) values (3)`);
  await assert.rejects(
    db.query(`insert into public.booking_reviews(rating, feedback) values (2, 'text')`),
    /booking_reviews_no_feedback/,
  );
});

test("running the chapter again changes nothing", async () => {
  const db = await fixture();
  await db.exec(await chapter());
  const { rows } = await db.query(`select count(*)::int as n from public.booking_reviews`);
  assert.equal(rows[0].n, 3);
});
