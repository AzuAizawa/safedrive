// CHAPTER 100 - a released payout keeps the account it was sent to.
//
// Two things have to hold, and neither can be proved from the UI. The payout
// row must be able to carry the destination as it stood at release, so a later
// profile edit cannot rewrite a finished transfer's receipt. And that stored
// destination must not become visible to the renter, who shares the booking but
// has no business seeing the lister's account. Proved against real PostgreSQL
// (PGlite) with the chapter applied verbatim from the master file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const LISTER = "11111111-1111-4111-8111-111111111111";
const RENTER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const BOOKING = "44444444-4444-4444-8444-444444444444";

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
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.is_admin() returns boolean language sql stable as
      $$ select coalesce(current_setting('test.admin', true), 'false') = 'true' $$;

    create table public.profiles(
      id uuid primary key,
      payout_method text,
      payout_account_name text,
      payout_account_number text);

    create table public.bookings(
      id uuid primary key,
      owner_id uuid references public.profiles(id) not null,
      renter_id uuid references public.profiles(id) not null);

    create table public.payments(
      id uuid primary key default gen_random_uuid(),
      booking_id uuid references public.bookings(id) not null,
      amount numeric not null,
      payment_type text not null,
      status text default 'pending',
      transaction_id text,
      payment_method text,
      notes text,
      created_at timestamptz default clock_timestamp());

    alter table public.payments enable row level security;
    grant select on public.payments to authenticated;
    -- The policy's subquery reads bookings, so the role needs it the same way
    -- it does in the real project.
    grant select on public.bookings to authenticated;

    -- Chapter 1's policy, as it stood before this chapter: booking_id only,
    -- with no regard for who the payment belongs to.
    create policy "Participants see payments" on public.payments
    for select using (
      exists (
        select 1 from public.bookings
        where id = payments.booking_id
          and (renter_id = auth.uid() or owner_id = auth.uid())
      )
      or public.is_admin()
    );

    insert into public.profiles(id, payout_method, payout_account_name, payout_account_number)
      values
        ('${LISTER}', 'GCash', 'Moises Plasigue', '09934086208'),
        ('${RENTER}', null, null, null),
        ('${STRANGER}', null, null, null);
    insert into public.bookings(id, owner_id, renter_id)
      values('${BOOKING}', '${LISTER}', '${RENTER}');
  `);

  // The rows that already existed before this chapter: one payout the renter
  // could read, and one balance payment that is genuinely the renter's.
  await db.exec(`
    insert into public.payments(booking_id, amount, payment_type, status, payment_method, notes)
      values('${BOOKING}', 4500, 'payout', 'completed', 'GCash', 'Released in August');
    insert into public.payments(booking_id, amount, payment_type, status, payment_method)
      values('${BOOKING}', 6000, 'balance', 'paid', 'GCash');
  `);

  await db.exec(await chapter("-- CHAPTER 100 - A released payout keeps the account it was sent to"));
  return db;
}

/** Act as a signed-in member (or an admin) - RLS applies. */
async function asMember(db, uid, { admin = false } = {}) {
  await db.exec("set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.query("select set_config('test.admin', $1, false)", [admin ? "true" : "false"]);
}

/** Act as the server (service role) - RLS bypassed, as the payout job runs. */
async function asServer(db) {
  await db.exec("reset role;");
  await db.query("select set_config('test.admin', 'false', false)");
}

const visibleTypes = async (db) => {
  const { rows } = await db.query(
    "select payment_type from public.payments where booking_id = $1 order by payment_type",
    [BOOKING],
  );
  return rows.map((row) => row.payment_type);
};

test("a payout row can carry the destination it was actually sent to", async () => {
  const db = await fixture();
  await asServer(db);
  const { rows } = await db.query(
    `insert into public.payments
       (booking_id, amount, payment_type, status, payment_method,
        payout_account_name, payout_account_masked)
     values($1, 4500, 'payout', 'completed', 'GCash', 'Moises Plasigue', '****6208')
     returning payout_account_name, payout_account_masked`,
    [BOOKING],
  );
  assert.equal(rows[0].payout_account_name, "Moises Plasigue");
  assert.equal(rows[0].payout_account_masked, "****6208");
});

test("the lister changing their profile does not rewrite a released payout", async () => {
  const db = await fixture();
  await asServer(db);
  await db.query(
    `insert into public.payments
       (booking_id, amount, payment_type, status, payment_method,
        payout_account_name, payout_account_masked)
     values($1, 4500, 'payout', 'completed', 'GCash', 'Moises Plasigue', '****6208')`,
    [BOOKING],
  );

  // September: the lister moves their payouts to a different wallet entirely.
  await db.query(
    `update public.profiles
        set payout_method = 'Maya',
            payout_account_name = 'Ana Plasigue',
            payout_account_number = '09171234567'
      where id = $1`,
    [LISTER],
  );

  const { rows } = await db.query(
    `select payment_method, payout_account_name, payout_account_masked
       from public.payments
      where payment_type = 'payout' and payout_account_masked is not null`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payment_method, "GCash", "the method it was sent with");
  assert.equal(rows[0].payout_account_name, "Moises Plasigue");
  assert.equal(rows[0].payout_account_masked, "****6208", "August's receipt still says August");
});

test("the full account number is never copied onto the payment row", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'payments'
        and column_name like 'payout_account%'
      order by column_name`,
  );
  assert.deepEqual(
    rows.map((row) => row.column_name),
    ["payout_account_masked", "payout_account_name"],
    "a masked number and a name - never payout_account_number",
  );
});

test("the lister still sees their own payouts", async () => {
  const db = await fixture();
  await asMember(db, LISTER);
  assert.deepEqual(await visibleTypes(db), ["balance", "payout"]);
});

test("the renter no longer sees the lister's payout, but keeps their own payments", async () => {
  const db = await fixture();
  await asMember(db, RENTER);
  assert.deepEqual(
    await visibleTypes(db),
    ["balance"],
    "what the renter paid stays visible; what the lister was paid does not",
  );
});

test("every other payment type the renter has is untouched", async () => {
  const db = await fixture();
  await asServer(db);
  for (const type of ["downpayment", "extension", "security_deposit", "refund"]) {
    await db.query(
      "insert into public.payments(booking_id, amount, payment_type, status) values($1, 100, $2, 'paid')",
      [BOOKING, type],
    );
  }
  await asMember(db, RENTER);
  assert.deepEqual(await visibleTypes(db), [
    "balance",
    "downpayment",
    "extension",
    "refund",
    "security_deposit",
  ]);
});

test("an admin sees every payment on the booking, payouts included", async () => {
  const db = await fixture();
  await asMember(db, STRANGER, { admin: true });
  assert.deepEqual(await visibleTypes(db), ["balance", "payout"]);
});

test("someone outside the booking sees nothing", async () => {
  const db = await fixture();
  await asMember(db, STRANGER);
  assert.deepEqual(await visibleTypes(db), []);
});

test("payout rows written before this chapter are left alone, not invented", async () => {
  const db = await fixture();
  await asServer(db);
  const { rows } = await db.query(
    `select payout_account_name, payout_account_masked
       from public.payments
      where payment_type = 'payout' and notes = 'Released in August'`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payout_account_name, null);
  assert.equal(rows[0].payout_account_masked, null, "no destination is guessed for old rows");
});

test("members still cannot write payments themselves", async () => {
  const db = await fixture();
  await asMember(db, LISTER);
  await assert.rejects(
    db.query(
      "insert into public.payments(booking_id, amount, payment_type) values($1, 1, 'payout')",
      [BOOKING],
    ),
    /permission denied/i,
  );
});
