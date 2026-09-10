// CHAPTER 81 - a booking conversation has a closing time.
//
// The rule is enforced by the database, not by the browser, so it is proved
// against real PostgreSQL (PGlite) the same way the vehicle compliance chapter
// is. The fixture builds only what the chapter touches, applies the chapter
// verbatim out of the master file, and then acts as each party in turn.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const RENTER = "11111111-1111-4111-8111-111111111111";
const LISTER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const BOOKING = "44444444-4444-4444-8444-444444444444";
const BOOKING2 = "55555555-5555-4555-8555-555555555555";

let chapter;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.admin_can(text) returns boolean language sql stable as
      $$ select coalesce(current_setting('test.support_admin', true), 'false') = 'true' $$;

    create table public.profiles(id uuid primary key, role text default 'user');
    create table public.bookings(
      id uuid primary key, renter_id uuid, owner_id uuid, status text default 'pending');
    create table public.support_tickets(
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      participant_user_id uuid,
      subject text not null,
      tag text default 'general',
      booking_id uuid references public.bookings(id) on delete set null,
      status text not null default 'open',
      created_at timestamptz default now());
    create table public.ticket_messages(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid references public.support_tickets(id) on delete cascade not null,
      sender_id uuid not null,
      message text not null,
      attachment_name text, attachment_mime_type text,
      attachment_storage_path text, attachment_bucket text,
      created_at timestamptz default now());

    alter table public.support_tickets enable row level security;
    alter table public.ticket_messages enable row level security;
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete
      on public.support_tickets, public.ticket_messages to authenticated;

    insert into public.profiles(id) values('${RENTER}'), ('${LISTER}'), ('${STRANGER}');
    insert into public.bookings(id, renter_id, owner_id, status)
      values('${BOOKING}', '${RENTER}', '${LISTER}', 'active'),
            ('${BOOKING2}', '${RENTER}', '${LISTER}', 'active');
  `);

  chapter ??= (await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  ))
    .split("-- CHAPTER 81 - A booking conversation has a closing time")[1]
    ?.split("-- Read-only verification")[0];
  assert.ok(chapter, "CHAPTER 81 exists in the master file");
  await db.exec("-- CHAPTER 81\n" + chapter);

  return db;
}

/** Act as a signed-in member (or as support staff) - RLS applies. */
async function asMember(db, uid, { support = false } = {}) {
  await db.exec("set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.query("select set_config('test.support_admin', $1, false)", [
    support ? "true" : "false",
  ]);
}

/** Act as the server (service role / trusted code) - RLS bypassed. */
async function asServer(db) {
  await db.exec("reset role;");
  await db.query("select set_config('test.support_admin', 'false', false)");
}

async function openConversation(db, bookingId = BOOKING) {
  const { rows } = await db.query(
    `insert into public.support_tickets(user_id, participant_user_id, subject, tag, booking_id)
     values($1, $2, 'Booking conversation', 'booking_conversation', $3)
     returning id, conversation_closes_at`,
    [RENTER, LISTER, bookingId],
  );
  return rows[0];
}

const closesAt = async (db, ticketId) => {
  const { rows } = await db.query(
    "select conversation_closes_at from public.support_tickets where id = $1",
    [ticketId],
  );
  return rows[0].conversation_closes_at;
};

test("ending a booking gives its conversation one more day", async () => {
  const db = await fixture();
  const ticket = await openConversation(db);
  assert.equal(ticket.conversation_closes_at, null, "an active booking's thread has no deadline");

  await db.query("update public.bookings set status = 'completed' where id = $1", [BOOKING]);

  const stamped = await closesAt(db, ticket.id);
  assert.ok(stamped, "completing the booking stamps a closing time");
  const hoursAway = (new Date(stamped).getTime() - Date.now()) / 3_600_000;
  assert.ok(hoursAway > 23.5 && hoursAway < 24.5, `expected ~24h, got ${hoursAway}h`);
});

test("a later status change cannot hand the two members another day", async () => {
  const db = await fixture();
  const ticket = await openConversation(db);

  await db.query("update public.bookings set status = 'completed' where id = $1", [BOOKING]);
  const first = await closesAt(db, ticket.id);

  await db.query("update public.bookings set status = 'cancelled' where id = $1", [BOOKING]);
  const second = await closesAt(db, ticket.id);

  assert.deepEqual(second, first, "the first ending is the one that counts");
});

test("cancelling a booking closes its conversation too", async () => {
  const db = await fixture();
  const ticket = await openConversation(db);
  await db.query("update public.bookings set status = 'cancelled' where id = $1", [BOOKING]);
  assert.ok(await closesAt(db, ticket.id));
});

test("inside the day both members still read the thread and can reply", async () => {
  const db = await fixture();
  const ticket = await openConversation(db);
  await db.query("update public.bookings set status = 'completed' where id = $1", [BOOKING]);
  await db.query(
    "insert into public.ticket_messages(ticket_id, sender_id, message) values($1, $2, 'pickup photo')",
    [ticket.id, LISTER],
  );

  // Each pass leaves one more reply behind, so the expected count walks up.
  let expected = 1;
  for (const uid of [RENTER, LISTER]) {
    await asMember(db, uid);
    const seen = await db.query("select id from public.support_tickets where id = $1", [ticket.id]);
    assert.equal(seen.rows.length, 1, "the thread is still there");
    const msgs = await db.query("select id from public.ticket_messages where ticket_id = $1", [
      ticket.id,
    ]);
    assert.equal(msgs.rows.length, expected, "and so is every message in it");
    await db.query(
      "insert into public.ticket_messages(ticket_id, sender_id, message) values($1, $2, 'still talking')",
      [ticket.id, uid],
    );
    expected += 1;
  }
  await asServer(db);

  const total = await db.query("select id from public.ticket_messages where ticket_id = $1", [
    ticket.id,
  ]);
  assert.equal(total.rows.length, 3, "the seeded photo plus both replies");
});

test("after the day the thread is gone for both members and takes no new message", async () => {
  const db = await fixture();
  const ticket = await openConversation(db);
  await db.query("update public.bookings set status = 'completed' where id = $1", [BOOKING]);
  await db.query(
    "insert into public.ticket_messages(ticket_id, sender_id, message) values($1, $2, 'pickup photo')",
    [ticket.id, LISTER],
  );
  // The day has passed.
  await db.query(
    "update public.support_tickets set conversation_closes_at = now() - interval '1 minute' where id = $1",
    [ticket.id],
  );

  for (const uid of [RENTER, LISTER]) {
    await asMember(db, uid);
    const seen = await db.query("select id from public.support_tickets where id = $1", [ticket.id]);
    assert.equal(seen.rows.length, 0, "the thread is no longer readable");
    const msgs = await db.query("select id from public.ticket_messages where ticket_id = $1", [
      ticket.id,
    ]);
    assert.equal(msgs.rows.length, 0, "neither are its messages");
    await assert.rejects(
      db.query(
        "insert into public.ticket_messages(ticket_id, sender_id, message) values($1, $2, 'hello again')",
        [ticket.id, uid],
      ),
      /row-level security/i,
      "and the database refuses a new message",
    );
  }
  await asServer(db);
});

test("support staff keep the whole closed conversation", async () => {
  const db = await fixture();
  const ticket = await openConversation(db);
  await db.query("update public.bookings set status = 'completed' where id = $1", [BOOKING]);
  await db.query(
    "insert into public.ticket_messages(ticket_id, sender_id, message) values($1, $2, 'pickup photo')",
    [ticket.id, LISTER],
  );
  await db.query(
    "update public.support_tickets set conversation_closes_at = now() - interval '30 days' where id = $1",
    [ticket.id],
  );

  await asMember(db, STRANGER, { support: true });
  const seen = await db.query("select id from public.support_tickets where id = $1", [ticket.id]);
  assert.equal(seen.rows.length, 1, "the evidence is still reachable from the admin console");
  const msgs = await db.query("select message from public.ticket_messages where ticket_id = $1", [
    ticket.id,
  ]);
  assert.equal(msgs.rows.length, 1);
  assert.equal(msgs.rows[0].message, "pickup photo");
  await db.query(
    "insert into public.ticket_messages(ticket_id, sender_id, message) values($1, $2, 'admin note')",
    [ticket.id, STRANGER],
  );
  await asServer(db);
});

test("a SafeDrive support ticket never closes on a timer", async () => {
  const db = await fixture();
  const { rows } = await db.query(
    `insert into public.support_tickets(user_id, subject, tag) values($1, 'Payment help', 'payment')
     returning id, conversation_closes_at`,
    [RENTER],
  );
  const support = rows[0];
  assert.equal(support.conversation_closes_at, null);

  // Even after every booking this person has ends.
  await db.query("update public.bookings set status = 'completed'");
  assert.equal(await closesAt(db, support.id), null);

  await asMember(db, RENTER);
  const seen = await db.query("select id from public.support_tickets where id = $1", [support.id]);
  assert.equal(seen.rows.length, 1, "support is unaffected by this chapter");
  await db.query(
    "insert into public.ticket_messages(ticket_id, sender_id, message) values($1, $2, 'any update?')",
    [support.id, RENTER],
  );
  await asServer(db);
});

test("a conversation opened after its booking already ended still closes", async () => {
  const db = await fixture();
  // api/submit-trip-condition-report.ts opens the thread on demand to post the
  // report into it, which can happen once the booking is already terminal.
  await db.query("update public.bookings set status = 'completed' where id = $1", [BOOKING]);
  const ticket = await openConversation(db);

  assert.ok(ticket.conversation_closes_at, "stamped at insert, not left open forever");
  const hoursAway = (new Date(ticket.conversation_closes_at).getTime() - Date.now()) / 3_600_000;
  assert.ok(hoursAway > 23.5 && hoursAway < 24.5, `expected ~24h, got ${hoursAway}h`);
});

test("booking again with the same person starts a thread of its own", async () => {
  const db = await fixture();
  const first = await openConversation(db, BOOKING);
  await db.query("update public.bookings set status = 'completed' where id = $1", [BOOKING]);
  await db.query(
    "update public.support_tickets set conversation_closes_at = now() - interval '1 minute' where id = $1",
    [first.id],
  );

  const second = await openConversation(db, BOOKING2);
  assert.equal(second.conversation_closes_at, null, "the new trip's thread is open");

  await asMember(db, RENTER);
  const { rows } = await db.query("select id from public.support_tickets order by created_at");
  assert.deepEqual(
    rows.map((row) => row.id),
    [second.id],
    "the closed thread is not reopened by the new booking",
  );
  await asServer(db);
});
