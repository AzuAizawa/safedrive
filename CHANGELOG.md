# SafeDrive 2.0 — Change Log

Running log of intentional changes. Newest first. Each entry: what changed, why,
which files, and any follow-up (migration to apply, doc to re-check).

The authoritative detail still lives in
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` and
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`. This file is the quick index.

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
