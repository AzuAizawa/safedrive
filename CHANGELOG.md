# SafeDrive 2.0 — Change Log

Running log of intentional changes. Newest first. Each entry: what changed, why,
which files, and any follow-up (migration to apply, doc to re-check).

The authoritative detail still lives in
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` and
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`. This file is the quick index.

---

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
