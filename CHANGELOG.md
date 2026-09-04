# SafeDrive 2.0 — Change Log

Running log of intentional changes. Newest first. Each entry: what changed, why,
which files, and any follow-up (migration to apply, doc to re-check).

The authoritative detail still lives in
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` and
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`. This file is the quick index.

---

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
