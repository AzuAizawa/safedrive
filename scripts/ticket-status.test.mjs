// CHAPTER 130 - a support ticket shows where it stands (panel feedback #4).
//
// The chapter is applied verbatim to real PostgreSQL (PGlite) on top of the
// few tables it touches, then driven the way the pages and the daily job do.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import * as serverTickets from "../server/ticketStatus.ts";

const HEADING = "-- CHAPTER 130 - A support ticket shows where it stands";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const LISTER = "33333333-3333-4333-8333-333333333333";

const chapterText = async () => {
  const master = await readFile(
    new URL("../database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql", import.meta.url),
    "utf8",
  );
  const body = master.split(HEADING)[1]?.split("-- Read-only verification")[0];
  assert.ok(body, "CHAPTER 130 exists in the master file");
  return "-- chapter\n" + body.slice(body.indexOf("\n"));
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function public.admin_can(p_key text) returns boolean language sql stable
      as $$ select coalesce(current_setting('test.admin', true), '') = 'yes' $$;
    create function public.check_plan_order(p_values jsonb) returns void language sql as $$ select $$;
    create table public.profiles(
      id uuid primary key, role text not null default 'user',
      deleted_at timestamptz, suspended_at timestamptz);
    insert into public.profiles(id, role) values
      ('${MEMBER}', 'user'), ('${ADMIN}', 'admin'), ('${LISTER}', 'user');
    create table public.platform_settings(id text primary key);
    insert into public.platform_settings values ('default');
    create table public.support_tickets(
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      participant_user_id uuid,
      subject text not null,
      tag text default 'general',
      booking_id uuid,
      status text not null default 'open'
        constraint support_tickets_status_check check (status in ('open', 'in_progress', 'resolved', 'closed')),
      created_at timestamptz default now());
    create table public.ticket_messages(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null references public.support_tickets(id),
      sender_id uuid not null,
      message text not null,
      created_at timestamptz default now());
    create table public.notifications(
      id bigserial primary key, user_id uuid, title text, message text, type text, link text);
    create table public.audit_log(
      id bigserial primary key, user_id uuid, action text not null,
      entity_type text, entity_id text, details jsonb);
    create table public.bookings(id uuid primary key, renter_id uuid, owner_id uuid, status text);
    create table public.payments(booking_id uuid, payment_type text, status text);
  `);
  await db.exec(await chapterText());
  return db;
}

const as = (db, uid, admin = false) =>
  db.query("select set_config('test.uid', $1, false), set_config('test.admin', $2, false)", [
    uid,
    admin ? "yes" : "no",
  ]);

const newTicket = async (db, fields = {}) => {
  const { rows } = await db.query(
    "insert into public.support_tickets(user_id, subject, tag, participant_user_id, booking_id) values ($1, $2, $3, $4, $5) returning id",
    [
      fields.user_id ?? MEMBER,
      fields.subject ?? "Cannot upload my licence",
      fields.tag ?? "general",
      fields.participant_user_id ?? null,
      fields.booking_id ?? null,
    ],
  );
  return rows[0].id;
};
const post = (db, ticketId, senderId, message = "hello") =>
  db.query("insert into public.ticket_messages(ticket_id, sender_id, message) values ($1, $2, $3)", [
    ticketId,
    senderId,
    message,
  ]);
const ticket = async (db, id) =>
  (await db.query("select status, resolved_at, status_changed_at from public.support_tickets where id = $1", [id]))
    .rows[0];
const setStatus = (db, id, status) =>
  db.query("select public.set_support_ticket_status($1, $2) as r", [id, status]);
const reopen = (db, id) => db.query("select public.reopen_support_ticket($1) as r", [id]);

test("the five statuses are the only ones a ticket can hold", async () => {
  const db = await fixture();
  const id = await newTicket(db);
  await db.query("update public.support_tickets set status = 'waiting_for_user' where id = $1", [id]);
  await assert.rejects(
    db.query("update public.support_tickets set status = 'pending' where id = $1", [id]),
    /support_tickets_status_check/,
  );
});

test("the reopen window is a voted setting: 7 days by default, 1-30", async () => {
  const db = await fixture();
  const { rows } = await db.query("select ticket_reopen_days as d from public.platform_settings");
  assert.equal(Number(rows[0].d), 7);
  await assert.rejects(db.exec("update public.platform_settings set ticket_reopen_days = 0"), /_check/);
  await assert.rejects(db.exec("update public.platform_settings set ticket_reopen_days = 31"), /_check/);
  const validate = (changes) =>
    db.query("select public.validate_platform_setting_change($1::jsonb)", [JSON.stringify(changes)]);
  await validate({ ticket_reopen_days: 14, commission_rate: 0.1 });
  await assert.rejects(validate({ ticket_reopen_days: 2.5 }), /whole number 1-30/);
  await assert.rejects(validate({ ticket_reopen_days: 31 }), /whole number 1-30/);
  await assert.rejects(validate({ something_else: 1 }), /not configurable/);
});

test("a ticket moves on by itself: staff reply puts it in progress, the member's answer brings it back", async () => {
  const db = await fixture();
  const id = await newTicket(db);
  await post(db, id, MEMBER, "first message");
  assert.equal((await ticket(db, id)).status, "open", "the opening message changes nothing");
  await post(db, id, MEMBER, "a follow-up before anyone answered");
  assert.equal((await ticket(db, id)).status, "open");

  await post(db, id, ADMIN, "Looking into it");
  assert.equal((await ticket(db, id)).status, "in_progress");

  await as(db, ADMIN, true);
  await setStatus(db, id, "waiting_for_user");
  assert.equal((await ticket(db, id)).status, "waiting_for_user");
  await post(db, id, ADMIN, "Please send a clearer photo");
  assert.equal((await ticket(db, id)).status, "waiting_for_user", "staff writing again does not move it");

  await post(db, id, MEMBER, "Here it is");
  assert.equal((await ticket(db, id)).status, "in_progress");
});

test("a ticket staff open themselves stays open until the member answers", async () => {
  const db = await fixture();
  const id = await newTicket(db);
  await post(db, id, ADMIN, "SafeDrive opened this ticket");
  assert.equal((await ticket(db, id)).status, "open");
});

test("only support staff set a status, and the member is told", async () => {
  const db = await fixture();
  const id = await newTicket(db);
  await as(db, MEMBER, false);
  await assert.rejects(setStatus(db, id, "resolved"), /Support permission required/);

  await as(db, ADMIN, true);
  await assert.rejects(setStatus(db, id, "open"), /cannot be set to open/);
  const { rows } = await setStatus(db, id, "resolved");
  assert.equal(rows[0].r.changed, true);
  const after = await ticket(db, id);
  assert.equal(after.status, "resolved");
  assert.ok(after.resolved_at, "resolving starts the reopen window");

  const notices = (await db.query("select user_id, message from public.notifications")).rows;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].user_id, MEMBER);
  assert.match(notices[0].message, /reopen it within 7 days/);
  const audit = (await db.query("select action, details from public.audit_log")).rows;
  assert.deepEqual(
    [audit[0].action, audit[0].details.from, audit[0].details.to],
    ["support_ticket_status_changed", "open", "resolved"],
  );

  const again = await setStatus(db, id, "resolved");
  assert.equal(again.rows[0].r.changed, false, "the same status twice is not a second change");
});

test("a member reopens a resolved ticket within the window, and cannot write into it before that", async () => {
  const db = await fixture();
  const id = await newTicket(db);
  await post(db, id, MEMBER);
  await as(db, ADMIN, true);
  await setStatus(db, id, "resolved");

  await assert.rejects(post(db, id, MEMBER, "still broken"), /Reopen it to add a message/);

  await as(db, LISTER, false);
  await assert.rejects(reopen(db, id), /not found/, "someone else's ticket");

  await as(db, MEMBER, false);
  await reopen(db, id);
  const after = await ticket(db, id);
  assert.equal(after.status, "open");
  assert.equal(after.resolved_at, null);
  await post(db, id, MEMBER, "still broken");
  const adminNotice = (await db.query("select user_id from public.notifications where title = 'Support ticket reopened'")).rows;
  assert.deepEqual(adminNotice.map((row) => row.user_id), [ADMIN]);
});

test("the window closes: after N days the ticket cannot be reopened and the daily job closes it", async () => {
  const db = await fixture();
  const id = await newTicket(db);
  await as(db, ADMIN, true);
  await setStatus(db, id, "resolved");
  await db.query("update public.support_tickets set resolved_at = now() - interval '8 days' where id = $1", [id]);

  await as(db, MEMBER, false);
  await assert.rejects(reopen(db, id), /7 days to reopen this ticket have passed/);

  const fresh = await newTicket(db, { subject: "Resolved yesterday" });
  await as(db, ADMIN, true);
  await setStatus(db, fresh, "resolved");

  const closed = (await db.query("select * from public.close_resolved_support_tickets()")).rows;
  assert.deepEqual(closed.map((row) => row.ticket_id), [id], "only the one past its window");
  const after = await ticket(db, id);
  assert.equal(after.status, "closed");
  assert.ok(after.resolved_at, "a closed ticket keeps when it was resolved");
  assert.equal((await ticket(db, fresh)).status, "resolved");
  await assert.rejects(post(db, id, MEMBER), /closed\. Reopen it/);
});

test("a case the system opened is reopened by staff only (R1)", async () => {
  const db = await fixture();
  for (const tag of ["booking_incident", "manual_refund"]) {
    const id = await newTicket(db, { tag });
    await as(db, ADMIN, true);
    await setStatus(db, id, "resolved");
    await as(db, MEMBER, false);
    await assert.rejects(reopen(db, id), /Only SafeDrive Support can reopen this case/);
    await as(db, ADMIN, true);
    await setStatus(db, id, "in_progress");
    assert.equal((await ticket(db, id)).status, "in_progress", "staff can");
  }
});

test("a booking conversation keeps its own open/closed life", async () => {
  const db = await fixture();
  const id = await newTicket(db, { participant_user_id: LISTER, tag: "booking_conversation" });
  await post(db, id, MEMBER);
  await post(db, id, ADMIN, "SafeDrive stepping in");
  assert.equal((await ticket(db, id)).status, "open");
  await as(db, ADMIN, true);
  await assert.rejects(setStatus(db, id, "resolved"), /booking conversation/);
});

test("a case waiting on the member still blocks an account deletion", async () => {
  const db = await fixture();
  const id = await newTicket(db, { booking_id: "44444444-4444-4444-8444-444444444444" });
  await db.query("update public.support_tickets set status = 'waiting_for_user' where id = $1", [id]);
  const { rows } = await db.query("select public.account_deletion_blockers($1) as b", [MEMBER]);
  assert.deepEqual(rows[0].b, ["A support case about one of your bookings is still open."]);
  await db.query("update public.support_tickets set status = 'resolved' where id = $1", [id]);
  const cleared = await db.query("select public.account_deletion_blockers($1) as b", [MEMBER]);
  assert.deepEqual(cleared.rows[0].b, []);
});

test("the server's list of open cases includes a case waiting on the member", () => {
  assert.deepEqual([...serverTickets.ACTIVE_TICKET_STATUSES], ["open", "in_progress", "waiting_for_user"]);
  assert.deepEqual([...serverTickets.PAYOUT_BLOCKING_TICKET_TAGS], ["booking_incident", "manual_refund"]);
});

test("the server and the pages use the same status rules", async () => {
  const [server, browser] = await Promise.all([
    readFile(new URL("../server/ticketStatus.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/ticketStatus.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(server.replace(/\r\n/g, "\n"), browser.replace(/\r\n/g, "\n"));
});

test("the Reopen button shows only when the database would allow it", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const resolvedAgo = (days) => new Date(now - days * 86_400_000).toISOString();
  const reopenable = (ticket) => serverTickets.canMemberReopenTicket(ticket, 7, now);
  assert.equal(reopenable({ status: "resolved", resolved_at: resolvedAgo(6.9), tag: "general" }), true);
  assert.equal(reopenable({ status: "resolved", resolved_at: resolvedAgo(7.1), tag: "general" }), false);
  assert.equal(reopenable({ status: "closed", resolved_at: resolvedAgo(1), tag: "general" }), false);
  assert.equal(reopenable({ status: "resolved", resolved_at: resolvedAgo(1), tag: "booking_incident" }), false);
  assert.equal(reopenable({ status: "resolved", resolved_at: resolvedAgo(1), tag: "general,manual_refund" }), false);
  assert.equal(
    reopenable({ status: "resolved", resolved_at: resolvedAgo(1), tag: "general", participant_user_id: "x" }),
    false,
  );
  assert.equal(serverTickets.reopenDaysLeft(resolvedAgo(4.5), 7, now), 3);
  assert.equal(serverTickets.reopenDaysLeft(resolvedAgo(8), 7, now), 0);
});

test("only real cases hold a payout, and they still do while waiting on the member (R2)", async () => {
  const source = await readFile(new URL("../server/payoutAutomation.ts", import.meta.url), "utf8");
  const query = source.slice(source.indexOf("let blockingTicketQuery"), source.indexOf("if (payoutBooking.status === \"active\")"));
  assert.match(query, /\.in\("tag", \[\.\.\.PAYOUT_BLOCKING_TICKET_TAGS\]\)/, "an ordinary booking question does not block");
  assert.match(query, /\.in\("status", \[\.\.\.ACTIVE_TICKET_STATUSES\]\)/, "a case waiting on the member still blocks");
});

test("no code that asks 'is this case still open?' leaves out waiting_for_user", async () => {
  // Every support_tickets query that decided whether a case is still open.
  // (guest_inquiries has its own open/in_progress statuses and is not a ticket.
  // The admin work queue lists tickets needing a staff reply - one waiting on
  // the member does not - so it keeps the two statuses on purpose.)
  const files = [
    "server/payoutAutomation.ts",
    "server/bookingCompletion.ts",
    "server/refundAutomation.ts",
    "server/cancellationRefundPlan.ts",
    "api/booking-incident-action.ts",
    "api/webhooks/paymongo.ts",
    "src/pages/admin/AdminPayoutsPage.tsx",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!source.includes('"open", "in_progress"]'), `${file} still lists only open and in_progress`);
    assert.ok(source.includes("ACTIVE_TICKET_STATUSES"), `${file} uses the shared list`);
  }
});
