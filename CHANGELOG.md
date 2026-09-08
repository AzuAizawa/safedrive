# SafeDrive 2.0 — Change Log

Running log of intentional changes. Newest first. Each entry: what changed, why,
which files, and any follow-up (migration to apply, doc to re-check).

The authoritative detail still lives in
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` and
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`. This file is the quick index.

---

## 2026-09-08 — Subscriptions kicked listers out of Lister Mode, then blamed them for it

Reported: a verified account in Lister Mode opens **Subscription & Billing**,
gets switched to Renter Mode, and lands on "Subscriptions are only available in
Lister Mode" with a four-step guide to unlocking it.

Confirmed, and it was unwinnable rather than merely confusing. `/subscriptions`
was classified as **renter** space in two places — the `<ModeRoute mode="renter">`
wrapper in `App.tsx` and `RENTER_PREFIXES` in `listerMode.ts` — while
`SubscriptionPlansPage` refuses to render for anyone whose `is_lister` is false.
So opening the page forced the account out of the exact mode the page requires,
and no sequence of clicks could get in: step 3 of its own unlock guide says
"Switch your account to Lister Mode", which is the state the user was already in
when they clicked.

Sharper still, both nav entries are gated on `isLister`, so the link is only
ever shown in Lister Mode. The only people who could see the button were the
only people it locked out.

A listing subscription buys vehicle slots, so it is lister space. Moved in both
places, which have to agree — fixing one alone brings the same contradiction
back in a different form. The `ModeRoute` verification guard still applies, so
an unverified account is not force-switched and still sees the unlock steps,
which is what that screen is actually for.

Files: `src/App.tsx`, `src/lib/listerMode.ts`.

---

## 2026-09-08 — SafeDrive absorbs the gateway fee, and says so by deleting the switch

The two "pass the PayMongo fee to the renter" settings are gone from Admin
Platform Settings. Removed after following the argument to its end: the fee is
kept at 0 because the commission is what pays for running the platform, and
gateway fees are a cost of running the platform. If the economics ever stop
working, the honest move is to raise the commission — one number with one
explanation — not to add a second charge for the same thing. Under that
reasoning there is no scenario where the setting gets switched on, and a
control nobody will ever use is worse than no control: it invites the question
of what it is and implies an unfinished feature.

So the decision is now stated by its absence. The renter pays exactly the
listed price. A ₱1,000 booking: ₱1,000 from the renter, ₱900 to the lister
(commission comes out of the lister's share, never added to the renter's), ₱100
to SafeDrive, and the gateway's cut comes out of that ₱100.

**Deliberately kept: the accounting.** Account `4020` and the three-way payment
split stay. A chart of accounts routinely holds accounts with no activity, and
rewriting the function that divides every payment — the most sensitive code in
the system, and one with test coverage — to produce the identical zero would be
risk bought for nothing. The DB columns and their validator branches stay at 0
too, so this is a frontend-only change with no chapter to run.

**Also kept: the disclosure row on the booking panel**, still conditional on
`processingFee > 0`. It can no longer fire through the UI, but it guarantees
that if a fee ever exists it is shown rather than silently folded into the
total. Never charge something the screen does not name.

**One gap recorded, not fixed.** Account `5010 'Payment processing fees'`
(expense) exists and nothing ever posts to it, so the books show ₱100 of
commission revenue against ₱0 of gateway expense. The PayMongo webhook does not
report the fee it deducted, so this cannot be automated from what arrives —
it needs a monthly manual entry read off the PayMongo dashboard. Currently ₱0
in truth as well, since the account is in test mode.

Files: `src/pages/admin/AdminPlatformSettingsPage.tsx`.

---

## 2026-09-08 — "3 dayss", and a fee line that was always zero

Two small things on the car booking panel, both reported from the renter side.

**"₱1,000 × 3 dayss".** `formatDayCount()` already returns "3 days", but the
call site still appended its own `{totalDays > 1 ? "s" : ""}` from before that
helper existed, so every multi-day booking doubled the s. The other three
`formatDayCount` call sites were checked and are correct.

**"Payment processing fee ₱0".** The rate is 0 and is meant to stay 0 until a
real PayMongo rate is confirmed — Admin Platform Settings says "Keep 0 unless
verified" for exactly that reason. So this row rendered a permanent ₱0 that
explained nothing and prompted the question of what the fee even was. It is now
shown only when there is one.

The sentence under the total moved with it: it claimed the total was "the
listed price plus the disclosed payment-processing fee" while pointing at a fee
no longer on screen. At zero it now reads "exactly the listed price - no
processing fee".

Worth recording, since the fee looked like a bug and is not: commission is
computed from `basePrice`, not the total, and the lister's payout is
`basePrice` minus commission. The processing fee is added on top of what the
renter pays and touches neither. It exists to pass the gateway's cut to the
renter; at 0, SafeDrive absorbs it. Keeping the mechanism at 0 is a real
choice, not an unfinished one.

Files: `src/pages/CarDetailPage.tsx`.

---

## 2026-09-08 — The no-show grace window becomes a setting, typed once

**Run CHAPTER 68 BEFORE deploying this.** The client and three API handlers now
select `no_show_grace_minutes`; until the column exists those reads fail, and
Admin → Platform Settings fails with them since it selects every column in one
query. SQL first, then push.

The wait at the meetup — 30 minutes past the agreed time before either side can
report the other and claim a refund — was **typed out five separate times**:
`bookingLifecycle.ts` (when the button appears), `booking-incident-action.ts`
(whether the click is accepted), `expire-booking-deadlines.ts`,
`send-return-reminders.ts`, and in words inside the help article. Two of them
carried a comment saying they "mirrored" the first, which is an admission that
nothing enforced it.

The first two are the dangerous pair. One decides when the button **appears**,
the other whether the press is **accepted** — let them drift and you ship a
button that is visible and rejects every click, which is the failure this
codebase already hit twice (the dead "Car Returned" button, and the arrival
gate). They agreed only because someone remembered to type 30 five times.

Now there is one column and two readers: `fetchPlatformPolicyTimings()` on the
client, `fetchNoShowGraceMinutes()` on the server, both clamped 15–180 and both
falling back to 30 — so even a failed read leaves the two sides agreeing rather
than disagreeing.

**Threaded as a required parameter, deliberately.** An optional one defaulting
to 30 would let a call site quietly keep the old number while the server ran on
the configured value — the same divergence in a new form. Required means `tsc`
names every call site; it found eight.

**The panel now says why, not just when.** It read "SafeDrive waits until
12:30 AM" — the time, never the reason — so a changed setting silently showed a
different time with no explanation. It now reads "waits 30 minutes after the
pickup time — until 12:30 AM", which explains itself after any change. The help
article stops naming a number it cannot verify (static text cannot read a
setting); `buildNoShowSupportPath` and the admin incident notification
interpolate the live value instead of asserting 30.

**Bounds are 15–180 and they are not arbitrary.** Under 15 a lister one traffic
light away loses the booking to a full refund with no realistic chance to
arrive. Over 180 a renter stands on a corner with no car for three hours before
they can get their money back.

**Checked and deliberately left alone: late arrival past the grace.** Asked
whether a lister arriving at 1:00 AM for a 12:00 AM pickup can still proceed
when the renter agrees to wait. It can, already. Nothing auto-cancels at
pickup — that cancel is entirely the renter's choice. The arrival gate
(`booking-action.ts:1062`) only asks "is it too early?" with no upper bound, so
check-in never closes. And the moment the second party checks in,
`getNoShowWindowState` returns null and the cancel button disappears on its own.
The grace window forbids nothing; it only unlocks an option.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 68),
`api/lib/noShowGrace.ts` (new), `api/booking-incident-action.ts`,
`api/expire-booking-deadlines.ts`, `api/send-return-reminders.ts`,
`src/lib/bookingLifecycle.ts`, `src/lib/incidents.ts`,
`src/lib/platformSettings.ts`, `src/lib/helpCenter.ts`,
`src/lib/supportTickets.ts`, `src/pages/MyBookingsPage.tsx`,
`src/pages/ListerBookingsPage.tsx`,
`src/pages/admin/AdminPlatformSettingsPage.tsx`, `src/types/database.ts`.

---

## 2026-09-08 — Three statistics that change a decision, and one stale label

Answering "what analytics actually belong here" by adding only figures that
change something someone does. Nothing new is recorded — all three read
columns that already exist.

**Admin → Earnings, two new sections.** *Most booked car types* groups
completed bookings by `car_models.body_type` (the admin-managed catalog
column), so recruiting is aimed at what renters book. *Cars listed vs
bookings, by area* puts both counts side by side per region — the region
segment of `cars.location`, split the same way `MyVehiclesPage` already
splits it. The row that matters is a region with cars and zero bookings, so
those rows render amber rather than being sorted out of sight. "Cars listed"
uses `status in (approved, active)`, the identical filter
`BrowseCarsPage.tsx:180` uses, so the number is what a renter can really find
— not a wider internal count that would flatter the comparison.

**Lister → Bookings, earnings per car.** A lister could see their total
released but not *which* car produced it. The new list shows completed trips
and amount earned per car, highest first, computed from the bookings and
payout logs the page already loads. It informs the one recurring decision a
lister makes: re-price a car that never books, or take it down. A car showing
trips but PHP 0 is a payout not yet released, and the caption says so rather
than leaving it looking like a bug.

**The sidebar still said the old name.** The page was renamed to *Money
Records*; `AdminLayout.tsx` still linked to it as *Financial Ledger*, so the
menu and the page disagreed. Fixed — that finishes the rename.

Deliberately not added: renter statistics (a renter makes no decision a
dashboard informs), signup/visit charts (no tracking exists and no decision
attached), and utilisation or revenue-per-user (real metrics for a company
with an operations team, jargon to explain at defense here). No SQL chapter —
no schema change.

Files: `src/pages/admin/AdminEarningsPage.tsx`,
`src/pages/ListerBookingsPage.tsx`, `src/components/AdminLayout.tsx`.

---

## 2026-09-08 — Super admins are never IP-blocked, and account owners get told

Two gaps in the IP blocking shipped an hour earlier, found by comparing it
against what a mature setup actually has.

**A super admin could have blocked themselves.** Globe and Smart put large
numbers of subscribers behind one CGNAT address, so an admin can easily share
an address with whoever tripped the auto-block — and discovering that while
trying to release a payout or clear a verification is the worst possible
moment. `blockedIpResponse` now exempts `super_admin`, checked only *after*
the address is found blocked, so the normal path costs nothing extra. A
failure to confirm the exemption falls through to the block rather than
opening it.

**Nobody told the person being attacked.** The auto-block acts on the
attacker; the account owner had no signal at all. Five failed sign-ins
against one account within 15 minutes now emails that owner — deliberately
lower than the 10-attempt IP threshold, because this is a warning rather than
an enforcement action, and it is the only way a victim learns someone is
working on their account. Deduped to one message per account per hour.

**Still a manual step, and the highest-value one:** CHAPTER 24's
`password_verification_hook` is written and waiting but must be registered in
the Supabase Dashboard (Authentication → Hooks → Password Verification
Attempt). That is the real server-side lockout — the localStorage one in
`src/lib/authLockout.ts` lives on the attacker's own machine and is cleared by
an incognito window. Until the hook is registered, the genuine brute-force
defences are Turnstile on the login form and that hook's absence is the
biggest remaining hole.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:api-boundaries`, `check:booking-flow`.

Files: `api/lib/ipBlock.ts`, `api/record-security-event.ts`.

---

## 2026-09-08 — Delete a user from User Management, and block an IP (CHAPTER 67)

Two admin capabilities the owner went looking for and could not find, because
neither existed.

### Delete a user, with a two-step confirm

Nothing in `AdminUsersPage.tsx` deleted or anonymized — that only happened
through the Privacy Requests queue, which a user has to file into. The case
that had no path: an account simply abandoned, whose owner will never ask for
anything.

(Worth knowing: CHAPTER 58's `flag-dormant-accounts` already runs daily at
03:58 and auto-files a deletion request after `dormant_account_days`, default
365. Lowering that setting is a Platform Settings change, not code.)

Super-admin only, reusing `public.anonymize_user()` exactly as the Privacy
Requests page does — it is super-admin gated in SQL and writes its own
`audit_log` row even with no linked request, so the paper trail survives.
Two dialogs: the first states plainly what is destroyed and what is kept, the
second will not enable its button until the admin types **the account's own
email**. A fixed phrase like "delete user" becomes muscle memory and would
not catch having the wrong profile open; the email forces you to look at who
you are erasing. `ConfirmDialog` gained an optional `confirmDisabled` prop —
additive, so every existing caller is unchanged.

Verified in the SQL and stated in the dialog: personal fields are
*overwritten* and verification images are *deleted from storage*, neither
recoverable — while bookings, payments and ledger rows are untouched.
`anonymize_user` only nulls arrival photos on bookings and never mentions
`payments` or the ledger, `bookings.renter_id` has no `ON DELETE CASCADE`,
and the profile row is soft-deleted rather than removed. No financial total
moves.

### Block and unblock an IP (CHAPTER 67)

Security Logs recorded an IP on every attempt and could do nothing with it —
the page only searched and displayed the column.

**What this can and cannot do, stated plainly because it is easy to
over-promise:** it cannot stop a blocked address from *signing in*. Login goes
from the browser straight to Supabase Auth, and the server-side
`password_verification_hook` receives only `user_id` and `valid` — no IP.
What it does is stop them *doing* anything: `api/lib/ipBlock.ts` runs at the
top of ten state-changing handlers, so booking, all four checkouts, every
booking action, and conversation-opening are refused with a 403. Reads that
go straight to PostgREST are not covered — enforcing there would mean an IP
test inside policies every table depends on, where one mistake locks out
everyone.

**A header bug had to be fixed first, or the whole thing was theatre.**
`record-security-event.ts` and `create-guest-inquiry.ts` both read the
**left-most** `x-forwarded-for` value — the end the *caller* supplies. Anyone
could pick the IP recorded against their own failed logins, and walk past both
the block and the counter behind it. Both now use `x-real-ip`, falling back to
the right-most hop.

Auto-block lives in `record-security-event.ts`, which already receives every
failed login: **10 failures from one address within 15 minutes → a block that
expires in 24 hours.** Ten clears someone who forgot their password; the
expiry matters because Globe and Smart put many subscribers behind one CGNAT
address, so a permanent block on one bad actor can be a permanent block on a
whole neighbourhood. A manual block from the UI has no expiry until an admin
removes it. Every lookup fails **open** — a blocklist that takes the site down
when it breaks is worse than one that briefly lets someone through.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:api-boundaries`,
`check:process-logic`, `check:financial-logic`.

Files: `src/pages/admin/AdminUsersPage.tsx`, `src/components/ConfirmDialog.tsx`,
`api/lib/ipBlock.ts` (new), `api/record-security-event.ts`,
`api/create-guest-inquiry.ts`, ten state-changing handlers,
`src/pages/admin/AdminSecurityLogsPage.tsx`, `src/types/database.ts`,
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 67 — run in
Supabase SQL Editor).

---

## 2026-09-08 — Trip condition photos never appeared in the booking chat

Reported from a booking conversation showing "Lister pickup photo" twice as
plain text, with no image behind either.

`submit-trip-condition-report.ts` posts those photos correctly: the message
carries `attachment_storage_path` **and** `attachment_bucket:
"trip-condition-evidence"`, because that evidence lives in its own private
bucket rather than the default attachment one. `getTicketAttachmentUrl()`
accepts that bucket as its second argument for exactly this reason.

Both reader pages dropped it — `SupportTicketsPage.tsx` and
`AdminSupportTicketsPage.tsx` each called
`getTicketAttachmentUrl(message.attachment_storage_path)` with no bucket, so
the lookup fell through to `support-attachments`, found nothing, returned
null, and the message rendered as its bare caption. Every party was
affected: renter, lister and admin all saw a label where the evidence should
have been.

Both now pass `message.attachment_bucket` through. No data was lost — the
photos were in storage the whole time, just never resolved to a URL.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/SupportTicketsPage.tsx`,
`src/pages/admin/AdminSupportTicketsPage.tsx`.

---

## 2026-09-08 — No extending a booking you already showed up to return

User feedback: the "Request extension" button should disappear once the
renter has checked in for the return — they are standing at the meetup
handing the car back, so asking for more time makes no sense.

Correct, and it was worse than cosmetic. Neither the button nor the API
looked at `renter_return_arrived_at` — both only checked the booking status,
which is still `active` at that point. So an extension could be requested,
approved by the lister, and paid for while the return handoff was under way.
And because an approved-but-unpaid extension blocks completion
(`extensionBlocksCompletion`), doing so could **jam the very return already
in progress** — the two parties standing there unable to close the trip.

"Request early return" had the identical hole for the same reason: nothing
left to shorten when you are already at the handoff.

Both are now gated on `renter_return_arrived_at`, in the UI and on the
server (`api/booking-extension-action.ts`,
`api/booking-early-return-action.ts` — the field had to be added to both
booking selects, which had never fetched it).

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:process-logic`,
`check:financial-logic`.

Files: `src/pages/MyBookingsPage.tsx`, `api/booking-extension-action.ts`,
`api/booking-early-return-action.ts`.

---

## 2026-09-08 — Camera "Permission denied" now says what to actually do

User feedback: *"Naka denied agad yung camera, walang nag a-ask if a-allow ba
yung camera or not."*

The missing prompt is the browser, not a bug: once camera access for a site
has been refused - especially with "remember" ticked - `getUserMedia()`
rejects instantly and no prompt is shown again. Nothing in the app can
re-trigger it; only the user can clear it in site settings.

What *was* our bug is the advice. The screen printed the browser's bare
string ("Permission denied") and appended "use the waiver button below if
this device has no working camera" — the wrong instruction for by far the
most common cause. The user has a working camera; they need to unblock it.
Following that advice meant filing a condition report with no photo when a
photo was perfectly possible.

The failure is now mapped to something actionable: a blocked permission
explains where to re-enable it and does not mention the waiver; a genuinely
missing camera points at the waiver; a camera held by another app says to
close that app. Applied to both camera screens — the trip condition report
and, where it matters more, the verification selfie, since without it a user
cannot finish KYC at all.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/TripConditionReportPage.tsx`, `src/pages/VerificationPage.tsx`.

---

## 2026-09-08 — Arrival check-in no longer asks for your location

User feedback: *"Bakit tinatanong yung location kapag nag click ng 'I have
arrived'? eh kapag nag list ka na ng kotse mo may pickup ka ng nilalagyan
ng details."*

This is a **different** GPS feature from the car's pickup pin removed
earlier — that one was set once when listing a car, this one fired on every
arrival check-in — so the earlier removal never touched it. And removing
the pin is exactly what broke it: the only consumer that could act on an
arrival reading was `isReporterLocationVerified()`, which compared it
against `cars.pickup_latitude`. With no pin on any newly listed car, its
`every(Number.isFinite)` guard returns false every time. The app was asking
for a location permission to feed an automation that could no longer run.

Removed end to end: the geolocation call in `ArrivalPhotoCapture`, the
`arrivalLocation` payload and `normalizeArrivalLocation()` in
`booking-action.ts` (including the fallback retry that existed only to cope
with those optional columns being absent), the "with an optional location
check" notification wording, the map link auto-posted into the booking chat,
and the consent copy on both booking pages.

In `booking-incident-action.ts`, the "no car at pickup" claim now always
goes to manual review, and the haversine helpers behind the old comparison
are gone. That was already the effective behaviour — the instant-refund
branch could not be reached — so this removes a dead path rather than
changing an outcome.

The `bookings.*_arrival_latitude` columns stay, and the admin dispute view
still renders the map link for bookings that recorded one before this; its
empty-state copy now explains why new ones never will.

`scripts/booking-flow-smoke-check.mjs` asserted this feature's presence, so
it caught the removal. Its markers now assert the opposite.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:process-logic`,
`check:financial-logic`, `check:api-boundaries`.

Files: `src/components/ArrivalPhotoCapture.tsx`, `api/booking-action.ts`,
`api/booking-incident-action.ts`, `src/pages/MyBookingsPage.tsx`,
`src/pages/ListerBookingsPage.tsx`,
`src/pages/admin/AdminSupportTicketsPage.tsx`,
`scripts/booking-flow-smoke-check.mjs`.

---

## 2026-09-08 — Captured money that nobody recorded, and a renter-overlap backstop (CHAPTER 65)

The last two findings from the lifecycle audit.

**A payment captured seconds after its deadline vanished from the books.**
The deadline-expiry cron runs every 15 minutes and payments cluster at the
last minute, so it can cancel a booking in the gap between the renter
tapping Pay and PayMongo's webhook arriving. All three payment branches
(downpayment, balance, full) then found the booking no longer payable,
wrote a security log line, and returned 409 — and nothing else. The
renter's money was gone while SafeDrive held no `payments` row, no refund
row, no ticket and no notification, so unless the renter complained nobody
would ever learn of it.

Those branches now record the capture with a note saying it was not
applied, open a `manual_refund` review ticket, and notify super admins.
Deliberately **not** an automatic refund — a human decides — but the money
lands in a queue instead of disappearing. Wrapped so a bookkeeping failure
cannot change the webhook's answer to PayMongo.

**"One trip at a time" now has a database backstop (CHAPTER 65).**
`create-booking.ts` enforced it as a read-then-write: SELECT the renter's
overlapping bookings, then INSERT. Two requests milliseconds apart — a
double-tapped Confirm on a slow connection, a client retry, two tabs — both
passed the check before either inserted, leaving one renter holding
overlapping bookings on two different cars and blocking two listers'
calendars. The car side has had exactly this backstop since CHAPTER 5
(`bookings_no_active_date_overlap`); the renter side had nothing. CHAPTER 65
mirrors it with the same status list. Verified against live data first —
the self-join for existing violations returned no rows. `create-booking.ts`
now tells the two exclusion violations apart, since "someone else booked
these dates" and "you already have an overlapping trip" mean opposite
things to the reader.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:financial-logic`,
`check:process-logic`, `check:api-boundaries`.

Files: `api/webhooks/paymongo.ts`, `api/create-booking.ts`,
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 65 — run in
Supabase SQL Editor).

---

## 2026-09-08 — Both profile guard triggers had never run (CHAPTER 64)

Found while verifying CHAPTER 63 against the live database, and more severe
than the escalation that chapter was written for.

Both guard triggers on `public.profiles` start by exempting server callers
with `current_user in ('postgres','service_role','supabase_admin')`. Both
are `SECURITY DEFINER` owned by `postgres` — confirmed against the live
database (`prosecdef = true`, `proowner = postgres`). PostgreSQL sets
`current_user` inside a `SECURITY DEFINER` function to the **function
owner**, never the caller, so that condition is unconditionally true and
both functions return on their first statement.

Every check below it has therefore never executed:

- `protect_profile_sensitive_fields()` — "Users cannot change their own
  role", self-approval of `verified_status`, clearing one's own login
  block, editing verified identity fields, licence validity, the
  deleted-profile reactivation guard.
- `enforce_admin_profile_permission()` — the `users.verify` /
  `users.moderate` permission split, and everything CHAPTER 63 added.

Impact: the policy `"Users can update own profile"` (`FOR UPDATE USING
auth.uid() = id`) lets any authenticated user update their own row, the
grant is table-level over every column, and the trigger meant to stop them
was inert. **Any logged-in account** — not just an admin — could set its
own `role` to `super_admin`, self-approve verification, or clear its own
login block. CHAPTER 63's rules were right; they had simply inherited the
same broken test.

CHAPTER 64 adds `is_trusted_server_context()`, which reads the PostgREST
request JWT rather than `current_user`. That setting is per-request and is
not rewritten by the security context: no JWT means direct SQL (migrations,
the SQL editor, psql), which is privileged by definition, and a JWT whose
role is `service_role` is the key every `api/` handler uses. Both trigger
functions are recreated on top of it, keeping their existing rules
unchanged. CHAPTER 64 supersedes CHAPTER 63 — running 64 alone is enough.

Also fixed in CHAPTER 63 itself: it used a bare `$$` dollar quote, which
the Supabase SQL editor mangles into "syntax error at end of input". Named
tags are the convention here for exactly this reason (see the CHAPTER 57
and 58 follow-up commits); it now uses `$admin_profile_guard$`.

**Verified against the live database** after applying, by impersonating an
authenticated session inside a rolled-back transaction (`set local role
authenticated` + `set local request.jwt.claims`):

- setting your own `role` to `super_admin` → blocked by
  `enforce_admin_profile_permission()`;
- clearing your own `login_blocked_until` → blocked by
  `protect_profile_sensitive_fields()`;
- self-approving your own `verified_status` → blocked by the same;
- editing your own `phone` → still succeeds, so ordinary profile editing
  is unaffected.

The last three are guards that had never once executed before this.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 64 — run
in Supabase SQL Editor).

---

## 2026-09-07 — "Request early return" before the trip starts, and an invisible 9 AM default

Two problems reported from a live booking sitting in the handoff phase.

**"Finishing early?" was offered before the trip had started.** The
early-return controls admitted `fully_paid`, so the renter saw "Request
early return" while standing at the pickup point waiting for the lister
to arrive — trip progress still reading "In handoff", the car not yet in
their hands. An early return means handing the car back sooner than
agreed; it cannot apply before you have the car. Shortening a booking
that has not started is a cancellation, with its own refund policy. Now
gated on `active` on both sides — the button and
`api/booking-early-return-action.ts`, which had the same over-permissive
status list.

**The 9:30 AM that came out of nowhere.** The renter was told "SafeDrive
waits until 9:30 AM before you can cancel for no car at pickup" on a
booking that showed no pickup time at all. Cause: when `pickup_time` is
null the timing math falls back to 09:00 (+ the 30-minute grace window =
9:30), but the display printed the time *only if it existed* — so the
assumption drove every deadline while remaining invisible. The default is
now a named constant shared by both, and the pickup time always renders,
marked `(default)` when it is the assumed one rather than a time the
renter chose. New bookings are unaffected (the booking form requires a
pickup time); this is about bookings that reach the system without one.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:process-logic`, `check:alignment`, `check:booking-flow`.

Files: `src/pages/MyBookingsPage.tsx`,
`api/booking-early-return-action.ts`.

---

## 2026-09-07 — The return handshake, and the "car was never returned" case

Clarified by the owner: the return is a handshake. Both sides tap "I Have
Arrived", the renter adds optional photos and taps **"Car Returned"**, the
lister taps **"Car Received"**, and neither half may be skipped.

The code did something different. The lister's confirmation set
`status='completed'` **unilaterally**, with a comment stating their
completion "finalizes the trip on its own". Three things followed from
that, all broken:

- **The renter could never record their half.** Their button only appeared
  once `owner_completed` was true — by which point the booking was already
  `completed`, and the completion endpoint only accepts `fully_paid` /
  `active`, so their call was rejected. A dead button, always.
- **The lister-unresponsive safety net could never fire.** It looks for
  `renter_completed = true` **and** `owner_completed = false` — a
  combination the code made unreachable. It is written correctly, with
  notifications and payout release; it had simply never matched a booking.
  The renter was still being told, in an incident ticket, that "the trip
  will auto-complete with payout if the lister remains unresponsive."
- **A silent lister froze the booking forever.** Status stayed `active`,
  which keeps the car's calendar blocked by the overlap constraint and the
  lister's payout unreleased.

The fix is on the renter's side, not the lister's. The lister tapping
"Car Received" still finalizes the trip on its own — they are the one
party who can be certain the car is physically back, and they cannot
reach that tap without having filed both required photo reports. What
changed is that the renter's button no longer waits for
`owner_completed`: it opens as soon as **both** sides have checked in at
the return, is labelled "Car Returned", and the endpoint now requires the
return check-in rather than the pickup one. The renter can go first —
which is exactly what arms the safety net.

**An open dispute now stops the auto-completion clock.** Raised while
working through the scenarios: a silent lister usually means they forgot,
but it can also mean the car was never handed back — the renter marked it
returned and the lister has nothing to confirm. Auto-completing on the
renter's unverified word would close the trip, release the payout and
free the car's calendar while the car is still gone. `report_non_return`
is the lister's way to say precisely that and it sets
`dispute_status='open'`, but the cron never looked at it. It does now, at
both the select and the claim, so a filed dispute wins and the case goes
to an admin instead.

**And the lister is now told when the renter goes first.** Notifications
only ever fired once a booking actually completed, so a lister who forgot
got no nudge, and a lister who never received the car back got no prompt
to report it before the timeout ran. Both now get a notification and an
email: confirm receipt, or report that the car was not handed back.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:process-logic`, `check:financial-logic`, `check:alignment`,
`check:booking-flow`, `check:api-boundaries`.

Files: `api/booking-action.ts`, `api/expire-booking-deadlines.ts`,
`src/pages/MyBookingsPage.tsx`.

---

## 2026-09-07 — Remaining lifecycle findings: extension safety, dead-end buttons, timezone

The rest of the booking-lifecycle audit.

**An extension could be applied to a cancelled or completed booking.** The
webhook's booking update carried no status guard, unlike every other
transition in the codebase — so an extension paid after the lister
cancelled (legal while there are no arrivals) still rewrote `end_date`,
`total_days`, `base_price`, `commission` and `total_price`, and credited
the lister payable, re-billing a trip that was over. Now claimed on
`fully_paid`/`active`.

**And when it can't be applied, the money is no longer dropped.** The
extension row is flipped to `paid` before the booking is touched, so
throwing there made PayMongo's retry return `ALREADY_PROCESSED` — capture
kept, `end_date` unchanged, and no payment row written at all. The same
hole caught a date collision taken between approval and payment. The
payment is now recorded with a note saying it was not applied, and a
security event is raised for a human.

**Two dead-end button sets, siblings of the return-report bug.** On the
lister side, every return-stage branch was gated on `active`, so a booking
still at `fully_paid` (handover stalled) fell through and was offered
"Return report (required)" and "Confirm - Car Received" — the report
endpoint requires an active booking, and completion demands a report that
endpoint refuses to create, so both 409 with no way forward. It now
explains that the trip has not started. On the renter side, the return
"I Have Arrived" button appeared purely on the clock, with no status
check, so on a short booking it showed on a trip that had never started.

**`findExtensionCollision` scanned every active booking on the platform**
— no car filter, no renter filter, no limit — so past PostgREST's
max-rows cap real collisions were silently missed and an overlapping
extension would be approved. Now narrowed to the same car or the same
renter.

**An extension and an early return could both be open at once.** The
early-return endpoint already blocks when an extension is open; the
reverse check was missing, so a booking could hold an approved early
return ("back by Sep 3") while an extension pushed `end_date` to Sep 8,
and the return gate would follow the earlier date. Now symmetric.

**Client return math ran in the device's timezone.** `bookingLifecycle.ts`
built return/pickup instants with `new Date(y, m, d, h, …)` — browser-local
— while the pages' own pickup math used the Manila-anchored
`Date.UTC(...) - 8h`. On a device not set to UTC+8 the return check-in
button disagreed with the server by the device offset. Both helpers now
use the Manila construction the server uses.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:process-logic`, `check:financial-logic`,
`check:reconciliation-logic`, `check:alignment`, `check:booking-flow`,
`check:api-boundaries`.

Still open, needing decisions rather than a patch: the documented
lister-absent auto-completion does not exist (`expire-booking-deadlines.ts`
only fires from `renter_completed`, and the docs say it must also fire
from `renter_return_arrived_at`); a cron/webhook race can still capture a
payment seconds after a deadline cancellation with no refund path; and
"one trip at a time" has no DB constraint behind it.

Files: `api/webhooks/paymongo.ts`, `api/booking-extension-action.ts`,
`src/pages/ListerBookingsPage.tsx`, `src/pages/MyBookingsPage.tsx`,
`src/lib/bookingLifecycle.ts`.

---

## 2026-09-07 — Security + lifecycle audit: payout was blocked on every booking (CHAPTER 63)

The two audits that a session limit had killed were re-run. Both came back
with confirmed criticals; each claim below was re-verified directly before
being acted on.

### Admin could make themselves super_admin (CHAPTER 63)

The `api/` layer is clean — all 41 handlers re-fetch by id and authorize,
no IDOR, no client-supplied prices, webhook signatures verified
constant-time before use, cron secrets fail closed, no secrets in the
bundle. The hole was one layer down, where the browser talks to PostgREST
directly, and it needed four things to line up — all four were true:
the `authenticated` grant is table-level over every column; the "Admins
can update any profile" policy admits any admin holding `users.verify` or
`users.moderate`; `protect_profile_sensitive_fields()` — the only function
carrying the "Users cannot change their own role" guard — returns early
for admins, so that guard never ran for them; and
`enforce_admin_profile_permission()` checked only verification and
login-block columns, never `role`.

A plain admin could therefore `PATCH` their own profile with
`{"role":"super_admin"}` from an ordinary browser session and gain every
super-admin power at once, defeating every correct check in `api/`. The
same policy also let a support-tier admin rewrite another lister's
`payout_account_number` — the column `payoutAutomation.ts` reads to build
the transfer — or set `deleted_at`/`admin_disabled_at` on a super admin.

CHAPTER 63 hardens `enforce_admin_profile_permission()`: `role` is no
longer writable through PostgREST by anyone (admin accounts are created
and removed by the service-role endpoints, which are exempt), and a plain
admin can no longer change `deleted_at`, `admin_disabled_at`, or another
account's payout details. No client code writes `profiles.role`, so
nothing legitimate breaks.

### Lister payout could never complete — two independent blocks

**`renter_completed` was required but unreachable.** The lister's
confirmation sets `status='completed'` on its own (by design — their photo
reports carry the evidence), leaving `renter_completed` false. The
renter's own complete call only accepts `fully_paid`/`active`, so after
that it is rejected forever. Yet both `payoutAutomation.ts` and the admin
batch in `process-payout.ts` required the flag. Every trip emailed the
lister "your payout is being processed" and then nothing moved. The
requirement is dropped in both places, matching the documented intent.

**A booking's chat thread blocked its own payout.** The blocker counted
any `support_tickets` row for the booking with status open/in_progress —
with no tag filter. Booking conversations are rows in that same table,
opened automatically the first time anyone taps "I Have Arrived" or files
a condition report, and nothing ever closes them. So any booking that
reached check-in was refused with "Open booking support case found". Now
filtered on `participant_user_id is null`, the codebase's own marker for a
real support case (`isConversationTicket`, `adminWorkQueue.ts`) — genuine
disputes still block exactly as before.

### Return reminders were 8 hours wrong

`send-return-reminders.ts` built the deadline with
`new Date(y, m, d, h, …)`, which uses the runtime timezone — UTC on the
edge. An 18:00 Manila drop-off became 02:00 the next day, and the email
then formatted it back in Asia/Manila, so both parties were told a return
time 8 hours late. The due-soon/overdue windows were shifted the same way,
skipping genuinely overdue trips. Now uses the `Date.UTC(...) - 8h`
construction every other handler already uses.

### Double booking returned a raw 500

The exclusion constraint correctly stops the second of two concurrent
bookings, but the error surfaced as a 500 carrying the Postgres text. Now
a 409 with "Those dates were just booked by someone else."

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:financial-logic`, `check:alignment`, `check:booking-flow`,
`check:api-boundaries`.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 63 — run
in Supabase SQL Editor), `api/lib/payoutAutomation.ts`,
`api/process-payout.ts`, `api/send-return-reminders.ts`,
`api/create-booking.ts`.

---

## 2026-09-07 — Cleared the queued audit findings

The remaining code-level findings from the full-system audit.

**Refunding a completed booking double-debited account `2040`**
(`api/lib/refundAutomation.ts`). At completion the whole commission moves
`2040 → 4010`. Refund automation blocked only on a *completed payout* — so
a booking that completed but whose payout **failed** stayed refundable,
and the refund posting debited `2040` a second time for a liability that
no longer existed, leaving `2040` negative while `4010` still showed
revenue that had been handed back. Completed bookings are now blocked from
automatic refund, with a message telling the admin to record it manually
so the correcting entry is deliberate.

**The lister's no-show dialog quoted live platform settings**
(`ListerBookingsPage.tsx`). It read the current `refund_late_renter_percent`
for every booking, while the server decides the refund from the booking's
own snapshot (`api/booking-incident-action.ts`). After an admin changed the
setting, the dialog promised a percentage the refund would not use. It now
reads the booking's snapshot and falls back to the live value only for
bookings created before snapshots existed — the field was already being
fetched by `select("*")`, just missing from the type.

**`refund_full_hours_snapshot = 0` silently became 24**
(`MyBookingsPage.tsx`). Zero is valid and admin-settable, meaning "always
refund in full", and the server honours it — but `Number(x) || DEFAULT`
turned it into 24, so a renter cancelling 2 hours before pickup was shown
"about 50% back" and then refunded 100%. Now an explicit null check, the
shape the adjacent `latePercent` line already used.

**Payout Review showed the wrong amount when a trip had a paid extension**
(`AdminPayoutsPage.tsx`). It displayed `base_price − commission`, but the
transfer also adds each paid extension's fuel top-up, which is
deliberately not folded into `base_price`. Once a payout row exists its
amount *is* the transferred figure, so that is now shown; the estimate is
kept only for not-yet-paid bookings and labelled "est."

Still open, needing a business decision rather than code: short-notice
**lister compensation** is withheld from the renter but no code path ever
pays it to the lister (`api/mark-manual-payout.ts`, which
`run-reconciliation.ts` and the smoke check both expect, does not exist).

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:financial-logic`, `check:reconciliation-logic`, `check:alignment`,
`check:booking-flow`.

Files: `api/lib/refundAutomation.ts`, `src/pages/ListerBookingsPage.tsx`,
`src/pages/MyBookingsPage.tsx`, `src/pages/admin/AdminPayoutsPage.tsx`.

---

## 2026-09-07 — Phase D: plain wording, and the end of the false "unbalanced" alarms

Feedback, roughly: the finance side reads like it was built for an
accountant, and nobody should complicate wording just to make a system
look impressive. Fair — the machinery is worth keeping (it is what
surfaced the Phase A money bugs), but it was on display instead of under
the hood.

**"Financial Ledger" is now "Money Records."** Each record reads as a
sentence — "Renter paid ₱5,000", "Paid out to lister ₱4,500",
"Subscription payment ₱199" — instead of an event key and a debit/credit
table. Account codes, event keys, the running debit/credit totals and the
manual correction form now sit behind an **Accounting view** toggle; that
form asks for debits and credits in centavos and is genuinely dangerous
for a non-accountant to meet by accident.

**Fixed the false red "unbalanced — payout blocked" badges.** Journals and
entries were fetched as two independent queries with different limits and
different sort keys, so any journal whose lines fell outside the entries
cut-off rendered as zero debits and zero credits — and was labelled
unbalanced. Entries are now fetched for exactly the journals being shown.

**Same root cause fixed in `api/run-reconciliation.ts`**, where it was
worse: it raised `ledger_journal_does_not_balance` at **critical**
severity for healthy journals, on every run. A normal journal has 3-4
lines, so 1000 journals routinely exceeded the flat 5000-entry cap.
Entries are now fetched per-journal in chunks, and the job also warns when
the payment or journal caps are actually hit instead of silently
reconciling a partial period. `finalize_ledger_journal` refuses to
finalize anything that does not balance, so a finalized journal is
balanced by construction — every one of those criticals was noise, and
noise that teaches admins to ignore critical alerts.

**"Retention Requests" is now "Privacy Requests"** and no longer sits in
the finance-coloured group on the dashboard. It is Data Privacy Act
request handling — someone asking for their data, or asking to be deleted
— on a 30-day clock, and calling it retention made it read as an
accounting screen. The page copy now says that plainly. The
`retention_policy_rules` table stays a reference report; there is no
automated purge job anywhere and none was added.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:financial-logic`,
`check:reconciliation-logic`, `check:api-boundaries`.

Files: `src/pages/admin/AdminFinancialLedgerPage.tsx`,
`api/run-reconciliation.ts`,
`src/pages/admin/AdminRetentionRequestsPage.tsx`,
`src/components/AdminLayout.tsx`, `src/pages/admin/AdminDashboard.tsx`.

---

## 2026-09-07 — Phase C: an Earnings page, in plain words

Raised directly: the admins are not accountants, could not tell where to
see what SafeDrive earns, and could not verify financial computations
themselves. Nothing in the app answered "how much did the platform make?"
— the Admin Dashboard is a work queue (profiles to verify, payouts
needing attention) and shows no money at all, and there was no chart
library installed, so no peak-period view was possible either.

New `/admin/earnings` (super-admin), deliberately written for someone who
does not read ledgers:

- **From booking commission** and **from subscriptions**, plus the total —
  in pesos, with the count and average printed under each figure rather
  than left implicit.
- **Every total is counted twice.** The headline number comes from the
  ledger (accounts `4010` and `4030`); an independent second count comes
  from the source records (commission stored on completed bookings;
  `subscriptions.amount_centavos`). Agreement is shown as a green tick
  with the second figure; disagreement shows the gap in pesos and points
  at Reconciliation. Correctness is demonstrated rather than asserted,
  which is the point when the reader cannot audit the math.
- **Monthly bar chart**, hand-rolled with plain divs — no chart library
  added for one screen — split by commission vs subscriptions.
- **Busiest month and weekday**, counted from completed bookings by the
  date the rental starts.
- **"How these numbers are counted"** in plain language at the bottom,
  including that reversals subtract so a corrected mistake is not counted
  twice, and that PayMongo test-mode transactions are not collected cash.

Row caps are explicit: if a query actually hits its limit the page says
the totals are incomplete instead of quietly showing a short number — the
failure mode the Financial Ledger page's mismatched limits already
produce.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/admin/AdminEarningsPage.tsx` (new), `src/App.tsx`,
`src/components/AdminLayout.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-07 — Phase B: subscription revenue now reaches the books (CHAPTER 62)

Subscription payments are real money — `api/create-subscription-checkout.ts`
creates a live PayMongo checkout for the PHP 199 / PHP 299 plans, and the
webhook verifies the paid amount against the plan and guards against
duplicate events before activating it. But after collection the money went
nowhere financially: the webhook wrote a `subscriptions` row and an
`audit_log` entry and stopped. No ledger journal, so collected revenue was
invisible to every financial report and to reconciliation. At least one
account had already subscribed, so this was unrecorded real revenue, not a
hypothetical.

Deliberately **not** routed through `payments`: that table's `booking_id`
is `NOT NULL` and a subscription has no booking. Making it nullable would
ripple through RLS policies, every `payments`→`bookings` join, the admin
payment screens and reconciliation — a large blast radius for no gain,
since `subscriptions` already records the payment itself
(`amount_centavos`, `provider_payment_id`, `paid_at`).
`ledger_journals.booking_id` has always been nullable, so the journal is
the right home; only `postSimpleBalancedJournal`'s TypeScript signature
had required a booking id.

A subscription carries no lister payable and nothing deferred — the
platform earns it outright — so each is a plain "cash in, revenue
recognised" pair: debit `1010`, credit the new `4030 Subscription
revenue`. CHAPTER 62 adds that account and backfills journals for
already-paid subscriptions, keyed identically to what the webhook now
writes, so it is safe to run more than once.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `check:alignment`.

Files: `api/webhooks/paymongo.ts`, `api/lib/ledger.ts`,
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 62 — run in
Supabase SQL Editor).

---

## 2026-09-07 — Phase A: stored XSS, double refund, and three money-truth bugs

Found by a full-system audit. Phase A of a four-phase plan; the numbers
have to be true before any earnings reporting is built on top of them.

**Stored XSS → admin session takeover** (`src/lib/richText.ts`). When a
tag wasn't on the allowlist the sanitizer unwrapped it — but the
recursion meant to clean the promoted children ran *after*
`element.replaceWith(fragment)`, and inserting a DocumentFragment empties
it. So the loop iterated nothing and every promoted child survived
unsanitized: `<div><img src=x onerror=…></div>` passed straight through
into `dangerouslySetInnerHTML`. Write-side sanitizing is client-only and
messages go to PostgREST directly, so an attacker could skip the composer
entirely; the payload then ran in the **admin's** browser on
`AdminSupportTicketsPage`. Children are now sanitized depth-first
*before* being promoted, and genuinely dangerous tags (script, style,
iframe, svg, img, form…) are removed outright rather than unwrapped.

**Double refund** (`AdminRefundReviewPage.tsx`, `api/mark-manual-refund.ts`).
A short-notice cancellation creates a pending `manual_review` row for the
policy share only. The UI still offered "Retry PayMongo" on it, which
refunds 100% of captured and doesn't recognise the manual row as covering
anything — then the manual row could *also* be released. PHP 10,000
captured at a 50% snapshot could pay out PHP 15,000. The button is now
hidden for manual rows, and the server rejects any release that would
push total refunds past what the booking collected.

**Unbounded goodwill refund** (`api/booking-early-return-action.ts`). The
client-supplied amount had a floor but no ceiling; a lister could approve
PHP 999,999 on a PHP 3,000 booking. Now clamped to captured, matching
`api/booking-incident-action.ts`.

**`/api/process-refund` had no state guard** on its single-booking path,
so an `active` mid-trip booking could be refunded in full. Now guarded
like the batch path.

**Two missing ledger journals.** The payout callback
(`api/webhooks/paymongo-payouts.ts`) marked payments completed without
posting a journal — for InstaPay/PesoNet that's the *normal* path, so the
ledger permanently overstated both the lister payable and the clearing
balance, and reconciliation raised a critical nothing could clear. Manual
refund release (`api/mark-manual-refund.ts`) — the terminal path for every
manual-review refund — likewise posted nothing. Both now post, idempotent
on the same event keys reconciliation looks for. Also fixed the
`payout:null` event key (`api/lib/payoutAutomation.ts`): when PayMongo
returned no transfer id, the unique key let one booking claim
`"payout:null"` and silently skipped every later payout's journal.

**Commission rounding** (`api/create-booking.ts`). The only unrounded
money value in the file; a rate like 0.125 on a 1333 base stored
166.625, drifting accounts 2010/2040 a centavo out permanently — each
journal still balanced, so nothing caught it.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:financial-logic`, `check:reconciliation-logic`, `check:alignment`,
`check:booking-flow`, `check:api-boundaries`.

Files: `src/lib/richText.ts`, `src/pages/admin/AdminRefundReviewPage.tsx`,
`api/mark-manual-refund.ts`, `api/booking-early-return-action.ts`,
`api/process-refund.ts`, `api/webhooks/paymongo-payouts.ts`,
`api/lib/payoutAutomation.ts`, `api/create-booking.ts`.

---

## 2026-09-07 — Fixed: single-session guard could lock you out of your own account recovery

Reported: signing in on a device while another device held the session
showed "signed in on another device", the OTP was still entered, and the
authenticator step failed with "invalid claim: missing sub claim" - the
device could not get in at all. The follow-up question was the serious
one: if someone hacks your account and is using it, can you still log
back in to take it back?

By design, yes - CHAPTER 57 is "newest login wins", and
`finalizeSingleSession()` revokes every other session server-side via
`signOut({ scope: "others" })`, so logging in *is* the recovery path. A
bug was defeating it, and it bit precisely in that case.

Two causes compounding:

1. `sd_active_session_token` was written at login (`singleSession.ts`)
   and read by the guard, but **never cleared** - not by `signOut()`, not
   by `forceSignOut()`. Any device that had ever logged in kept a stale
   token forever.
2. `markUserAuthPending()` ran *after* the password call plus two awaited
   round-trips, but `AuthContext` starts the guard the instant a session
   appears and the guard checks immediately. In that window the guard
   didn't know a 2FA step was still owed, so it compared the stale local
   token against the remote one (the other device's), saw a mismatch, and
   force-signed-out the half-finished login. The OTP was then verified
   against a dead session - hence "missing sub claim".

A device that had never logged in has no local token and returns early,
which is why this only struck a returning device while another session
was active.

Fixes: new `clearLocalSessionToken()` called from both sign-out paths in
`AuthContext.tsx`, so a returning device starts with nothing to compare
(timing-independent); and the pending-2FA marker now set *before* the
password call on both portals, with matching clears on the
password-failure branches and in AdminLoginPage's catch. The login pages
also no longer restore an OTP step from the email-less placeholder state
- that flag is deliberately left in place rather than cleared, since it
is also what forces a sign-out if a password-only session is opened in
another tab.

Note (not code): single-session ends the attacker's *session*, but
someone who knows the password can log in again and ping-pong. Changing
the password is what actually ends it.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/lib/singleSession.ts`, `src/contexts/AuthContext.tsx`,
`src/pages/LoginPage.tsx`, `src/pages/admin/AdminLoginPage.tsx`.

---

## 2026-09-07 — Renter's trip-report buttons only appear when they're actually usable

Reported from an ongoing rental: the renter already received the car and
the drop-off was days away, yet the booking detail still offered "Return
report (optional)" and "Pickup photos (optional)". Once you've tapped "I
Have Received the Car", the pickup is over and the return isn't close -
neither belongs on screen.

"Return report" was also a real bug, not just clutter: it rendered from
the moment the renter checked in at *pickup* and stayed all trip, but
`api/submit-trip-condition-report.ts` (lines 102-122) rejects a
return-phase report unless the booking is `active` **and** the renter's
own `renter_return_arrived_at` is set. Tapping it mid-trip walked the
renter through the entire live-camera form and failed at submit with a
409 - while the caption directly underneath already said "Return check-in
opens N hours before drop-off". The button contradicted its own caption.

In `MyBookingsPage.tsx`'s mid-trip block: the pickup-report button is
gone (the two moments where it makes sense - at the pickup point, and at
handover beside "I Have Received the Car" - each still offer it,
untouched), and the return-report button now renders only once
`booking.renter_return_arrived_at` is set. So during the trip the screen
is clean - "Message Lister" and "Report Booking" only, plus the
check-in-opens caption - and the return report reappears when the car is
actually being handed back.

This matches what the lister side has always done
(`ListerBookingsPage.tsx:3425-3490`): report buttons only in states the
API would accept, and "Pickup report"/"Return report" wording rather than
"photos". No backend change - the API already enforced the right rules;
the UI just stopped offering an action it would refuse.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/MyBookingsPage.tsx`.

---

## 2026-09-07 — Added a "Booking Ref" on My Bookings and Lister Bookings

Follow-up to the entry directly below: fixing the conversation ticket
title solves matching a *chat thread* back to its booking, but there was
still no standalone reference number for a booking itself - the kind of
short code an online order confirmation shows, that a renter or lister
can read out or quote when talking to support or to each other, instead
of a 36-character UUID.

New `src/lib/bookingReference.ts`: `getBookingReference(bookingId)`
returns `SD-BK-<first 8 hex chars, uppercased>` - same "SD-<type>-<8
chars>" pattern already used for payment/refund receipt document numbers
in `MyBookingsPage.tsx` (`documentNo`), just for bookings instead of
payments. Shown as "Booking Ref: SD-BK-0B1F5701" in the booking detail
view on both `MyBookingsPage.tsx` (renter) and `ListerBookingsPage.tsx`
(lister) - not on the compact list card, matching how a support ticket's
"Ticket ID" is likewise only shown once the ticket is opened. The payment
receipt's existing "Booking ID" row is untouched (keeps the full UUID,
for audit precision) - different label so the two are never confused for
the same thing.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/lib/bookingReference.ts` (new), `src/pages/MyBookingsPage.tsx`,
`src/pages/ListerBookingsPage.tsx`.

---

## 2026-09-07 — Booking conversation tickets now show the vehicle, not a raw ID (CHAPTER 61)

Reported: a "Car inquiry" support ticket already showed a readable title
("Car inquiry: Toyota Ativ (NNY 3609)"), but a booking's own conversation
thread showed only the raw booking UUID ("Booking conversation:
0b1f5701-ffa9-4d45-b492-303858c3315f") - confusing, and there was nowhere
on the booking screens to look that ID up either.

`api/open-booking-conversation.ts` (the "Message Lister"/"Message Renter"
button) already built a proper "<Brand> <Model> (<Plate>) (<start> to
<end>)" label. Two other places that can auto-create the same kind of
ticket were still falling back to the raw ID: `api/booking-action.ts`'s
arrival auto-post to chat, and `api/submit-trip-condition-report.ts`'s
pickup/return report auto-post (both only create a ticket here if the
renter/lister never explicitly opened the conversation first). Both now
build the same label - `booking-action.ts` reuses its existing
`getVehicleLabel()` helper; `submit-trip-condition-report.ts`'s booking
query was expanded to also fetch the car/model/brand needed to build one
locally, since the ticket-creation code lives in a "never let a chat
hiccup fail an already-saved report" try/catch already.

CHAPTER 61 SQL backfills existing tickets that already carry the old raw-
ID subject (matches only that exact old format, so it never touches a
ticket already carrying a real label) - this is what fixes the specific
ticket from the report, not just future ones.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:api-boundaries`.

Files: `api/booking-action.ts`, `api/submit-trip-condition-report.ts`,
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 61 - run in
Supabase SQL Editor).

---

## 2026-09-07 — Removed the car pickup GPS pin feature entirely

Follow-up to (and supersedes) the two entries directly below. Talking
through the city-mismatch warning surfaced a bigger question: is a raw
GPS pin the right way to convey a pickup location to a person at all?
Confirmed `cars.location` is already a pre-combined "Region - City -
Specific Pick-up Location" string built at write time
(`MyVehiclesPage.tsx`'s add/edit save handlers), and `CarDetailPage.tsx`
already renders that full string to renters today - so nothing new was
needed to show renters a real, human-readable address. The GPS pin only
ever added a second, harder-to-read representation of the same spot.

Removed the entire "Pickup Location Pin" section from both the
add-vehicle form and the Edit Listing modal - the "Use My Current
Location" button, its city-mismatch-warning check, and the "view on
Google Maps" confirmation link are all gone. Also removed
`pickup_latitude`/`pickup_longitude` from the add-form state, the
car-creation insert payload, and the car-edit update payload; deleted
`src/lib/pickupLocationCheck.ts` (now fully unused).

Deliberately did **not** touch the `cars.pickup_latitude`/`pickup_longitude`
database columns (left nullable, not dropped) or the type fields that
describe them - old listings that already have a pin keep it. That pin
is also the input to `api/booking-incident-action.ts`'s
`isReporterLocationVerified()`, which auto-approves an instant refund
for a "no car at pickup" incident report when a renter's arrival GPS
matches the car's pin within 500m. That function already degrades
gracefully when the pin is missing (`return false` when any coordinate
isn't finite), routing to `queueManualRefundReview()` instead of
crashing - so going forward, new listings' "no car at pickup" reports
route to manual admin review rather than instant auto-refund. This only
affects that one incident-report fast path; the regular time-based
"Cancel Booking" flow is unrelated and stays fully automatic.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/MyVehiclesPage.tsx`, `src/lib/pickupLocationCheck.ts`
(deleted).

---

## 2026-09-07 — Warns when the GPS pickup pin looks far from the selected city

Raised scenario: a lister selects Region/City from the dropdowns (e.g. a
Calabarzon city), but taps "Use My Current Location" while actually
standing somewhere else entirely (e.g. Quezon City) - nothing caught the
two contradicting each other. The dropdown stays a legitimate fallback
for editing a listing away from the actual pickup spot (the GPS pin is
optional for exactly that reason), so this can't just always defer to
one or the other - but `BrowseCarsPage.tsx` filters/displays cars by the
dropdown's Region value directly, so a silent mismatch isn't cosmetic to
a renter.

Added a local-only (no external geocoding service) distance check: new
`src/lib/pickupLocationCheck.ts` holds an approximate center coordinate
for every city already in `MyVehiclesPage.tsx`'s dropdown list, and
`isPinFarFromCity()` compares a freshly captured pin against the
currently selected city (checked at the city level, not the broader
region bucket - several region buckets like "Southern Luzon" span areas
too large/non-circular for a region-level radius to usefully catch
anything). If the pin lands over ~40km from the selected city, "Use My
Current Location" now shows an additional warning toast alongside its
usual success toast - advisory only, never blocks saving, never changes
the dropdown or the captured pin. The free-text "Other" city option has
no known coordinate, so it's silently skipped (no false warnings).

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/lib/pickupLocationCheck.ts` (new), `src/pages/MyVehiclesPage.tsx`.

---

## 2026-09-07 — Pickup pin confirmation is now a Google Maps link, not raw coordinates

Follow-up to the entry directly below: after removing the manual
lat/long inputs, the confirmation text still showed raw coordinates
("Pin set: 14.725551, 121.006767") - not something a lister can read or
verify. Checked the one other place a pin's coordinates are shown to a
person (`AdminSupportTicketsPage.tsx`'s arrival-evidence review) and
confirmed it already does the right thing - a clickable "Map" button via
a plain `https://www.google.com/maps?q=...` link, never raw numbers.
Applied the same pattern here: "Pin set" is now a clickable "view on
Google Maps" link instead of text, in both the add-vehicle form and the
Edit Listing modal. No external API/key needed - same zero-cost Maps URL
pattern already used elsewhere in this codebase (the admin arrival
review, and this session's earlier booking-arrival chat message).

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/MyVehiclesPage.tsx`.

---

## 2026-09-07 — Removed the manual latitude/longitude fields from the pickup pin

Reported: the "Pickup Location Pin" section (add-vehicle form and Edit
Listing modal, `MyVehiclesPage.tsx`) showed raw editable latitude/longitude
number fields under the "Use My Current Location" button - a lister has
no way to know what coordinates to type there.

Removed the manual number inputs from both places - "Use My Current
Location" (stand at the pickup spot, tap the button) is now the only way
to set the pin, which is also the only way that actually produces a
correct real-world coordinate for this feature to begin with. Updated the
helper text and the geolocation-failure toast to stop mentioning manual
entry ("Try again from the pickup spot" instead of "enter coordinates
manually"). No data model change - `pickup_latitude`/`pickup_longitude`
are set the same way as before, just no longer directly editable as text.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/MyVehiclesPage.tsx`.

---

## 2026-09-07 — Vehicle renewal no longer asks for documents an updated OR/CR already proves

Feedback: the renewal form required 5 separate uploads (OR/CR, LTO
receipt, MVIR, emission test, updated car photos) plus CTPL. An updated
OR/CR cannot be issued by the LTO without already having passed the LTO
receipt, MVIR inspection, and emission test - the OR/CR is itself proof
those already happened, so asking for them again was redundant. Updated
car photos aren't a renewal/compliance document at all - vehicle photos
are edited directly on the listing (My Vehicles), unrelated to
registration/insurance renewal.

Dropped LTO receipt, MVIR, emission test, and car photos from the
required-upload set on both `ListerCarRenewalPage.tsx` (submission) and
`AdminVehicleRenewalsPage.tsx` (review) - only **Updated OR/CR** (required),
**CTPL document** (required, unchanged), and **comprehensive insurance
document** (optional, unchanged) remain. The four dropped columns on
`car_renewals` are relaxed to nullable, not removed (CHAPTER 60) - no
data loss, only changes what a new submission must provide.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/ListerCarRenewalPage.tsx`,
`src/pages/admin/AdminVehicleRenewalsPage.tsx`, `src/types/database.ts`,
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 60).

---

## 2026-09-07 — Security fix: the 2FA step could be skipped entirely by opening a new tab/PWA

Reported: entered the correct password, stopped at the "enter your
verification code" screen without submitting it, then opened SafeDrive
from a separately installed PWA icon on the same device - it signed
straight in, no code ever required.

Root cause: `signInWithPassword()` already writes a full, usable Supabase
session into `localStorage` the instant the password is correct - the
2FA step is enforced entirely by this app's own client-side gate
(`src/lib/authPending.ts`), not by Supabase withholding the session. That
gate was stored in `sessionStorage`, scoped to a single tab/window and
never shared with any other browsing context - so a second tab, a new
window, or a separately launched installed-PWA icon saw the valid
session with no memory that its 2FA step was never finished, and let it
straight through. `UserRoute.tsx`/`AdminRoute.tsx` already had the
correct guard logic (force sign-out + a "Finish Sign-In First" screen) -
it just couldn't see the flag from any context but the one that started
the login.

Fixed by moving `authPending.ts`'s storage from `sessionStorage` to
`localStorage`, which - like the session it's gating - is shared across
every tab/window/installed-PWA instance on the same origin. No other file
needed to change.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/lib/authPending.ts`.

---

## 2026-09-07 — Defensive fix: light/dark theme now has a plain-hex fallback for browsers without oklch() support

Reported (second-hand, not reproducible on the reporting user's own
device): a tester's light/dark toggle did nothing - the app stayed black
regardless. The toggle logic and the `:root`/`.dark` CSS variables were
both confirmed correct and distinct; not a universal bug. One real gap
found while checking: every color token in `src/index.css` was
`oklch()`-only with no fallback - on a browser that doesn't support
`oklch()` (older Android WebView, older in-app browsers/Samsung
Internet), `var(--background)` etc. resolve to nothing usable and the
affected elements fall back to the browser's own unstyled default, which
can plausibly render as "stuck black" - a "works for me, not for them"
pattern that matches the report, though it isn't confirmed as this
specific tester's exact cause.

Added a `@supports not (color: oklch(0 0 0))` block restating the same
`:root`/`.dark` custom properties with plain hex equivalents. A browser
that supports `oklch()` is completely unaffected (the block never
activates); one that doesn't gets a fully working, if slightly less
precise, palette instead of broken/unstyled elements.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/index.css`.

---

## 2026-09-07 — Fixed: single-active-session guard could kick a login out mid-2FA-entry

Reported: login with the correct password AND a valid authenticator code
still got rejected with "Authenticator verification rejected - invalid
claim: missing sub claim."

Root cause: `signInWithPassword()` already establishes a real Supabase
session the moment the password is correct - the second factor
(authenticator/email code) this app additionally requires is enforced by
the app's own UI/routing, not by Supabase withholding the session. That
means `AuthContext.tsx`'s single-active-session guard (CHAPTER 57, shipped
this session) started running - and could act - the instant the password
step succeeded, before the 2FA step had actually finished.
`finalizeSingleSession()` only runs once the WHOLE login (password + 2FA)
completes, so at that in-between moment this tab's own saved session
token was still whatever an earlier, separate login had left behind. If
another device had logged in in the meantime, the guard saw a mismatch,
decided this looked "superseded," and force-signed the tab out - out from
under its own in-progress login - right as the authenticator code was
being verified, producing the missing-JWT error.

Fixed in `src/lib/singleSession.ts`: the guard now checks
`isUserAuthPending()`/`isAdminAuthPending()` (`src/lib/authPending.ts` -
already tracks exactly "a 2FA challenge is in progress on this tab,"
cleared right after a successful verify) and skips its check entirely
while either is true. Applies to every trigger (poll, realtime, tab
focus) uniformly, and to both portals and every 2FA sub-path (authenticator
verify, email-code fallback, first-time enrollment).

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/lib/singleSession.ts`.

---

## 2026-09-07 — Vehicle renewal: admin now enters/verifies the expiry dates, not the lister

Reported gap, found while brainstorming the renewal flow: driver's-licence
resubmission has the *admin* type the authoritative expiry date after
reading the uploaded document - the renter never self-reports it. Vehicle
renewal was the opposite: the lister typed all three expiry dates
(registration, CTPL, comprehensive insurance) when submitting, and
`AdminVehicleRenewalsPage.tsx`'s "Approve & relist" saved those lister-typed
values straight to `cars` with no admin date-picker at all - the admin only
opened the document images and clicked one button.

Fixed to match the licence pattern: each pending renewal card now shows
the lister's submitted dates as reference text plus three editable date
fields (registration and CTPL required, comprehensive optional - CTPL is
legally mandatory in the Philippines, comprehensive isn't), pre-filled
from the lister's submission but fully admin-correctable. Approving now
saves whatever the admin actually confirmed/typed, not the unverified
lister input. `ListerCarRenewalPage.tsx` (the lister's own submission
form) is unchanged - their self-reported dates remain a useful starting
point for the admin, they just stop being the final source of truth.

Also confirmed, no change needed: a car goes fully offline
(`renewal_required`, unbookable) the moment **any one** of the three
compliance dates expires - `public.flag_vehicles_needing_renewal()`
already checks `registration_expiry < current_date OR ctpl_expiry <
current_date OR comprehensive_insurance_expiry < current_date`, run daily.
Already prevents "registration is fine but the insurance quietly expired
and the car stayed bookable."

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/admin/AdminVehicleRenewalsPage.tsx`.

---

## 2026-09-07 — Closed notification/email gaps found in a full-app audit

Requested: verify every significant process/status-update (arrival,
licence resubmission accept/reject, and similar) notifies both in-app AND
by email. Confirmed the established pattern already holds for every
admin-decision event (licence resubmission, KYC verification, vehicle
listing approve/reject, support replies, payouts, manual refunds) - but
several automated/background events, and two incident branches, only
ever wrote an in-app `notifications` row.

Five gaps closed, all reusing the existing `sendUserNotificationEmail`
helper (`api/lib/email.ts`) with the exact same title/message text
already written for each in-app notification - no new copywriting:

1. `api/booking-incident-action.ts`: `renter_no_show` (lister reports the
   renter never showed at pickup) had zero email for either party -
   money/reliability-record-affecting, now emails both. `renter_no_car`
   (renter reports no car at pickup) only emailed the owner - the renter
   (whose booking is cancelled and refunded) now gets one too, including
   the `overstay` sub-case.
2. `api/expire-booking-deadlines.ts` - every one of its ~10 automated
   notification sites (owner-response/payment expiry, balance-unpaid
   cancellation, balance reminder, early-return/extension expiry x2,
   lister-completion timeout, handover-stall auto-start and notice,
   return no-show warning) now also emails, on top of the in-app row -
   this is the file where a user is least likely to have the app open
   when it fires.
3. New `api/send-vehicle-renewal-decision-email.ts` (structural twin of
   `send-vehicle-decision-email.ts`), wired into `AdminVehicleRenewalsPage.tsx`'s
   three actions (flag for renewal, reject a resubmission, approve a
   resubmission) - previously the direct structural twin of licence
   resubmission review, which already emailed, while renewal decisions
   didn't.
4. Found one level deeper while researching #3: the *automated* daily
   sweep (`api/flag-expired-vehicle-documents.ts` →
   `flag_vehicles_needing_renewal()`) had the same gap - a car auto-flagged
   for an expired document only ever got an in-app notice.
5. Same pattern again: `api/flag-expiring-licenses.ts` →
   `notify_expiring_licenses()` (licence expiry reminders) was in-app only.

For #4/#5, Postgres can't change a function's return type via
`CREATE OR REPLACE`, so both SQL functions were dropped and recreated
`returns table(...)` instead of a bare count, handing back the rows they
already compute so the edge function can loop and email each one - no
table/column changes, pure logic update (CHAPTER 59).

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:api-boundaries`.

Files: `api/booking-incident-action.ts`, `api/expire-booking-deadlines.ts`,
`api/send-vehicle-renewal-decision-email.ts` (new),
`src/pages/admin/AdminVehicleRenewalsPage.tsx`,
`api/flag-expired-vehicle-documents.ts`, `api/flag-expiring-licenses.ts`,
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 59),
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-07 — Renamed "Support" nav to "Support & Chats"

Reported: the sidebar nav item is just "Support" with a headset icon,
which reads as SafeDrive-facing help - but the page behind it also holds
every renter↔lister booking conversation ("Message Lister"/"Message
Renter"). Nothing to click into first shows that.

The two kinds of threads were already correctly separated *inside* the
page (`SupportTicketsPage.tsx` already has distinct "SafeDrive Support"
and "Booking Conversations" tabs, backed by `isConversationTicket()`) - the
mislabel was only the entry point. Renamed the sidebar nav label and the
page's own H1 (both renter and lister) from "Support"/"Help & Support" to
**"Support & Chats"**. Route, icon, and everything inside the page
(including the two tab labels) are unchanged. Admin's own
`AdminSupportTicketsPage.tsx` keeps its "Support" wording - that's their
actual support queue, not this nav item.

A bigger, separate idea was discussed and deliberately deferred: opening
the booking conversation inline in a modal right on the booking card
(Grab/Uber-style), instead of navigating to `/support?ticketId=...`. Left
for a future pass since it needs extracting the message-thread view out of
`SupportTicketsPage.tsx` into a shared component first.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/components/DashboardLayout.tsx`, `src/pages/SupportTicketsPage.tsx`.

---

## 2026-09-07 — Removed the lister's manual "renter is here" override; arrivals now auto-post to the booking chat

Two related pickup-handoff cleanups, lister side:

1. Removed "Confirm - Renter Is Here" - a manual override letting the
   lister confirm the renter's arrival on their behalf (originally for
   "renter's phone is dead"). Removed end to end: the button, its handler,
   and the server-side `confirmOnBehalfOfRenter` override in
   `api/booking-action.ts`'s `"arrive"` action - confirmed via a full-repo
   grep that nothing else depended on it.
2. When either party taps "I Have Arrived" and optionally shares a
   location, the action now auto-posts a message into that booking's chat
   thread (e.g. "Renter arrived at pickup." with a clickable "View
   location" Google Maps link when a location was shared) - the same
   find-or-create-conversation pattern already used for pickup/return
   condition-report photos (`api/submit-trip-condition-report.ts`). No
   external API or key needed - the link is just
   `https://www.google.com/maps?q={lat},{lng}` from data already captured.
   A chat-post failure never fails the arrival itself (logged only).
   Return-arrival isn't included - it captures no location today.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:api-boundaries`.

Files: `src/pages/ListerBookingsPage.tsx`, `api/booking-action.ts`,
`scripts/booking-flow-smoke-check.mjs`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-07 — Dormant account policy: inactivity indicator + auto-flag, manual execute

Requested: a way to see how long a user account has gone unused, a
real-world-grounded rule for when it counts dormant, a decision on whether
crossing that line deletes automatically or notifies an admin, and an
explicit guarantee that deleting an account never destroys booking/payment
history needed for future financial reporting.

Turned out most of this already existed. `public.anonymize_user()`
(Chapter 26) was already the safe "delete an account" mechanism - it
blanks PII and keeps the `profiles` row's id, so `bookings`/`payments`/
ledger entries (none of which `CASCADE` from `profiles` - confirmed at the
database level: `bookings.renter_id`/`owner_id` have no `ON DELETE` clause
at all, so a real hard delete on a profile with any booking fails outright
rather than silently cascading) are untouched. `data_retention_requests` +
`AdminRetentionRequestsPage.tsx` was already a full human-reviewed pipeline
ending in that same function. This chapter only adds a way to auto-FILE
into that existing pipeline once an account has been inactive past a
threshold - a super admin still reviews and executes, exactly like a
user-submitted request. Nothing is ever deleted unattended.

- New admin-configurable setting `dormant_account_days` (default 365 - a
  common dormant-account threshold; changeable any time in Admin Platform
  Settings, no redeploy).
- New "Last Active" badge on the admin Users tab, measured from
  `profiles.active_session_started_at` (Chapter 57, stamped at every
  completed login) falling back to `created_at`.
- New daily cron (`api/flag-dormant-accounts.ts` → `flag_dormant_accounts()`)
  auto-files a `deletion` retention request for any account past the
  threshold with no booking in progress and no existing open request -
  it never touches bookings/payments/ledger, only queues the account for
  review.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:api-boundaries`.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 58),
`src/lib/accountDormancy.ts` (new), `src/lib/platformSettings.ts`,
`src/pages/admin/AdminUsersPage.tsx`,
`src/pages/admin/AdminPlatformSettingsPage.tsx`,
`api/flag-dormant-accounts.ts` (new),
`.github/workflows/scheduled-workers.yml`, `src/types/database.ts`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-07 — Lister's pickup screen no longer offers "Add pickup photos" before arrival is confirmed

Reported: on the lister's pickup card, "Add pickup photos (optional)"
already appeared right next to "Confirm Arrival Now," before the lister
had even confirmed arrival. Confusing on two counts: nothing to
photograph together yet (the renter may not even be there), and it read
"(optional)" even though the lister's pickup report is already mandatory
by the time it actually matters.

Verified the rest of the flow already worked as intended and needed no
change: the "both arrived" block already requires a submitted pickup
report (which is already required, not optional, for the lister -
`TripConditionReportPage.tsx`) before "Hand Over the Car" is clickable,
and `getNextStep()` already switches the card's "NEXT STEP" banner to
"Hand over the car" / "Submit your pickup condition report with live
photos..." exactly once both parties have arrived - not before.

Fix: removed the premature "Add pickup photos (optional)" button and its
tooltip from the pre-arrival block entirely; the required prompt at the
correct time ("Submit pickup report") was already there and unaffected.
Also renamed the trip-progress label "Renter confirmed receipt" to
"Renter received the car" - the old wording read like an actual receipt
(resibo), which it isn't.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/ListerBookingsPage.tsx`.

---

## 2026-09-06 — Single active session per account (newest login wins)

Reported: logging into the same account from a second device (e.g. a
laptop, while still signed in on a phone) left both sessions valid at
once, indefinitely - going back to the older device later found it still
logged in.

Two layers, CHAPTER 57:
1. **The actual revoke.** Every login that fully completes (password +
   whichever 2FA step applies), on either portal, now calls the native
   `supabase.auth.signOut({ scope: "others" })` - this immediately revokes
   the refresh token of every other session on the same account at the
   Supabase Auth server level. The new device's own session is untouched.
2. **Fast, visible detection on the older device**, reusing the
   poll+realtime pattern `AuthContext.tsx` already uses for admin
   permissions: a new `profiles.active_session_token` column is
   overwritten at every finalized login; every signed-in tab compares its
   own `localStorage` copy against it via a realtime subscription, a
   check when the tab regains focus (covers "left the device, came back to
   it later"), and a 45s poll backstop. A mismatch force-signs the tab out
   locally with a "signed in on another device" message, via the same
   session-timeout-notice flow already used for inactivity.

Also fixed while touching this code: `AuthContext.tsx`'s inactivity
timeout and the manual "Sign Out" button both called
`supabase.auth.signOut()` with no `scope`, which defaults to `'global'` -
an idle phone was silently signing out an actively-used laptop too. Both
now use `{ scope: "local" }`. The four account-status forced sign-outs in
`fetchProfile` (deleted / blocked / inactive / admin disabled) correctly
keep the default global scope - those really should end every session on
the account.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:api-boundaries`.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 57),
`src/lib/singleSession.ts` (new), `src/contexts/AuthContext.tsx`,
`src/pages/LoginPage.tsx`, `src/pages/admin/AdminLoginPage.tsx`,
`api/record-security-event.ts`, `src/types/database.ts`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-06 — Install button was showing even from inside the installed app itself

Immediate correction to the entry directly below. That fix made the button
never hide, including when `isStandalone` (already installed) was true -
reported as wrong the moment it shipped: opening the installed app and
logging in both still showed "Install," which is genuinely confusing (there
is nothing left to install from inside it).

Re-added `if (isStandalone) return null;`. This does not reintroduce the
"stranded after uninstall" problem the previous entry was trying to avoid -
`isStandalone` is a live check of the CURRENT tab/window's display mode,
not a persistent "this device has installed it before" flag. The instant
the same site is opened in a normal browser tab again (e.g. after later
uninstalling the app), `isStandalone` reads `false` and the button is back.
It only ever hides the button in the one context where showing it would be
confusing: while already running inside the installed app.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/components/InstallButton.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-06 — Install button never hides itself, period

Immediate follow-up to the entry directly below. That fix still hid the
button when `isStandalone` (already installed) was true - rejected: if a
user later uninstalls the app, they'd have no visible way back to an
install control. (`isStandalone` is actually a live per-tab check, not a
permanent "ever installed" flag, so it would already un-hide itself in a
normal browser tab post-uninstall - but depending on that being obvious, or
on any single browser signal being reliable at all, is exactly the
fragility that caused the original bug.) Simplest and most robust: the
button never hides itself, for any reason, on any page, matching how an
install control behaves on other sites. Clicking it while already
standalone now shows "SafeDrive is already installed on this device."
instead of doing nothing (previously the button just wasn't there to click).

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/components/InstallButton.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-06 — Install button no longer disappears after repeated page refreshes

Reported: on the landing page, refreshing several times made the "Install"
button vanish. Root cause: `InstallButton.tsx` hid itself whenever neither
`canInstall` nor `showIosHint` was true - but `beforeinstallprompt` (the
event `canInstall` depends on) is a one-shot-ish browser event that Chrome
throttles/suppresses re-firing on repeated page loads within one session
once it's fired and gone unused. So on an installable browser, `canInstall`
could legitimately be `false` on any given reload for reasons that have
nothing to do with whether the page is actually installable, and the button
flickered in and out accordingly.

Fixed by always rendering the button once mounted - the only real
"permanently irrelevant" signal is `isStandalone` (already installed).
Clicking it with no native prompt available (canInstall false, not iOS
Safari either) now shows a toast with manual instructions ("Look for the
install icon in your browser's address bar, or open the browser menu and
choose 'Install app' / 'Add to Home Screen'") instead of the button just
not being there.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/components/InstallButton.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-06 — Fixed a client/server mismatch: incident actions ignored approved early returns

Caught while explaining the "renter arrived early, lister didn't" scenario:
the client-side eligibility check for reporting a no-show/non-return
(`src/lib/incidents.ts`'s `canReportNonReturn`, updated in an earlier entry
today to use the new operative-deadline helper) had no server-side
counterpart - `api/booking-incident-action.ts`'s actual `report_non_return`
and `lister_no_show_return` handlers still computed the return deadline
directly from `bookings.end_date`/`dropoff_time`, completely ignoring any
approved early return. For `lister_no_show_return` specifically (the renter
reporting that the lister never showed up to receive an early return) this
was a real, confirmed bug: the client would show the report button as
available 30 minutes after the *early* time, but the server would reject
the request until 30 minutes after the *original* time - hours later.
`report_non_return` turned out to converge with the client in every case in
practice (its neither-side-arrived precondition means the early return's own
grace always elapses, and triggers the fallback to the original instant,
before the original instant's own grace could ever be reached) but is now
computed the same way regardless, rather than relying on that being true by
coincidence.

Added `getOperativeReturnMs`/`fetchApprovedEarlyReturn` to
`api/booking-incident-action.ts` (mirrors `getOperativeReturnDeadline` in
`src/lib/bookingLifecycle.ts`) and used them in both handlers. No refund
logic changes - `lister_no_show_return` was already refund-free by design
(the trip was already delivered by this point, so there's nothing to give
back), this only fixes *when* the report becomes available, not what
happens once it's filed.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:api-boundaries`.

Files: `api/booking-incident-action.ts`.

---

## 2026-09-06 — Once approved, an early return can't be re-requested if it's missed

Follow-up to the entry directly below. Reported rule: once a lister approves
an early return, that's the one shot at it - if it doesn't happen, the
renter waits for the original deadline (the fallback already built), not
send another early-return request for the same trip. The `request` action's
duplicate-request guard (`api/booking-early-return-action.ts`) only ever
checked for an existing `pending` row - an already-`approved` row didn't
block a new request at all. Extended the guard to also reject when the
latest row for the booking is `approved`, with a clear explanation in the
error. Mirrored client-side in `MyBookingsPage.tsx`'s `canRequestEarlyReturn`
so the "Request early return" button doesn't invite a request that would
just be rejected. A `rejected`/`cancelled`/`expired` prior request still
does not block a new one - only `pending`/`approved` do.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`.

Files: `api/booking-early-return-action.ts`, `src/pages/MyBookingsPage.tsx`.

---

## 2026-09-06 — Time-aware early returns, with a fallback to the original deadline if missed (CHAPTER 56)

Two related asks after reviewing the return handshake. First: early-return
requests only ever let a renter pick an earlier calendar *day* - never an
earlier *time* on the same day (e.g. original agreed drop-off 10 AM, wanting
to hand the car back 6 AM that same day was impossible to request at all).
Second: approving an early return has always destructively overwritten
`bookings.end_date`, so if both parties then missed that new, earlier
window entirely, the original deadline was gone - no safety net. Requested:
let the renter pick a real date+time, and if both sides miss it, fall back
to letting the handoff still happen up through the *original* agreed
date+time rather than a permanently harder deadline. A related smaller ask:
the "overdue" label on the return reminder banner should only appear a
3-hour grace period after the deadline actually in force, not immediately.

**Design**: `bookings.end_date`/`dropoff_time` now permanently mean "the
ORIGINAL agreed return date+time," never touched by early-return approval -
they stay the sole input to every availability/overlap check elsewhere (the
`bookings_no_active_date_overlap` exclusion constraint, `create-booking.ts`'s
overlap check, `booking-extension-action.ts`'s day-math anchor, both
calendars), so none of those needed to change. The approved early date+time
lives only on its own `booking_early_returns` row. Two distinct deadline
concepts, not one, because a single "falls back after a miss" value can't
also gate the arrival button (it would flicker shut right when the missed
party needs it most): **operative deadline** (can fall back to the
original once both sides miss the early one, past its own 30-minute grace)
drives the reminder/overdue banner and no-show-report eligibility;
**check-in eligible from** (never re-closes once an early return is
approved) drives only the "I Have Arrived" button's lead-time gate. The
fallback is stateless - recomputed fresh from live arrival timestamps each
time, not persisted once triggered.

**CHAPTER 56**: `booking_early_returns` gains `requested_end_time` (required
on every new row) and `current_dropoff_time` (a snapshot, same idea as the
existing `current_end_date`); the earlier-than check constraint now compares
full date+time instants instead of bare dates, so a same-day request is
valid as long as it's genuinely earlier.

**`api/booking-early-return-action.ts`**: `request` validates the real
instant instead of just the date; `approve` no longer writes to `bookings`
at all - notification/refund-note text explains the new date+time and that
a missed window falls back automatically.

**Shared helpers** (`src/lib/bookingLifecycle.ts`): `getOperativeReturnDeadline`,
`getReturnCheckinEligibleDeadline`, `getEffectiveReturnDateTime`,
`RETURN_OVERDUE_LABEL_GRACE_MINUTES` (180, independent of the existing
30-minute `NO_SHOW_GRACE_WINDOW_MINUTES`, which still only gates no-show-
*report* eligibility). Propagated to every other place that computed a
return deadline this session found: `src/lib/incidents.ts`,
`api/booking-action.ts`'s `return_arrive` gate, `api/expire-booking-deadlines.ts`'s
return no-show sweep (batch-fetches approved early returns once per sweep,
not per booking), and `api/send-return-reminders.ts` (plus a supplementary
query so a booking with a far-off original `end_date` but a near, still-active
approved early return isn't missed by the reminder cron).

**UI**: `TIME_OPTIONS`/`formatTimeLabel` extracted from `CarDetailPage.tsx`
into shared `src/lib/timeOptions.ts` (now a 3rd consumer). Both booking
pages' early-return request modal gained a time `<select>` and now allow a
same-day date; both pages' `returnCheckinOpen` gating and reminder calls
were updated to the new helpers; the lister-side approval card shows the
requested time alongside the date.

**Note**: the overdue-label grace change (0 → 180 minutes) is an intentional
behavior change, not a regression - a booking that's 1 minute past its
return deadline no longer immediately shows "overdue."

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow` (one stale marker fixed -
`manilaEndOfDayMs` was removed from `booking-early-return-action.ts` in
favor of capping the response deadline against the real requested instant),
`check:api-boundaries`, `check:financial-logic`. Hand-traced the plain,
on-time, and missed-early-return scenarios against the exact instant math
before implementing (see the approved plan).

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 56),
`api/booking-early-return-action.ts`, `api/booking-action.ts`,
`api/expire-booking-deadlines.ts`, `api/send-return-reminders.ts`,
`src/lib/bookingLifecycle.ts`, `src/lib/earlyReturns.ts`,
`src/lib/incidents.ts`, `src/lib/timeOptions.ts` (new),
`src/pages/CarDetailPage.tsx`, `src/pages/MyBookingsPage.tsx`,
`src/pages/ListerBookingsPage.tsx`, `src/types/database.ts`,
`scripts/booking-flow-smoke-check.mjs`.

---

## 2026-09-06 — Return "I Have Arrived" now waits for its own check-in window, matching pickup

Reported (while reviewing the return handshake): the return-leg "I Have
Arrived" button rendered the instant a booking went active, even for a
multi-day trip whose drop-off was days away - confusing, since nothing
explained why a return button was showing up on day one. The pickup leg
already handled this correctly (`arrivalCheckinOpen`, computed from
`getBookingPickupMs` minus `arrival_checkin_lead_hours`, gates the pickup
button and shows a "check-in opens ..." note otherwise) - the return leg
had no equivalent, even though the server (`api/booking-action.ts`'s
`return_arrive` handler) already enforced the same lead-time rule and would
just reject an early tap with an error.

Added the missing mirror in both `MyBookingsPage.tsx` and
`ListerBookingsPage.tsx`: a `getBookingDropoffMs` helper (mirrors
`getBookingPickupMs`) and `returnCheckinOpen`/`returnCheckinOpensMs`
(mirrors `arrivalCheckinOpen`/`arrivalCheckinOpensMs`). The return button
now only renders once inside its lead-time window; before that, both
dashboards show "Return check-in opens N hour(s) before drop-off - [date]"
instead - exactly the pickup leg's existing pattern, just applied to
return.

No server-side change needed - `api/booking-action.ts` already enforced
this correctly; only the client-side UI was missing the gate.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/MyBookingsPage.tsx`, `src/pages/ListerBookingsPage.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-06 — Removed the dismissible install banner - one entry point only

Immediate follow-up to the entry directly below: on reflection, having both
a one-time dismissible banner (`InstallPrompt.tsx`) and a permanent button
(`InstallButton.tsx`) was one surface too many for what should be a single,
unambiguous place to install. Deleted `InstallPrompt.tsx` and its mount in
`App.tsx`; `InstallButton.tsx` (landing page header + `DashboardLayout`
header) is now the only install entry point. `src/lib/pwaInstall.ts`'s
`usePwaInstall()` is unchanged - it only ever had one consumer now.

Verified: `tsc -b`, lint.

Files: `src/App.tsx`, `src/components/InstallButton.tsx`,
`src/lib/pwaInstall.ts`, `src/components/InstallPrompt.tsx` (deleted),
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-06 — A permanent Install button, alongside the one-time banner

Reported: a renter saw the "Install SafeDrive" banner, dismissed it, then
later wanted to install and had no idea where to find that option again -
`InstallPrompt.tsx` was a one-time nudge with a 14-day dismiss cooldown and
nothing else offered installability.

Extracted the shared install-detection logic (`beforeinstallprompt` capture,
iOS Safari detection, already-standalone detection) into
`src/lib/pwaInstall.ts`'s `usePwaInstall()`, and added a second, permanent
surface on top of it: `InstallButton.tsx`, a small button mounted in the
landing page header (`LandingPage.tsx`) and in `DashboardLayout.tsx`'s
header - reachable from a first-time visitor's very first screen and every
logged-in page afterward, regardless of whether the one-time banner was ever
seen or dismissed. `InstallPrompt.tsx` itself is otherwise unchanged (still
one-time, still dismissible) and now also tells the user where to find the
permanent button if they dismiss it.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Also verified per a separate question: the pickup/drop-off-time change above
does not affect the return handshake/grace-period logic at all -
`getReturnNoShowWindowState()`/`getBookingReturnDeadline()`
(`src/lib/bookingLifecycle.ts`) and the return-arrival lead-time gate
(`arrival_checkin_lead_hours`, default 3h, in `api/booking-action.ts`'s
`return_arrive` handler) all just read whatever `dropoff_time` ends up
stored on the booking - unaffected by how that value gets set at booking
creation. Confirmed by reading both, not assumed.

Files: `src/lib/pwaInstall.ts` (new), `src/components/InstallButton.tsx`
(new), `src/components/InstallPrompt.tsx`, `src/pages/LandingPage.tsx`,
`src/components/DashboardLayout.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-06 — Drop-off time now always matches pickup time (1 paid day = a real 24 hours)

Reported gap: `total_days` (and so the base price) is a pure calendar-date
difference - Sept 5 to Sept 6 is always "1 day," regardless of time of day.
Pickup and drop-off time were previously chosen independently, so a renter
could pick pickup 11:59 PM / drop-off 12:01 AM the next day - a few minutes
of actual use, billed as a full day - or the inverse (pickup 12:01 AM /
drop-off 11:59 PM) for nearly 48 hours at a 1-day price. Neither is what
"price per day" is supposed to mean.

Fixed by locking drop-off to the same clock time as pickup, so every paid
day is a real, consistent 24 hours from pickup to drop-off:
- `CarDetailPage.tsx`: drop-off time is no longer an independent `<select>` -
  it's a read-only display that mirrors whatever pickup time is chosen
  (`useEffect` keeps `dropoffTime` in sync with `pickupTime`), with a note
  explaining why.
- `api/create-booking.ts`: rejects a request where `dropoffTime !==
  pickupTime` (400), enforcing the same rule server-side so a direct API
  call can't recreate the old mismatch.

Early return and extension flows are unaffected - neither touches
`pickup_time`/`dropoff_time` at all, so this only changes booking
*creation*. No historical data to reconcile (CHAPTER 55 already cleared all
booking history this session).

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build`,
`check:alignment`, `check:booking-flow`, `check:api-boundaries`,
`check:financial-logic`.

Files: `src/pages/CarDetailPage.tsx`, `api/create-booking.ts`.

---

## 2026-09-06 — Install prompt was invisible on the landing/login/signup pages

Reported: the "Install SafeDrive" banner never appeared on the landing page.
`InstallPrompt.tsx` had been mounted only inside `DashboardLayout.tsx`, but
`/` (LandingPage), `/login`, `/signup`, `/contact`, and the legal pages are
all registered outside that shell in `App.tsx` (public routes, no
`DashboardLayout` wrapper) - so the component never had a chance to render
there at all. The intended scope exclusion was `/admin/*` only, not every
public/pre-auth page.

Moved the mount point to the `App.tsx` root (sibling to the already
app-wide `InquiryWidget`/`Toaster`/`ThemeColorMeta`), and added a
`useLocation()`-based check inside `InstallPrompt.tsx` itself that returns
`null` on any `/admin/*` path - the actual intended exclusion. It now
reaches the landing page and every public page a first-time mobile visitor
would land on, not just the logged-in renter/lister shell.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/App.tsx`, `src/components/InstallPrompt.tsx`,
`src/components/DashboardLayout.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-06 — Pickup/drop-off time: explicit dropdown instead of a native time input

Reported: a renter said the pickup/drop-off time appeared already fixed (at
12:30 PM) and couldn't tell it was something they were meant to choose.
`CarDetailPage.tsx`'s booking form always used a plain `<input type="time">`
with no default value in state - functionally it was never actually fixed
(any value the renter picked was correctly saved through to
`api/create-booking.ts`), but a known pitfall of native time inputs is that
their collapsed display can show the current device time as soon as the
field mounts, indistinguishable on some mobile browsers from an already-
chosen value - explaining a report that lines up with "stuck at whatever time
the renter opened the page."

Replaced both fields with an explicit `<select>` (30-minute increments,
00:00-23:30, 12-hour labels) that starts on a disabled "Select pickup/
drop-off time" placeholder - a renter must now make a visible, deliberate
choice on every platform, and the existing "booking disabled until both
times are set" validation needed no changes since it already just checked
for a non-empty string. Value format (`HH:MM`) is unchanged, so
`combineDateAndTime`/`parseTime` and the booking-creation payload are
unaffected.

Verified: `tsc -b`, lint, `npm run build`, `check:alignment`,
`check:booking-flow`.

Files: `src/pages/CarDetailPage.tsx`.

---

## 2026-09-06 — PWA: SafeDrive is now installable (renter/lister pages)

Thesis-panel requirement: mobile users should be able to install SafeDrive and use it like a native app instead of always going through the browser - responsive, no broken UI, no lost functionality. Scope confirmed with the user: renter/lister-facing pages only; `/admin/*` stays desktop-oriented.

Added as a layer on top of the existing app (no booking/payment logic touched):
- `vite-plugin-pwa` (Workbox) - `registerType: 'autoUpdate'`, explicit `NetworkOnly` rules for `*.supabase.co` and `/api/*` so live data is never served from the service-worker cache. Matches the existing "recover automatically" philosophy already used for stale-build chunk failures (`src/lib/lazyWithReload.ts`).
- `public/manifest.webmanifest` (hand-authored) + generated icons (`scripts/generate-pwa-icons.mjs`, `sharp`, dev-only, from `public/favicon.svg`) - 192/512/maskable PNGs plus an Apple touch icon.
- `index.html`: manifest link, `viewport-fit=cover`, Apple PWA meta tags.
- Safe-area CSS (`--safe-top`/`--safe-bottom`) applied to the floating inquiry widget and toast notifications so they clear a notch/gesture-bar in standalone mode; a no-op on ordinary devices.
- New `ThemeColorMeta.tsx` (keeps the OS chrome color synced to the app's actual light/dark toggle) and `InstallPrompt.tsx` (dismissible install banner - `beforeinstallprompt` capture on Android, an "Add to Home Screen" instructional variant on iOS, mounted only in the renter/lister shell).
- Fixed five pre-existing responsive bugs found during the audit: an unconditionally `sticky` booking card and an oversized fixed-height date picker on `CarDetailPage.tsx`; four modals with no scroll/keyboard handling (`ConfirmDialog.tsx` plus one each in `MyBookingsPage.tsx` and `ListerBookingsPage.tsx`) standardized onto the scrollable-overlay pattern already used correctly elsewhere; overflowing filenames in the Add Vehicle document-upload rows; an oversized fixed minimum height on the Support page's mobile layout.

Verified: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `npm run build` (confirmed `dist/manifest.webmanifest`, `dist/sw.js`, and all icons are actually emitted; confirmed the built service worker's caching rules resolve to `NetworkOnly` for Supabase/`/api/*`), `check:alignment`, `check:booking-flow`.

**Not yet verified - flagged, not assumed**: Vercel serving the manifest/SW as static files ahead of the SPA rewrite on a real deployment; a Lighthouse PWA audit; on-device install and a full integration-point regression pass (PayMongo checkout redirect, camera/geolocation capture, PDF download, update/reload behavior) on Android Chrome and iOS Safari specifically in standalone mode; iOS session-persistence behavior for an installed Home-Screen app after an extended idle period. See master doc §18.1.

Files: `vite.config.ts`, `index.html`, `src/index.css`, `src/App.tsx`, `src/components/InstallPrompt.tsx` (new), `src/components/ThemeColorMeta.tsx` (new), `src/components/InquiryWidget.tsx`, `src/components/ConfirmDialog.tsx`, `src/components/DashboardLayout.tsx`, `src/components/ui/sonner.tsx`, `src/pages/CarDetailPage.tsx`, `src/pages/MyBookingsPage.tsx`, `src/pages/ListerBookingsPage.tsx`, `src/pages/MyVehiclesPage.tsx`, `src/pages/SupportTicketsPage.tsx`, `scripts/generate-pwa-icons.mjs` (new), `public/manifest.webmanifest` (new), `public/icons/*` (new), `public/apple-touch-icon.png` (new), `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-06 — One-time reset script: clear all booking history, payments, and ledger (CHAPTER 55)

Reported need: the booking lifecycle changed materially this session
(mandatory handover gate, mutual return arrival, commission flip, extension
deadlines) - bookings created and paid under the old process could behave
inconsistently mixed with bookings created under the new one. Requested: wipe
every currently-listed booking and all history so every derived statistic (a
lister's own earnings, SafeDrive's own commission revenue and payout figures)
reads back to zero. Confirmed first that nothing in the schema caches or
materializes those numbers - everything is a live query over
bookings/payments/ledger_entries, so deleting the underlying rows is
sufficient.

A one-time operational script (not a reusable RPC, so it leaves no standing
"wipe everything" capability in the database) that deletes, in FK-safe order,
`payments`, then `ledger_entries`/`ledger_journals` (with
`prevent_finalized_entry_change` / `prevent_finalized_journal_change`
temporarily disabled, since finalized ledger rows are normally append-only,
then re-enabled immediately after), then `bookings` itself - which cascades
to `booking_extensions`, `booking_agreement_acceptances`,
`trip_condition_reports`/`trip_condition_photos`, `booking_reviews`,
`booking_cancellations`, `booking_early_returns`, and sets
`support_tickets.booking_id` / `reconciliation_items.booking_id` to null
(those rows are kept, just unlinked). Deliberately does not touch cars,
profiles, car documents/images, vehicle listings, or `subscriptions`
(vehicle-listing-slot plan payments - a separate revenue stream with no
`booking_id` link, out of scope for "booking history"). `security_deposits` /
`security_deposit_claims` needed no handling here - CHAPTER 34 already
dropped both tables outright, not just emptied them (an earlier draft of this
chapter incorrectly assumed they still existed as an unused table and
included a `DELETE FROM` for them, which would have failed with "relation
does not exist" and aborted the whole transaction - caught and fixed before
this was run, while confirming that removal actually was a full `DROP TABLE`
and not a leftover).

Also confirmed during this discussion: there is currently no admin-facing
view of `subscriptions` revenue at all (not on `AdminFinancialLedgerPage` or
anywhere else) - flagged as a possible follow-up, not built in this pass.

Irreversible; run once, directly, by the project owner in the Supabase SQL
editor - same as every other chapter.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 55).

---

## 2026-09-06 — Vehicle transmission is admin-only; lister requests a correction instead of self-editing

Reported gap: a vehicle's transmission type (Automatic/Manual) gates which
renters may book it at all (via `profiles.license_transmission`), so it must
be a fixed spec set once at initial listing - never lister-editable, not even
at renewal. `MyVehiclesPage.tsx`'s Edit Listing form already rendered
transmission read-only, but that was only an app-level convention with no
database enforcement, and legacy pre-gate listings with `transmission = null`
had no way to ask for one to be set beyond a dead-end label ("set it on your
next edit") pointing at a field that was never actually editable. Fixed by
mirroring the existing `profiles.license_update_pending` pattern exactly,
onto a new `cars.transmission_update_pending` flag.

**CHAPTER 54:**
- `cars.transmission_update_pending boolean not null default false`.
- `protect_car_submission_fields()` (the existing `before insert or update on
  cars` trigger) extended with the same two rules `protect_profile_sensitive_fields`
  already enforces for licences: a non-admin session can never change
  `transmission` on UPDATE (INSERT is unaffected - the lister still proposes
  it once at initial listing), and `transmission_update_pending` may only be
  flipped `false -> true` by a non-admin; only an admin (who returns early
  from the trigger) can set the real value or clear the flag.
- `notify_admins_of_transmission_update` - an `after update of
  transmission_update_pending` trigger, same shape as
  `notify_admins_of_license_update`, notifying every admin/super-admin with a
  link into the new review tab.
- The flag is intentionally orthogonal to listing approval status (like
  `license_update_pending` is orthogonal to `verified_status`): flagging a
  car does not touch `cars.status` or take the listing offline, matching how
  a licence resubmission doesn't un-verify the profile.

**Lister side (`MyVehiclesPage.tsx`):**
- Vehicle card and the Edit Listing modal's transmission box both replace the
  old "set it on your next edit" text with a real action: "Ask admin to set
  transmission type" (null transmission) or "Report incorrect transmission
  type" (already-set value believed wrong), calling a direct
  `.update({ transmission_update_pending: true })` on the lister's own row -
  RLS-permitted the same way `license_update_pending` is self-settable by a
  renter, blocked from going further by the new trigger rule. Shows "sent for
  review" once flagged instead of the button.

**Admin side (`AdminVehicleApprovalPage.tsx`)** - integrated into the
existing page rather than a new one, per explicit choice:
- New "Transmission review" tab (with a live pending-count badge) alongside
  the existing Pending/Active tabs, querying `transmission_update_pending =
  true` across any status rather than the two tabs' status-based queries.
- Status column gets a small "Transmission review" badge when a car in any
  tab has the flag set, so it's visible without switching tabs.
- Detail modal gains a review panel (shown whenever the selected car has the
  flag, regardless of which tab it was opened from): current value, a
  transmission dropdown, and "Save & Clear Request" - sets `transmission` and
  clears the flag together, notifies the lister, and writes an audit-log row.

Verified clean: `tsc -b`, `tsc -p tsconfig.api.json`, lint,
`check:alignment`, `check:booking-flow`.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 54),
`src/pages/MyVehiclesPage.tsx`, `src/pages/admin/AdminVehicleApprovalPage.tsx`,
`src/types/database.ts`.

---

## 2026-09-05 — Dynamic legal content (Terms, Privacy, Platform Agreement) + security-deposit disclosure

Thesis-panel requirement, two parts. Part 1: make it unmistakable that any
security deposit is arranged directly between Renter and Owner, outside
SafeDrive - the deposit *feature* itself was already removed earlier today
(CHAPTER 34) and a defensive disclaimer ("SafeDrive doesn't hold one") was
already added to `PlatformAgreementPage.tsx` §8 and `CarDetailPage.tsx`'s
rental-agreement summary; what was still missing was the proactive half -
telling users to arrange it directly with each other. Part 2: SafeDrive's own
legal documents (Terms & Conditions, Privacy Policy, Platform Agreement) were
fully hardcoded JSX - any wording change needed a code deploy. Made dynamic:
a super admin edits and publishes new content from a dedicated admin page,
reached from Platform Settings.

**Part 1 - security-deposit language added to four places:**
- `TermsPage.tsx` - new §5.5 (Terms had none since the old clause was deleted
  in CHAPTER 34).
- `PlatformAgreementPage.tsx` §8 and `CarDetailPage.tsx`'s rental-agreement
  summary clause 5 - extended the existing disclaimer with "arranged directly
  between the Lister and Renter, outside the Platform."
- `MyVehiclesPage.tsx` - a guidance note next to the "Rental Agreement (PDF)"
  upload field (Add and Edit forms): SafeDrive cannot edit a Lister's own
  uploaded PDF, so this sets expectations rather than checking compliance.

**Part 2 - `legal_document_versions` (CHAPTER 53):**
- New table, one row per published/superseded version per document
  (`terms_of_service` / `privacy_policy` / `platform_agreement`), mirroring
  `car_agreement_versions`' "one active row" partial-unique-index pattern.
  Every version is kept permanently for the audit trail.
- `publish_legal_document_version(p_document_key, p_content_html)` - a
  `SECURITY DEFINER` RPC, same governance as `set_platform_contact_email` /
  `set_verification_eta_messages`: a single super admin can publish directly,
  no multi-admin vote (legal content changes were judged closer to "display
  text a single admin should be able to fix quickly" than "a money/policy
  value that needs a supermajority," matching precedent already set for
  those two settings).
- Seeded version 1 for each document with today's exact text, including the
  Part 1 security-deposit clauses, so the first dynamic version already
  reflects the requirement instead of needing an immediate follow-up edit.
- **New admin page**, `AdminLegalContentPage.tsx` (`/admin/legal-content`,
  linked from a new card on `/admin/platform-settings`): a document-tab
  selector, a `contentEditable` rich-text area with a small toolbar (Bold /
  Italic / Underline / Bullet list / Numbered list / Heading, via
  `document.execCommand` - browser-native, no new library) reusing and
  extending the sanitizer pattern from `src/lib/richText.ts` (used today for
  support-ticket chat messages) rather than adopting a full editor framework,
  a read-only version-history list, and a publish confirmation step.
- `src/lib/richText.ts` gained `sanitizeLegalDocumentHtml` - a wider allowlist
  (adds headings) than chat's `sanitizeRichText`, kept as a separate function
  so chat-message rendering is untouched. Sanitized on both save (the admin
  editor) and render (the public pages), defense in depth.
- `TermsPage.tsx`, `PrivacyPolicyPage.tsx`, `PlatformAgreementPage.tsx`
  converted from static JSX to a fetch-and-render of the published row for
  each page's `document_key`; page chrome (title, back button, footer)
  unchanged. "Last Updated" now shows the real `published_at` instead of a
  hardcoded date. `PrivacyPolicyPage.tsx`'s contact-email interpolation
  (`usePlatformContactEmail()`) is preserved via a `{{CONTACT_EMAIL}}` token
  left in the stored content, replaced with the live value right before
  rendering - no general templating system, just this one token.
- Verified clean: `tsc -b`, `tsc -p tsconfig.api.json`, lint,
  `check:booking-flow` (the `PrivacyPolicyPage.tsx` marker updated for the
  token move), `check:alignment` (new route documented), `check:api-boundaries`,
  and a full production build.

**Not done in this pass, flagged as a follow-up:** per the master doc's own
standing instruction, legal/policy wording changes like these should still
get a real Philippine legal and accounting review before public launch - this
pass makes the content technically dynamic and internally consistent, it
does not certify the wording itself.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 53),
`src/lib/richText.ts`, `src/pages/admin/AdminLegalContentPage.tsx` (new),
`src/pages/admin/AdminPlatformSettingsPage.tsx`, `src/pages/TermsPage.tsx`,
`src/pages/PrivacyPolicyPage.tsx`, `src/pages/PlatformAgreementPage.tsx`,
`src/pages/CarDetailPage.tsx`, `src/pages/MyVehiclesPage.tsx`, `src/App.tsx`,
`src/types/database.ts`, `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`,
`scripts/booking-flow-smoke-check.mjs`.

---

## 2026-09-05 — Commission flip: renter pays listed price, lister absorbs it

Flips who bears SafeDrive's commission. Previously a lister listing a car at
₱1,000/day meant the renter was charged ₱1,000 + 10% commission (₱1,100,
before the payment-processing fee), while the lister received the full,
undiminished ₱1,000. Now the renter pays exactly the listed price
(₱1,000 + the disclosed payment-processing fee only), and the lister's
payout is ₱900 - the commission comes out of the lister's earnings, not on
top of what the renter pays. The payment-processing fee is untouched by this
change - it stays charged to the renter, since it's tied to the renter's
chosen payment method, a deliberately separate decision from the commission.

This also resolves a pre-existing mismatch: the Terms of Service and master
documentation already *described* commission as something SafeDrive "deducts
from the agreed base" / lister earnings "net of commission," but the actual
code paid the lister the full base price and charged the difference to the
renter instead. The code now matches what was already promised.

- **`api/create-booking.ts`**: `total_price` is now `base_price + payment
  processing fee` only - `commission` is still computed and stored (needed
  for ledger/payout math and revenue reporting) but no longer contributes to
  what the renter is charged.
- **`api/booking-extension-action.ts` / `api/webhooks/paymongo.ts`**: paid
  trip extensions mirror the same change - the renter's extension charge
  drops the commission slice; `booking_extensions` gains an explicit
  `extension_commission` column (CHAPTER 52) since it can no longer be
  derived as a residual of what the renter paid (that would always be zero
  now).
- **`api/lib/ledger.ts`**: `calculatePaymentLedgerAllocation`'s owner-share
  formula becomes `(base_price - commission)`'s proportional share of the
  payment, instead of `base_price` alone.
- **`api/lib/payoutAutomation.ts`** (the highest-risk change - real PayMongo
  transfers): the payout amount is now `base_price - commission` (+ any fuel
  reimbursement), fixed at the single point where it's first computed so
  every downstream use in the function (the pending payout record, the
  actual transfer payload, every notification/email/audit-log line) picks up
  the corrected amount automatically.
- **New: upfront lister earnings disclosure** (`MyVehiclesPage.tsx`, both
  Add and Edit Listing forms) - a live note next to the price field ("You'll
  earn approximately ₱X/day after SafeDrive's Y% commission") so a lister
  knows their real take-home the moment they set a price, not just when the
  payout receipt arrives.
- **Renter-facing checkout** (`CarDetailPage.tsx`): removed the "Service fee
  (X%)" line item entirely - the renter's breakdown is now just price +
  processing fee + total, no commission line to show.
- **Payout receipt email** (`api/lib/email.ts`): used to tell the lister the
  commission was "retained separately and is not part of this amount" - now
  itemizes it as an actual deduction from the base rental shown in the
  receipt.
- **Admin dashboard** (`AdminPayoutsPage.tsx`) and **lister revenue
  analytics** (`ListerBookingsPage.tsx`): all payout/earnings figures that
  previously equaled `base_price` now correctly show `base_price -
  commission`.
- **Legal copy updated** to match: `TermsPage.tsx` §5.4, `PlatformAgreementPage.tsx`,
  `SignUpPage.tsx`. Per the master doc's own standing instruction, wording
  like this should still get a real legal/accounting review before public
  launch - not something this pass can certify alone.
- Existing/in-flight bookings are unaffected - `base_price`/`commission`/
  `total_price` are snapshotted per booking at creation time, so only
  bookings created after this change use the new formula.
- Verified clean: `tsc -b`, `tsc -p tsconfig.api.json`, lint,
  `check:financial-logic` (two hardcoded allocation assertions updated to
  the new formula), `check:booking-flow` (payout-receipt marker updated),
  `check:api-boundaries`, `check:alignment`, `check:reconciliation-logic`,
  and a full production build.

Files: `api/create-booking.ts`, `api/booking-extension-action.ts`,
`api/webhooks/paymongo.ts`, `api/lib/ledger.ts`, `api/lib/payoutAutomation.ts`,
`api/lib/email.ts`, `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`
(CHAPTER 52), `src/pages/CarDetailPage.tsx`, `src/pages/MyVehiclesPage.tsx`,
`src/pages/ListerBookingsPage.tsx`, `src/pages/MyBookingsPage.tsx`,
`src/pages/admin/AdminPayoutsPage.tsx`, `src/pages/TermsPage.tsx`,
`src/pages/PlatformAgreementPage.tsx`, `src/pages/SignUpPage.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`, `src/types/database.ts`,
`scripts/financial-logic.test.mjs`, `scripts/booking-flow-smoke-check.mjs`.

---

## 2026-09-05 — Mandatory handover gate, mutual return arrival, fraud hardening

Redesigns the pickup and return legs to add an explicit, deliberately
minimal-tap handover handshake, and closes several fraud/no-deadline gaps
found while designing it. Backend and frontend in one pass.

**Pickup: handover now gates `active`.** Previously "arrive" auto-flipped
`fully_paid → active` the instant both sides checked in, with no
verification the vehicle was actually handed over. Now `status` stays
`fully_paid` through a mandatory handover sub-sequence: lister submits their
required pickup condition report (unchanged system) and taps
`handover_confirm` ("Hand Over the Car"); only then can the renter tap the
new `handover_receive` ("I Have Received the Car"), which is the one and
only place `status` becomes `active`. No new `bookings.status` value - kept
every existing `.in("status", [...])` gate elsewhere untouched. New columns:
`lister_handover_confirmed_at`, `renter_handover_received_at` (CHAPTER 47).

**Return: mutual arrival, mirroring pickup.** `return_arrive` was renter-only
(a one-way "I've returned it" announcement); it's now role-dispatched like
`arrive`; the lister calls it too (`lister_return_arrived_at`, CHAPTER 48).
The lister's `complete` now additionally requires both return-arrival flags
set before it can finish the trip. A new incident action,
`lister_no_show_return`, lets the renter flag a lister who never shows to
receive the return - unlike pickup no-show this never cancels or refunds
(the rental was already fully delivered), it only flags `dispute_status` for
visibility; the existing `lister_completion_timeout_hours` safety net still
auto-completes (and pays out) if the lister stays unresponsive.

**New cron sweeps** (`api/expire-booking-deadlines.ts`): a 2-hour handover
stuck-state timeout (auto-activates on the renter's behalf if the lister
already handed over and the renter is merely silent; otherwise flags the
lister-fault stall for both sides); a return-leg no-show reminder (advisory
only, dedup'd, never auto-cancels); extension response-deadline expiry and
approved-but-unpaid expiry (`booking_extensions.response_deadline`, CHAPTER
49 - the same gap CHAPTER 46 had already fixed for early-return requests).

**Fraud hardening, found while designing the above:**
- Arrival check-in silently captures device location again
  (`ArrivalPhotoCapture.tsx` calls `navigator.geolocation` on the existing
  single button - no new UI, permission denial never blocks the tap). This
  was removed in the 2026-09-05 handover/return redesign for simplicity when
  it had nothing to verify against; it's back because a car listing can now
  carry a pickup pin.
- **New: car listings can pin their exact pickup location**
  (`cars.pickup_latitude/longitude`, CHAPTER 51) via "Use My Current
  Location" in both the Add and Edit Listing forms (`MyVehiclesPage.tsx`) -
  no geocoding API, the lister just drops themselves there once.
- A `renter_no_car` no-show claim now only gets an instant automatic full
  refund if the reporter's arrival location is within 500m of the car's
  pickup pin; otherwise it's routed to the same manual-refund-review queue
  `renter_no_show` already used (extracted into a shared
  `queueManualRefundReview` helper), still recommending a full refund -
  just pending a human's confirmation of the claim.
- `cars.min_early_return_notice_hours` was shown to renters but never
  enforced - `api/booking-early-return-action.ts` now rejects a request
  that doesn't give the configured notice.
- `api/booking-extension-action.ts`: overlap is now re-validated at
  `approve` time too (previously only at `request` time - the calendar
  could change in between), plus a 30-minute cooldown between a
  cancelled/rejected/expired request and a new one on the same booking.
- Trip-condition-report submissions now require the reporter's own arrival
  (or return-arrival) check-in first, and are auto-posted into the
  booking's conversation thread (attributed to the real submitter, not a
  system identity) so photos actually show up where both parties can see
  them - needed a new `ticket_messages.attachment_bucket` column (CHAPTER
  50) since that evidence lives in a different storage bucket than normal
  ticket attachments.

Verified clean: `tsc -b`, `tsc -p tsconfig.api.json`, lint, `check:booking-flow`
(markers updated for all of the above), `check:api-boundaries`,
`check:alignment`, `check:financial-logic`, `check:process-logic`,
`check:reconciliation-logic`, and a full production build.

**Not done in this pass, flagged as a follow-up:** the pickup pin is a
manual lat/lng entry or a "stand there and tap" capture, not an interactive
map picker - fine for now (zero cost, no new dependency), but a visual map
would be a nicer lister experience later.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 47-51),
`api/booking-action.ts`, `api/submit-trip-condition-report.ts`,
`api/booking-incident-action.ts`, `api/booking-early-return-action.ts`,
`api/booking-extension-action.ts`, `api/expire-booking-deadlines.ts`,
`src/components/ArrivalPhotoCapture.tsx`, `src/pages/MyBookingsPage.tsx`,
`src/pages/ListerBookingsPage.tsx`, `src/pages/MyVehiclesPage.tsx`,
`src/lib/bookingLifecycle.ts`, `src/lib/incidents.ts`,
`src/lib/supportTickets.ts`, `src/types/database.ts`,
`scripts/booking-flow-smoke-check.mjs`.

---

## 2026-09-05 — Advance-booking window and trip-length cap decoupled (60 / 30 days)

Follow-up to the extension cap above. `api/create-booking.ts` had checked a
NEW booking's start date AND end date against the same `today + 30 days`
ceiling - meaning "how far ahead can you book" and "how long can the trip
be" were really one shared rule, not two. That squeezed a trip booked near
the edge of the window into far less than 30 days (e.g. a trip starting 25
days out could only run 5 more days before hitting the ceiling), and
conflated two different concerns that a standard car-rental business
reasons about separately: advance-booking risk (pricing/availability
drift, licence/verification possibly lapsing before a far-out trip even
starts) versus trip-length risk (a single rental that runs too long starts
looking like an informal long-term lease, with different insurance/
liability implications than a short-term P2P rental - the same basis
already used for the extension cap).

- `MAX_ADVANCE_BOOKING_DAYS = 60` - how far in the future a trip's start
  date can be, counted from today.
- `MAX_TOTAL_RENTAL_DAYS = 30` (same name/value as the extension cap) - how
  long a single trip can run, counted from its OWN start date, independent
  of how far ahead it was booked.
- `src/pages/CarDetailPage.tsx`'s calendar mirrors both: dates beyond 60
  days out are disabled before a start date is picked; once a start date is
  picked, the ceiling switches to that start date + 30 days for the return
  date. Copy on the page updated to state both numbers.

Files: `api/create-booking.ts`, `src/pages/CarDetailPage.tsx`,
`scripts/booking-flow-smoke-check.mjs`.

## 2026-09-05 — Car photo not showing on some listings (stale carousel index)

Reported: opening a car's detail page sometimes showed the no-photo
placeholder even though the car does have photos. Checked the actual data
first (live DB + direct storage fetches for every car and every image row) -
every listing's photos exist and load fine at the storage level, so this
wasn't a data or storage bug.

The real cause: `CarDetailPage.tsx` keeps `currentImageIndex` (which photo
the carousel is on) in component state, but navigating from one car's page
straight to another car's page - without a full reload - reuses the same
page instance, so the index never reset. Landing on a car with fewer photos
than the index you were previously on left `images[currentImageIndex]`
pointing past the end of the new car's photo array, so `currentImage` was
`undefined` and the placeholder rendered instead - even for a car with
photos.

- `currentImageIndex` now resets to `0` whenever the `id` route param
  changes.
- Defensive fallback: `currentImage` now falls back to `images[0]` if the
  index is ever out of range, so this can't recur from some other future
  state-timing edge case either.

Files: `src/pages/CarDetailPage.tsx`.

## 2026-09-05 — Booking extensions had no upper bound - capped at 30 days total

Reported: a live test could request an extension all the way to 2028 from a
2026 booking. Confirmed - `api/booking-extension-action.ts` only ever
checked that the requested date was *after* the current end date, never an
upper bound. A chain of extensions could grow one continuous rental
indefinitely, defeating the intent behind `api/create-booking.ts`'s own
30-day window (a new booking's start and end must both fall within 30 days
of today).

- `MAX_TOTAL_RENTAL_DAYS = 30` (same number, reused for one consistent rule)
  now caps `requested_total_days` (already computed - `total_days +
  extensionDays`) - a single continuous rental, original days plus every
  approved extension, can never exceed 30 days. Anchored to the trip's own
  `start_date`, so it doesn't get more restrictive as the trip progresses.
- Client-side: the date input on `/my-bookings`' "Request extension" gets a
  `max` (start_date + 30 days) plus a pre-submit check, so the native date
  picker never offers - and typing never bypasses - an out-of-range date.

Files: `api/booking-extension-action.ts`, `src/pages/MyBookingsPage.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## 2026-09-05 — Early-return requests get a real response deadline (CHAPTER 46)

Reported: the lister's response time on an early-return request should have
a time limit - it didn't. A pending `booking_early_returns` row could sit
unanswered forever; the renter had no way to know whether to plan around the
early date or the original one. The table's `status` check constraint has
allowed `'expired'` since CHAPTER 30 - clearly anticipated from day one - but
nothing ever computed a deadline or set anything to that status.

- `booking_early_returns.response_deadline` is stamped at request time:
  `min(now + 24h, end of the requested new return day)` - deciding after the
  renter already wanted the car back would be moot, so it's capped there,
  same "never past the moment that matters" rule already used for
  `payment_deadline`/`balance_deadline`.
- A pending request past its deadline is treated as a decline - the
  booking's `end_date` is never touched by expiry, only by an actual
  approval - and moves to `expired`. Resolved two ways: a defensive check
  inline in `approve`/`reject`/`cancel` (closes the narrow race window
  before the next cron tick), and the authoritative path, a new section in
  `api/expire-booking-deadlines.ts` (already running every 15 minutes) that
  notifies both sides.
- Countdown surfaced on the pending-request card on both `/my-bookings` and
  `/lister-bookings`.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 46),
`api/booking-early-return-action.ts`, `api/expire-booking-deadlines.ts`,
`src/pages/MyBookingsPage.tsx`, `src/pages/ListerBookingsPage.tsx`,
`src/types/database.ts`, `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## 2026-09-05 — Retired the redundant "Refresh Authenticator Check" login button

Reported as pointless. Investigated: it does not refresh the 6-digit
authenticator-app code (that rotates on its own every 30s, client-side,
unrelated to this button) - it requests a fresh server-side MFA challenge,
which can go stale if a user sits on the code-entry screen a while. But
`handleOtpSubmit` already auto-recovers from exactly that case on its own:
a stale-challenge error (`isStaleAuthenticatorChallengeError`) silently
requests a new challenge and asks for the newest code, with no failed-
attempt/lockout penalty - so the manual button was pure duplicate coverage
of an already-automatic path. Removed for the authenticator code method on
both login pages; "Resend Code" stays for the email-code method, where no
such automatic recovery exists.

Files: `src/pages/LoginPage.tsx`, `src/pages/admin/AdminLoginPage.tsx`.

## 2026-09-05 — Platform-setting votes are locked once cast + auto-expire (CHAPTER 45); license-transmission booking gate now visible before the click

### Consensus-vote logic bug (CHAPTER 45)

Reported: as the proposer of a platform-setting change, the user could still
flip their own vote back and forth after posting the proposal - and any
other super admin could do the same on someone else's proposal. Confirmed in
`vote_platform_setting_change`: it used
`on conflict (request_id, voter_id) do update set vote = excluded.vote` - a
vote could always be overwritten, including the proposer's own auto-approve
from `propose_platform_setting_change`.

- `vote_platform_setting_change` now raises `"You already voted on this
  proposal - votes cannot be changed"` instead of updating. The proposer's
  own escape hatch stays `cancel_platform_setting_change` ("Withdraw"),
  unaffected - that closes the whole proposal, not just their vote.
- `/admin/platform-settings` now shows a locked "you voted X (final)" state
  once `myVote` is set, instead of two still-clickable buttons.
- Also asked: is there a deadline, and does it auto-reject? There already was
  a 7-day `expires_at` and `_resolve_platform_setting_change` already flips a
  past-deadline row to `expired` - but only reactively, inside propose/vote.
  Nothing ever called it on a schedule, so a proposal nobody voted on again
  stayed "pending" forever, permanently blocking the next proposal (only one
  may be pending at a time). New daily cron
  `api/expire-platform-setting-changes.ts` resolves every still-pending
  request, so a stale one actually expires.

### Licence-transmission booking gate wasn't visible before the click

Reported: an `automatic_only`-restricted renter could still view a manual
car and reach the booking button with no upfront indication - they could
only view details (correct, unrestricted) but the actual block appeared too
late for a good UX. Checked live: the server gate in `api/create-booking.ts`
was already correct (no bad booking existed in production), and
`CarDetailPage.tsx` already computed the same `licenceGateReason` - but
**the pre-agreement "Review Agreement to Book" button was missing it from
its `disabled` list** (only the later "Request to Book" button had it), and
nothing greyed out the calendar/time inputs or said why upfront.

- Added a destructive-toned banner above the calendar naming the exact
  reason ("Your licence is not eligible for this vehicle's transmission" /
  "Your driver's licence has expired") once verified and blocked.
- The date-range calendar and both pickup/drop-off time inputs now grey out
  and stop responding (`disabled`) under the same condition.
- Fixed the missing gate on "Review Agreement to Book" so no button in the
  flow stays clickable while blocked.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 45),
`api/expire-platform-setting-changes.ts` (new),
`.github/workflows/scheduled-workers.yml`,
`src/pages/admin/AdminPlatformSettingsPage.tsx`, `src/pages/CarDetailPage.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## 2026-09-05 — Replaced the Vite favicon with a car icon; KYC approval now requires licence expiry/transmission first

- **Favicon**: the browser-tab icon was still the default Vite lightning-bolt
  logo (recolored to brand purple, same bolt shape). Replaced with a car
  silhouette (body + wheels) on a blue gradient rounded-square, matching the
  `Car` icon already used for the in-app logo mark.
- **KYC approval requires the licence fields**: `/admin/users`' **Approve
  Identity** used to stay clickable with a blank licence expiry/transmission
  - a `window.confirm()` dialog let the admin approve anyway ("grandfathered
  ... until an admin sets it"), and even when the admin did fill the fields
  in the form, approving never saved them (only the separate "Save licence
  details" button did) - a plausible trap where an approved account was left
  with no licence data despite the form looking filled in. Approve Identity
  is now disabled until both fields have values, and approving saves them in
  the same update as the verification decision.

Files: `public/favicon.svg`, `src/pages/admin/AdminUsersPage.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## 2026-09-05 — CRITICAL: ordinary accounts and guests could not actually browse cars (CHAPTER 43) + licence resubmission gets a real Reject action (CHAPTER 44)

### Cross-account profile visibility (CHAPTER 43)

Reported as "a new account can't see other listings"; verified live and found
far more severe: `public.profiles` has ever had exactly one `for select`
policy - `auth.uid() = id or is_admin()`. A non-admin account could read
*only its own row*. Confirmed empirically against the live database: an
anonymous guest's `BrowseCarsPage.tsx` query returned **0 cars** where the
service-role ground truth was 5. This went unnoticed because every account
used to test this session (and likely prior ones) was admin/super-admin,
which bypasses the restriction via `is_admin()`.

Blast radius, all from the same root cause (PostgREST enforces RLS on an
embedded/joined table same as the base table):
- `BrowseCarsPage.tsx` embeds `profiles!cars_owner_id_fkey!inner(...)` - an
  INNER join, so the blocked embed dropped the whole car row. Guests and
  every ordinary renter saw an empty Browse page.
- `CarDetailPage.tsx` uses a plain (LEFT) join - the car still showed, but
  the lister's name/phone/email/rating block was blank.
- `MyBookingsPage.tsx` / `ListerBookingsPage.tsx` lost the other
  participant's name/contact info on the renter's/lister's own booking.

Fix: two additive `or exists (...)` clauses on the same policy (row-level,
not column-level - every affected query already requests an explicit column
list, never `profiles(*)`, so this does not expose more sensitive columns
through those call sites):
- A profile that owns at least one `approved`/`active` car becomes publicly
  readable (including to signed-out guests) - the public listing-owner
  visibility Browse/CarDetail need.
- A profile becomes readable to the other participant of any booking
  between them (either direction) - what My Bookings/Lister Bookings need.

No frontend code changes - every affected query was already correct; RLS was
the only blocker.

### Licence resubmission Reject action + email (CHAPTER 44)

Reported gap: the admin licence-review panel (`/admin/users`) only had
"Save licence details" - no way to say a resubmission still wasn't
acceptable, so a bad resubmission sat in "pending" forever with no feedback,
or an admin had to save it anyway. Accepted resubmissions also only ever
notified in-app, never by email.

- New **Reject** button (shown only while a resubmission is pending),
  requires a reason, clears `license_update_pending` **without** touching
  `license_expiry`/`license_transmission` - the draft form values are never
  saved on reject, since the submission itself is what's being rejected.
- New `profiles.license_rejection_reason` column - shown on the panel until
  the next accepted save clears it again.
- Both accept and reject now email the renter too
  (`api/send-license-decision-email.ts`, the generic account-notification
  Resend template every other admin decision in this schema already uses),
  not just an in-app notification.

Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 43, 44),
`src/pages/admin/AdminUsersPage.tsx`, `api/send-license-decision-email.ts`
(new), `src/types/database.ts`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## 2026-09-05 — Fixed the dashboard's mode badge showing the wrong side after a direct link into the other portal space

Reported bug: the header sometimes read "Lister Mode" (badge, nav, colors)
while the actual page on screen was a renter-only page (or vice versa).

Root cause: `ModeRoute.tsx` (the backstop for bookmarked/emailed links into
the *other* portal mode's space) renders the destination page immediately
and flips `profiles.is_lister` in the background - it "never blocks" by
design. `DashboardLayout`'s chrome read the same persisted flag directly, so
for the whole async round-trip until the flip resolved, the badge/nav showed
the *previous* mode while the page underneath already matched the
destination's mode.

- `DashboardLayout.tsx` now derives its display-only `isLister` from
  `portalModeForPath(location.pathname)` first, falling back to the
  persisted flag only on neutral routes - so the badge/nav match the current
  route from the first paint, no waiting on the background flip.
- The persisted flag (`profileIsLister`) stays authoritative for the actual
  toggle action - `handleToggleMode`'s verification gate, the database
  write, and the "Switch to Renter"/"Switch to Lister" button label all
  still act on the real stored value, not the route-derived one.
- Swept every other `profile.is_lister` read in the app (`ModeRoute.tsx`,
  `VerificationPage.tsx`, `NotificationsPage.tsx`, `SubscriptionPlansPage.tsx`,
  the legal-page "back" links) - all of them are either on neutral routes or
  genuine eligibility/mode-switch-decision checks that correctly need the
  true flag, not display. `DashboardLayout`'s badge was the only literal
  "Lister Mode"/"Renter Mode" text in the codebase.

Files: `src/components/DashboardLayout.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## 2026-09-05 — Balance-payment deadline: a downpayment-only booking can no longer sit unpaid forever (CHAPTER 42)

Raised while discussing the no-show refund policy: once a booking reached
`downpayment_paid`, nothing ever expired it if the renter never paid the
remaining balance - the deadline cron only expired `confirmed`/
`awaiting_payment` (pre-any-payment) bookings, and `downpayment_paid` still
counts as an active status, so the car's dates stayed permanently blocked
with no automatic recovery and no reminder.

- **`bookings.balance_deadline`** is stamped once, when the downpayment
  webhook succeeds: `min(now + balance_deadline_hours, pickup time)` - the
  same "never past pickup" cap the original `payment_deadline` already uses.
- **Two new live, super-admin-configurable settings** (consensus-vote flow on
  `/admin/platform-settings`, same category as `arrival_checkin_lead_hours` /
  `lister_completion_timeout_hours` - operational timings, not snapshotted
  per booking): `balance_deadline_hours` (default 24) and
  `balance_reminder_hours_before` (default 6).
- **Expiry** (`api/expire-booking-deadlines.ts`): auto-cancels a
  `downpayment_paid` booking past its deadline, reusing the **existing**
  late-cancellation refund policy (`refund_full_hours_snapshot` /
  `refund_late_renter_percent_snapshot`, already snapshotted per booking) -
  no new refund percentage. Extracted the shared calculation into new
  `api/lib/cancellationRefundPlan.ts` (`getCancellationRefundPlan`,
  `createManualRefundReview`) so this cron and the existing user-initiated
  `cancel` action (`api/booking-action.ts`, left untouched, its own local
  copy) don't diverge. Counts against the renter's reliability record the
  same way any other late cancellation does.
- **One-time reminder** before the deadline hits (`balance_reminder_sent_at`
  dedupes it).
- **Countdown surfaced** on the `downpayment_paid` guidance card on both
  `/my-bookings` and `/lister-bookings`.

Files: `api/webhooks/paymongo.ts`, `api/expire-booking-deadlines.ts`,
`api/lib/cancellationRefundPlan.ts` (new), `src/pages/MyBookingsPage.tsx`,
`src/pages/ListerBookingsPage.tsx`, `src/pages/admin/AdminPlatformSettingsPage.tsx`,
`src/types/database.ts`, `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`
(CHAPTER 42), `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`,
`project_docs/SYSTEM_FLOWS.md`.

## 2026-09-05 — Add Vehicle: OR/CR are single-page documents, drop the front/back split

Reported bug: Add Vehicle asked for "OR front", "OR back", "CR front", and
"CR back" - four uploads. Both an Official Receipt and a Certificate of
Registration are single-page documents with no back page, so the split was
never meaningful and just made listing harder.

- `MyVehiclesPage.tsx` now asks for one OR photo and one CR photo. Removed
  `orBackFile`/`crBackFile` state, the two upload widgets, and the
  now-satisfied validation for them.
- Uploaded document types changed from `or_front`/`or_back`/`cr_front`/`cr_back`
  to plain `or`/`cr`. No SQL migration needed - `car_documents.document_type`
  has no CHECK constraint - and `AdminVehicleApprovalPage.tsx` already
  recognized bare `or`/`cr` alongside the legacy `_front`/`_back` values (kept
  as-is there, unchanged, so a car listed before this fix still displays its
  documents correctly).

Files: `src/pages/MyVehiclesPage.tsx`,
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## 2026-09-05 — Booking Conversations replace "Ask the lister"; My Inquiries folded into the floating widget (CHAPTER 41)

Triggered by a real reported bug: the `/support` "Lister Messages" tab was a
static label that read backwards for a lister viewing their own inbox (they
appeared to be messaging "a lister", when the messages were actually from
renters). Rather than just relabel it, this redesigns where renter<->lister
messaging comes from at all, and separately folds a redundant nav item into
the floating inquiry widget it duplicated.

- **Retired the pre-booking "Ask the lister"** (`CarDetailPage.tsx`'s inquiry
  modal, `api/create-car-inquiry.ts`). It had no `booking_id`, stayed in the
  inbox forever, and was reachable before a renter had even booked.
- **New "Message Lister" / "Message Renter"** button on an active
  (`fully_paid`/`active`) booking, both `MyBookingsPage.tsx` and
  `ListerBookingsPage.tsx`. Opens (or reuses) one `support_tickets` thread per
  booking via new `api/open-booking-conversation.ts` - reuses the exact same
  `support_tickets`/`ticket_messages` conversation shape the old flow used
  (`participant_user_id` set), just always with `booking_id` set now, so no
  schema change was needed beyond a notification-copy fix.
- **`/support` tab renamed** "Lister Messages" -> **"Booking Conversations"**
  - neutral regardless of which side is viewing, fixing the reported bug.
  Empty-state copy updated to point at the new entry point.
- **Soft-archive on completion:** a booking conversation disappears from both
  dashboards' list the moment its booking is `completed`/`cancelled` (a client
  filter joining `bookings.status`, not a delete) - still fully readable by an
  admin in `/admin/support` "Member conversations" for disputes. A legacy
  conversation ticket with no `booking_id` (from the retired flow) is never
  archived.
- **"My Inquiries" removed from the profile dropdown** (`DashboardLayout.tsx`,
  `/inquiries` route and `InquiriesPage.tsx` deleted). Its list-and-thread view
  was merged directly into the floating `InquiryWidget` - opening the widget
  now shows past inquiries first (with a reply-pending badge on the closed
  button) instead of always a blank form, so a submitted inquiry's reply is
  never orphaned behind a nav item that no longer exists.
- Two notification strings ("New car inquiry" / "New inquiry reply") reworded
  to generic booking-conversation copy, since every new conversation ticket is
  one from now on, not a pre-booking inquiry (CHAPTER 41, text-only).

Files: `src/pages/CarDetailPage.tsx`, `src/pages/MyBookingsPage.tsx`,
`src/pages/ListerBookingsPage.tsx`, `src/pages/SupportTicketsPage.tsx`,
`src/components/InquiryWidget.tsx`, `src/components/DashboardLayout.tsx`,
`src/lib/supportTickets.ts`, `src/lib/bookingConversation.ts` (new),
`src/lib/listerMode.ts`, `src/pages/GuestInquiryPage.tsx`, `src/App.tsx`,
`api/open-booking-conversation.ts` (new, replaces deleted
`api/create-car-inquiry.ts`), `src/pages/admin/AdminSupportTicketsPage.tsx`
(copy only), `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 41),
`src/pages/InquiriesPage.tsx` (deleted).

Deferred, not part of this batch: the idea of eventually viewing submitted
condition-report photos inside this same booking conversation thread - raised
by the user alongside this fix, explicitly held for later planning.

## 2026-09-05 — Add Vehicle form: required early-return dropdown, CTPL/insurance uploads, region/city dropdowns (CHAPTER 40)

A batch of Add Vehicle form fixes requested after live testing: the minimum
early-return notice was a free-text number box that most listers left blank or
misunderstood, CTPL/comprehensive insurance expiry dates had no supporting
document (unlike registration), and the pickup/dropoff region and city fields
were free-text (with only region backed by a `<datalist>`), letting listers
type anything.

- **Minimum early-return notice is now a required 1-24h dropdown**, not an
  optional free-text number field. Renamed range CHAPTER 38 introduced
  (0-72h, optional) is tightened to 1-24h, required on every new listing.
  CHAPTER 40 tightens the DB check constraint to match; the column stays
  nullable at the database level so cars listed before this chapter (with no
  value, or an old 0-72 value) don't become invalid - only new submissions
  from the UI always supply one now.
- **CTPL document upload added to Add Vehicle**, required alongside its
  existing expiry date (matching the OR/CR upload pattern). **Comprehensive
  insurance document upload also added**, optional (matching its optional
  expiry date). `car_documents.document_type` has no CHECK constraint, so
  the new `ctpl` / `comprehensive_insurance` document types needed no schema
  change.
- **Mileage (km) field label now explicitly marked "(optional)"** for
  clarity - the field itself was already optional.
- **Pickup/Dropoff Region converted from a free-text input (with a
  `<datalist>` suggestion list) to a required `<select>` dropdown**, backed
  by the existing curated `VEHICLE_REGION_OPTIONS` list (11 broad Philippine
  marketing regions). Changing the region clears the selected city.
- **City/Municipality converted to a region-scoped `<select>` dropdown**,
  same treatment as region, with a curated per-region city list
  (`VEHICLE_CITY_OPTIONS`) and an explicit "Other (type manually)" fallback
  that reveals a free-text input, so a lister whose city isn't in the
  curated list is never blocked from listing.
- Both conversions applied identically to the Edit Listing form (region/city
  there were already free-text; brought in line with Add Vehicle).

Files: `src/pages/MyVehiclesPage.tsx`,
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 40),
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

---

## 2026-09-05 — Handover/return redesign, dashboard UI (matches the backend rework)

The UI half of the handover/return redesign - makes the dashboards match
the backend behavior reworked in the same day's earlier commit, and fixes
several button labels/gates that the backend change made stale or outright
wrong.

- **Removed "Confirm With Location" entirely** from the shared
  `ArrivalPhotoCapture` component (used by both dashboards) - arrival is
  now a single "Confirm Arrival Now" button, no location capture at all.
- **New lister-only override:** "Confirm - Renter Is Here" lets the lister
  mark the renter's arrival on their behalf (e.g. dead phone), calling the
  new `confirmOnBehalfOfRenter` flag on `arrive`.
- **Trip-progress checklists redesigned** on both dashboards to the new
  8-step lists (renter: you arrived / lister arrived / vehicle handover /
  vehicle received / rental in progress / vehicle returned / return
  confirmed / your rating; lister: renter arrived / you arrived / vehicle
  verification / vehicle handover / rental in progress / vehicle return /
  trip completed / your rating). Backed by a new lightweight
  `trip_condition_reports` fetch on each dashboard (RLS already lets either
  participant read either side's reports) - no schema change needed.
- **Fixed now-stale required/optional labels and gates** from the backend
  flip: the renter's "Return report" is relabeled from "(required)" to
  "(optional)"; the lister's "Return photos (optional)" is relabeled to
  "Return report (required)" (the lister is now required at both phases);
  the lister's "Confirm - Car Received" button no longer waits on
  `renter_return_arrived_at` (that gate no longer exists server-side) and
  its caption now correctly says it needs both the lister's own pickup and
  return reports, "with or without the renter's own tap."
- **"Submitted" button state:** the pickup/return report buttons on both
  dashboards now show a green checkmark and "(submitted)" and become
  non-clickable once that report is on file, instead of always reading
  "(required)"/"(optional)" regardless of status.
- **"Report Place Limit" retired** on both dashboards - the renter side
  already had a generic "Report Booking" button covering the same ground
  (opens a support ticket, `booking_report` tag) throughout the whole
  booking lifecycle; the lister side gained the same generic button in
  Place Limit's spot. One report entry point per booking now, not two.
- **Transmission locked** in `MyVehiclesPage.tsx`'s Edit Listing modal -
  replaced the editable dropdown with a read-only display (same treatment
  CHAPTER 33 already gave registration/CTPL/comprehensive insurance): it's
  a fixed vehicle spec, not something that should need admin re-review
  after initial listing.
- Verified clean: `tsc -b`, lint, `check:api`, `check:alignment`,
  `check:booking-flow` (markers updated for the retired location-capture
  feature), and a full production build all pass.
- **Not done in this pass, flagged as a separate follow-up:** there is
  still no UI anywhere (participant or admin) to actually *view* a
  submitted condition report's photos after submission - found while
  investigating this redesign, out of scope for this specific change.
- **Files:** `src/components/ArrivalPhotoCapture.tsx`,
  `src/pages/MyBookingsPage.tsx`, `src/pages/ListerBookingsPage.tsx`,
  `src/pages/MyVehiclesPage.tsx`, `scripts/booking-flow-smoke-check.mjs`.

## 2026-09-05 — Handover/return redesign, backend (superseding Phase 3's gate)

Tester feedback after using the live-camera pickup flow and sequential
return handover: the required-photo asymmetry and the renter-blocks-owner /
owner-blocks-renter completion gates didn't match the intended process. This
is the backend half of a larger redesign; the matching dashboard UI
(MyBookingsPage/ListerBookingsPage trip-progress redesign, "confirm renter
is here" override, Report Place Limit consolidation, Transmission lock, a
photo-evidence viewer) is the next, separate piece of work.

- **Arrival is unconditional again.** Removed the CHAPTER-36 gate that
  required the lister's pickup report to already be filed before their own
  `arrive` call succeeded - arrival is now a quick presence check for both
  sides, full stop. Vehicle verification (live photos) and handover
  confirmation are separate, later steps, enforced at `complete` instead
  (already the existing behavior there, now the *only* place it's checked).
- **New owner-only override:** `arrive` accepts `confirmOnBehalfOfRenter`,
  letting the lister mark the renter's arrival themselves (e.g. renter's
  phone is dead) instead of only the renter being able to tap it.
- **The lister now carries the evidentiary burden at both ends of the
  trip**, not just pickup: `complete` requires the owner to have filed
  *both* a pickup and a return condition report with at least one live
  photo each. The renter's own report at either phase is fully optional -
  their own record for their own protection, never a blocker.
- **Removed the sequential completion gate added for Phase 3.** The
  renter's `complete` no longer waits on `owner_completed`, and the
  owner's `complete` no longer waits on `renter_return_arrived_at` /
  `renter_completed`. The owner's completion (backed by their required
  live-photo reports) finalizes the trip on its own, with or without the
  renter's participation; the renter's own completion is now a pure,
  non-blocking courtesy record. Removed the auto-confirmation cron branch
  in `api/expire-booking-deadlines.ts` that existed only to un-stick the
  gate this replaces - it's no longer reachable.
- **`return_arrive` (the renter's "I've returned the car" announcement)
  is now purely informational** - it never blocks anything - and gained
  its own arrival-style time window (opens the same configured number of
  hours before the scheduled return instant as pickup does, respecting an
  approved early return's updated `end_date`).
- **Retired the fixed front/back/left/right/interior/odometer/fuel_or_battery
  category system entirely.** Every trip condition report - pickup or
  return, either role - now uses the same free-form 1-4 live-camera photos
  introduced for the lister's pickup report in CHAPTER 36.
  `hasRequiredTripPhotos` no longer branches on phase.
- **Removed optional location capture** from trip condition reports
  (`TripConditionReportPage.tsx` and `api/submit-trip-condition-report.ts`)
  per this decision; `TripConditionReportPage.tsx` also gained a Back
  button and simplified to a single unified live-camera flow (no more
  fixed-category branch).
- No new SQL was needed - every field this reuses already exists from
  CHAPTER 36-39.
- Verified clean: `tsc -b`, lint, `check:api`, `check:alignment`,
  `check:booking-flow` (markers updated for the retired fixed-category
  system), and a full production build all pass.
- **Files:** `api/booking-action.ts`, `api/submit-trip-condition-report.ts`,
  `api/expire-booking-deadlines.ts`, `src/pages/TripConditionReportPage.tsx`,
  `scripts/booking-flow-smoke-check.mjs`.

## 2026-09-05 — Process-planning Phase 3: sequential return handover (CHAPTER 39)

Completion at return was fully symmetric - either party could tap "Finish
Trip" first, in either order. The arrival/handover process planning session
asked for a specific sequence instead: renter announces the return, the
lister confirms receiving the car, and only then does the renter's own
final confirmation unlock - so the renter has their own record that the
lister acknowledged the return, not just the lister's word alone.

- New renter-only action `return_arrive` (`api/booking-action.ts`): a
  lightweight "I've Returned the Car" announcement
  (`bookings.renter_return_arrived_at`, CHAPTER 39), no evidence requirement
  of its own - it just unlocks the lister's side below and notifies them.
- The lister's completion (`owner_completed`, relabeled "Confirm - Car
  Received") now additionally requires `renter_return_arrived_at` to be set.
- The renter's completion (`renter_completed`, relabeled "Car Confirm") now
  additionally requires `owner_completed` to already be `true` - the button
  is hidden/replaced with a waiting message until then, and a "Car Delivered"
  badge appears once the lister has confirmed.
- **Grandfathered:** a booking that already reached `renter_completed=true`
  under the old symmetric rule (in flight when this deployed) is not stuck -
  the lister's new gate also accepts a pre-existing `renter_completed` in
  place of `renter_return_arrived_at`.
- **Found and fixed a real gap while implementing this:** the existing
  "lister-absent auto-completion" safety valve in
  `api/expire-booking-deadlines.ts` only fired on `renter_completed=true,
  owner_completed=false` - a state the new sequential rule makes almost
  unreachable going forward, which would have left a renter permanently
  stuck if the lister simply never confirmed receipt. Added a mirrored
  auto-confirmation path keyed off `renter_return_arrived_at` timing out
  instead: it auto-sets only `owner_completed` (not straight to
  `completed`, since the renter still needs to tap their own final
  confirm) and notifies both sides.
- Updated the "next step" reminder card text on both dashboards
  (`MyBookingsPage.tsx`, `ListerBookingsPage.tsx`) for all three new
  sub-states, and the smoke-check markers that referenced the retired
  "Finish Trip" label.
- Verified clean: `tsc -b`, lint, `check:api`, `check:alignment`,
  `check:booking-flow`, and a full production build all pass.
- **Files:** `api/booking-action.ts`, `api/expire-booking-deadlines.ts`,
  `src/pages/MyBookingsPage.tsx`, `src/pages/ListerBookingsPage.tsx`,
  `src/types/database.ts`, `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`
  (CHAPTER 39), `scripts/booking-flow-smoke-check.mjs`,
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`,
  `project_docs/SYSTEM_FLOWS.md`.

## 2026-09-05 — Process-planning Phase 1: liability notice, structured non-return reason, early-return notice hint (CHAPTER 37-38)

Three smaller, independent items from the arrival/handover process planning
session:

- **Security-deposit liability disclaimer.** Now that the security-deposit
  feature is gone (CHAPTER 34), added an explicit clause to the renter-facing
  rental agreement summary (`CarDetailPage.tsx`, new item 5) and expanded
  `PlatformAgreementPage.tsx`'s Limitation of Liability section (§8): SafeDrive
  is not a party to vehicle condition/damage/theft/loss disputes between
  Lister and Renter - those are governed by the vehicle-specific rental
  agreement and the existing anti-carnapping policy (§6) - and keeps only a
  neutral, timestamped record (pickup/return reports, arrival check-ins) to
  support either side. No code/schema change.
- **Structured reason on a non-return report (CHAPTER 37).** A lister
  reporting an overdue, un-returned vehicle previously gave no reason at all -
  "stolen" and "renter's just late replying" looked identical in the ticket.
  Added a required reason dropdown (Renter unreachable / Vehicle stolen or
  missing / Accident or breakdown / Other) to the report dialog in
  `ListerBookingsPage.tsx`, a new checked `bookings.dispute_reason` column,
  and the label now appears in the opened support-ticket message and the
  audit log - a real, filterable field instead of unstructured free text.
- **Early-return minimum-notice hint (CHAPTER 38).** A lister can optionally
  set `cars.min_early_return_notice_hours` (0-72, in `MyVehiclesPage.tsx`'s
  Add/Edit forms, also shown on the vehicle card) - surfaced to the renter in
  `MyBookingsPage.tsx`'s early-return request modal as a hint before they
  send one. Deliberately informational only, not an enforced block: the
  lister can already approve or decline any request regardless of notice
  given, so a hard rule would add schema/validation complexity for little
  extra protection over what "the lister can just say no" already provides.
- Verified clean: `tsc -b`, lint, `check:api`, `check:alignment`,
  `check:booking-flow`, and a full production build all pass.
- **Files:** `src/pages/CarDetailPage.tsx`, `src/pages/PlatformAgreementPage.tsx`,
  `api/booking-incident-action.ts`, `src/lib/incidents.ts`,
  `src/pages/ListerBookingsPage.tsx`, `src/pages/MyVehiclesPage.tsx`,
  `src/pages/MyBookingsPage.tsx`, `src/types/database.ts`,
  `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 37-38),
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## 2026-09-05 — Free-form live-camera pickup photos for the lister (CHAPTER 36)

From the arrival/handover process planning session: the lister's required
pickup condition-report photo (the "before" evidence that gates arrival and
completion) accepted a plain file upload - a gallery pick, not proof the
photo was taken live at the car. Now that the security-deposit feature is
gone (CHAPTER 34), this photo is the main anti-fraud signal left at
handover, so this mattered more than before.

- The lister's pickup report now captures **1 to 4 free-form photos live
  through the device camera** (`getUserMedia` → live preview → capture →
  canvas → file - no `<input type="file">` at all, so there is no OS
  gallery/file picker to route around, not even on desktop where the
  `capture` attribute trick doesn't work). Reused the live-camera pattern
  already shipped for selfie capture in `VerificationPage.tsx`, adapted to a
  rear (`environment`) camera with no mirror flip. Known, accepted ceiling:
  a spoofed virtual-camera driver is unavoidable for any browser-based
  check - this is the strongest achievable client-side measure, not a
  cryptographic guarantee.
- **Return reports (either party) and the renter's own optional pickup
  report are completely unchanged** - still the fixed 4-required/3-optional
  categories, still plain file upload. The fixed-category system was
  duplicated in three independent places
  (`TripConditionReportPage.tsx`, `api/submit-trip-condition-report.ts`,
  `api/booking-action.ts`'s `hasRequiredTripPhotos`) with no shared code, so
  all three got an additive `phase === "pickup" && role === "lister"` branch
  rather than a restructure, to keep the untouched paths provably untouched.
  `hasRequiredTripPhotos` is now phase-aware (pickup: at least one live
  photo; return: the original all-4-fixed-categories check).
- Added the same upload-provenance/AI-suspicion scan (`inspectContentProvenance`,
  already used on verification images and vehicle documents) to each
  captured photo as defense-in-depth, with a schema-missing-column fallback
  so submissions don't hard-fail before CHAPTER 36's SQL is run.
- **Database (CHAPTER 36):** widens `trip_condition_photos.category` to
  additionally accept 4 generic `live_photo_1`..`live_photo_4` slots, and
  adds the same provenance-review columns already carried by
  `verification_images`/`car_documents`.
- Found and fixed two more leftover mentions of the removed security-deposit
  feature in `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` (a capability
  list and a demo checklist) missed during CHAPTER 34 - the doc still has
  many more scattered narrative mentions in Appendix E/K that were a
  deliberate scope decision at the time and remain out of scope here.
- Verified clean: `tsc -b`, lint, `check:api`, `check:alignment`,
  `check:booking-flow` (with new markers covering the added code path), and
  a full production build all pass.
- **Files:** `src/pages/TripConditionReportPage.tsx`,
  `api/submit-trip-condition-report.ts`, `api/booking-action.ts`,
  `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 36),
  `scripts/booking-flow-smoke-check.mjs`,
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`,
  `project_docs/SYSTEM_FLOWS.md`.

## 2026-09-05 — Make the renter no-show refund share admin-configurable

Decision from the arrival/handover process planning session: the renter
no-show forfeit (renter never appears at pickup, lister cancels) stays at
its current 50/50 split, but that number was hardcoded (`* 0.5`) in
`api/booking-incident-action.ts` instead of reading the same
admin-configurable setting the short-notice cancellation policy already
uses.

- `renter_no_show` now reads `refund_late_renter_percent_snapshot` off the
  booking (the same per-booking snapshot column Terms 6.2 short-notice
  cancellations already use), clamped 0-100 with a 50 default - so it's one
  admin-configurable number for "renter bailed with notice" and "renter
  never showed," and existing bookings keep the split they were created
  under even if the platform-wide setting changes later. Every message that
  referenced a literal "50%" (the refund note, the super-admin review
  notification, the incident ticket, the renter's own notification) now
  interpolates the actual percent.
- `AdminPlatformSettingsPage.tsx`'s "Short-notice renter refund share"
  setting hint now says it covers both cases, since one number now drives
  both policies.
- `ListerBookingsPage.tsx`'s two no-show advisory strings (before/after
  filing the report) now read the live percent via
  `fetchPlatformPricingSettings()` instead of a hardcoded "50%".
- Fixed the same hardcoded "50%" in `PlatformAgreementPage.tsx`'s Renter
  No-Show clause and two spots in
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` to say "default 50%"/
  reference the setting, matching how the Cancellation Policy paragraph
  right above it is already phrased.
- Verified clean: `tsc -b`, lint, `check:api`, `check:alignment`,
  `check:booking-flow`, and a full production build all pass.
- **Files:** `api/booking-incident-action.ts`,
  `src/pages/admin/AdminPlatformSettingsPage.tsx`,
  `src/pages/ListerBookingsPage.tsx`, `src/pages/PlatformAgreementPage.tsx`,
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## 2026-09-05 — Driver's licence resubmission: admin notification, status label (CHAPTER 35)

Tester feedback: after resubmitting a driver's licence (an already-verified
renter renewing an expired one), the admin side showed no sign it happened -
no notification, and the user's row in User Management still just said
"Verified" with nothing calling out the pending resubmission.

- **Root cause of the missing notification:** `VerificationPage.tsx`'s
  `handleLicenseUpdate()` tried to insert notification rows for admins
  directly from the renter's browser session. RLS's
  `"Users can insert own notifications"` only allows `auth.uid() = user_id`,
  so every one of those inserts was silently rejected - the result was never
  checked, so nothing surfaced the failure. Confirmed live: the uploaded
  images and `license_update_pending` flag were saved correctly, but zero
  notification rows existed for any admin.
- **Fixed the same way every other admin-notification path in this schema
  already works:** a `SECURITY DEFINER` trigger
  (`notify_admins_of_license_update`, fires `after update of
  license_update_pending on profiles`) that inserts as the function owner,
  bypassing RLS entirely - mirroring `notify_admins_of_pending_verification`.
  Removed the dead client-side insert from `handleLicenseUpdate()`.
- **New "Resubmission" status:** `AdminUsersPage.tsx`'s User Management table
  now shows an amber "Resubmission" badge (instead of "Verified") for any
  user with `license_update_pending`, and it's filterable from the status
  dropdown - previously the only place this showed at all was a small badge
  inside the per-user review modal.
- The reported "uploaded photo doesn't show up on the admin side" traced to
  the same root cause, not a data or storage bug - live verification
  confirmed all 6 verification images (existing + the 3 resubmitted ones)
  were correctly stored with valid signed URLs; admins simply had no prompt
  to go look.
- Also cleaned up two stale references caught while in this file: the
  diagnostic trigger-name and constraint-name lists at the end of
  `SAFE_DRIVE_DATABASE_MASTER.sql` still named `cars_security_deposit_amount_check`
  (dropped with the column in CHAPTER 34) and were missing the new trigger.
- Verified clean: `tsc -b`, lint, `check:alignment`,
  `check:booking-flow`, and a full production build all pass.
- **Files:** `src/pages/VerificationPage.tsx`,
  `src/pages/admin/AdminUsersPage.tsx`,
  `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (CHAPTER 35).

## 2026-09-05 — Remove the security deposit feature entirely (CHAPTER 34)

Requested removal: the refundable security-deposit flow (separate deposit
checkout, claim review, auto-release, its own ledger liability account, and
the payout gate waiting on it) was never used in production - a diagnostic
query confirmed zero deposits, zero claims, zero deposit payment rows, and
zero finalized deposit ledger journals in the live database - so it was hard
deleted end to end rather than soft-disabled. Booking data did **not** need
to be touched: `security_deposits.booking_id` pointed one-directionally at
`bookings` (`ON DELETE RESTRICT`), so dropping the deposit tables never
required touching booking rows.

- **Removed entirely:** `api/security-deposit-action.ts`,
  `api/create-security-deposit-checkout.ts`,
  `api/process-security-deposit-release.ts`, `api/lib/securityDeposit.ts`,
  `src/pages/SecurityDepositPage.tsx`,
  `src/pages/admin/AdminSecurityDepositsPage.tsx`.
- **Every process that gated on deposit state now proceeds without it**,
  reconnected rather than left half-wired: arrival check-in
  (`api/booking-action.ts`), payout eligibility
  (`api/lib/payoutAutomation.ts`), booking completion
  (`api/lib/bookingCompletion.ts`), the PayMongo webhook
  (`api/webhooks/paymongo.ts`), receipts/ledger posting
  (`api/lib/email.ts`, `api/lib/ledger.ts`), reconciliation
  (`api/run-reconciliation.ts`), and deadline expiry
  (`api/expire-booking-deadlines.ts` - also dropped its now-orphaned
  deposit auto-release loop and gained a `booking_cancellations` write for
  unpaid-deadline expiry, matching how a late cancellation is already
  recorded for reliability scoring).
- **Frontend:** removed every deposit display line, gate, and button from
  `MyBookingsPage.tsx`, `ListerBookingsPage.tsx`, `CarDetailPage.tsx`, and
  `MyVehiclesPage.tsx` (Add/Edit vehicle forms); removed the deposit tab
  from `AdminFinancialReviewsPage.tsx`, the deposit-review count from
  `AdminDashboard.tsx` and `adminAttention.ts`, the
  `deposit_claim_window_hours` control from
  `AdminPlatformSettingsPage.tsx`, and the two deposit routes from
  `App.tsx`. Also fixed lingering deposit-claim wording in
  `TripConditionReportPage.tsx`, `AdminPayoutsPage.tsx`, `TermsPage.tsx`
  (dropped the now-inaccurate ToS clause 5.5), and `helpCenter.ts`
  (repurposed the FAQ entry to downpayment-vs-balance).
- **Types/QA:** `src/types/database.ts` (dropped the two deposit table
  types and `cars.security_deposit_amount`/
  `platform_settings.deposit_claim_window_hours` columns),
  `scripts/financial-logic.test.mjs`, `scripts/booking-flow-smoke-check.mjs`,
  and the `verify-live-*.mjs` scripts all updated to match - no orphaned
  markers or checks left pointing at removed code.
- **Database (CHAPTER 34):** drops `security_deposits` and
  `security_deposit_claims`, drops `cars.security_deposit_amount` and
  `platform_settings.deposit_claim_window_hours`, removes ledger account
  `2020` (refundable-deposit liability), and recreates
  `return_materially_changed_car_to_review()` and
  `validate_platform_setting_change()` without the dropped-column
  references those trigger/RPC functions used to have.
- **Docs:** `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`,
  `project_docs/SYSTEM_FLOWS.md`, `project_docs/RBAC_DESIGN.md`,
  `project_docs/DATA_RETENTION_AND_DELETION.md`, `docs/system-process.md`,
  `docs/system-process-flow.mermaid`, `docs/dfd-level-1.mermaid`,
  `plans/todo.md`, and `plans/implementation-plan.md` all updated to drop
  every current-tense deposit reference; historical changelog and
  dated-spec entries that describe what existed *at the time* are left
  alone on purpose - they're accurate records, not live claims.
- Verified clean: `tsc -b`, lint, `check:api`, `check:alignment`, build,
  `node --test` (financial-logic), and
  `node scripts/booking-flow-smoke-check.mjs` all pass.
- **Files:** ~30 files across `api/`, `src/`, `scripts/`, `project_docs/`,
  and `docs/`; see `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`
  CHAPTER 34 for the full SQL.

## 2026-09-04 — Deadline timezone bug, arrival-card reorder, non-payment reliability

Tester feedback: payment/response deadlines were showing hours past the
actual pickup time, and the pickup/arrival card's flow and copy were
confusing.

- **8-hour deadline bug, root-caused and fixed:** `api/create-booking.ts`
  (`owner_response_deadline`) and `api/booking-action.ts`'s `accept` handler
  (`payment_deadline`) both combined a calendar date with a pickup time
  using a naive `Date.UTC(y,m,d,h,m)` with no Manila (UTC+8) correction -
  the exact same file's own `getBookingPickupMs()` (used for refund timing)
  already did this correctly. Both deadlines could therefore land up to 8h
  *past* the real pickup instead of being capped by it. `booking-action.ts`
  now reuses `getBookingPickupMs()` instead of a duplicate buggy calc;
  `create-booking.ts` gets the same `-8h` correction. The lister's "accept
  within Xh" countdown reads directly off the fixed value, so it's
  corrected too with no separate UI change.
- **Renter reliability on non-payment:** a `confirmed`/`awaiting_payment`
  booking that auto-cancels because the renter never completed payment now
  writes a `booking_cancellations` row (`cancelled_by_role='renter'`,
  `was_late=true`) in `api/expire-booking-deadlines.ts` - it ties up the
  car the same way a late cancellation does, so it now counts the same way
  toward `get_renter_reliability`. Previously this path left no reliability
  trace at all.
- **Arrival card reorder + cleanup** (`ArrivalPhotoCapture`, shared by
  `/my-bookings` and `/lister-bookings`): "Confirm Arrival Now" /"Confirm
  With Location" now come *before* the pickup-report button (you must
  arrive before you can usefully photograph the handover), not after.
  Removed "Take Optional Photo" / "Upload Optional Photo" (redundant next
  to the dedicated 4-photo pickup report; that report is the real evidence
  trail admins already use for disputes). The pickup-report button is
  honestly labelled "(optional)" on both sides now - it never actually
  blocked arrival, only the lister's copy claimed otherwise - with an eye
  icon whose hover tooltip explains it's still worth doing (dispute
  evidence; required to file a deposit claim later).
- **Files:** `api/{create-booking,booking-action,expire-booking-deadlines}.ts`;
  `src/components/ArrivalPhotoCapture.tsx`;
  `src/pages/{MyBookingsPage,ListerBookingsPage}.tsx`.

## 2026-09-04 — Fix broken car photo on the car detail page

Tester feedback: "May bug sa car picture /UI, di lumalabas yung picture sa
ibang car" - one car's (Kia Soluto) photo showed as a broken image on its
detail page even though it showed fine on Browse.

- **Root cause:** `car_images.storage_path` is supposed to hold a relative
  storage path (`getPublicUrl()` builds the full URL at read time) - that's
  what Add Vehicle stores. But re-uploading images through `/my-vehicles`
  Edit Listing stored the *already-resolved* full public URL instead, which
  `CarDetailPage`'s `getImageUrl()` then fed back into `getPublicUrl()`,
  double-prefixing it into a 404. `BrowseCarsPage`, `LandingPage`, and
  `ListerCarRenewalPage` already special-cased a full-URL value; only the
  detail page didn't.
- Fixed both ends: Edit Listing's image re-upload now stores the relative
  path like Add Vehicle does, and `CarDetailPage.getImageUrl()` now returns
  a stored full URL as-is (the same backwards-compat check the other three
  pages already had), so already-affected rows display correctly too.
- **Files:** `src/pages/{CarDetailPage,MyVehiclesPage}.tsx`.

## 2026-09-04 — Force-view the lister's PDF before agreeing

Tester feedback: "Dapat ma force view muna yung pdf bago ma click yung
'Yes, I Agree and Continue'" - every lister's rental agreement PDF sets
different conditions, but a renter could click Agree without ever opening
it.

- `CarDetailPage`: "Yes, I Agree and Continue" is now disabled until the
  renter has clicked "View PDF" at least once for the currently loaded
  agreement (tracked per agreement load, not per modal open/close, so
  re-opening the same review dialog doesn't force a re-view). An amber hint
  explains why the button is disabled; `handleAgreementAccept` also checks
  it defensively in case the disabled state is ever bypassed.
- **Files:** `src/pages/CarDetailPage.tsx`.

## 2026-09-04 — Registration/CTPL/comprehensive move to Renewal (CHAPTER 33, run manually)

Tester feedback: "Edit Listing" let a lister silently retype
registration/CTPL/comprehensive expiry dates with **no supporting
document**, while the annual renewal flow only ever collected 5 physical
inspection documents (never a CTPL or comprehensive-insurance document, and
never the dates themselves - an admin re-typed them blind via
`window.prompt()` after eyeballing the OR/CR photo).

- **`/my-vehicles` Edit Listing:** the three expiry date pickers are gone.
  The card now only touches booking-facing info (price, deposit, location,
  transmission, fuel, contact, GPS, rental agreement) and shows the current
  dates read-only with a link to the renewal page.
- **`/car-renewals` (`ListerCarRenewalPage`):** open to any of the lister's
  live vehicles at any time (not only ones already forced offline), so a
  lister can renew ahead of expiry. Now collects the new registration/CTPL
  expiry (required) with a required CTPL document, and an optional
  comprehensive expiry + document (must be given together or both blank) -
  alongside the existing 5 inspection documents.
- **`/admin/vehicle-renewals`:** Approve now reads and validates the
  lister-submitted dates directly instead of three `window.prompt()`
  dialogs; shows a CTPL-document button always and a comprehensive-document
  button when one was uploaded.
- **SQL (CHAPTER 33, run manually):** `car_renewals` gains
  `registration_expiry`, `ctpl_expiry`, `comprehensive_insurance_expiry`,
  `ctpl_document_path`, `comprehensive_document_path`.
- **Files:** CHAPTER 33; `src/pages/{MyVehiclesPage,ListerCarRenewalPage,
  admin/AdminVehicleRenewalsPage}.tsx`; `src/types/database.ts`.

## 2026-09-04 — Clearer file-input affordance app-wide

Tester feedback: the licence-update file inputs "clickable siya pero parang
walang hint... nag iiba behavior ng cursor" — the native `<input type=file>`
box only made the "Choose File" text look like a button; the rest of the
box (and the "No file chosen" text) read as inert, and the cursor changed
between the two halves even though clicking anywhere opens the picker.

- `components/ui/input.tsx`: file inputs now get a full-width pointer
  cursor and the file-selector button is styled like a real outline button
  (border + background + hover state), matching `buttonVariants`. One
  shared component, so every file upload in the app (licence update, KYC
  documents, vehicle documents/registration/insurance, support-ticket
  attachments, trip-condition photos) gets the fix at once.
- **Files:** `src/components/ui/input.tsx`.

## 2026-09-04 — Region/city/barangay search filter fix + honest Browse empty state

Two tester reports.

- **Verification address search:** typing into Region/City/Barangay (a
  shared `SearchableLocationInput`) stopped filtering the dropdown as soon
  as the field was clicked again (e.g. to move the caret) — `openMenu()`
  unconditionally reset to "show everything," discarding the search. It now
  only shows the full list when the field is empty; a click on a field that
  already has text keeps filtering by what's typed. Fixes Region, City, and
  Barangay at once (one shared component).
- **Browse Cars "Clear All Filters":** it was showing on every empty
  result, even with zero filters selected, which read as "your filter is
  hiding cars" when the real cause was simply no listed cars yet. It now
  only appears - and the message only blames filters - when a filter is
  actually active; a genuinely empty catalog now says "no listed cars
  available right now" instead.
- **Files:** `src/pages/{VerificationPage,BrowseCarsPage}.tsx`.

## 2026-09-04 — Payout account number length guard (CHAPTER 32, run manually)

Tester feedback: the payout Account Number field had no character limit.

- All three payout-account-number inputs (identity verification form, the
  `/verify` "Edit Payout Details" card, and the lister-mode payout modal)
  now share one `sanitizePayoutAccountNumber` helper: digits only, capped at
  16, plus `maxLength={16}` on the input.
- **SQL (CHAPTER 32, run manually):** backfills any existing value to its
  first 16 digits and adds `profiles_payout_account_number_check` so a
  bypassed/old client can never write past the UI's limit.
- **Files:** CHAPTER 32; `src/pages/VerificationPage.tsx`.

## 2026-09-04 — Clickable logo on the login / sign-up pages

Tester feedback: the SafeDrive logo should be clickable everywhere and go to
the main landing page; it already did inside the dashboard (back to
`/browse` or `/lister-bookings`) and the admin panel (back to `/admin`) via
`DashboardLayout` / `AdminLayout` — only the logged-out `/login` and
`/signup` headers were a static, non-clickable mark.

- `/login`, `/signup`: the header logo is now a `Link to="/"` (the public
  landing page).
- **Files:** `src/pages/{LoginPage,SignUpPage}.tsx`.

## 2026-09-04 — Resend signup confirmation email

Tester feedback: the "Confirm your signup" email is sent exactly once, at
signUp() time; if it lands in Spam/Promotions or is missed, the account was
stuck with no way to get another one.

- **`AuthContext.resendConfirmationEmail(email)`:** wraps
  `supabase.auth.resend({ type: "signup", ... })` (same template, same
  `emailRedirectTo`).
- **`/login`:** a sign-in attempt that fails with "Email not confirmed" now
  shows an inline banner with a "Resend confirmation email" button (60s
  client-side cooldown, clears when the email field changes).
- **`/signup`:** the success toast now mentions Spam/Promotions and the
  resend option on `/login`.
- **Files:** `src/contexts/AuthContext.tsx`,
  `src/pages/{LoginPage,SignUpPage}.tsx`.

## 2026-09-04 — Pickup no-show / non-return incidents + fault attribution (CHAPTER 31)

Closes the CHAPTER 27 fairness gap: an innocent party should not take the
reliability hit when a handover fails.

- **SQL (CHAPTER 31, run manually):** `bookings.dispute_status`
  (`none`/`open`/`resolved` — a sub-flag, not a new booking status) +
  `booking_cancellations.strike_waived`; both reliability RPCs recreated to
  ignore a waived cancellation.
- **`api/booking-incident-action.ts` (new):** `renter_no_car` (renter checked
  in, no car → cancel + full auto-refund, no reliability hit; cascade-aware —
  an overdue previous renter is blamed instead and the lister strike is
  waived), `renter_no_show` (lister checked in, renter absent → cancel, renter
  keeps a 50% forfeit, other 50% queued for admin release), `report_non_return`
  (active trip overdue → `dispute_status='open'`, support case, no cancel).
- **Blocking:** a renter with an `open` dispute cannot create or pay for
  bookings (`api/create-booking.ts`, `api/create-checkout.ts`,
  `api/create-balance-checkout.ts`, each a separate defensive query); the
  lister cannot re-enable that car's listing.
- **`booking-action.ts`:** new `waiveStrike` payload flag; the auto-pause
  strike count and `booking_cancellations` now honour `strike_waived`.
- **`/my-vehicles` "Disable":** a car with upcoming bookings now opens a
  confirmation modal that lists them + a reason select; on confirm each is
  cancelled (paid → auto-refund), then the car goes offline. Reason
  stolen/damaged waives the strikes and opens a `vehicle_offline` ticket; an
  active trip blocks the toggle.
- **`/my-bookings` / `/lister-bookings`:** the old "Report No-Show" links
  (which only opened a support form) are replaced with the real actions above.
- **Platform Agreement:** §4 gains the renter no-show 50%-forfeit clause.
- **Files:** CHAPTER 31; `api/{booking-incident-action,booking-action,
  create-booking,create-checkout,create-balance-checkout}.ts`;
  `src/lib/incidents.ts`; `src/pages/{MyBookingsPage,ListerBookingsPage,
  MyVehiclesPage,PlatformAgreementPage}.tsx`; `src/types/database.ts`.

## 2026-09-04 — Early return + expired-licence checkpoints

- **Early return (CHAPTER 30, run manually):** `booking_early_returns` table +
  `api/booking-early-return-action.ts` (request / approve / reject / cancel,
  mirror of extensions). A renter asks to hand the car back before the booked
  end date; **no automatic refund** for unused days (Turo/Getaround standard);
  the lister may approve with an optional goodwill refund that goes through the
  standard admin refund review. Approve moves `bookings.end_date` earlier.
  `/my-bookings` gets a "Request early return" button + modal + status card;
  `/lister-bookings` gets Approve/Reject with a goodwill field + note.
- **Expired-licence second checkpoint:** `api/create-checkout.ts` and
  `api/create-balance-checkout.ts` block payment when the renter's licence has
  an explicit past expiry (separate query, degrades to no check pre-SQL); the
  renter can cancel for a full refund.
- **`/verify` clarity:** an expired licence now says listing/hosting is
  unaffected; a lister with a soon-expiring licence gets a soft "keep your ID
  current" prompt.
- **Platform Agreement:** §2 gains an ongoing-licence-validity clause; §4 gains
  the early-return no-automatic-refund clause.
- **Files:** CHAPTER 30; `api/{booking-early-return-action,create-checkout,
  create-balance-checkout}.ts`; `src/lib/earlyReturns.ts`;
  `src/pages/{MyBookingsPage,ListerBookingsPage,VerificationPage,
  PlatformAgreementPage}.tsx`; `src/types/database.ts`.

## 2026-09-04 — Driver's licence validity + transmission (AT / AT-MT) gating

The KYC review captured licence photos but no structured expiry and no
Philippine transmission restriction. Renters with an automatic-only licence
could book manual cars, and an expired licence was never a booking gate.

- **DB (CHAPTER 29, run manually):** `profiles.license_expiry` /
  `license_transmission` (`automatic_only` | `manual_and_automatic`) /
  `license_update_pending` / `license_expiry_notified_at`; `cars.transmission`
  (`automatic` | `manual`). `protect_profile_sensitive_fields` +
  `enforce_admin_profile_permission` extended (user cannot self-edit validity;
  admin edit needs `users.verify`). `return_materially_changed_car_to_review`
  now treats a transmission change as material. `notify_expiring_licenses()`.
- **Admin** (`/admin/users`, `users.verify`): a Driver's licence panel to set
  expiry (date picker) + restriction (dropdown) from the licence photos;
  clears `license_update_pending`; approve prompts if not set.
- **Renter** (`/verify`): Driver's Licence card with the expiry countdown /
  restriction, an "Update licence" mini-form (re-uploads QR + front + back,
  flags a re-review, notifies admins), and a "Report a mistake" link →
  `license_dispute` support ticket.
- **Lister** (`/my-vehicles`): required Transmission dropdown on the add form,
  editable in the edit modal (material change), shown on the vehicle card.
- **Gate** (`api/create-booking.ts`, conservative — only explicit values
  block, read in separate queries so a pre-SQL deploy degrades to no gate):
  explicit past expiry blocks; `automatic_only` renter cannot book a `manual`
  car. Browse + car page show the transmission and the disabled-with-reason
  booking button.
- **Cron:** `api/flag-expiring-licenses.ts` (daily) + the workflow job.
- **UX:** login / sign-up forms disable their inputs while an attempt runs.
- **Files:** CHAPTER 29; `api/{create-booking,flag-expiring-licenses}.ts`;
  `src/lib/driversLicense.ts`; `src/pages/{VerificationPage,MyVehiclesPage,
  BrowseCarsPage,CarDetailPage,LoginPage,SignUpPage}.tsx`;
  `src/pages/admin/AdminUsersPage.tsx`; `src/types/database.ts`;
  `.github/workflows/scheduled-workers.yml`.

## 2026-09-04 — My Vehicles lifecycle hub + editable verification ETA

My Vehicles was a flat list; a `renewal_required` car showed a misleading
"Pending" badge (no key in `statusBadge`), the renewal flow lived only on a
separate `/car-renewals` page, and the verification wait time was hard-coded.

- **My Vehicles restructure:** In review / Listed / Inactive sub-tabs
  (`AdminSectionTabs`), auto-landing on the tab that needs attention.
- **`renewal_required` badge fix** + an in-card "Renew documents" CTA linking
  to `/car-renewals`, so the renewal flow is reachable from the vehicle.
- **Compliance reframe:** the "Insurance review: …" line becomes a "Documents"
  row of Registration / CTPL / Comprehensive chips coloured by expiry
  (valid / expiring ≤30d / expired-or-missing).
- **Pending card:** explicit "In admin review · <ETA> · you'll be notified".
  Rejected card shows the reason inline.
- **Editable verification ETA (CHAPTER 28):** `platform_settings` gains
  `user_verification_eta_message` / `vehicle_verification_eta_message`;
  `get_verification_eta_messages()` (anon+auth) and
  `set_verification_eta_messages()` (super-admin, direct edit, audit-logged,
  10–400 chars). A super admin can raise the ETA during a peak season from
  `/admin/platform-settings` with no redeploy. Consumed by VerificationPage
  (pending screen, form intro, submit toast) and MyVehiclesPage (pending
  card, add form, submit toast, "unlock Lister Mode" card).
- **Files:** `src/pages/{MyVehiclesPage,VerificationPage}.tsx`,
  `src/pages/admin/AdminPlatformSettingsPage.tsx`, `src/lib/platformSettings.ts`,
  `src/types/database.ts`.

## 2026-09-04 — Lister cancellation accountability + two-sided reliability

The API supported a lister cancelling a paid pre-trip booking (renter gets an
automatic full refund) but no UI exposed it, so a flaky lister just no-showed,
and there was no consequence and no signal to future renters. Modelled on
Airbnb host-cancellation policy / Superhost metrics and Turo All-Star Host.

- **Lister cancel button** on `/lister-bookings` for `confirmed` /
  `downpayment_paid` / `fully_paid` pre-arrival bookings — one dropdown reason
  + a warning, then the existing `booking-action` `cancel` path (full auto
  refund to the renter, who is notified with a Browse link).
- **`booking_cancellations`** table: one row per cancelled booking, either
  party, with `was_late` (inside the booking's own `refund_full_hours`
  window — same threshold the renter faces).
- **Strike / auto-pause:** 3 late cancellations of a paid booking within 60
  days sets every one of the lister's live cars to `inactive` + notifies them
  to contact support. Repeat offenders only.
- **Reliability signals** (`get_lister_reliability`, `get_renter_reliability`,
  rolling 365 days, shown once ≥3 completed-or-cancelled): completion rate on
  the car page's lister block and on the renter card in `/lister-bookings`.
- **Review after a lister cancellation:** the renter can leave a star + comment
  (Airbnb-style). Shown on the car page with a "The lister cancelled this
  booking" badge; **excluded from the numeric star average** — trip reviews
  only move the score.
- **SQL:** CHAPTER 27 (run manually). **Files:** `api/booking-action.ts`,
  `src/lib/ratings.ts`, `src/pages/{ListerBookingsPage,CarDetailPage,MyBookingsPage,BrowseCarsPage}.tsx`,
  `src/types/database.ts`.

## 2026-09-03 — Ratings & reviews: standard marketplace model

The rating flow existed but was incomplete: Browse showed no ratings,
the car page's rating on `/my-bookings` was computed from ALL reviews
(owner-of-renter reviews polluted the car number), there was no lister
rating anywhere, and the renter's rating never reached a future lister's
request modal.

- **Model:** renter gives ONE trip rating -> aggregated by car (car
  rating) and by owner (lister rating), same rows. Lister gives ONE
  renter rating. No separate "rate the lister" star - no redundancy.
- **Double-blind:** a review counts / shows only once both parties rated
  the booking or 14 days passed. Computed at read time.
- **New SQL (`phase10_rating_functions.sql`):** `get_car_rating_summaries`,
  `get_lister_rating_summaries`, `get_public_car_reviews`,
  `get_renter_reputation` (SECURITY DEFINER, aggregates + first-name-only
  review text, so logged-out visitors see ratings). `_review_is_published`
  helper. No schema change.
- `src/lib/ratings.ts` (new) — shared fetchers + `formatAverage`.
- Browse cards: `★ 4.8 (12)` / "New".
- Car page: rating summary + star distribution (Google-Play style),
  reviewer name/avatar, and "Hosted by X · ★ 4.9 · N trips" on the
  Listed-by card. Reads now work logged-out via the RPCs.
- `/my-bookings`: fixed the car-rating source; "Your renter rating"
  chip; rating modal reworded ("Rate your trip", double-blind note).
- Lister bookings: renter reputation (with double-blind) on the request
  card and a "Recent feedback from other listers" block in the
  renter-info modal.
- Files: db master + phase10.sql, `src/types/database.ts`,
  `src/lib/ratings.ts`, `BrowseCarsPage`, `CarDetailPage`,
  `MyBookingsPage`, `ListerBookingsPage`,
  `scripts/booking-flow-smoke-check.mjs`,
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` (8.2).
- Follow-up: apply `phase10_rating_functions.sql` in Supabase.

---

## 2026-09-03 — One trip per renter at a time

A renter could book car A and car B for the same overlapping dates - the
overlap check (API + the DB exclusion constraint) was per-car only. In a
peer-to-peer rental the verified account holder is the driver the lister
meets; a second overlapping booking means someone else drives one car,
breaking the identity / liability / insurance model.

- `api/create-booking.ts`: after the per-car conflict check, also checks
  the renter's own active bookings across every car and rejects an
  overlap with a clear message ("account holder has to be the driver...
  book it from their own account").
- `api/booking-extension-action.ts`: the extended date window must not
  collide with another active booking on the same car or another trip of
  the same renter.
- Files: those two + `scripts/booking-flow-smoke-check.mjs`,
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` (E.8.1). No schema
  change - the DB constraint stays per-car; this is an API rule.

---

## 2026-09-03 — Recover from stale chunks after a deploy (no more "React App Crashed")

After a new build, an already-open tab still holds the previous
build's hashed chunk URLs. The first navigation to a not-yet-loaded
lazy route 404s ("Failed to fetch dynamically imported module") and
the error boundary showed a red "React App Crashed" stack trace. A
manual refresh fixed it because the fresh index.html has the new
chunk names.

- New `src/lib/lazyWithReload.ts`: `isChunkLoadError`,
  `reloadForStaleChunk` (one rate-limited full reload, guarded by a
  sessionStorage timestamp so a genuinely broken module still surfaces),
  and `lazyWithReload` - a `React.lazy` wrapper that reloads instead of
  throwing on a stale-chunk import failure.
- `src/App.tsx`: every route `lazy(() => import(...))` is now
  `lazyWithReload(...)`.
- `src/main.tsx`: listens for Vite's `vite:preloadError` and reloads.
- `src/components/ErrorBoundary.tsx`: a chunk-load error now reloads and
  shows a short "Updating SafeDrive" card instead of the crash stack.

Note: an already-open stale tab needs one manual refresh to get this
code; deploys after that self-heal.

---

## 2026-09-03 — Security logs: role, IP, device, session, failure reason (Tier 1)

The security log stored `ip_address` and `user_agent` all along; the
admin page just never showed them, and there was no role or reason.

- Migration (`phase9_security_log_fields.sql`): `security_logs` gains
  `actor_role`, `actor_is_lister` (snapshot at event time),
  `session_id` (Supabase session, from the JWT `session_id` claim),
  `failure_reason`, `target_email` (address entered on a failed login).
  Two indexes (`created_at desc`, partial `session_id`). No backfill.
- `api/record-security-event.ts`: looks up the actor's role/lister flag
  from `profiles`, decodes the JWT for `session_id`, and promotes
  `details.reason` / `details.email` to the new columns. Client login
  flows already send reason + email, so no client change was needed.
- `AdminSecurityLogsPage`: new Role / IP address / Device columns
  (device is a dependency-free user-agent parse, raw string on hover),
  a role filter (All / Super admin / Admin / Lister / Renter), failure
  reason shown inline instead of "reason recorded", session-id chip,
  and IP / device / session / target-email added to search. Older rows
  fall back to `details.portal` / `details.reason` / `details.email`.
- Append-only RLS unchanged (admin SELECT, validated-server INSERT,
  no UPDATE/DELETE).

- Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`,
  `api/record-security-event.ts`, `src/types/database.ts`,
  `src/pages/admin/AdminSecurityLogsPage.tsx`,
  `scripts/booking-flow-smoke-check.mjs`,
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.
- Follow-up: apply `phase9_security_log_fields.sql` in Supabase.
- Deferred (Tier 2/3): session table + "sign out all devices",
  time-based retention purge, geo/country + impossible-travel alerts.

---

## 2026-09-03 — Extension in payout, itemized payout receipt, admin exception alerts

Follow-up to the lister email work. Four related gaps around trip
extensions and payout visibility:

- **Lister extension email.** A paid trip extension only pinged the
  lister in-app. Added the `lister-extension:<id>` email (same
  "SafeDrive holds it, released after completion in one payout"
  wording as the other payment emails).
- **Fuel top-up now reaches the lister.** An extension's
  `fuel_top_up_amount` was charged to the renter and added to
  `total_price` but never to `base_price`, so it was stranded in the
  clearing account and never paid out. `payoutAutomation` now adds the
  sum of paid-extension fuel top-ups on top of `base_price`, the same
  way approved deposit claims are added.
- **Correct ledger split for extension payments.** The extension
  webhook recorded the payment *before* bumping the booking totals, so
  `postCompletedPaymentToLedger` allocated the extension amount by the
  stale booking-wide ratio (smearing the fuel reimbursement across
  commission and fees). Reordered: mark extension paid (idempotency
  gate) -> bump booking -> record payment with an explicit
  `allocationOverride` (rental + fuel -> lister payable, commission ->
  deferred fee).
- **Itemized payout receipt.** `sendPayoutReceiptEmail` was one line
  ("Amount released"). Now it breaks out base rental (day count),
  trip extension (day count), fuel/charge reimbursement, approved
  deposit claim, total released, masked destination, and a one-line
  renter-payment timeline with dates. Notes the retained commission.
- **Admin exception alerts.** New `sendAdminAlertEmail(supabase, ...)`
  emails every admin/super-admin, but only on money-movement
  exceptions: failed auto payout (`payoutAutomation` x2 +
  `bookingCompletion` catch), refund needing manual review
  (`refundAutomation` x3), critical reconciliation mismatch
  (`run-reconciliation`). Routine success stays in-app only.

- Files: `api/webhooks/paymongo.ts`, `api/lib/ledger.ts`,
  `api/lib/payoutAutomation.ts`, `api/lib/refundAutomation.ts`,
  `api/lib/bookingCompletion.ts`, `api/run-reconciliation.ts`,
  `api/lib/email.ts`, `scripts/booking-flow-smoke-check.mjs`,
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.
- No migration. No schema change.

---

## 2026-09-03 — Super-admin-editable platform contact email

- The public contact address (`admin.no.reply.360@gmail.com`) was
  hardcoded in the Terms of Service, Privacy Policy, sign-up notice, and
  the sign-in / password-reset MFA help text - changing it meant a code
  edit and redeploy.
- Added `platform_settings.contact_email` plus `get_platform_contact_email()`
  (anon + authenticated, live read) and `set_platform_contact_email(text)`
  (super-admin only, email-shape validated, audited as
  `platform_contact_email_updated`). It is contact info, not a money or
  policy value, so it is a direct edit - no consensus proposal/vote.
- New `usePlatformContactEmail()` hook + `fetchPlatformContactEmail()` in
  `src/lib/platformSettings.ts`; `TermsPage`, `PrivacyPolicyPage`,
  `SignUpPage`, `LoginPage`, `UpdatePasswordPage` now render it live with
  a fallback to the seeded default. `/admin/platform-settings` gains a
  "Platform contact email" card (super admins edit, others view).
- Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`,
  `src/lib/platformSettings.ts`, `src/types/database.ts`,
  `src/pages/TermsPage.tsx`, `src/pages/PrivacyPolicyPage.tsx`,
  `src/pages/SignUpPage.tsx`, `src/pages/LoginPage.tsx`,
  `src/pages/UpdatePasswordPage.tsx`,
  `src/pages/admin/AdminPlatformSettingsPage.tsx`,
  `src/pages/admin/AdminAuditTrailPage.tsx`,
  `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`,
  `scripts/booking-flow-smoke-check.mjs`.
- Follow-up: apply `phase8_contact_email.sql` in the Supabase SQL editor.

---

## 2026-09-03 — Lister Bookings: compact card + detail modal

- `ListerBookingsPage` matched the old renter page: every booking was a
  full card with the whole 2-column detail body (renter info, dates,
  payout, next step, arrival, completion, deposit, ratings) laid out,
  taking huge vertical space.
- Now each booking is a compact summary card (car, plate, status, renter,
  dates, price, "View details"); clicking it opens a portal modal
  (Esc / backdrop / X to close) with the full detail body moved in
  verbatim - the 2-column grid becomes a single stack and right-aligned
  bits flip left via scoped variants, same as the renter modal.
- No handler, state, condition, or data logic changed - the entire
  action body is the same JSX, only relocated and re-wrapped. `rejecting`
  / rating / renter-info modals bumped above the new modal's z-index.

---

## 2026-09-03 — Lister email notifications for the booking lifecycle

- The lister only got an email on cancellation (and accept/decline, which
  actually go to the renter). Added `sendUserNotificationEmail` to the
  lister for:
  - **New booking request** (`api/create-booking.ts`) - "accept or
    decline within 24 hours".
  - **Downpayment / balance / full payment confirmed** (three
    `api/webhooks/paymongo.ts` paths) - each says SafeDrive holds the
    payment and releases the lister's share (rental minus commission)
    after the trip completes, so it is no longer just "the renter paid".
  - **Trip completed** (`api/lib/bookingCompletion.ts`) - payout is
    processing, receipt follows.
- All keyed with an idempotency key; the in-app notification is unchanged.

---

## 2026-09-03 — Threaded user inquiries (Phase 7)

- Inquiries are now a conversation with history, not a one-shot email -
  while staying separate from Support Tickets (which carry a reference
  number and signal "an issue to fix"). Panel's model.
- New `guest_inquiry_messages` table (thread) + `guest_inquiries.submitted_by_user_id`.
  Message minimum lowered 10 -> 5 chars.
- **Signed-in submitter** (`/contact` sends a bearer token): the inquiry
  links to the account, seeds a first thread message, and shows in a new
  **`/inquiries`** page (`InquiriesPage`) - read replies, post follow-ups.
  Follow-up = `api/inquiry-followup.ts` (RLS-guarded insert + re-open +
  admin notify). "My Inquiries" added to the account dropdown.
- **Guest** (no token): unchanged one-email exchange.
- `api/reply-guest-inquiry.ts`: `action: reply` adds a thread message +
  emails (idempotency now per-message) + `in_progress` (no longer
  auto-resolves) + notifies a linked account; `action: resolve` closes it.
- `AdminGuestInquiriesPage`: inline conversation view, "Reply" + "Mark
  resolved" buttons, "Account holder - threaded" vs "Guest - email only"
  badge.
- **Migration:** `guest_inquiry_messages` + `submitted_by_user_id` + RLS +
  message CHECK 5-3000 + backfill from existing intake/reply, from the
  master SQL.

---

## 2026-09-03 — User Inquiries: drop the standalone "Start review" step

- The "Start review" button was optional (you could reply from `open`
  too) but looked required. Removed it. Opening the reply box now
  silently claims the inquiry (`open -> in_progress`, assigned admin,
  timestamp) so the queue still shows who is on it; the reply endpoint's
  resolved-check remains the real double-answer guard.
- The reply action is now "Reply & close" / "Send & close" and the modal
  says it sends one email and closes the inquiry. `AdminGuestInquiriesPage`
  only. Master doc updated.

---

## 2026-09-03 — "Support Cases" -> "Support Tickets"; "Guest Inquiries" -> "User Inquiries"

- The admin sidebar called the ticket system "Support Cases" while the
  user side calls it "Support Ticket" - the same `support_tickets` table.
  Renamed the sidebar to **Support Tickets** so it's clearly one thing.
- "Guest Inquiries" implied the sender has no account, but the public
  contact form is open to anyone and account holders use it too. Renamed
  the admin page, nav, dashboard card, attention feed, audit labels, and
  the privacy-policy line to **User Inquiries** / "contact inquiry".
- Display strings only - routes (`/admin/support`, `/admin/guest-inquiries`),
  the `guest_inquiries` table, and audit action keys are unchanged.
- Master doc section 5 + route table + SYSTEM_FLOWS updated. Behaviour
  (auto-routing logged-in users to tickets, "convert to ticket", removing
  the standalone "Start review") is a separate follow-up.

---

## 2026-09-03 — Vehicle Availability is a calendar now

- `VehicleAvailabilityPage` replaced the start/end date inputs + "Reason
  type" dropdown + "Reason" text field with a **month calendar**
  (react-day-picker). Booked dates render red and disabled; already
  blocked dates amber and disabled; the lister taps a free range and hits
  "Block selected dates".
- No reason/category is asked. `vehicle_unavailability.reason` /
  `category` are NOT NULL, so inserts write fixed values
  ("Blocked by owner" / "other") - no migration.
- The page also loads the car's own bookings (owner RLS) so conflicts are
  visible up front instead of only failing on the DB trigger after submit.
- Files: `src/pages/VehicleAvailabilityPage.tsx`, master doc,
  SYSTEM_FLOWS.

---

## 2026-09-03 — Demo money-movement mode for refunds + deposit releases (Phase 6)

- The payout flow already simulated cleanly in demo mode; refunds and
  security-deposit releases still called PayMongo test refunds, which are
  unreliable in test mode (they mostly fail).
- New shared gate `api/lib/paymongoMode.ts` `isDemoMoneyMovementEnabled`
  (the existing `PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION` flag + test
  key). When on:
  - `refundAutomation.ts`: cancellation refunds record a completed
    `refund` payment (`sandbox_refund_*`), post the reversal ledger
    journal, notify, and send the refund receipt - no PayMongo call.
  - `securityDeposit.ts` `runSecurityDepositRelease`: the refundable
    portion finalizes with a `sandbox_deposit_refund_*` reference and no
    PayMongo call, so the lister "Confirm return - no issues" button and
    the 24h auto-release work on a synthetic deposit.
- `payoutAutomation.ts` now imports the shared `isPayMongoTestKey`
  instead of a local copy. `check-local-env` warning reworded.
- No migration. Files: `api/lib/paymongoMode.ts` (new),
  `api/lib/refundAutomation.ts`, `api/lib/securityDeposit.ts`,
  `api/lib/payoutAutomation.ts`, `scripts/check-local-env.mjs`, master
  doc, smoke-check markers.

---

## 2026-09-03 — Asymmetric evidence + handover handshake (Phase 5)

- **Handover confirmation is now a two-tap handshake.** The lister files
  the pickup report and confirms "Handover complete - renter has the
  car"; the renter then taps a single "Confirm - I have the car". Both
  marks are still recorded (booking goes `active` on both), but the
  renter no longer needs their own pickup report to check in.
- **Asymmetric photo requirement** (`api/submit-trip-condition-report.ts`,
  `api/booking-action.ts`):
  - Pickup: **lister** report required (4 photos), renter optional.
  - Return: **renter** report required (4 photos), lister optional.
  - The `complete` action checks the caller's required-phase report only;
    the `arrive` action requires the pickup report from the lister only.
- **Deposit claim** now needs the lister's own complete pickup **and**
  return reports (`api/security-deposit-action.ts` `submit_claim`) - the
  return report is optional for the lister generally but mandatory to
  claim, so "skip evidence, then claim on nothing" stays closed.
- `TripConditionReportPage` shows whether the report is required or
  optional for the current user, and only offers the waiver on a required
  report. File inputs already dropped forced-camera in Phase 4.
- No migration (reuses Phase 4's `evidence_waived`; Phase 4 migration is a
  prerequisite). Files: the four above + `src/pages/MyBookingsPage.tsx`,
  `src/pages/ListerBookingsPage.tsx`, master doc, smoke-check markers.

---

## 2026-09-03 — Lighter trip condition reports (Phase 4)

- Required photos per report cut from **7 to 4** (front, back, odometer,
  fuel/battery gauge). Left / right / interior are now optional. File
  inputs no longer force the live camera, so a gallery photo works.
- The typed **odometer and fuel/battery readings are optional** (the
  odometer + fuel photos carry the evidence). `trip_condition_reports`
  `odometer_reading` / `fuel_or_battery_level` are now nullable; the
  return >= pickup odometer check only runs when both are present.
- New **"submit without photos" waiver** (`trip_condition_reports.evidence_waived`):
  a report with an incomplete photo set can still be submitted so the
  trip is never stuck, but it is flagged in the audit log and a **deposit
  claim cannot be filed on a waived or incomplete return report**
  (`security-deposit-action.ts` `submit_claim`) - keeps the anti-fake-damage
  guarantee. `booking-action.ts` `hasRequiredTripPhotos` treats a waived
  report as satisfying the gate.
- Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`,
  `api/submit-trip-condition-report.ts`, `api/booking-action.ts`,
  `api/security-deposit-action.ts`, `src/pages/TripConditionReportPage.tsx`,
  `src/types/database.ts`, master doc, smoke-check markers.
- **Migration:** `alter column ... drop not null` on the two reading
  columns + `add column evidence_waived` (from the master SQL).

---

## 2026-09-03 — Payout visibility + payment "confirming" copy (Phase 3)

- Every successful lister payout now notifies **all admins** (previously
  only failures did) and its audit entry records `released_by`
  `automatic` vs `admin`. A completion-triggered payout always logs as
  automatic (`api/lib/bookingCompletion.ts` passes a null initiator).
- `AdminPayoutsPage`: new "Released via" column (Auto - demo / Auto -
  PayMongo / Released) in the Statistics table, and the overview card now
  states that most payouts auto-release on completion and the queue is
  only for the ones needing a manual nudge.
- `PaymentSuccessPage`: reworded to "Payment received - confirming..." and
  the confirmed state now tells the renter their receipt email has been
  sent and may take a few minutes. No second email is added - the single
  post-webhook receipt stays the confirmation.
- Files: `api/lib/payoutAutomation.ts`, `api/lib/bookingCompletion.ts`,
  `src/pages/admin/AdminPayoutsPage.tsx`, `src/pages/PaymentSuccessPage.tsx`,
  smoke-check markers. No migration.

---

## 2026-09-03 — Return / deposit flow: lister waiver + auto-release + auto-complete (Phase 2)

- **Lister "Confirm return - no issues"** (`security-deposit-action.ts`
  `lister_confirm_return`): during the deposit review window the lister can
  release the renter's deposit immediately instead of waiting out the timer.
  Once confirmed - or once the window closes - the lister can no longer file a
  claim, so a lister cannot wait for the renter to leave and then raise a fake
  claim. Surfaced on `ListerBookingsPage` with a "File a claim" alternative.
- **Deposit auto-release:** `api/expire-booking-deadlines.ts` now releases the
  full deposit to the renter once `deposit_claim_window_hours` (default 24, was a
  hard-coded 48) elapses with no claim filed.
- **Lister-absent auto-completion:** the same job auto-completes the lister's
  side `lister_completion_timeout_hours` (default 18) after the renter completes,
  so an unreachable lister can't hold the renter or the deposit. Needs new
  `bookings.renter_completed_at` / `owner_completed_at` columns, set by
  `api/booking-action.ts` on completion.
- Shared paths extracted: `api/lib/bookingCompletion.ts`
  (`runBookingCompletionSideEffects` - commission journal + deposit review +
  payout) and `api/lib/securityDeposit.ts` `runSecurityDepositRelease` (PayMongo
  refund + finalize), now used by `booking-action.ts`,
  `process-security-deposit-release.ts`, `security-deposit-action.ts`, and the
  expiry job.
- **Migration:** add `bookings.renter_completed_at` / `owner_completed_at`
  (+ a best-effort backfill) from the master SQL. Point an external scheduler at
  `GET /api/expire-booking-deadlines` (~15 min) for the auto transitions to fire.

---

## 2026-09-03 — Trip lifecycle time gates + 3 new configurable timings (Phase 1)

- The arrival check-in and "Finish Trip" buttons had no clock gate, so a
  Sept-4 booking could be arrived, finished, and completed on Sept 3.
  - `api/booking-action.ts` now rejects `arrive` before
    `arrival_checkin_lead_hours` (default 3 h) ahead of the scheduled pickup,
    and rejects `complete` before the pickup datetime.
  - `MyBookingsPage` / `ListerBookingsPage` show "check-in opens ..." /
    "finish once it starts ..." notes instead of the buttons until the gate
    opens; both fetch the lead-hours value live.
- Three lifecycle timings are now consensus-configurable in
  `platform_settings` (`/admin/platform-settings`): `arrival_checkin_lead_hours`
  (0-48), `deposit_claim_window_hours` (1-168), `lister_completion_timeout_hours`
  (1-72). Read **live**, never snapshotted per booking. Only the first is wired
  in this phase; the other two are consumed in Phase 2 (return/deposit flow).
- Files: `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` (columns, checks,
  `validate_platform_setting_change` keys), `src/types/database.ts`,
  `src/lib/platformSettings.ts` (`fetchPlatformPolicyTimings`),
  `src/pages/admin/AdminPlatformSettingsPage.tsx`, `api/booking-action.ts`,
  `src/pages/MyBookingsPage.tsx`, `src/pages/ListerBookingsPage.tsx`, master doc,
  smoke-check markers.
- **Migration:** apply the new `platform_settings` columns/constraints and the
  updated `validate_platform_setting_change` function from the master SQL.

---

## 2026-09-02 — Payouts are in-app only; payout receipt shows the destination

- Removed the out-of-app manual payout path. The Admin > Payouts screen had a
  "Manual Paid" flow where a super admin sent money by hand (GCash/Maya) and
  typed back a reference - unverifiable and outside any system control. Deleted
  `api/mark-manual-payout.ts` and the button/modal/state/handlers in
  `AdminPayoutsPage`. `Auto Payout` (`/api/process-payout`) is now the only
  release path. README / SYSTEM_FLOWS / master doc API table / historical spec /
  smoke-check markers updated.
- Demo `Auto Payout` now also posts the double-entry ledger journal
  (`2010 -> 1010`, event key `payout:<txn>`) like the real PayMongo and former
  manual paths. Before this, demo payouts left the ledger unbalanced and tripped
  the reconciliation `completed_payment_missing_ledger_journal` check.
- Payout receipt email + lister notification now show the destination from the
  lister's saved Payout Details: `<Account Name> - <Method> ****<last4>` (account
  number masked to the last 4; full number never leaves in an email). Falls back
  to just the method when no account number is on file. Files:
  `api/lib/email.ts`, `api/lib/payoutAutomation.ts`.

---

## 2026-09-02 — Auto Payout button works in demo mode on the deployed site

- The "Auto Payout" button in Admin > Payouts already existed but only the
  localhost sandbox simulator could complete it without real PayMongo Money
  Movement. Removed the `isLocalDevelopmentOrigin` restriction from
  `payoutAutomation.ts` - `PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION=true` +
  a `sk_test_` key (a live key still auto-disables it) now lets the button
  record the lister's earnings (`base_price`, net of SafeDrive commission),
  post the ledger journal, and send the receipt email + notification with no
  real transfer. Flag set in Vercel + `.env`; copy in README / master doc /
  check-local-env updated; smoke-check markers updated.

---

## 2026-09-02 — Subscription: "Cancel" keeps perks until the end date

- The "Switch to Free now" action did an immediate downgrade (forfeiting the
  paid days) - pointless for a plan that never auto-renews. Replaced with a
  proper "Cancel Subscription":
  - `subscriptions.cancelled_at` column; `api/cancel-subscription.ts` now only
    stamps `cancelled_at` and leaves `status`/`end_date` alone (and no longer
    deactivates any listings). Perks stay until `end_date`, when the existing
    lazy expiry flips it to `expired` and the slot-limit trigger pauses any
    over-limit cars.
  - `SubscriptionPlansPage`: button relabelled, confirm dialog reworded (no
    longer destructive), and once cancelled the current-plan card shows
    "Cancelled · active until <date>" with the header explaining it reverts to
    Free with no further charge.
  - `getCurrentSubscription` + `Subscription`/`database.ts` types carry
    `cancelled_at`.

---

## 2026-09-02 — Phase C: super-admin consensus for platform configuration

- `platform_settings` changes now go through a proposal + vote flow instead of a
  direct super-admin write:
  - `platform_setting_change_requests` + `platform_setting_change_votes` tables
    (super-admin read RLS; writes only through the functions below).
  - `propose_platform_setting_change(jsonb, text)` - validates keys/ranges,
    enforces one pending proposal at a time, records the proposer's approve vote,
    snapshots the current values.
  - `vote_platform_setting_change(uuid, text)` - approve/reject (changeable);
    re-tallies on every vote. Threshold = `ceil(2N/3)` of the current
    super-admin count (N=3 -> 2, N=4 -> 3, N=1 -> 1). Reaching it applies the
    change to `platform_settings`; becoming unreachable rejects it; 7-day expiry.
  - `cancel_platform_setting_change(uuid)` - proposer withdraws.
  - Every step writes an `audit_log` row.
- `AdminPlatformSettingsPage` rebuilt: active configuration (all 6 money/policy
  fields), a propose form (sends only the changed keys), a pending-proposal card
  with the diff, live tally and approve/reject/withdraw, and a recent-decisions
  list. Types added to `database.ts`.
- FOLLOW-UP: drop the old `"Super admins can manage platform settings"` ALL
  policy on `platform_settings` so raw writes can't bypass consensus (added to
  the master SQL; run in SQL editor / via the setup token).

---

## 2026-09-02 — Phase B: tiered cancellation-refund policy (measured from pickup)

- Cancellation refunds now key off hours **before pickup** (from the booking's
  snapshot, default 24), not hours since payment:
  - unpaid → free;
  - paid & >= threshold before pickup → automatic full refund (unchanged path);
  - paid & inside the window → cancellation still goes through, but the refund is
    a policy-recommended partial (`refund_late_renter_percent`, default 50%) with
    the remainder recorded as short-notice lister compensation, released via
    admin review (`createManualRefundReview` now carries the recommended amount
    and reasoning; `AdminRefundReviewPage` shows the note);
  - paid & past pickup → support review, recommended 0.
- `api/booking-action.ts`: new `getCancellationRefundPlan` / `getBookingPickupMs`;
  removed the `REFUND_GRACE_PERIOD_MS` 24-h-from-payment gate.
- `MyBookingsPage` cancellation guidance + confirm dialog now show the estimated
  refund for a short-notice cancel. Terms 6.1/6.2, Platform Agreement, and the
  help centre updated to the tiered wording. Smoke-check markers updated.

---

## 2026-09-02 — My Bookings: cancellation copy matches the real 24h rule

- `getCancellationGuidance` / `getCancellationCutoff` in `MyBookingsPage.tsx`
  described a "cancel for free 3 days before pickup" cutoff that the code never
  enforced (and that contradicts Terms 6.1/6.2 and `booking-action.ts`, which
  use a 24-hour-after-payment automatic-refund window). It also only showed for
  pending requests.
  - Rewrote the guidance around the actual states: unpaid = free to cancel any
    time before paying; paid & within 24h of payment = automatic full refund
    (with a live countdown); paid & past 24h = still cancellable pre-trip but
    the refund goes through support review, no automatic penalty.
  - Now shown for every cancellable booking, tinted green/amber, and the cancel
    confirm dialog uses the same wording. Removed `getCancellationCutoff`.
  - Terms and Platform Agreement pages were already correct; no change there.

---

## 2026-09-02 — Car detail: show owner blackout dates on the booking calendar

- The renter booking calendar only fetched `bookings`, so owner
  maintenance / personal-use blackouts (`vehicle_unavailability`) showed as
  selectable and the request failed only afterwards on the
  `prevent_booking_blackout_conflict` DB trigger.
  - New `get_car_blackout_ranges(uuid)` SECURITY DEFINER function returns a
    listed car's blackout date ranges + category (never the free-text reason);
    granted to `anon`/`authenticated`. Added to the master SQL next to the
    blackout triggers.
  - `src/pages/CarDetailPage.tsx` fetches it, disables those days, styles them
    amber + strikethrough with a new "Amber dates" legend entry, and
    `isDateOverlapping` (so the request button + messages) now covers blackouts.
  - Added `get_car_blackout_ranges` to `src/types/database.ts`.
- Also removed the last stale "3-day" copy: the "3-day booking process" note and
  a "3-to-30-day booking window" line, both contradicting the same page's "as
  early as tomorrow" and the actual validation (`minDate` = tomorrow,
  `create-booking.ts` `minStart = today + 1 day`, deadlines capped at pickup,
  auto-cancel via `expire-booking-deadlines`). No booking-logic change - the
  next-day rule was already implemented per master doc K.2.

---

## 2026-09-02 — My Bookings (renter): compact cards + Active/History split

- `src/pages/MyBookingsPage.tsx` — each booking rendered as one very tall card
  with every detail (next step, return status, trip progress, extension, all
  action buttons, photo capture) inline, and active + finished bookings shared
  one paginated list.
  - The Bookings tab now has an **Active | History** sub-toggle (with counts);
    each view is its own paginated list with its own empty state. `expired`
    joined completed/cancelled/rejected as a history status.
  - Each row is now a **compact summary card** (car, plate, status, dates,
    total, one-line next step, "View details ›"). Clicking it opens a **modal**
    (`createPortal`, Esc / backdrop / × to close) containing the full,
    unchanged detail body and all actions - so the list stays short and other
    rows don't get pushed down.

---

## 2026-09-02 — Authenticator (MFA) recovery

- If a lister/admin removed the account from their authenticator app there was
  no way to enrol a new one - every sign-in fell back to "Use Email Code
  Instead" forever. Added two recovery paths:
  - **Self-service**: `api/reset-my-authenticator.ts` clears the caller's own
    factor(s). After an email-code sign-in with a stale factor still attached,
    `LoginPage` / `AdminLoginPage` now offer "Set up a new authenticator?" - on
    confirm it calls the endpoint then walks the user through a fresh QR using
    the existing enrolment UI. No security downgrade: email-code sign-in already
    bypasses the authenticator.
  - **Admin-assisted**: `api/admin-reset-authenticator.ts` (super-admin only,
    standard-user targets, mirrors admin-reset-password) plus a "Reset
    Authenticator (MFA)" action with a confirm dialog on the Admin > Users
    review panel.
- Both use `supabase.auth.admin.mfa.listFactors` / `deleteFactor`, write an
  audit_log row (`user_mfa_reset` / `admin_reset_user_mfa`), and are documented
  in the master doc API table.

---

## 2026-09-02 — Subscription slot-limit enforcement

- Previously a lister could subscribe to Pro (10 slots), list 10 cars, cancel,
  and keep all 10 live on Free. Now:
  - `deactivate_cars_over_slot_limit(uuid)` DB function pauses the newest
    listings beyond the plan allowance (base 5 + active subscription slots),
    keeping the oldest.
  - `subscription_expiry_slot_enforce` trigger runs it on lazy expiry
    (status active -> expired). The upgrade webhook uses 'cancelled', not
    'expired', so mid-upgrade housekeeping is unaffected.
  - `api/cancel-subscription.ts` calls the function via RPC on the explicit
    "Switch to Free now" cancel and returns `deactivatedListings`.
  - `enforce_live_car_limit` trigger + a client guard in
    `MyVehiclesPage.handleToggleVehicleLiveStatus` block reactivating an
    inactive listing past the allowance.
- All three DB objects added to `SAFE_DRIVE_DATABASE_MASTER.sql` Chapter 14 and
  the trigger names to the Chapter 16 verification list.

---

## 2026-09-02 — Subscription: cancel on the right card + clearer copy

- `src/pages/SubscriptionPlansPage.tsx` — the "Cancel Subscription" action sat
  on the **Free** card (dev framed it as "downgrade to Free"), so a subscribed
  user saw no cancel option on their own plan and worried about surprise
  charges. Now:
  - the current paid plan card ("Your Plan") shows a "Switch to Free now" action
    under "Current Plan";
  - the Free card, while subscribed, is a disabled "Applies automatically when
    your plan ends" - no action;
  - a confirm dialog spells out that it is paid through the end date, no refund
    for remaining days, and current listings are kept;
  - header copy states plainly: one-time 30-day payment, no auto-renewal,
    reverts to Free automatically.
  `handleUpgrade` no longer carries the cancel branch; new `handleCancelSubscription`.

---

## 2026-09-02 — My Vehicles: remove filter/sort controls

- `src/pages/MyVehiclesPage.tsx` — dropped the Status filter and the 5-option
  Sort dropdown. This page is for adding vehicles and tracking their approval,
  not browsing a marketplace, and with a 5-15 slot cap the controls added
  clutter (and an orphaned filter bar under the open add-vehicle form). The
  list now uses one fixed order: live (approved/active) first, then pending,
  then rejected/inactive; newest-first within each group. Status stays visible
  as the per-card badge. `created_at` added to the row type for the ordering.

---

## 2026-09-02 — My Vehicles: hide list while adding

- `src/pages/MyVehiclesPage.tsx` — the vehicle list rendered independently of
  the add-vehicle form, leaving the (now removed) filter bar floating below an
  open form. List is wrapped in `!showForm`.

---

## 2026-09-02 — Login QR, admin banner, vehicle-form validation

- `src/lib/qrCode.ts` (new) — Supabase returns the enrolled TOTP QR as an SVG
  that begins with an `<?xml ?>` prolog, so `LoginPage`/`AdminLoginPage`'s old
  `qrCodeSrc` `startsWith("<svg")` check missed it and the raw XML string went
  to `<img src>` (broken/blurry). New helper strips the prolog, injects a
  `viewBox` + `shape-rendering="crispEdges"`, returns a proper data URI. Both
  pages import it; QR box enlarged, pixelate-scaled.
- `src/pages/admin/AdminLoginPage.tsx` — the "Access Denied" clearance banner
  rendered whenever `profile.role !== "admin"`, so a `super_admin` briefly saw
  it during the post-auth redirect. Now also allows `super_admin`.
- `src/lib/vehicleValidation.ts` (new) + `src/pages/MyVehiclesPage.tsx` — the
  listing form only had native `<input pattern>`/`min`, so a malformed plate
  (`ABC12345`) or an under-500 price could reach admin review. `validatePlateNumber`
  / `validateListingPrice` now run in the create and edit submit handlers with
  live inline error text, independent of native constraint validation.
- **Migration applied:** `cars_plate_number_format` CHECK
  (`plate_number ~ '^[A-Z]{3}[ -]?[0-9]{3,4}$'`) added to `public.cars` and to
  `SAFE_DRIVE_DATABASE_MASTER.sql` Chapter 14 + the Chapter 16 verification list.
  All existing rows conform.

---

## 2026-08-31 — Receipts

- New `src/lib/receiptPdf.ts` — one branded A4 receipt renderer for renter
  payment, renter refund, and lister payout. `loadJsPDF()` resolves the jsPDF
  constructor defensively (its ESM export shape has shifted, which could make a
  download click silently do nothing). `savePdf()` tries `pdf.save()` then falls
  back to an explicit object-URL `<a download>` for strict-CSP / webview cases.
- `src/pages/MyBookingsPage.tsx` — `downloadPaymentAcknowledgment` now uses the
  shared renderer and **branches on refunds**: a `payment_type = 'refund'` row
  produces a proper "Refund Receipt" (positive amount, "Amount refunded", refund
  notice, `SD-RF-` number) instead of a negative "Payment Acknowledgment". The
  list button relabels to "Download Refund Receipt" for those rows. Invalid
  dates no longer throw.
- `src/pages/ListerBookingsPage.tsx` — `downloadPayoutReceipt` uses the shared
  renderer; consistent layout with the other two.
- Real error messages now surface in the toast instead of a generic "try again".

**Not fixed by code — Resend receipt emails:** `sendPaymentReceiptEmail` /
`sendRefundReceiptEmail` / `sendPayoutReceiptEmail` are wired into the webhook
and the payout/refund helpers, but they return `not_configured` and send nothing
unless `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set in the Vercel
environment. The Resend sending domain is verified; the server env vars still
need to be added there (then redeploy). Check Resend → Logs for per-send errors.

---

## 2026-08-31 — Doc consistency pass

- `Chapter 15` → `Chapter 16` for every "read-only verification" reference
  (README, master doc ×13, `plans/todo.md`, `plans/implementation-plan.md`,
  `scripts/verify-live-supabase.mjs`, `AdminRoute.tsx`, `UserRoute.tsx`). The
  verification chapter had been renumbered when "authenticated service fallbacks"
  became Chapter 15, but the prose was never updated.
- `docs/system-process.md`: Resend is the primary email path (not Gmail);
  next-day booking + deadline-cap + auto-cancel described in §4.
- Master doc: status date → 31 Aug; added a "Recent" summary block and an
  Appendix I update (file/line counts, build type-checks api/, CI workflow).
- New `project_docs/SYSTEM_FLOWS.md` — end-to-end "what calls what and what it
  checks" reference, guest → payout/refund, derived from the code.
- `plans/todo.md`: added a Chapter 17 apply checkbox.

---

## 2026-08-31 — CI lint fix

- `.github/workflows/ci.yml`: dropped `check:api-boundaries` (spawns a server;
  flaky in CI). `eslint.config.js`: split the `files` glob and added the
  standard `^_` ignore patterns to `@typescript-eslint/no-unused-vars`.
  `api/lib/supabaseTypes.ts`: `eslint-disable` on the intentional permissive
  `any`. `package.json`: `lint` script uses explicit globs (`eslint .` did not
  traverse `src/`/`api/` under ESLint 9 flat config on every platform). 6
  pre-existing lint errors fixed (all intentional, just not configured).

---

## 2026-08-31 — Booking lead time: next-day allowed

**Why.** Team instruction (Moises Bien, relayed by the project owner): a car left
idle is wasted, so a trip should be bookable as soon as the next day instead of
requiring 3 days' notice. The existing 24h + 24h process windows stay, and an
unpaid request auto-cancels before pickup so the car is not held.

**What changed.**
- `api/create-booking.ts` — minimum trip start lowered from `today + 3 days` to
  `today + 1 day` (same-day still blocked). The `owner_response_deadline` is now
  `min(now + 24h, pickup time)`.
- `api/booking-action.ts` — on lister accept, `payment_deadline` is now
  `min(now + 24h, pickup time)`. Added `pickup_time` to the booking select.
- `src/pages/CarDetailPage.tsx` — date-picker minimum and validation lowered to
  tomorrow; error and "availability guide" copy updated.
- `src/pages/MyBookingsPage.tsx` — "Booking process reminder" copy updated;
  `getCancellationGuidance` no longer shows a "window closed" warning for
  short-lead bookings.
- `src/pages/TermsPage.tsx`, `src/pages/PlatformAgreementPage.tsx` — lead-time
  clauses rewritten (removed the 72-hour minimum).
- `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` — Appendix K.1 row 5, K.2,
  K.11, K.12 updated. `README.md` "Current Booking Flow Notes" updated.

**Behavioural note.** For a booking made a few hours before the trip, the accept
and pay deadlines can be much shorter than 24h. If the flow does not complete
before pickup, `api/expire-booking-deadlines.ts` cancels the request. That cron
worker must actually be running (see the 2026-08-31 deployment-hygiene entry).

**Follow-up.** No DB migration. Run an authenticated end-to-end test of a
next-day booking on staging before relying on it in production.

---

## 2026-08-31 — Security hardening (P0) — NOT YET APPLIED TO LIVE DB

**Why.** Audit of the deployed app found live exposures: any logged-in user can
write to `public.payments` and `public.notifications`; `decrypt_pii` has no
permission check and is reachable by booking counterparties; `encrypt_pii` falls
back to a key committed in this repo when `app.settings.encryption_key` is unset.

**What changed (in the repo — pending apply).**
- `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` — new **Chapter 17**:
  removes participant/`authenticated` write access to `public.payments`;
  adds an `is_admin()` gate inside `decrypt_pii` (the admin screens call it
  directly from the browser, so it keeps its `authenticated` grant but now
  returns NULL for non-admins); `encrypt_pii` raises instead of using the
  committed fallback key; `encrypt_pii` / `handle_pii_encryption` revoked from
  `anon` / `authenticated`, `decrypt_pii` revoked from `anon`.

**Follow-up (blocking).**
1. `pg_dump` the live database first (Free tier has no backups).
2. Confirm `app.settings.encryption_key` is set on the live project; if not,
   existing `pgp:%` KYC rows need a re-key migration before Chapter 17.2 applies.
3. Apply Chapter 17 on staging, then production. Re-run Chapter 16 verification
   and `npm run check:live-roles`.
- Still open: `notifications` self-only RLS (needs cross-user inserts moved
  server-side), `audit_log` forgeable INSERT.

---

## 2026-08-31 — Deployment & build hygiene

**Why.** `api/**` was never type-checked by the build; no CI; the cron workers
(`expire-booking-deadlines`, `send-return-reminders`) had no scheduler so they
never ran on the live deployment.

**What changed.**
- `package.json` — `build` now runs `npm run check:api` between `tsc -b` and
  `vite build`.
- `.github/workflows/ci.yml` — new: lint, `check:api`, static/logic tests,
  alignment, api-boundary smoke, and build on push/PR to `main`.
- Cron scheduling: `vercel.json` `crons` was tried but Vercel Hobby only allows
  once-a-day schedules and rejected the deploy, so it was removed. Added
  `.github/workflows/scheduled-workers.yml` which calls
  `/api/expire-booking-deadlines` (~15 min) and `/api/send-return-reminders`
  (~hourly) with `Authorization: Bearer CRON_SECRET`. **It needs two repo secrets
  set before it works: `CRON_SECRET` (matching Vercel) and `SITE_URL`.** Until
  those are set, the workers do not run and next-day bookings will not
  auto-cancel on their own.
- `api/process-payout.ts` — batch loop capped 50 → 10 (edge runtime time limit).
- `src/lib/supabase.ts` — throws on missing `VITE_SUPABASE_*` in a production
  build instead of using a placeholder backend.
- `scripts/repository-alignment-check.mjs` — whitelist Vite's `import.meta.env`
  built-ins (`PROD`/`DEV`/`MODE`/`SSR`/`BASE_URL`).

**Follow-up.** After deploy, confirm the Vercel cron jobs actually fire (check
the function logs after one interval).

---

## 2026-08-31 — Resend transactional email branch (cleanups)

Cleanups to the in-progress Resend migration before it is committed:
`.js` import extensions made consistent in `api/mark-manual-refund.ts`,
`api/sync-paymongo-refund.ts`, `api/webhooks/paymongo.ts`;
`RefundContext.baseOrigin` made required (`api/lib/refundAutomation.ts`);
`page()` in `api/lib/email.ts` no longer emits an empty `<table>`;
`loadReceiptRecipient` / `loadPayoutRecipient` deduped;
comment added on the `reply-guest-inquiry.ts` idempotency key.
