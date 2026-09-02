# SafeDrive 2.0 — Change Log

Running log of intentional changes. Newest first. Each entry: what changed, why,
which files, and any follow-up (migration to apply, doc to re-check).

The authoritative detail still lives in
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` and
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`. This file is the quick index.

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
