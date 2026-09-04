# SafeDrive 2.0 — End-to-End System Flows

Derived from the current source code (as of 31 August 2026). Where this
disagrees with the code, the code wins. For rationale, law, and evidence
requirements see `SAFE_DRIVE_MASTER_DOCUMENTATION.md`; this file is the
operational "what calls what, and what it checks" reference.

Trust rule throughout: the browser talks to Supabase directly for ordinary
RLS-guarded reads/writes, and to `/api/*` for anything privileged (pricing,
booking state, payments, cross-user actions, webhooks, cron). Every `/api`
handler re-validates the Supabase bearer token and re-checks role/ownership
server-side. Route guards in `src/components/*Route.tsx` are cosmetic.

---

## 1. Guest / visitor (no account)

- Public pages: `/`, `/contact`. Approved cars are world-readable via RLS
  (`Cars read access USING (true)`).
- User inquiry: `/contact` → `POST /api/create-guest-inquiry`. Open to anyone;
  a bearer token links the inquiry to the account (`submitted_by_user_id`) and
  seeds the first `guest_inquiry_messages` row. Validates name 2–120, email
  format, ≥1 topic, message 5–3000; rate-limits ≥5/email/hour; hashes a request
  fingerprint with `GUEST_INQUIRY_HASH_SALT`. A DB trigger notifies admins.
- Threaded inquiry (signed-in): the person reads replies and posts follow-ups at
  `/inquiries` (`InquiriesPage`). Admin reply = `POST /api/reply-guest-inquiry`
  `action: reply` (thread message + email + `in_progress`, not resolved) or
  `action: resolve` (close). Follow-up = `POST /api/inquiry-followup` (RLS lets
  the owner insert an `inquirer` message; the route re-opens the inquiry and
  notifies admins). Guests with no account stay a one-email exchange.

## 2. Registration & auth

- `/signup` → `supabase.auth.signUp` with email confirmation. On first
  authenticated load `AuthContext.fetchProfile` auto-creates the `profiles` row
  (`role: user`, `verified_status: unverified`).
- Login: password / email OTP / TOTP MFA. Admin uses a separate portal
  (`/admin/login`) with a `sessionStorage` marker + pending-second-factor gate.
  10-minute idle auto-logout. Auth events → `POST /api/record-security-event` →
  `security_logs`.

## 3. Identity verification (KYC)

- `/verify`: full name, driver's-license number, birthdate (≥18), PH phone
  (`/^(09|\+639)\d{9}$/`), address, 6 photos (each ≤2 MB, uploaded in parallel to
  a private bucket). Client Tesseract OCR (`kycOcr.ts`) flags name/number
  mismatches for the admin; never auto-rejects.
- On write, trigger `on_pii_encrypt` → `handle_pii_encryption()` →
  `encrypt_pii()` encrypts `driver_license` / `national_id` at rest
  (`pgp:<base64>`, pgcrypto, key from the `app.settings.encryption_key` DB
  setting). `verified_status`: `unverified` → `pending`. Triggers notify admins
  and log `verification_submitted`.
- Admin review (`/admin/users`): decrypts via `supabase.rpc('decrypt_pii', ...)`
  (gated on `is_admin()`), sets `verified` / `rejected` (+ reason). Then
  `POST /api/send-verification-decision-email` re-checks status and emails the
  user via Resend; delivery state is audit-logged.
- Only `verified` users can book or list.

## 4. Vehicle listing (lister)

- `/my-vehicles`: vehicle + registration + CTPL/insurer details + policy dates +
  comprehensive-cover declaration + rental-use confirmation + photos + private
  documents + pickup location + price/day. Uploads
  the vehicle-specific rental agreement PDF → `car_agreement_versions` (numbered
  version, storage path, SHA-256, status `pending`). Car → `pending`; trigger
  notifies admins.
- Admin approval (`/admin/vehicle-approval`): approves/rejects with reason.
  Trigger `approve_latest_car_agreement_with_vehicle` approves the pending
  agreement alongside the car; `enforce_vehicle_insurance_approval` blocks
  approval without required insurance fields.
  `POST /api/send-vehicle-decision-email` emails the lister (re-checks status).
- Re-approval: trigger `return_materially_changed_car_to_review` drops the car
  back to `pending` on a material edit (price, ownership, insurance,
  location, agreement). The prior approved agreement version is preserved and
  superseded.
- Extra vehicle slots: `/subscriptions` → `POST /api/create-subscription-checkout`
  (Pro ₱199 +5, Premium ₱299 +10 via PayMongo). `POST /api/cancel-subscription`.

## 5. Availability / maintenance

- `/vehicle-availability`: a month calendar (react-day-picker). Booked dates
  show red (disabled), already-blocked dates amber (disabled); the lister taps a
  free range and blocks it → `vehicle_unavailability`. No reason / category is
  asked (the row still stores a fixed `reason`/`category` for legacy columns).
  Constraint `vehicle_unavailability_no_overlap` + trigger
  `prevent_blackout_booking_conflict` prevent overlaps with each other and with
  active bookings.

## 6. Browse / car detail

- `/browse`: lists `approved`/`active` cars. `/cars/:id`: details, reviews, price
  preview, a calendar disabled outside **tomorrow-to-30-days** and on booked
  ranges, the agreement PDF via a 5-minute signed URL, and a listing question →
  `POST /api/create-car-inquiry`.

## 7. Booking creation — `POST /api/create-booking`

Server recalculates everything:

- Dates: **start must be tomorrow-to-30-days** (same-day blocked); end after
  start; drop-off after pickup.
- Eligibility: renter `verified`, not a lister/admin; car `approved`/`active`;
  renter ≠ owner; agreement accepted and `agreementVersionId` still matches the
  current approved version.
- Price: `price_per_day × days`; commission from
  `platform_settings.commission_rate` (default 10%); renter processing-fee
  gross-up from `payment_processing_fee_rate` + `payment_processing_fixed_centavos`;
  total ≤ ₱100,000. `downpayment = ceil(total × 0.5)`, `balance = total − downpayment`.
- Overlap check vs active `bookings` and maintenance blackouts.
- Inserts `bookings` (status `pending`), snapshots agreement version + path +
  SHA-256, sets `owner_response_deadline = min(now + 24h, pickup datetime)`.
- Inserts `booking_agreement_acceptances` (renter id + server timestamp); rolls
  back the booking on failure.
- Audit-logs `booking_created` (`pricing_source: server_authoritative`);
  notifies the lister.

## 8. Lister accept / reject — `POST /api/booking-action`

- `accept`: lister only; `pending` only; if `owner_response_deadline` passed →
  auto-reject + 409. On success → `confirmed`, sets
  `payment_deadline = min(now + 24h, pickup datetime)`; notifies/emails renter.
- `reject` → `rejected`; notifies renter.
- Cron `POST /api/expire-booking-deadlines` (needs `CRON_SECRET`): `pending`
  past owner deadline → `rejected`; `confirmed`/`awaiting_payment` past payment
  deadline → `cancelled`. Notifies both parties. Capped 200 + 200 per run.
  **Requires an external scheduler** (GitHub Actions workflow
  `scheduled-workers.yml`, or any cron hitting the URL with the bearer secret).

## 9. Payment — downpayment / full / balance

- `POST /api/create-checkout` (`downpayment`|`full`) / `POST /api/create-balance-checkout`:
  renter only; requires the agreement-acceptance row; if `payment_deadline`
  passed → cancels + 409; creates a PayMongo Checkout Session; stores
  `paymongo_checkout_id`; `reference_number` = booking id / `booking-full:<id>` /
  `booking-balance:<id>`.
- **`POST /api/webhooks/paymongo` is the payment authority:**
  - Verifies `Paymongo-Signature` (HMAC-SHA256 over `t.rawBody`, test `te` /
    live `li`, 300 s replay tolerance), constant-time compare, fails closed.
    Every attempt → `security_logs`.
  - On `checkout_session.payment.paid`, routes by `reference_number` prefix
    (bare id = downpayment, `booking-full:`, `booking-balance:`,
    `booking-extension:`, `subscription:`).
  - Re-checks stored checkout id + **exact amount** + payable state; inserts an
    idempotent `payments` row (DB uniqueness index on the event); advances
    booking status (`downpayment_paid` / `fully_paid` / `active`).
  - Posts a balanced ledger journal (`api/lib/ledger.ts`
    `postCompletedPaymentToLedger` → owner / commission / processing-fee split,
    debit `1010`, credit `2010` + `2040` + `4020`, then `finalize_ledger_journal`).
  - Notifies both parties; sends the renter a **payment receipt** via Resend;
    records `delivery_state`.
- `/payment/success` is a waiting screen only — never the authority.

## 10. Security deposit (Removed)

The separate refundable-deposit checkout/claim/release flow was removed end
to end (CHAPTER 34) before any deposit was ever collected in the live
database. Number kept so sections 11-20 don't shift.

## 11. Trip start / arrival — `POST /api/booking-action` (`arrive`)

- Participant confirms arrival (one-tap). Optional: one photo to a private
  bucket + (only on active consent) browser lat/long/accuracy/capture-time
  (validated). Sets `renter_arrived_at` / `lister_arrived_at`.
- No-show: after the 30-minute grace window, the party who checked in can file an
  in-app no-show support ticket. Review is manual (timestamps + evidence + admin
  judgement).

## 12. Condition reports — `POST /api/submit-trip-condition-report`

- `phase: pickup | return`; participant; odometer int ≥0; fuel/battery 0–100;
  optional consented location. One report per participant per phase — no
  silent overwrite. Renter and lister submit independently, in the private
  `trip-condition-evidence` bucket at `<booking>/<user>/<report>/…`.
- **Return (either party) and the renter's optional pickup report:** the
  fixed 7-category system (front, back, left, right, interior, odometer,
  fuel_or_battery — 4 required, 3 optional), file upload.
- **The lister's required pickup report (CHAPTER 36):** 1-4 free-form photos
  captured live through the device camera (`getUserMedia`, no file picker) -
  stored as `live_photo_1`..`live_photo_4`. At least 1 is required.

## 13. Booking extensions — `POST /api/booking-extension-action`

- `request` / `approve` / `reject` / `cancel`; recomputes added days + fuel
  top-up + commission. `POST /api/create-booking-extension-checkout` (reference
  `booking-extension:<extensionId>`); the webhook confirms payment and updates
  the booking dates. Emails/notifies at each step.

## 14. Return handover / completion — `POST /api/booking-action`

- **`return_arrive`** (renter only): lightweight "I've returned the car"
  announcement (`renter_return_arrived_at`) - no evidence requirement of its
  own, just gates the lister's completion below.
- **`complete`** (sequential, CHAPTER 39 - no longer symmetric): each party's
  own required condition report must be present (the renter's return report,
  4 of 7 categories; the lister's pickup report, re-checked here too, 1-4
  live photos). The **lister** additionally needs `renter_return_arrived_at`
  set (or a pre-existing `renter_completed`, grandfathering pre-CHAPTER-39
  bookings) before `owner_completed` can be set. The **renter** additionally
  needs `owner_completed` already `true` before `renter_completed` can be
  set - so the renter's own final confirmation only unlocks after the lister
  has acknowledged receiving the car. When both are true → `completed`, the
  payout-eligibility trigger point.
- If the lister never confirms, `api/expire-booking-deadlines.ts` auto-sets
  `owner_completed` after `lister_completion_timeout_hours` from
  `renter_return_arrived_at` (the renter still taps their own final confirm
  afterward) - or, for a pre-CHAPTER-39 booking already at
  `renter_completed=true`, auto-completes straight to `completed` from
  `renter_completed_at` as before.

## 15. Security-deposit claim window (Removed)

Removed with the rest of the deposit feature - see §10. Number kept so
sections 16-20 don't shift.

## 16. Payout — lister gets paid

- `POST /api/process-payout` (super-admin) or auto-triggered on completion →
  `api/lib/payoutAutomation.ts`
  `processAutomaticPayoutForBooking`. **Eligibility gates:**
  1. booking `completed` and both parties completed
  2. no open/in-progress support ticket on the booking
  3. lister payout details present (`payout_method` GCash/Maya, account name,
     account number)
  4. no existing completed payout and no pending payout with a transaction id
  - amount = `base_price` (plus any fuel top-up), added **once** (retry-safe).
- Demo mode (`PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION=true`, `sk_test_` key or
  no key; a live key auto-disables it): writes a `sandbox_payout_*` row, notifies,
  audits, posts the ledger journal `2010→1010` (event key `payout:<txn>`), sends a
  **payout receipt** — no wallet call, no real money moved.
- Real mode: matches the method to a PayMongo InstaPay receiving institution,
  loads the wallet source account, creates `/v2/batch_transfers` with idempotency
  key `safedrive-payout-<paymentId>` and `callback_url` →
  `/api/webhooks/paymongo-payouts`. succeeded → `payments` row `completed`,
  notify lister, **payout receipt**, ledger journal `2010→1010`. failed → row
  `failed`, alert admins. pending → row `pending`, await the callback.
- `POST /api/webhooks/paymongo-payouts`: verifies the signature, finds the
  `payout` row by booking + transaction id, transitions `pending → completed/failed`
  (terminal-guarded), notifies/audits, sends the receipt.
- There is **no out-of-app manual payout path**. Every payout runs through the
  in-app **Auto Payout** action (`/api/process-payout`); an admin never sends the
  money by hand and records a reference.
- Real automatic payout (the live `/v2/batch_transfers` call) stays **disabled**
  until PayMongo Money Movement API access is approved; demo mode covers the
  thesis build.

## 17. Refunds

- On cancellation (`POST /api/booking-action` `cancel`): if a captured
  `downpayment`/`balance` payment is inside the 24-hour refund window and the
  trip has not started → `api/lib/refundAutomation.ts`
  `processAutomaticRefundForBooking`: groups completed refundable payments by
  PayMongo payment/checkout id; blocks if a payout was released or a refund is
  pending; resolves the `pay_…` id (or from the `cs_…` checkout); calls PayMongo
  `/v1/refunds`; writes a negative-amount `payments` row (`payment_type: refund`);
  posts a reversal ledger journal; notifies renter + lister; sends the renter a
  **refund receipt** via Resend (`baseOrigin` is required, so this can't be
  silently skipped). If the automatic path can't run → creates a **manual refund
  review** for a super-admin sized from the captured refundable total.
- Super-admin tools (`/admin/financial-reviews`): `POST /api/process-refund`
  (retry one/batch), `POST /api/mark-manual-refund` (record a manual refund),
  `POST /api/sync-paymongo-refund` (poll PayMongo, reconcile the matching local
  row + ledger + audit only — never creates a new refund).
- `payment.refunded` / `payment.refund.updated` webhook events complete/fail the
  local refund rows.

## 18. Ledger

- `ledger_journals` + `ledger_entries`, integer centavos, every finalized
  journal balances, append-only (triggers `prevent_finalized_journal_change` /
  `prevent_finalized_entry_change`). `event_key` = idempotency key. Corrections:
  `create_ledger_correction` RPC posts an exact reversal + a new corrected
  journal with a reason, and audit-logs it. Starts fresh from `ledger_activated_at`.
- Accounts: `1010` cash/PayMongo clearing, `2010` lister payable, `2040`
  deferred platform fee, `4020` fee recovery, plus commission revenue /
  payment-processing expense.
- Super-admin only in the browser (`/admin/financial-ledger`).

## 19. Reconciliation — `POST /api/run-reconciliation` (super-admin)

- Compares local paid `payments` / balanced journals / payout + refund states
  against PayMongo checkout/payment status, amounts, references. Lists up
  to 100 provider payments; records `provider_payment_list_may_be_truncated` if a
  full page returns.
- Detects: provider-only payment, SafeDrive-only completion, duplicate
  transaction id, amount mismatch, stale/failed payout, refund not
  provider-confirmed, unbalanced journal. Every finding → hold-and-investigate;
  never silently moves money, marks a payment successful, creates a refund, or
  edits a finalized journal. `/admin/reconciliation`.

## 20. Cross-cutting

- **Notification work center:** the bell (`adminWorkQueue.ts` / `adminAttention.ts`
  / `queueAge.ts`) counts live queues with exact elapsed wait + deep links;
  `/admin/notifications` is the full view.
- **Support tickets** (`/support`, `/admin/support`): authenticated cases +
  messages + attachments; RLS scoped to participants/admins; admin replies can
  trigger `POST /api/send-support-ticket-reply-email`.
- **Privacy / retention** (`/privacy-request` → `POST /api/data-request` or RPC
  `submit_data_retention_request`): access / correction / deletion / anonymization
  / restriction → `data_retention_requests`. Super-admin workflow
  (`/admin/retention-requests`): submitted → identity check → under review →
  approved/denied → executed, with legal-hold states. Account "delete" routes
  here — no direct self-deletion. All audit-logged.
- **Audit vs security logs:** `audit_log` = accountable business actions;
  `security_logs` = auth events / signature failures / suspicious activity.
  Neither stores plaintext secrets. Some `audit_log` events are written by DB
  triggers so a modified browser can't forge or suppress them.
- **Cron workers:** `expire-booking-deadlines` and `send-return-reminders` (emails
  renter + lister when a return is due-soon/overdue, Resend with Gmail fallback)
  — both require `CRON_SECRET` and an external scheduler.
