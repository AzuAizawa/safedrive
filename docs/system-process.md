# SafeDrive 2.0 System Process Summary

> **Supplementary flow map.** The authoritative current paper is
> `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`, especially Sections 6-18
> and Appendices G-I. Current code and the master take precedence if this short
> summary conflicts with them.

## 1. Accounts and roles

- Visitors can browse the landing page and submit a minimal, multi-topic guest
  inquiry without creating an account.
- Registered users confirm their email and submit KYC evidence before protected
  renting/listing actions are enabled.
- Admins review profiles, vehicles, support cases, and guest questions.
- Super-admins additionally control payouts, refunds, security deposits,
  financial ledger/reconciliation, retention/deletion decisions, and protected
  platform-setting changes.
- All roles share one Supabase backend and one React application, but server
  authorization, route guards, RLS, and restricted storage separate access.

## 2. Guest questions and support

1. A visitor supplies name, email, optional phone, one or more allowed topics,
   and a message at `/contact`.
2. The public API validates/rate-limits the request and stores it.
3. The admin notification center shows the queue and exact wait time.
4. An admin starts review and replies. The reply is sent through Resend
   (server-only API key, verified sending domain); the deployed Gmail Apps
   Script webhook is used only as a fallback when Resend is not configured.
5. The inquiry is resolved only after email delivery is confirmed; failure
   leaves it open for retry.
6. Listing-specific or account/booking disputes use authenticated support
   tickets instead of the guest channel.

## 3. Vehicle approval and availability

1. A verified lister submits vehicle, ownership, insurance, images, pickup,
   pricing, and rental-agreement evidence.
2. Restricted evidence stays private; approved listing images are public.
3. Admin review approves or rejects the listing with reasons and audit evidence.
4. A material vehicle, image, ownership, insurance, or agreement change returns
   the listing to pending review.
5. Maintenance and blackout dates prevent unavailable bookings.

## 4. Booking and agreement

1. The renter selects a vehicle and date range. A trip may start as early as the
   next day; same-day starts are blocked.
2. `/api/create-booking` recalculates price, fees, eligibility, dates, and
   overlaps on the server.
3. The lister accepts within 24 hours and the renter then pays within 24 hours,
   but both deadlines are capped at the pickup time. Cron processing
   (`/api/expire-booking-deadlines`) cancels a request that is not accepted and
   paid before pickup and releases the car.
4. The booking snapshots the approved lister agreement version and hash.
5. The renter's acceptance identity and server timestamp are recorded before
   the protected rental proceeds.

## 5. Payment, trip, deposit, and payout

1. PayMongo hosted checkout collects the booking amount; the browser redirect
   is not proof of payment.
2. A signed webhook confirms provider state and posts an idempotent balanced
   journal.
3. The separately disclosed test security deposit is recorded as a refundable
   liability, not platform income.
4. Renter and lister submit independent pickup/return condition reports with
   required photo categories and optional consented location evidence.
5. A claim can hold the deposit while the renter responds and a super-admin
   decides the approved amount. The remainder is returned through confirmed
   provider/manual evidence.
6. Lister payout is eligible only after the required terminal trip/agreement
   state and checks. PayMongo Money Movement remains provider/account dependent;
   the localhost simulator never represents real money.

SafeDrive must not describe this model as regulated escrow unless Philippine
legal counsel and the payment provider explicitly approve that representation.

## 6. Ledger and reconciliation

- Completed payments, refunds, deposits, claims, fees, and payouts create
  append-only balanced journals using centavos and stable event keys.
- Corrections use linked reversal/adjustment entries; finalized finance records
  are never silently edited or deleted.
- Super-admin reconciliation compares SafeDrive records, PayMongo information,
  and recipient-bank evidence, then classifies and resolves mismatches.
- The operational ledger supports traceability but is not automatically a BIR
  statutory book or an accountant-approved chart of accounts.

## 7. Privacy and retention

- Users can request access, correction, deletion/blocking, or another privacy
  action from the application.
- Super-admin review records identity/authorization, decision, reason, lawful
  hold, completion time, and audit evidence.
- A request does not promise immediate deletion when a legal, accounting,
  security, dispute, or fraud-preservation obligation applies.

## 8. Verification and launch boundary

Local validation uses `npm run build:clean`, `npm run check:all`, `npm audit`,
and `git diff --check`. Live Supabase, PayMongo signed callbacks/payouts,
provider-bank reconciliation, hosted TLS/cron/logs/backups, manual accessibility,
privacy registration/process, legal, insurance, and tax/accounting evidence are
separate launch requirements recorded in the master.
