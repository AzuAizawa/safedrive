# SafeDrive 2.0 Master Documentation

**Authoritative project, operations, and weekly-check reference**

**Status date:** 31 August 2026

**System status:** deployed on Vercel (Hobby) with a live Supabase project and real user data; PayMongo remains in test mode; not approved for public real-money operation

**Canonical database companion:** `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`

**Running change log:** repository root `CHANGELOG.md`

**End-to-end flow reference:** `project_docs/SYSTEM_FLOWS.md`

**Recent (31 August 2026):** next-day booking rule (a trip can start as early as
tomorrow; accept/pay deadlines capped at pickup; auto-cancel otherwise);
CHAPTER 17 security & integrity hardening SQL added (payments write lockdown, PII
encryption-key guard) — **written, apply-by-hand still pending**; Resend
transactional email finalised; `api/**` now type-checked by the build; CI and an
external cron scheduler added. See `CHANGELOG.md` for the file-level detail.

This is the primary SafeDrive reference. It combines the current architecture, implemented workflows, financial design, supporting rationale, migration checklist, and remaining work. If an older document conflicts with this master, use the current code, the current database schema, and this master in that order.

Never place service-role keys, PayMongo secret keys, webhook secrets, Gmail shared secrets, personal identity documents, wallet identifiers, or database exports in this document or Git.

## Table of Contents

- [1. Executive Decision](#1-executive-decision)
- [2. Roles and Permissions](#2-roles-and-permissions)
- [3. Architecture and Connections](#3-architecture-and-connections)
- [4. Admin Notification Work Center](#4-admin-notification-work-center)
- [5. User Inquiry Workflow](#5-user-inquiry-workflow)
- [6. Vehicle Approval, Insurance, and Availability](#6-vehicle-approval-insurance-and-availability)
- [7. Vehicle-Specific Rental Agreement](#7-vehicle-specific-rental-agreement)
- [8. Pickup and Return Condition Reports](#8-pickup-and-return-condition-reports)
- [9. Security Deposit](#9-security-deposit-option-b)
- [10. Financial Ledger](#10-financial-ledger)
- [11. Payout Timing](#11-payout-timing)
- [12. Reconciliation Dashboard and Solutions](#12-reconciliation-dashboard-and-solutions)
- [13. Privacy, Retention, and Deletion](#13-privacy-retention-and-deletion)
- [14. Supporting Law, Standards, and Industry Rationale](#14-supporting-law-standards-and-industry-rationale)
- [15. Canonical SQL and Supabase Procedure](#15-canonical-sql-and-supabase-procedure)
- [16. Environment Variables](#16-environment-variables)
- [17. Local Run and Test Procedure](#17-local-run-and-test-procedure)
- [18. Accessibility, Mobile, and Browser Checklist](#18-accessibility-mobile-and-browser-checklist)
- [19. Hosting-Only Work](#19-hosting-only-work-deferred)
- [20. Weekly Operational Checklist](#20-weekly-operational-checklist)
- [21. Completed, Remaining, and Owner Actions](#21-completed-remaining-and-owner-actions)
- [22. Reference Links](#22-reference-links)
- [23. Release Decision](#23-release-decision)
- [Appendices A-K](#appendix-a-security-and-quality-standards)

## 1. Executive Decision

SafeDrive 2.0 now has the requested local code for the admin work center, multi-topic guest inquiries, agreement versioning, maintenance blackouts, independent trip-condition reports, a separate security-deposit workflow, retention requests, an append-only double-entry ledger, reconciliation review, role-aware administration, and local browser/accessibility smoke checks. The guarded clean production build, lint, frontend and API TypeScript checks, financial logic tests, booking-flow checks, repository alignment check, environment checks, direct local routes, and protected API boundaries pass. The 16 August alignment check reviewed 166 text files and 59,863 lines and cross-checked 46 application routes, 28 API handlers, 24 frontend API references, 38 Supabase relations/buckets, and 13 environment names.

The resumed live Supabase project is now reachable. Read-only schema/workflow verification passed, the authenticated role matrix passed all 12 checks, and a disposable live booking journey passed all 13 checks. That journey created temporary renter/lister identities, a versioned agreement and approved car, a booking, lister acceptance, an overlap rejection, a PayMongo test checkout, audit records, and participant notifications, then removed the temporary Supabase data and accounts. One unpaid PayMongo test checkout remains in provider test mode; it contains no payment and moved no money.

SafeDrive remains unsuitable for a public real-money launch until hosting, live callback URLs, production secrets, PayMongo Money Movement access, staging evidence, monitoring, backup/restore proof, and Philippine professional review are complete. Local PayMongo simulation is safe for the thesis demonstration because it records a simulated payout without moving wallet funds.

### 1.1 Status matrix

| Area | Status | Evidence or next action |
|---|---|---|
| Local Vite app and API | Complete locally | Guarded clean build, lint, frontend/API type checks, logic tests, route checks, and protected-endpoint checks pass |
| Dependency audit | Last captured pass: 6 August 2026 | React Router RSC advisory removed by migrating to Router 8.3.0; repeat `npm audit` before a release |
| Repository alignment | Passed on 16 August 2026 | 166 reviewed text files and 59,863 lines; 46 routes, 28 API handlers, 24 frontend API references, 38 Supabase relations/buckets, and 13 environment names cross-checked |
| Admin notification work center | Implemented | Bell counts actionable queues and opens exact work items |
| Guest inquiry | Implemented and demonstrated locally | Multi-topic intake, in-review state, Resend reply with Gmail fallback, and failure-safe resolution work; staging delivery evidence remains |
| Trip reports | Implemented; live schema present | Required private bucket and relations exist; full authenticated photo journey remains a presentation/staging test |
| Vehicle agreement versions | Implemented; live schema present | Disposable booking test proved versioned agreement acceptance |
| Maintenance blackouts | Implemented; live schema present | Conflict rules exist; include a controlled UI example in the thesis demonstration |
| Security deposit | Implemented locally | PayMongo test mode cannot prove a real refund; controlled local claim/release simulation remains available |
| Ledger and reconciliation | Implemented and logic-tested | Live tables/accounts exist and queried journals balance; no historical journals are invented |
| Retention/deletion requests | Implemented locally | Schedule is provisional pending Philippine counsel/DPO review |
| PayMongo checkout/refunds | Test checkout proven | Test credentials/wallet and checkout creation pass; paid webhook/refund remains a controlled staging test |
| PayMongo wallet payout | Not production-proven | Keep disabled; use local simulator until API access is approved |
| Accessibility/browser smoke | Passed locally for public and unauthenticated admin routes | Chrome/Edge-compatible CDP checks pass at mobile and desktop sizes; authenticated, Firefox, Safari, camera, and physical-device checks remain |
| Live Supabase proof | Passed with recorded limitations | Schema/workflow and 12 role checks pass; Chapter 16 SQL remains the authoritative proof for catalog-only definitions |
| Hosting | Deferred by owner | Add only the selected host adapter/configuration after a host is chosen |
| Legal/tax/insurance readiness | Design review only | Obtain professional written review before public launch |

### 1.2 Current system summary

- **Works now on localhost:** public browsing, registration/login/recovery, verification, vehicle listing and approval, guest inquiry and Gmail reply, support cases, role-aware admin work, agreement-backed booking, PayMongo test checkout creation, notifications, audit/security logs, and the production build.
- **Implemented with automated logic coverage:** overlapping-booking protection, maintenance blackouts, agreement snapshots and acceptance, trip-condition requirements, refundable deposits and claims, refund/payout eligibility, append-only ledger entries, reconciliation findings, and retention requests.
- **Live services verified safely:** Supabase connectivity and schema surfaces, renter/admin/super-admin access boundaries, PayMongo test secret authentication, activated test wallet matching, and an unpaid disposable booking checkout.
- **Intentionally not performed:** a fabricated successful payment webhook, real refund, real wallet transfer, live payout, or destructive cleanup of historical records. These actions could create permanent provider or append-only financial evidence.
- **Release position:** suitable for controlled local/thesis demonstrations using test data; not approved for public real-money operation.

### 1.3 Needs improvement and remaining work

**Priority A - thesis and presentation quality**

- Prepare a clean, repeatable demo dataset instead of relying on old bookings. Three legacy cars need insurance re-review, four legacy bookings use the earlier price formula, and sixteen historical bookings do not have versioned agreements.
- Perform one human-reviewed, authenticated presentation run covering renter, lister, administrator, and super-administrator screens. Automation proves routes and business boundaries but cannot judge every dense screen, wording choice, modal focus behavior, uploaded photo, PDF readability, or mobile camera flow.
- Use concise seeded examples for the notification bell, guest inquiry, vehicle approval, agreement, condition reports, deposit review, ledger, and reconciliation. Avoid showing unrelated historical audit noise during the defense.
- Capture sanitized screenshots and expected results for the evidence register. Never capture secret values, identity documents, wallet identifiers, or service-role credentials.

**Priority B - engineering and staging quality**

- Add authenticated browser end-to-end coverage for the main renter/lister/admin journey, including failed states, retries, uploads, and keyboard interaction.
- Keep simplifying large booking and administration pages into focused tabs, summaries, and expandable details. Preserve server-side authorization when navigation is reorganized.
- Add centralized error monitoring, webhook/cron health alerts, correlation identifiers, and operational dashboards after a host is selected.
- Prove backup restoration, incident response, and retention-request execution in staging rather than documenting policy only.
- Run a paid PayMongo test-mode checkout through the genuine signed webhook, refund, deposit, reconciliation, and eligible payout path only in a controlled staging environment where immutable financial test records are expected.

**Priority C - public launch gates**

- Select a host and configure HTTPS, SPA fallback, API execution, encrypted environment variables, scheduled jobs, logs, Supabase redirect URLs, Gmail callbacks, and PayMongo webhooks.
- Obtain PayMongo Money Movement authorization and document wallet, recipient, institution, transfer, callback, retry, and reconciliation behavior. Do not infer authorization from the dashboard wallet page.
- Complete authenticated accessibility checks, Firefox/Safari/WebKit coverage, 200%/400% zoom, screen-reader testing, and real Android/iOS camera/location permission tests.
- Obtain Philippine legal, privacy/DPO, insurance, consumer, accounting, and tax review. Continue calling the generated document a payment acknowledgment, not a BIR invoice or official receipt.

## 2. Roles and Permissions

### 2.1 Guest visitor

A guest can read public pages and ask a question without creating an account. The form collects only name, email, optional phone, one or more topics, and a message. It does not require a car model because a general question is not a vehicle listing or a logged-in support ticket.

### 2.2 Registered renter or lister

One account may act as a renter or lister when eligible. Registered users can complete identity verification, browse approved vehicles, request bookings, pay through hosted checkout, submit their own trip reports, view the agreement accepted for a booking, manage vehicle availability, submit deposit claims or responses when they are a booking participant, and open authenticated support cases.

### 2.3 Administrator

An administrator's access is a per-account checklist of nine operational permissions (`users.verify`, `users.moderate`, `vehicles.review`, `vehicles.delete`, `catalog.manage`, `support.handle`, `inquiries.handle`, `audit.view`, `security.view`) held in `public.admin_permissions` and toggled by a super admin in `/admin/admins`. The dashboard and the notification work center are always available; every other operational page (users/profile verification, car catalog, vehicle approval, Support Tickets, User Inquiries, audit trail, security logs) appears only when the matching key is granted. The database gate is `public.admin_can(<key>)`, enforced by RLS and the `/api` handlers; the navigation filter is cosmetic. An administrator never sees finance, platform settings, retention requests, or admin management. See `project_docs/RBAC_DESIGN.md`.

### 2.4 Super administrator

A super administrator implicitly holds every permission and cannot be restricted. In addition to all operational work they have payouts, refunds, security-deposit decisions, financial ledger, reconciliation, retention/deletion requests, platform settings, and admin management (`/admin/admins`: create admin accounts, toggle each admin's checklist, disable accounts). These routes use a server-checked super-admin guard; hiding a menu item is never treated as authorization. A super admin is created only by direct SQL against `public.profiles` (there is no in-app path).

## 3. Architecture and Connections

### 3.1 Vite and React

SafeDrive is a React 19 and TypeScript single-page application built by Vite. React Router supplies public, user, admin, and super-admin routes. The Vite development server runs at `http://127.0.0.1:5173` and includes a local adapter for `/api/*`, so local browser and server-handler testing does not require Vercel.

### 3.2 Supabase

Supabase supplies authentication, PostgreSQL, Row Level Security, realtime changes, and object storage. Browser code receives only the Supabase URL and anon key. The service-role key stays in server handlers because it bypasses RLS.

### 3.3 SafeDrive API layer

TypeScript handlers under `api/` enforce authoritative pricing, booking state, checkout creation, signed webhooks, refunds, payouts, guest intake/replies, trip reports, deposit actions, privacy requests, ledger posting, and reconciliation. Critical decisions are revalidated server-side.

### 3.4 PayMongo

Hosted checkout collects renter payments without SafeDrive handling raw card data. The signed PayMongo webhook—not the success-page redirect—is the payment authority. The application validates timestamps/signatures, amount, state, transaction identity, and duplicate delivery.

The PayMongo wallet visible in the dashboard proves that a test wallet exists; it does not prove that SafeDrive has API permission to send Money Movement transfers. `PAYMONGO_PAYOUT_WALLET_ID` must come from an authorized PayMongo API/account response, never from guessing a dashboard number.

### 3.5 Gmail Apps Script

Resend is the primary transactional mail service. It carries payment/refund/payout receipts, inquiry replies, return reminders, and lifecycle notifications to both parties. The lister is emailed on a new booking request, on each confirmed payment (downpayment / balance / full / **paid extension** - the message states SafeDrive holds the money and releases the lister's share, net of commission, after completion, in one payout), on trip completion, on cancellation, and on extension decisions.

The **lister payout receipt** is a single itemized email: base rental (with day count), any paid trip extension, any fuel/charge reimbursement, any approved security-deposit claim, the total released, the masked destination, and a one-line renter-payment timeline (each downpayment / balance / full / extension payment with its date). A paid extension folds its rental into `base_price` and its commission into the deferred-fee account at payment time; the extension's fuel top-up is a lister reimbursement released with the same payout (`payoutAutomation` adds it on top of `base_price`; the extension payment's ledger split is taken as an explicit `allocationOverride`, not the booking-wide ratio).

Admins and super-admins additionally receive an **operational alert email** (`sendAdminAlertEmail`) only for money-movement exceptions that need a human - a failed automatic payout, a refund that needs manual review, or a critical reconciliation mismatch. Routine successful payouts and refunds stay in-app notifications only. A deployed Apps Script `/exec` URL remains a legacy fallback only when Resend is not configured. `GMAIL_WEBHOOK_SHARED_SECRET` in SafeDrive must equal the Apps Script property `SAFEDRIVE_WEBHOOK_SECRET`. Every email is keyed with an idempotency key; an in-app notification is always written even if the email fails.

## 4. Admin Notification Work Center

The notification bell is an actionable work center, not a decorative unread count. Clicking it opens a compact staff popover with the oldest live queues, precise deep links, elapsed waiting time, and recent system updates. The popover's **View all** action opens `/admin/notifications` for the complete work center.

Both admin roles see:

- guest inquiries that are open or in review;
- open/in-progress support tickets;
- profiles awaiting verification; and
- vehicles awaiting approval or re-approval.

Super-admins additionally see:

- pending or failed refunds;
- pending or failed payouts;
- security deposits requiring release, claim, decision, refund, or failure review;
- privacy/retention requests requiring identity or decision work; and
- open or investigating reconciliation mismatches.

Each queue item shows the exact elapsed time, such as `Waiting 1d 4h 12m`. Queue coloring uses these thresholds:

| Queue | Warning | Overdue | Critical |
|---|---:|---:|---:|
| Guest inquiry/support | 12h | 24h | 48h |
| Profile/vehicle review | 24h | 48h | 72h |
| Refund/payout | 2h | 4h | 24h |
| Security event | Immediate | Immediate | Immediate |

Opening the reply box silently claims the inquiry (`open → in_progress`, assigned to that admin, with a review-started timestamp) so the queue shows someone is on it - there is no separate "Start review" step. The reply endpoint 409s once an inquiry is resolved, which is the real guard against a second admin answering twice. Sending the reply emails the person once and closes the inquiry (`resolved`). The internal status stays `in_progress` / `resolved` to match the existing database constraint.

## 5. User Inquiry Workflow

The admin page is **User Inquiries** (table `guest_inquiries` + thread `guest_inquiry_messages`). It is the questions channel, distinct from **Support Tickets** which carry a reference and signal "an issue to resolve".

- **Signed-in submitter:** the inquiry is linked (`submitted_by_user_id`) and becomes a threaded conversation. They see it at `/inquiries` (`InquiriesPage`), read replies in-app, and post follow-ups (`api/inquiry-followup.ts`, which re-opens the inquiry in the admin queue). An admin reply (`action: reply`) adds a thread message + emails them + sets `in_progress`; it does **not** close the inquiry. An admin marks it resolved separately (`action: resolve`).
- **Guest (no account):** no token, no link, no in-app thread - a single email reply, then the admin marks it resolved. This is the fallback for a true visitor.

Inquiries do not carry a reference number - that is a Support Ticket signal.

### 5.1 Intake

The person chooses as many relevant topics as needed:

- What SafeDrive is/how it works;
- renting, booking availability, cancellation, or rescheduling;
- driver requirements;
- listing a vehicle, vehicle eligibility, or vehicle requirements;
- account registration or verification;
- payments, fees, or refunds;
- locations/service area;
- safety or insurance;
- complaint or safety concern;
- privacy/personal data;
- business/partnership;
- technical problem; or
- other.

The API validates lengths and email format, rate-limits repeated requests, hashes a request fingerprint with a private salt, and inserts with the server-side Supabase client. Guests cannot query the table directly.

### 5.2 Admin handling

1. An admin receives a bell/work-center item.
2. Opening the reply box claims the inquiry (`open → in_progress`); there is no separate "Start review" step.
3. The admin replies from SafeDrive. Resend delivers the email (Apps Script fallback while Resend is absent); a linked account also gets the reply in its `/inquiries` thread and a notification.
4. A failed delivery is not recorded and shows a specific error.
5. Replying does not resolve the inquiry - the person can follow up. The admin clicks **Mark resolved** when the question is answered; a follow-up after that requires a new inquiry.

A registered user with booking, payment, vehicle, or identity context should still use a Support Ticket so evidence and participants remain linked.

## 6. Vehicle Approval, Insurance, and Availability

Vehicle registration, CTPL, insurer details, policy dates, comprehensive-cover declaration, and confirmation that the insurer permits rental/commercial use are recorded. CTPL is required for motor-vehicle registration and principally covers third-party death/bodily injury; it is not a substitute for cover on vehicle damage or an insurer’s permission for peer-to-peer rental.

SafeDrive therefore warns that:

- current registration and CTPL are required;
- comprehensive cover should be documented;
- the lister must confirm rental/platform use is allowed by the insurer; and
- SafeDrive approval is not an insurance guarantee.

When a lister changes critical vehicle, ownership, pricing, deposit, insurance, location, or agreement information, database triggers return the vehicle to `pending`. It becomes public again only after admin review, following the same principle used during initial registration.

Vehicle maintenance and blackout dates are stored separately from bookings. The lister manages them on a **month calendar** (`/vehicle-availability`): dates with a booking show red and are not selectable, already-blocked dates show amber, and the lister taps a free range to block it. No reason or category is collected - an unavailable date is simply unavailable. A blackout cannot conflict with an active booking. Booking creation checks both bookings and blackouts.

## 7. Vehicle-Specific Rental Agreement

The lister uploads the agreement governing use of that particular vehicle, in addition to SafeDrive’s platform terms. Every upload creates a numbered version with a storage path and SHA-256 content hash. Only one version can be approved for a vehicle at a time.

When a lister replaces the agreement:

1. the prior approved version is preserved and superseded;
2. the new version is pending;
3. the vehicle returns to approval review; and
4. new bookings cannot silently use the changed agreement until approval.

At booking creation, SafeDrive snapshots the approved agreement version, path, and hash and records the renter’s acceptance with a server timestamp. Existing booking participants can still read their snapshotted version even if the vehicle or later agreement becomes pending.

An electronic timestamp is the trusted server date/time of the acceptance or submission. It helps prove sequence and integrity; it is not merely the renter’s device clock.

## 8. Pickup and Return Condition Reports

Each condition report requires **four** photographs: front, back, odometer, and fuel/battery gauge (left, right, and interior are optional). The typed odometer and fuel/battery readings are optional - the odometer and fuel photos carry the evidence. Condition notes and a server timestamp are always recorded.

**Asymmetric requirement.** The party that owns the evidence at each phase must file the report; the other side's report is optional:

- **Pickup**: the **lister** files the required "before" report; the renter's pickup report is optional.
- **Return**: the **renter** files the required "after" report; the lister's return report is optional.

Comparing the lister's before against the renter's after is the dispute evidence. To raise a **deposit claim**, the lister must have their own complete pickup **and** return reports (all four photos, not waived) - the return report is otherwise optional but it is the price of claiming.

A required report can be submitted with an incomplete photo set only through an explicit **"submit without photos" waiver** (`evidence_waived`). A waived report keeps the trip moving but is flagged for the super admin in any dispute, and a deposit claim cannot be filed on a waived or incomplete report.

**Handover confirmation.** At pickup the **lister** confirms the handover (after filing the pickup report); the **renter** then taps a single "Confirm - I have the car". Both marks are recorded, but it is a two-tap handshake, not two independent multi-step flows. The booking becomes `active` once both have confirmed.

Location is optional evidence. If a participant actively consents, the browser may store latitude, longitude, accuracy, and capture time. It can help investigate whether evidence was captured near pickup/return, but it is not required, may be inaccurate, and must not be used as automatic proof of fault.

The photos use a private `trip-condition-evidence` bucket. Only participants and authorized admins may read them. Each participant can submit one report per booking phase; reports are not silently overwritten.

### 8.1 Lifecycle time gates

The trip lifecycle is gated against the clock so it cannot be completed before it starts:

- **Arrival check-in** opens only from `arrival_checkin_lead_hours` before the scheduled pickup datetime (default 3 h). `api/booking-action.ts` rejects an earlier `arrive` call; both dashboards show a "check-in opens ..." note instead of the button.
- **Completion** (`Finish Trip`) is rejected before the scheduled pickup datetime - a trip that has not started cannot be finished. Early checkout is allowed any time from pickup onward.
- **Lister-absent completion:** once the renter has completed (return report submitted, car dropped off), `api/expire-booking-deadlines.ts` auto-completes the lister's side after `lister_completion_timeout_hours` (default 18) so an unreachable lister cannot hold the renter or the deposit indefinitely. The deposit review window and the lister's claim right still apply from the evidence on file.

`arrival_checkin_lead_hours` is one of three configurable lifecycle timings in `platform_settings` (`arrival_checkin_lead_hours`, `deposit_claim_window_hours`, `lister_completion_timeout_hours`). Unlike the financial terms they are read **live**, not snapshotted per booking, and are changed through the same multi-super-admin consensus flow (`/admin/platform-settings`).

### 8.2 Ratings and reviews (Airbnb / Turo style)

After a booking reaches `completed`, both sides get one prompt on that booking card:

- **Renter -> the trip:** one 1-5 star + optional text. The single rating is aggregated two ways from the same `booking_reviews` row: by `car_id` (the **car's rating**, shown on `/browse` cards and the car page) and by `reviewee_id`/`owner_id` (the **lister's rating**, shown as "Hosted by X - ★ 4.9 - N trips" on the car page). There is no separate "rate the lister" star; the trip review already covers both, so the lister rating is a re-grouping, not a duplicate.
- **Lister -> the renter:** one 1-5 star + optional text. Shown to a future lister on the incoming booking request card and inside the renter-info modal ("Recent feedback from other listers"), plus the renter's own "Your renter rating" chip on `/my-bookings`.

**Double-blind:** a review is only counted in an aggregate and only shown once BOTH parties have rated that booking, or 14 days have passed since the trip completed - this prevents retaliation and "rate me and I'll rate you" trades. It is computed at read time; no cron.

Reads for public / logged-out display go through SECURITY DEFINER functions that return only aggregates plus review text with a reviewer first name/avatar (no other PII): `get_car_rating_summaries()`, `get_lister_rating_summaries()`, `get_public_car_reviews(car_id)` (all `anon` + `authenticated`), and `get_renter_reputation(renter_id)` (`authenticated`). Writes still go straight to `booking_reviews` under its participant RLS. Client helpers are in `src/lib/ratings.ts`.

## 9. Security Deposit: Option B

SafeDrive uses a **separate refundable deposit**, not a hidden deduction from rental income. This is simpler to explain and reconcile than mixing the deposit with rental revenue.

### 9.1 Flow

1. The renter pays the stated refundable deposit through a separate test/live checkout.
2. The ledger records it as a liability, not SafeDrive income.
3. After both sides complete the trip, a claim window opens for `deposit_claim_window_hours` (default 24, configurable through platform consensus).
4. During the window the lister either **confirms the return with no issues** (`lister_confirm_return`, releases the deposit to the renter immediately and lets the payout proceed) or files a documented claim. Once they confirm - or the window closes - they can no longer claim, so a lister cannot wait for the renter to leave and then raise a late claim.
5. With no claim, `api/expire-booking-deadlines.ts` auto-releases the full deposit to the renter after the window.
6. A lister claim must state an amount and detailed reason; it never deducts automatically.
7. The renter can respond.
8. Only a super-admin can approve, partly approve, or reject after reviewing the agreement and evidence.
9. Approved deduction cannot exceed the claim or deposit.
10. The remaining amount is refunded; failures enter review and reconciliation.

Only one open claim is allowed per deposit. All actions are audit-logged. A less complicated future alternative is PayMongo authorization/hold-then-capture, but it should be adopted only if the relevant payment methods, hold duration, refund behavior, and SafeDrive merchant account are confirmed to support the complete rental period.

## 10. Financial Ledger

### 10.1 Why it exists

Payments, refunds, deposits, commission, provider fees, and lister payables are different economic events. A single `payments` row cannot reliably prove how money should be classified. The ledger gives the thesis and future operations a traceable answer to “what happened, when, for which booking, and which accounts changed?”

### 10.2 Rules

- Start fresh from `ledger_activated_at`; do not invent historical entries.
- Store money as integer centavos.
- Every finalized journal must have equal debits and credits.
- `event_key` is the unique idempotency key. `provider_reference` is indexed but intentionally not unique because one PayMongo checkout may fund more than one SafeDrive component, such as downpayment and balance journals.
- Finalized journals and lines are append-only.
- Errors are fixed by an exact reversal plus a new corrected journal with a written reason.
- Super-admin is the only browser role that can view/correct the ledger.
- Server handlers post normal payment, refund, deposit, and payout events.
- Security deposits use a liability account and are never counted as commission revenue.

Seed accounts include PayMongo clearing, cash/bank, lister payable, refundable deposits, refund payable, deferred platform fees, commission revenue, payment-fee recovery, and payment-processing expense.

### 10.3 Processing fee policy

SafeDrive currently supports a transparently disclosed renter processing charge calculated from configurable percentage/fixed settings. The checkout total is grossed up so the lister’s base rental amount is not reduced by that charge. This is a SafeDrive pricing decision, not a general rule that consumers always inherit transfer fees.

Before public launch, confirm the chosen surcharge wording and method with PayMongo and Philippine counsel. Show base rental, SafeDrive/platform fee, payment-processing charge, refundable deposit, and final total before acceptance. Do not hide a fee after checkout begins. Use **PHP 100 only as a controlled test amount**, not as a permanent production fee.

## 11. Payout Timing

Lister payout becomes eligible only after:

- the provider has confirmed the relevant renter payment;
- both parties have completed the trip workflow;
- required return reports are present;
- the deposit claim window is closed or a claim is resolved;
- no open support/dispute hold blocks release;
- payout details are complete; and
- no active payout already exists.

SafeDrive deducts its disclosed commission from the agreed base and protects the lister base from the configured renter processing charge. If a super-admin approves a security-deposit claim, only the approved amount is added once to the lister payable/payout and the remainder is handled as refundable to the renter. Rejected claims add nothing to the payout. The payout helpers are idempotent so a retry must not add the same approved claim twice.

Automatic payout remains disabled for public use until PayMongo Money Movement API access, wallet source, recipient/institution setup, callbacks, retries, and reconciliation are proven. The local simulator changes SafeDrive test records only and must never be described as wallet or bank settlement.

## 12. Reconciliation Dashboard and Solutions

Reconciliation compares SafeDrive, PayMongo, security deposits, and the ledger. It detects issues but never silently sends money, marks payment successful, creates a refund, or edits a finalized journal.

| Detected issue | Safe response |
|---|---|
| PayMongo payment exists but SafeDrive is missing it | Freeze booking transition, verify signed provider event, import only through an audited idempotent repair |
| SafeDrive completed but PayMongo does not | Hold payout, reopen investigation, never manufacture provider success |
| Duplicate provider transaction ID | Freeze affected rows, identify canonical event, reverse/correct ledger rather than delete evidence |
| Incorrect amount | Hold fulfillment/payout, compare checkout metadata and provider amount, refund/recharge only after approval |
| Pending payout too long | Alert super-admin, query provider status, retry only with the same idempotency key or switch to documented manual review |
| Failed payout | Keep lister payable open, correct recipient data, retry after review; do not mark paid |
| Refund recorded but not provider-confirmed | Keep refund pending/failed, block duplicate refund, investigate provider window/method restrictions |
| Deposit counted as income | Reverse incorrect journal and post it to refundable-deposit liability |
| Ledger does not balance | Do not finalize; correct lines before finalization or reverse a finalized error |

The API compares local paid records with provider checkout/payment status, amounts, references, deposit state, payout/refund state, and balanced journals. It also lists up to the first 100 provider payments when searching for a PayMongo payment missing from SafeDrive. If PayMongo returns a full page, the run records `provider_payment_list_may_be_truncated` instead of pretending the comparison was complete. A dedicated merchant account reduces false findings from unrelated provider payments; if the account is shared, the operator must scope and review provider-only results manually.

Reconciliation marks failed runs as failed and alerts super-admins about critical mismatches. It never auto-finalizes uncertain money. Current provider pagination/rate limits must be rechecked before production, and a hosted scheduled job is still deferred.

## 13. Privacy, Retention, and Deletion

A user agreement cannot remove statutory privacy rights or guarantee that SafeDrive may keep all data forever. SafeDrive therefore accepts access, correction, deletion/erasure, objection/restriction, and account-closure requests through `/privacy-request`.

The account-settings deletion action routes to this reviewed privacy-request flow. It does not directly mark the profile deleted and does not promise automatic permanent deletion after a fixed number of days.

The super-admin workflow uses submitted, identity check, under review, approved, executed, denied, cancelled, and legal-hold states. Every change is audit-logged: actor, action, entity, timestamp, and relevant reason are recorded so a later reviewer can see who did what. Audit logging does not mean that sensitive values should be copied into the log.

Provisional schedules in Chapter 14 include 90 days for abandoned inquiries/unsuccessful-login telemetry, 365 days for resolved inquiries, 730 days for support and undisputed trip evidence, five years for financial/source records, and ten years for agreement acceptance evidence. These are risk-based design defaults, not a substitute for a records-retention policy approved by counsel, the DPO, and tax/accounting advisers.

A request may be delayed or denied when identity cannot be verified, another person’s rights would be harmed, a legal obligation requires retention, or records are needed for a current claim/investigation. The system must record the reason and delete or anonymize everything outside the valid hold.

## 14. Supporting Law, Standards, and Industry Rationale

This section supports design choices; it is not a legal opinion or certification.

- The Philippine Data Privacy Act requires transparency, legitimate purpose, and proportionality. NPC materials recognize access/correction/erasure rights and lawful reasons why erasure may not apply. This supports data minimization, consented optional location, private evidence, and a real request workflow.
- Republic Act 8792 recognizes electronic documents/contracts and supports integrity and reliable authentication. This supports agreement version, hash, acceptance, and server timestamp evidence.
- Republic Act 11967 supports transparent online offers, responsive redress, privacy precautions, and platform diligence. The statute also contains scope rules, including an exclusion for consumer-to-consumer transactions, so its exact application to SafeDrive's peer-to-peer and platform roles needs Philippine counsel. SafeDrive uses its transparency and redress principles as a conservative design baseline without claiming a final legal classification.
- BIR Revenue Regulations No. 7-2024 set a five-year baseline for books and source/accounting records, with longer preservation where a protest, claim, or investigation remains pending. This supports the financial-source retention rule and legal holds.
- Insurance Commission guidance explains that CTPL is mandatory for registration and addresses death/bodily injury; it does not by itself prove comprehensive vehicle-damage or rental-use cover. This supports the additional insurance declarations and warnings.
- WCAG 2.2 and Philippine accessible-website guidelines support keyboard, focus, labels, contrast, error messaging, responsive layout, and assistive-technology testing.

Comparable marketplace practices also support the design: major car-sharing platforms use trip photographs, vehicle availability blocks, and insurance/eligibility checks; payment platforms expose reconciliation and immutable transaction records. SafeDrive must still implement and validate its own policy rather than claiming equivalence or certification.

## 15. Canonical SQL and Supabase Procedure

`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` is the only database-script file. It is chaptered so previous logic and provenance remain reviewable, but it is **not** one executable migration from top to bottom.

### 15.1 What was applied and how to verify it

The intended Supabase project was resumed and became reachable. Chapter 14 was applied successfully and the read-only Chapter 16 checks were run. Do not rerun historical reset/repair chapters merely because the project was paused and resumed. Never paste keys into screenshots or this document.

1. In Supabase SQL Editor, back up/export the current schema and important data.
2. Open the master SQL.
3. Select from the `CHAPTER 14` heading through its `commit;` only.
4. Run the selected Chapter 14 transaction.
5. Confirm `Success. No rows returned` and no failed transaction.
6. Select and run the Chapter 16 read-only verification block.
7. Confirm no missing tables, columns, buckets, accounts, constraints, policies, unbalanced journals, duplicate open claims, or active overlaps are returned.
8. Ensure `app.settings.encryption_key` is set to an independent random value, then select from the `CHAPTER 17` heading through its `commit;` and run it (this removes participant write access to `public.payments` and hardens the PII helpers). Re-run the Chapter 16 verification and the Chapter 17 verification queries.
9. Save sanitized screenshots or exported results in the evidence register.

Do not run Chapters 1 or 2 merely to obtain Chapter 14. Chapter 1 contains historical reset/cleanup/seed operations. Do not delete or rewrite financial/audit data to make a verification check pass; investigate and record a forward repair.

### 15.2 Current live proof

- `npm run check:live-supabase` passed against the intended project.
- The required operational, agreement, trip, deposit, retention, ledger, and reconciliation relations are readable through the server verifier.
- All required private storage buckets exist and remain private.
- `platform_settings` contains ledger activation, both renter-processing-fee controls, the configurable downpayment/refund terms, the three lifecycle timings (`arrival_checkin_lead_hours`, `deposit_claim_window_hours`, `lister_completion_timeout_hours`), and `contact_email` - the public contact address shown in the Terms of Service, Privacy Policy, sign-up notice, and the sign-in/password-reset help text. Because it is contact information rather than a money or policy value, a single super-admin edits it directly through `set_platform_contact_email(text)` (super-admin only, audited as `platform_contact_email_updated`); every surface reads it live through `get_platform_contact_email()` and falls back to the seeded default if the lookup fails.
- All nine required financial accounts are seeded.
- No active booking overlap, duplicate active payout, duplicate completed checkout event, duplicate active subscription, duplicate open deposit claim, or unbalanced queried ledger journal was found.
- `npm run check:live-roles` passed all 12 ordinary-user, admin, and super-admin authorization checks and removed its three temporary identities.
- `npm run check:live-booking-journey` passed all 13 disposable renter/lister booking checks and removed its temporary Supabase data and identities.

**Recorded limitations:** service-role REST cannot enumerate every PostgreSQL constraint, trigger body, function signature, or RLS definition. Chapter 16 in SQL Editor remains the authoritative catalog-level evidence. The workflow checker also reports three legacy cars requiring insurance re-review, four bookings using the pre-upgrade financial formula, and sixteen historical bookings without versioned agreements. These are legacy-data cleanup/presentation concerns, not failures in the current schema.

## 16. Environment Variables

### Browser-visible

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PAYMONGO_PUBLIC_KEY`

### Server-only

- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYMONGO_SECRET_KEY`
- `PAYMONGO_WEBHOOK_SECRET`
- `PAYMONGO_PAYOUT_WALLET_ID` (only after PayMongo provides/authorizes it)
- `CRON_SECRET`
- `GUEST_INQUIRY_HASH_SALT`
- `GMAIL_WEBHOOK_SHARED_SECRET`
- `GMAIL_GUEST_INQUIRY_WEBHOOK_URL`
- `GMAIL_RETURN_REMINDER_WEBHOOK_URL`
- `PAYMONGO_WEBHOOK_TOLERANCE_SECONDS=300` (default signature replay tolerance)

### Demo money-movement mode

- `PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION=true`

With this on (and a `sk_test_` key, or no key - a live key auto-disables it), SafeDrive records **all three money-movement paths** with the full ledger + notification + receipt trail but **without calling PayMongo**:

- **Payouts** - `payoutAutomation.ts`, `sandbox_payout_*` reference, journal `2010 -> 1010`.
- **Cancellation refunds** - `refundAutomation.ts`, `sandbox_refund_*` reference, `payments` row `refund` completed, reversal journal via `postCompletedRefundToLedger`.
- **Security-deposit releases** - `securityDeposit.ts` `runSecurityDepositRelease`, `sandbox_deposit_refund_*` reference, journal `2020 -> 1010`.

The shared gate is `api/lib/paymongoMode.ts` `isDemoMoneyMovementEnabled`. Set the flag on a thesis/demo deployment; omit it for any launch that moves real money. Never prefix a server secret with `VITE_`.

## 17. Local Run and Test Procedure

1. Use Node.js 22.22 or newer. React Router 8 requires Node 22.22+ and React/React DOM 19.2.7+.
2. Configure test/local values in `.env`.
3. Run `npm install` when dependencies change.
4. Run `npm run check:local-env`.
5. Run `npm run dev:clean`.
6. Open `http://127.0.0.1:5173`.
7. Admin login is `/admin/login`; legacy admin paths redirect there.

Required repository checks:

1. `npm run build:clean` deletes only `dist` and `node_modules/.vite`, then rebuilds from source.
2. `npm run check:all` runs lint, API types, booking, financial, reconciliation, self-starting browser smoke, and local environment checks.
3. `npm audit` checks installed production and development packages against the current advisory database.
4. `npm run check:live-supabase` verifies the configured live project without printing row data or secrets.
5. `npm run check:live-workflows` checks live workflow invariants and reports legacy-data warnings.
6. `npm run check:live-roles` creates and removes temporary identities to prove staff authorization boundaries.
7. `npm run check:paymongo-readonly` authenticates the test key and validates the configured activated test wallet without moving money.
8. `npm run check:live-booking-journey` creates a disposable live booking and unpaid PayMongo test checkout, then removes the temporary Supabase records.
9. `git diff --check` checks whitespace errors without modifying files.

The 16 August 2026 run passed the local suite, clean production build, live Supabase/schema/workflow checks, all 12 role checks, PayMongo test-wallet verification, and all 13 disposable booking-journey checks. The disposable run left only one unpaid provider test checkout; it created no payment and moved no money.

These automated checks are regression evidence, not a replacement for authenticated live-database, provider, physical-device, or human accessibility tests.

### 17.1 Safe payout/wallet simulation

**Simulation A - ordinary payout state machine:**

1. Keep a PayMongo `sk_test_` key and `PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION=true` (demo payout mode).
2. Use a completed test booking with valid payout details, required return reports, a terminal deposit state, and no dispute/reconciliation hold.
3. As super-admin, run the automatic payout action.
4. Confirm one `sandbox_payout_*` record, notification, audit entry, and balanced payout journal.
5. Repeat the action and confirm the same economic payout is not posted twice.
6. Confirm the PayMongo wallet balance did not change.

**Simulation B - PHP 100 security-deposit disposition:**

1. Configure a test vehicle deposit of PHP 100 and create the separate test deposit checkout.
2. Complete pickup/return reports and the booking workflow.
3. Submit a full PHP 100 claim with a reason and evidence; let the renter respond.
4. As super-admin, approve exactly PHP 100.
5. Confirm the deposit becomes terminal, the approved amount is added to the lister payout once, no renter remainder is recorded, and ledger entries balance.
6. Repeat/retry the finalization and confirm no duplicate claim payout/journal is created.

PayMongo test mode does not prove a real refund of test funds, and the local payout simulator does not call the wallet. These demonstrations validate SafeDrive eligibility, idempotency, review, audit, and accounting paths only. An actual PHP 100 wallet transfer requires PayMongo-authorized Money Movement wallet/recipient/institution API access. Do not guess a wallet ID or recipient.

## 18. Accessibility, Mobile, and Browser Checklist

The automated headless browser smoke suite passed sixteen route/viewport checks on both 375 x 812 mobile and 1366 x 768 desktop viewports for `/`, `/contact`, `/admin/login`, `/Safedriveadminlogin`, `/privacy-policy`, `/terms`, unauthenticated `/admin/guest-inquiries`, and unauthenticated `/admin/financial-reviews`. It verifies expected content, no React crash, no horizontal overflow, accessible names for visible controls, labels for visible inputs, image alternative text, and exactly one visible `h1`.

The following manual/authenticated checks remain after Chapter 14 is applied and again on staging:

- keyboard-only navigation, visible focus, skip/navigation order, modal focus trap, and Escape close;
- screen-reader labels for forms, status changes, errors, photo inputs, bell counts, and tables;
- zoom at 200% and 400%;
- color contrast and non-color status indicators;
- responsive widths at 320, 375, 768, 1024, and 1440 pixels;
- Chrome, Edge, Firefox, and Safari/WebKit where available;
- Android and iOS camera/file/location permission paths;
- denial of location/camera permission without blocking a report unnecessarily;
- slow/offline/failure/retry states for uploads, checkout, Gmail, and APIs; and
- no horizontal overflow or hidden admin actions.

Chrome/Edge-compatible automation is passing locally. Firefox, Safari/WebKit, screen-reader behavior, authenticated role workflows, real Android/iOS camera/location permissions, 200%/400% zoom, and full keyboard/modal focus behavior remain evidence tasks; no claim of WCAG conformance is made yet.

## 19. Hosting-Only Work (Deferred)

When the owner selects a host, it must support Vite static output, Node-compatible API handlers, encrypted server secrets, HTTPS callbacks, SPA fallback without rewriting `/api/*`, logs, and scheduled jobs or an external scheduler.

Migration sequence:

1. create staging with test secrets;
2. deploy static app and API handlers;
3. verify direct routes including `/admin/login` and `/admin/guest-inquiries`;
4. add the staging domain to Supabase Site URL/redirect allow-list;
5. register PayMongo test webhooks and Gmail URLs;
6. configure cron authorization;
7. keep the payout simulator off on hosted origins;
8. run authenticated acceptance, webhook, refund, deposit, reconciliation, and security tests;
9. preserve the old environment until rollback is proven; and
10. repeat with live keys only after owner and professional approval.

Do not reverse the local Vite adapter, canonical admin route, database guards, RLS, idempotency, ledger, or audit logic during migration. Only add the selected host adapter/configuration.

## 20. Weekly Operational Checklist

### Every development day

- [ ] Supabase project is active and reachable.
- [ ] Local environment checker passes without printing values.
- [ ] No secret appears in screenshots, logs, Git diff, or documentation.
- [ ] Guest inquiry submission and reply still work.
- [ ] Admin bell shows accurate queue counts and waiting time.
- [ ] Normal admin cannot open super-admin finance/retention routes.
- [ ] New vehicle/agreement edits return the vehicle to pending review.
- [ ] Build, lint, frontend/API checks, financial/reconciliation tests, browser smoke, and `git diff --check` pass.

### Before a demonstration

- [ ] Chapter 14 and Chapter 16 proof is complete.
- [ ] Test renter, lister, admin, and super-admin accounts are available.
- [ ] Test booking dates do not overlap or conflict with maintenance.
- [ ] Seven-photo pickup/return reports can upload to the private bucket.
- [ ] Deposit test uses test mode and is labeled refundable.
- [ ] Ledger entries balance and start only after activation.
- [ ] Reconciliation can detect a controlled mismatch without moving money.
- [ ] Simulator is labeled as no-wallet movement.
- [ ] Any PHP 100 deposit demonstration is labeled a local/test workflow, not a real PayMongo refund or wallet transfer.

### Before public hosting/live money

- [ ] Hosting/staging and rollback are proven.
- [ ] Supabase backups and restore test are documented.
- [ ] PayMongo webhooks, refund windows, wallet/Money Movement access, and reconciliation are proven.
- [ ] Monitoring alerts cover API errors, webhooks, cron, Gmail, uploads, payouts, refunds, and reconciliation.
- [ ] Privacy notice, terms, refund/cancellation, fees, deposit, agreement, insurance, and complaints are professionally reviewed.
- [ ] DPO/privacy, accountant/tax, insurance, consumer-law, and business/legal recommendations are documented.
- [ ] Accessibility/mobile/browser matrix passes.
- [ ] Live keys are separate from test keys and all exposed secrets are rotated.

## 21. Completed, Remaining, and Owner Actions

### Completed in the repository

- local API execution without Vercel;
- admin routing/login recovery and React provider/scroll fixes;
- real admin work-center bell and cleaner role-aware dashboard;
- multi-topic guest inquiry and Gmail reply;
- vehicle re-approval, insurance warnings, and maintenance blackouts;
- agreement version/hash/snapshot/acceptance;
- independent pickup/return reports with optional consented location;
- separate deposit claims and super-admin review;
- privacy/retention request workflow;
- append-only ledger, correction flow, and reconciliation dashboard;
- renter processing-charge support with itemized accounting;
- payout gating after trip/deposit/dispute completion;
- Chapter 14 implementation plus Chapter 16 verification SQL;
- frontend and server/API TypeScript validation;
- automated financial and reconciliation logic tests; and
- automated mobile/desktop browser accessibility smoke checks for public and unauthenticated admin routes.

### Still external or unfinished

- clean or clearly isolate the legacy car/booking/agreement records before the thesis demonstration;
- authenticated browser end-to-end tests for the complete renter/lister/admin workflow and physical upload/camera behavior;
- paid PayMongo test-mode webhook, refund, deposit, and reconciliation evidence in controlled staging;
- Money Movement API approval and a controlled PHP 100 transfer, if available;
- hosting/staging/callback/cron configuration;
- monitoring, backup restore, and incident evidence;
- authenticated accessibility/mobile/browser matrix, Firefox/Safari, screen-reader, camera, and physical-device evidence; and
- professional Philippine legal, privacy, insurance, consumer, accounting, and tax review.

### Project owner must do

- preserve a sanitized Chapter 16 result and a backup before future schema changes;
- prepare clean demonstration accounts and approve any provider action that would create permanent financial test records;
- choose hosting later and provide the domain;
- contact PayMongo for Money Movement wallet/recipient/API access;
- obtain professional reviews; and
- inspect, commit, and push the changes.

Codex must not invent wallet IDs, provider approvals, legal conclusions, or test results.

## 22. Reference Links

- National Privacy Commission, Data Privacy Act: https://privacy.gov.ph/data-privacy-act/
- National Privacy Commission, implementing rules: https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/
- National Privacy Commission, data-subject rights: https://privacy.gov.ph/data-subject-rights/
- E-Commerce Act (RA 8792): https://lawphil.net/statutes/repacts/ra2000/ra_8792_2000.html
- Consumer Act (RA 7394): https://lawphil.net/statutes/repacts/ra1992/ra_7394_1992.html
- Internet Transactions Act (RA 11967): https://lawphil.net/statutes/repacts/ra2023/ra_11967_2023.html
- DTI Internet Transactions Act IRR/JAO resources: https://ecommerce.dti.gov.ph/implementing-rules-regulations/
- BIR Revenue Regulations No. 7-2024: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%207-%202024.pdf
- Insurance Commission FAQs: https://www.insurance.gov.ph/faqs/
- PayMongo pricing: https://www.paymongo.com/pricing
- PayMongo Wallet: https://www.paymongo.com/products/money-movement/wallet
- PayMongo checkout retrieval API: https://docs.paymongo.com/reference/retrieve-a-checkout
- PayMongo payment-list API: https://docs.paymongo.com/reference/list-all-payments
- PayMongo ledger API: https://developers.paymongo.com/reference/list-ledger-entries
- PayMongo refunds: https://docs.paymongo.com/docs/payment-acceptance-refunds
- PayMongo disbursement reconciliation: https://docs.paymongo.com/docs/money-movement-disbursements-reconciliation
- PayMongo hold then capture: https://docs.paymongo.com/docs/payment-acceptance-hold-then-capture
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Philippine accessible website design guidelines: https://ncda.gov.ph/disability-laws/joint-circulars/accessible-website-design-guidelines/
- Turo trip-photo guide (industry comparator, not law): https://help.turo.com/en_us/trip-photos-guide-or-hosts-BkKcBEeN5
- Turo availability/calendar guidance (industry comparator, not law): https://help.turo.com/en_us/setting-custom-prices-HJmHSVgNc

## 23. Release Decision

**Controlled local/thesis demonstration:** ready for continued preparation. The local suite, live Supabase surfaces, role boundaries, PayMongo test wallet, unpaid checkout creation, and disposable booking journey pass. Use clean test records, PayMongo test mode, and clearly label any simulated payout/refund. A short human presentation rehearsal is still required because automation does not judge every authenticated screen, PDF, upload, or physical-device interaction.

**Public real-money launch:** not ready. Complete every external/hosting/legal/financial item above before live keys or public transactions are enabled.

## Appendix A. Security and Quality Standards

SafeDrive uses standards as engineering and review guides. They are not certifications, and the project must never claim that OWASP, ISO, or PCI has certified it.

| Reference | How SafeDrive uses it | Current evidence | Still required |
|---|---|---|---|
| OWASP Top 10:2025 | Application-risk checklist for access control, configuration, supply chain, cryptography, injection, design, authentication, integrity, logging, and exceptional conditions | RLS, server-side role checks, MFA support, hosted checkout, signed webhooks, audit/security logs, input validation, and failure-safe state changes | Authenticated penetration/authorization evidence, dependency-release process, monitoring, and an external security review before public launch |
| ISO/IEC 25010:2023 | Product-quality model covering functional suitability, performance, compatibility, interaction capability, reliability, security, maintainability, flexibility, and safety | Role-aware workflows, reusable TypeScript modules, responsive UI, guarded APIs, clear error states, and documented test/build checks | Full usability, load, resilience, accessibility, browser, and mobile evidence |
| PCI DSS v4.0.1 | Payment-scope reduction by sending card entry to PayMongo Hosted Checkout | SafeDrive does not intentionally collect or store raw card data; signed provider events, rather than the success redirect, authorize state changes | Confirm merchant responsibilities with PayMongo, prove live/test webhook controls, and do not claim PCI certification |

### A.1 OWASP control status

- **A01 Broken Access Control:** database RLS, server-side admin/super-admin guards, participant checks, and private buckets are implemented; the live role matrix passed 12 authorization checks, while broader authenticated penetration testing remains required before public launch.
- **A02 Security Misconfiguration:** environment separation, local secret checks, guarded error responses, and deployment-header configuration exist; the selected host must be reviewed before launch.
- **A03 Software Supply Chain Failures:** lockfile-based installs and build/lint checks exist; dependency alerts, release approval, software inventory, and incident procedures remain operational work.
- **A04 Cryptographic Failures:** TLS-provider usage, encrypted sensitive identity fields, hashes, and server-only secrets are designed; production key custody and rotation evidence remain required.
- **A05 Injection:** Supabase query builders, strict allow-lists, length/type checks, and server-derived amounts reduce injection and parameter-tampering risk; authenticated negative tests remain required.
- **A06 Insecure Design:** booking overlap guards, uniqueness guards, payout/refund/deposit gates, append-only ledger rules, and reconciliation holds address business-logic abuse; threat-model and abuse-case review should be repeated before launch.
- **A07 Authentication Failures:** Supabase authentication, password recovery, OTP/MFA support, and admin route guards exist; recovery, factor re-enrollment, lockout, and session evidence remain required.
- **A08 Software or Data Integrity Failures:** PayMongo signature/timestamp validation, expected amount/state checks, hashes, provider IDs, idempotency, and immutable journals protect integrity; provider staging evidence remains required.
- **A09 Security Logging and Alerting Failures:** append-only security logs (actor role snapshot, source IP, parsed device, session id, failure reason, attempted email), audit logs, admin queues, money-movement exception emails to admins, and critical reconciliation notifications exist; time-based retention, external alert delivery, and incident response remain hosting work.
- **A10 Mishandling of Exceptional Conditions:** API validation, bounded reconciliation batches, failed-run states, retry-safe records, and no-silent-money rules exist; failure-injection and outage exercises remain required.

### A.2 Security layers in plain language

- **Row Level Security:** the database checks who may read or change a row even if someone bypasses the visible page.
- **MFA:** a second proof of identity reduces the damage from a stolen password. An already enrolled authenticator normally asks for a code instead of showing a new QR setup.
- **Encryption and hashing:** encryption protects values that must later be recovered; hashing provides comparison or integrity evidence without exposing the original value.
- **Security logs versus audit logs:** security logs cover authentication and suspicious activity; audit logs record accountable business/admin actions and reasons.
- **Hosted checkout:** PayMongo collects payment details on its hosted interface. SafeDrive stores business and provider references, not raw card credentials.

## Appendix B. Thesis Defense Notes

### B.1 Thirty-second explanation

SafeDrive is a Philippine peer-to-peer car-rental platform where renters book approved vehicles from verified listers and administrators review identity, vehicles, support, safety, and financial exceptions. React and Vite provide the interface, Supabase supplies authentication/database/storage controls, PayMongo provides hosted checkout, and server APIs enforce pricing, roles, payment events, auditability, and release rules.

### B.2 One-minute security explanation

SafeDrive is reviewed against OWASP Top 10:2025 and ISO/IEC 25010:2023 and uses PCI DSS v4.0.1 scope-reduction practices through hosted checkout. Its layered controls include database RLS, admin and super-admin authorization, MFA support, private evidence storage, encrypted sensitive identity data, signed PayMongo webhooks, server-authoritative amounts, idempotency, security/audit logs, immutable financial journals, and manual review for money mismatches. These are implemented controls and design evidence, not formal certification.

### B.3 Honest answers for common panel questions

- **Is everything finished?** The requested local architecture and major controls are implemented, but live Supabase proof, authenticated end-to-end testing, provider evidence, hosting, monitoring, backup/restore proof, accessibility testing, and professional Philippine review remain before public real-money operation.
- **Why not trust the frontend?** Browser values can be altered. Critical roles, amounts, states, ownership, webhook signatures, and financial actions are checked again by the server and database.
- **Why an append-only ledger?** Editing history would make investigation unreliable. Final entries are corrected with an exact reversal and a new documented journal, preserving what happened and who corrected it.
- **Why collect optional location?** A consented timestamped capture may help establish where evidence was created, but it can be inaccurate, is not mandatory, and is never automatic proof of fault.
- **Why a separate deposit?** It is easier to disclose, account for as a refundable liability, review, and reconcile than hiding it inside rental revenue.
- **Does the renter always inherit payment fees?** No. SafeDrive currently supports a disclosed renter processing charge as a business decision. It must be itemized and reviewed with PayMongo and Philippine advisers before production.

Recommended statement: “SafeDrive is documented and reviewed against OWASP Top 10:2025 for application security risks, ISO/IEC 25010:2023 for software product quality, and PCI DSS v4.0.1 scope-reduction practices through hosted checkout. It does not claim formal OWASP, ISO, or PCI certification.”

## Appendix C. Gmail Apps Script Runbook

The executable source is `project_docs/SafeDrive_Email_Webhook_Code.gs`. Keep the source file because it is integration code, not duplicate documentation.

### C.1 Create and secure the script

1. Sign in to the Gmail account that should send SafeDrive messages and create a Google Apps Script project named `SafeDrive Email Webhook`.
2. Replace `Code.gs` with the repository `.gs` source.
3. Under Project Settings, add the Script Property `SAFEDRIVE_WEBHOOK_SECRET` with a newly generated random secret.
4. Put the same value in SafeDrive's server-only `GMAIL_WEBHOOK_SHARED_SECRET`. Never prefix it with `VITE_`.

### C.2 Deploy

1. Choose Deploy, New deployment, Web app.
2. Execute as the owner account and allow access needed for the SafeDrive server-to-server request.
3. Deploy and copy the `/exec` URL, not a `/dev` URL.
4. Opening the URL should return a JSON status naming `SafeDrive Gmail webhook` and the expected source version. If it does not, deploy the current `.gs` code as a new version.

### C.3 Configure SafeDrive

- `GMAIL_GUEST_INQUIRY_WEBHOOK_URL` is the deployed `/exec` fallback URL for administrator replies when Resend is not configured.
- `GMAIL_RETURN_REMINDER_WEBHOOK_URL` may use the same `/exec` URL as a fallback for reminders when Resend is not configured.
- `GMAIL_WEBHOOK_SHARED_SECRET` must exactly match `SAFEDRIVE_WEBHOOK_SECRET`.
- Local values belong in the ignored `.env`; hosted values belong in the selected host's encrypted server environment.
- Restart local development or redeploy the host after changing environment values.

### C.4 Acceptance test

1. Submit a public inquiry without signing in.
2. Confirm that the admin bell and guest-inquiry page show it as open with an exact wait time.
3. Start review and confirm the visible state becomes In review.
4. Send an administrator reply.
5. Confirm receipt in the guest email account.
6. Confirm the inquiry becomes resolved only after Apps Script reports successful delivery.
7. Force a bad secret or old deployment once in a controlled environment and confirm failure leaves the inquiry unresolved and retryable.

Never publish the shared secret, provider keys, identity evidence, or private customer messages in Git, screenshots, or thesis appendices.

## Appendix D. Evidence Capture Register

Use sanitized screenshots or exported command output. Never expose environment values, access tokens, private documents, email content, wallet identifiers, or service-role keys.

### D.1 Repository evidence

- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] `npm run check:api` passes.
- [ ] `npm run check:booking-flow` passes.
- [ ] `npm run check:financial-logic` passes.
- [ ] `npm run check:reconciliation-logic` passes.
- [ ] `npm run check:browser` passes at mobile and desktop sizes.
- [ ] `npm run check:local-env` passes without printing secret values.
- [ ] `npm run check:live-supabase` passes when the intended project is reachable; until then, record the DNS failure as blocked.
- [ ] `git diff --check` passes.
- [ ] Direct local routes return the application, including `/admin/login`, `/admin/guest-inquiries`, `/privacy-request`, and `/my-bookings`.
- [ ] Unauthenticated protected API requests return 401 or 403 without leaking internals.

### D.2 Supabase evidence

- [ ] Backup/export exists before Chapter 14.
- [ ] Chapter 14 succeeds as a selected transaction.
- [ ] Chapter 16 reports no missing objects or integrity findings.
- [ ] RLS/policy output proves renter, lister, admin, super-admin, and unrelated-user behavior.
- [ ] `trip-condition-evidence` is private and its participant/admin policy tests pass.
- [ ] Vehicle/agreement edit returns the listing to pending review.
- [ ] Active booking overlap and maintenance conflict are rejected.
- [ ] Ledger activation time and seeded accounts are visible without historical backfill.
- [ ] Finalized journals balance and cannot be edited/deleted by browser roles.

### D.3 Workflow evidence

- [ ] Guest multi-topic intake, Start review, Gmail reply, failure retry, and resolution are proven.
- [ ] Bell counts match open work and show exact elapsed waiting time.
- [ ] Normal admin cannot open super-admin finance/retention routes.
- [ ] Renter and lister independently submit pickup and return reports with seven required photos.
- [ ] Denying optional location does not block a report.
- [ ] Agreement hash/version is snapshotted and renter acceptance receives a server timestamp.
- [ ] Deposit payment, claim window, response, decision, release/refund, failure, and audit trails are proven in test mode.
- [ ] Reconciliation detects a controlled mismatch and does not silently move money or rewrite provider truth.

### D.4 Hosting and professional evidence

- [ ] The chosen host supports Vite static output, Node-compatible APIs, SPA fallback, encrypted secrets, HTTPS callbacks, logs, and scheduling.
- [ ] Staging, rollback, callbacks, cron authorization, monitoring, and backup restoration are proven.
- [ ] PayMongo test checkout, refund, deposit, signed webhooks, and reconciliation evidence is captured.
- [ ] Money Movement approval and an actual controlled PHP 100 test transfer are documented only if PayMongo provides the required wallet/recipient/API access.
- [ ] Accessibility checks cover keyboard, screen reader, focus, contrast, zoom, responsive sizes, Chrome, Edge, Firefox, Safari/WebKit where available, Android, and iOS.
- [ ] Philippine privacy/DPO, consumer/e-commerce, insurance, accounting/tax, and business/legal reviewers provide written recommendations before public launch.

## Appendix E. Decision Defense Handbook

This appendix gives the group a consistent way to defend SafeDrive's design choices. Each entry separates the implemented or proposed decision from its support and from claims that still require professional or provider confirmation. The cited sources are listed in Chapter 22.

Use this answer pattern during a defense: state the problem, name the control, explain the evidence it preserves, cite the relevant authority or engineering principle, and admit the remaining limitation. Do not describe a SafeDrive policy as legally required unless the cited authority actually requires it.

### E.1 Guest inquiries are separate from registered support tickets

- **Decision:** A visitor can ask a general question with a name, email, optional phone, one or more topics, and a message without creating an account. Account, booking, payment, and dispute cases remain authenticated support tickets.
- **Why:** Requiring registration for a simple pre-service question creates unnecessary friction and collects more identity data than the inquiry needs. Authenticated cases need account and transaction context, so they belong in the support system.
- **Support:** Data Privacy Act Section 11 supports proportional collection. Internet Transactions Act Sections 21 to 24 support direct communication and an accessible, efficient redress mechanism. This is also a normal separation between public presales contact and authenticated customer support.
- **Defense answer:** "We collect only enough information to answer a visitor. If the concern involves an account, booking, payment, or dispute, we move it to authenticated support so the case can be tied safely to the correct user and transaction."
- **Proof and limitation:** Demonstrate public submission, multi-topic selection, admin receipt, reply, and resolution. The workflow is not a substitute for formal complaint handling where law or policy requires additional records.

### E.2 Multi-select topics replace an optional car-model field

- **Decision:** Visitors can select several common concerns; a car model is not requested in the generic inquiry form.
- **Why:** Topics help administrators triage a message without assuming that every visitor wants to list a vehicle. Vehicle specifications belong in the controlled listing and approval workflow, where validation and evidence are available.
- **Support:** Data minimization and purpose limitation under Data Privacy Act Section 11 favor fields that are necessary for the stated purpose. Structured categories also improve routing and reporting without demanding unrelated details.
- **Defense answer:** "A topic tells us where to route the question. A car model does not help most inquiries and would duplicate the verified listing process, so we do not collect it by default."
- **Proof and limitation:** Show several selected topics stored with one inquiry and used by the admin queue. Free-text messages still need human review because categories cannot capture every concern.

### E.3 The admin notification center is a work queue, not only a message feed

- **Decision:** The bell summarizes open user inquiries, support tickets, user and vehicle reviews, and financial exceptions. Each item shows the exact elapsed wait and opens the relevant review page; opening an item to act on it claims it (ownership/state change) so another admin sees it is being handled.
- **Why:** Counts alone do not show urgency or whether someone is already handling an item. A work queue reduces overlooked requests and duplicate effort.
- **Support:** The Internet Transactions Act calls for responsive redress, while OWASP logging and exceptional-condition guidance supports actionable monitoring rather than silent failure. The exact wait is a usability choice, not a statutory service-level promise.
- **Defense answer:** "The notification center turns pending work into an accountable queue. Administrators see what needs action, how long it has waited, and whether review has started."
- **Proof and limitation:** Compare notification counts with source records and show wait-time updates. Response targets still need an approved operations policy and staffing plan.

### E.4 Normal admins and super-admins have different financial authority

- **Decision:** Both roles handle ordinary moderation and support, but only super-admins can access payouts, refunds, the financial ledger, reconciliation, and retention/deletion decisions.
- **Why:** Money movement and irreversible privacy decisions have greater impact and need narrower authority. Separation of duties reduces accidental or unauthorized action.
- **Support:** Data Privacy Act Section 20 requires reasonable organizational and technical safeguards. OWASP Broken Access Control guidance and least-privilege practice support server and database enforcement of role boundaries.
- **Defense answer:** "We separated high-impact financial and privacy decisions from ordinary moderation. A normal admin can operate the platform but cannot release money, approve refunds, alter financial evidence, or decide deletion requests."
- **Proof and limitation:** Test the same URL and API with admin and super-admin accounts. Hidden menus are not proof; the API and database must return 403 or deny the operation.

### E.5 Authorization is enforced beyond the visible interface

- **Decision:** Sensitive actions are checked by server APIs and Supabase policies, not merely hidden in React navigation.
- **Why:** A user can modify browser code or call an endpoint directly. Interface hiding improves clarity but does not provide security.
- **Support:** OWASP Broken Access Control directly treats missing server-side authorization as a major risk. Data Privacy Act Section 20 supports technical access controls for personal information.
- **Defense answer:** "The frontend expresses permissions, but the server and database enforce them. Even a manually crafted request must still pass identity, role, ownership, and state checks."
- **Proof and limitation:** Capture authenticated 401/403 and RLS tests for unrelated users and lower roles. These tests must be repeated against the live Supabase project and selected host.

### E.6 Material vehicle edits return a listing to approval

- **Decision:** When a lister changes material vehicle or agreement information, the listing returns to pending review before public use.
- **Why:** Approval applies to the facts reviewed at that time. Allowing later changes to remain automatically approved would let a lister bypass verification.
- **Support:** Internet Transactions Act Sections 21 to 23 emphasize accurate offers, ordinary diligence, and the described quality of online goods or services. OWASP Insecure Design supports controls against approval-workflow bypass.
- **Defense answer:** "Approval is attached to a reviewed version, not permanently to the vehicle record. Material changes invalidate that review until an admin checks the new information."
- **Proof and limitation:** Edit insurance, agreement, identity-sensitive, or material listing fields and show the pending state and audit entry. The exact list of material fields must be maintained as the product evolves.

### E.7 Insurance fields distinguish CTPL from broader protection

- **Decision:** SafeDrive records policy details and warns that CTPL alone does not establish comprehensive vehicle-damage or rental-use coverage.
- **Why:** A registration-related CTPL policy primarily addresses compulsory third-party liability; it should not be presented as proof that peer-to-peer rental damage or commercial use is covered.
- **Support:** Insurance Commission guidance explains the compulsory nature and scope of CTPL. Insurer terms, exclusions, and permitted use must still be confirmed for each policy.
- **Defense answer:** "We do not treat CTPL as complete rental protection. We record the declared policy and warn users that vehicle damage and rental use require separate confirmation from the insurer."
- **Proof and limitation:** Show policy fields, expiry warning, document review, and the user-facing disclaimer. SafeDrive is not an insurer and cannot independently guarantee coverage.

### E.8 Maintenance and blackout dates block unavailable vehicles

- **Decision:** Listers can mark maintenance or other unavailability, and active bookings cannot overlap those periods.
- **Why:** A vehicle known to be unavailable or under maintenance should not be offered for rent. Database conflict checks also prevent two active bookings for the same date range.
- **Support:** The Internet Transactions Act supports accurate service descriptions and completion according to the contract. Database exclusion/overlap constraints are a direct business-integrity control.
- **Defense answer:** "Availability is enforced as data, not as a note. The system rejects a booking if it conflicts with another active booking or a maintenance blackout."
- **Proof and limitation:** Attempt conflicting inserts and capture the rejection. This control cannot prove mechanical roadworthiness; inspection and maintenance procedures remain operational responsibilities.

### E.8.1 One trip per renter at a time

- **Decision:** A renter cannot hold two overlapping active bookings, even on different cars. `api/create-booking.ts` checks the renter's own active bookings across every car (not just the car being booked) and rejects an overlap; `api/booking-extension-action.ts` applies the same rule to the extended date range. The database exclusion constraint stays per-car (`bookings_no_active_date_overlap`); this renter-scope rule is enforced in the API.
- **Why:** SafeDrive is peer-to-peer. The lister meets and hands the car to the verified account holder, who is the driver and the person accountable under the agreement and CTPL. Two overlapping bookings would mean someone other than the account holder drives one of the cars, breaking identity, liability, and insurance assumptions. A car for another person must be booked from that person's own verified account.
- **Defense answer:** "The account holder is the driver. The system will not let one renter reserve two cars for the same dates - a car for someone else has to be booked from their own account."

### E.9 Rental agreements are versioned and accepted with server evidence

- **Decision:** The lister supplies vehicle-specific rules; SafeDrive snapshots the approved version and hash, and records the renter's acceptance with a server timestamp.
- **Why:** The parties need to know which exact terms applied when the booking was accepted. A later lister edit must not silently rewrite an earlier agreement.
- **Support:** Republic Act 8792 recognizes electronic data messages, documents, and signatures when reliability and integrity requirements are met. Versioning, hashing, and server timestamps strengthen evidence but do not automatically prove every contract term is valid.
- **Defense answer:** "We preserve the exact agreement version the renter accepted. The hash detects later alteration, and the server timestamp avoids relying only on the user's device clock."
- **Proof and limitation:** Show two agreement versions, a stored hash, acceptance record, and unchanged booking snapshot after a later edit. Final contract wording needs Philippine legal review.

### E.10 Both parties submit pickup and return condition reports

- **Decision:** Renter and lister independently submit required exterior/interior evidence at pickup and return, with server timestamps and an optional consented location capture.
- **Why:** Independent before-and-after records make damage, cleanliness, fuel, and handover discussions less dependent on one party's account.
- **Support:** The records support contract performance, dispute handling, and ordinary diligence. Data Privacy Act principles require evidence to be relevant, protected, and retained only as justified.
- **Defense answer:** "We ask both parties for the same structured evidence at both handover points. The reports do not decide fault automatically; they create a reviewable record."
- **Proof and limitation:** Demonstrate seven required photos per report, participant-only access, immutable submission time, and independent submissions. Photos can be incomplete or misleading, so a human dispute process is still required.

### E.11 Location evidence is optional, consented, and secondary

- **Decision:** Location may be captured when the user presses the relevant action and grants browser permission. Refusal does not block the report.
- **Why:** Location can help explain where evidence was created, but it is personal data, may be inaccurate, and is not necessary for every user or device.
- **Support:** Data Privacy Act Sections 11 and 12 support transparency, proportionality, and an appropriate lawful basis. Device accuracy and capture time are stored so the value is not overstated.
- **Defense answer:** "Location is optional corroborating context, not automatic proof of fault or presence. The report still works when consent is denied."
- **Proof and limitation:** Test allow and deny paths and show latitude, longitude, accuracy, and server/capture times only when granted. GPS can be unavailable or spoofed and must be weighed with other evidence.

### E.12 The security deposit is a separate refundable liability

- **Decision:** SafeDrive uses Option B: collect a clearly itemized deposit separately, hold it through the rental, allow a limited claim/response review, then release or refund according to the decision.
- **Why:** A deposit is not earned rental income. Separating it improves disclosure, accounting, refund handling, and dispute review.
- **Support:** Consumer transparency principles under the Internet Transactions Act support clear price components and redress. Accounting logic treats amounts owed back to a customer as liabilities until a valid disposition occurs. PayMongo's actual supported payment/refund methods must be confirmed.
- **Defense answer:** "We separate the deposit because it remains refundable and should not inflate revenue. Any deduction needs evidence, a response opportunity, a reasoned decision, and an audit trail."
- **Proof and limitation:** Demonstrate deposit payment, no-claim release, claim, response, decision, refund/failure, and ledger treatment. The claim window and policy are SafeDrive choices requiring legal and provider review.

### E.13 Financial journals are append-only and double-entry

- **Decision:** New in-scope transactions create balanced debit and credit entries in centavos. Finalized entries cannot be edited or deleted; corrections use an exact reversal and a new journal with a reason.
- **Why:** Mutable totals make it difficult to explain who changed money records and why. Double-entry detects imbalance, while reversals preserve history.
- **Support:** BIR Revenue Regulations No. 7-2024 support retaining books, accounting records, and source documents. Append-only double-entry is an accounting and auditability control; SafeDrive still needs an accountant to approve account mapping and tax treatment.
- **Defense answer:** "We never repair financial history by overwriting it. Every journal must balance, and a correction records the original, its reversal, the replacement, the actor, time, and reason."
- **Proof and limitation:** Show a balanced booking journal, failed update/delete, and reversal chain. Ledger activation starts fresh; earlier records are not backfilled or represented as complete history.

### E.14 Security deposits are not counted as income

- **Decision:** Deposit collection credits a deposit-liability account rather than rental revenue; only a justified final disposition can move an approved amount.
- **Why:** Counting refundable money as income would overstate earnings and make refunds and reconciliation unreliable.
- **Support:** This follows basic liability-versus-revenue accounting logic and the ledger's economic-event model. Final Philippine accounting and tax classification requires professional confirmation.
- **Defense answer:** "The deposit is money SafeDrive may owe back, so we record it as a liability until the claim period and any dispute are resolved."
- **Proof and limitation:** Show ledger accounts and journals for collection, full release, partial decision, and refund. The system record does not replace formal financial statements or tax advice.

### E.15 Reconciliation compares provider truth with SafeDrive truth

- **Decision:** Reconciliation flags missing, duplicate, mismatched, pending, failed, or unbalanced records instead of silently changing either system.
- **Why:** The application database and payment provider are separate systems. Network failures, repeated webhooks, manual provider actions, or coding errors can cause them to disagree.
- **Support:** PayMongo publishes reconciliation guidance based on provider identifiers, amounts, statuses, and terminal states. OWASP integrity and exceptional-condition guidance supports explicit mismatch handling.
- **Defense answer:** "A completed label in SafeDrive is not enough. We match it to the provider reference, amount, status, and ledger result; uncertain money is held for review rather than guessed."
- **Proof and limitation:** Inject controlled mismatches and show the alert, hold, assignment, resolution reason, and audit trail. A full provider page produces an explicit truncation warning; live proof requires PayMongo test exports/events, verified pagination behavior, and the selected host's scheduled job. Shared merchant accounts require scoping or manual review of unrelated provider payments.

### E.16 Reconciliation findings have defined safe responses

- **Decision:** Provider-only payment: investigate and import through a controlled recovery; SafeDrive-only completion: freeze fulfillment/payout; duplicate ID: quarantine duplicates; amount mismatch: hold and review; slow/failed payout: notify and retry only when safe; refund mismatch: block closure; deposit-as-income: reverse and repost; unbalanced journal: reject finalization.
- **Why:** Detection without a response plan leaves administrators to improvise with money. The safest default is no silent movement and no destructive rewriting.
- **Support:** PayMongo refund and reconciliation documentation distinguishes provider states and transaction identifiers. Append-only corrections and least-privilege review protect the evidence trail.
- **Defense answer:** "Every mismatch maps to a conservative action: hold, investigate, reconcile with provider evidence, then record a reasoned correction. We do not force a status merely to make the dashboard green."
- **Proof and limitation:** Demonstrate each finding with synthetic/test records. Automatic repair should remain limited to cases with deterministic, provider-confirmed evidence.

### E.17 Payout waits for completion and unresolved-risk checks

- **Decision:** Lister payout is not eligible until the rental is completed, required return evidence is submitted, the deposit/claim state is clear, and no dispute or reconciliation hold remains.
- **Why:** Paying too early can leave SafeDrive unable to respond to a refund, failed service, damage claim, or provider mismatch.
- **Support:** Contract-completion and consumer-redress principles support verifying fulfillment before final release. PayMongo Money Movement capabilities and merchant terms determine what payout flow is technically allowed.
- **Defense answer:** "We separate payment collection from payout eligibility. The lister is paid after the agreed service and required evidence are complete and no unresolved hold remains."
- **Proof and limitation:** Show eligibility reasons before and after each gate. Exact settlement timing, reserves, and payout rail behavior require PayMongo confirmation and an approved operations policy.

### E.18 Hosted checkout reduces payment-card exposure

- **Decision:** Customers enter payment data on PayMongo's hosted checkout, while SafeDrive stores internal records and provider references rather than raw card credentials.
- **Why:** Direct card collection would expand security scope and risk. The success redirect is not trusted as final payment authority; signed provider events confirm state.
- **Support:** Hosted payment pages are a PCI scope-reduction practice. PayMongo documentation and merchant obligations still apply; this design is not a claim of PCI certification.
- **Defense answer:** "PayMongo handles card entry on its hosted page. SafeDrive authorizes business state changes from validated provider events, not from a browser success screen."
- **Proof and limitation:** Show hosted redirection, absence of raw card fields/storage, signature and timestamp validation, and rejected invalid events. Merchant PCI responsibilities must be confirmed with PayMongo.

### E.19 Webhook idempotency prevents duplicate financial effects

- **Decision:** Repeated provider events are recorded and recognized so one payment/refund event cannot create duplicate completed records or ledger effects.
- **Why:** Payment providers retry events when delivery is uncertain. Network repetition is expected and must not charge, refund, or post twice.
- **Support:** Idempotency keys and controlled provider references are standard payment-integration integrity controls and align with OWASP Software and Data Integrity Failures guidance. SafeDrive uniquely constrains the event key; the provider reference may legitimately appear on multiple component journals from one checkout.
- **Defense answer:** "The same event key may arrive more than once, but it can affect SafeDrive only once. A provider checkout can still be referenced by each legitimate payment component without duplicating the event."
- **Proof and limitation:** Replay an identical signed test event and show one state transition and one journal. Different but related provider events still require type- and state-specific handling.

### E.20 A renter processing charge is disclosed, not assumed by law

- **Decision:** The architecture can itemize a configurable renter processing charge, but production activation requires PayMongo and Philippine legal/accounting confirmation.
- **Why:** SafeDrive needs transparent pricing and a way to recover approved transaction costs. A consumer paying a transfer fee in another app does not automatically create a legal rule for this marketplace.
- **Support:** Internet Transactions Act price and offer-transparency duties support clear pre-acceptance itemization. PayMongo publishes its own merchant pricing, which may be exclusive of VAT; merchant terms determine whether and how fees may be passed on.
- **Defense answer:** "Charging the renter is a disclosed SafeDrive pricing decision, not an automatic legal entitlement. The total must be visible before acceptance and reviewed with PayMongo and professional advisers."
- **Proof and limitation:** Show the rental amount, deposit, processing charge, taxes if applicable, and total separately before checkout. Do not enable or defend a live surcharge until provider terms and Philippine requirements are confirmed.

### E.21 Local payout simulation is not a real wallet transfer

- **Decision:** Local development may simulate pending, succeeded, and failed payouts without contacting PayMongo. A real controlled PHP 100 transfer is a separate provider test.
- **Why:** Developers need deterministic failure-path testing without moving money. A simulator validates SafeDrive state logic but cannot prove PayMongo wallet, recipient, institution, or settlement behavior.
- **Support:** Test-mode separation and explicit environment guards reduce accidental real-money actions. PayMongo Money Movement documentation and account approval control real transfer capability.
- **Defense answer:** "The local simulator proves our workflow reactions, not a bank transfer. Real payout proof will be a separately authorized PHP 100 test with provider IDs and reconciliation evidence."
- **Proof and limitation:** Show simulator banners, environment guards, idempotent retries, and all three states. PayMongo test mode does not prove a real refund, and the simulator never calls the wallet. Do not use sandbox-completion flags in production or claim a simulated payout/refund reached a recipient.

### E.22 Retention and deletion are handled as requests, not waived by terms

- **Decision:** Users can submit privacy requests. A super-admin verifies identity and scope, records the decision, deletes or blocks eligible data, and retains only data still justified by law, legal claims, fraud/security needs, or a documented legitimate purpose.
- **Why:** A blanket agreement cannot erase statutory data-subject rights. Immediate deletion can also destroy accounting, dispute, security, or legal evidence that must lawfully remain.
- **Support:** Data Privacy Act Sections 11 and 16 and NPC erasure guidance recognize both the right to request erasure/blocking and lawful grounds for partial or temporary denial. BIR rules support retention of accounting/source records.
- **Defense answer:** "The agreement explains the process; it does not cancel the user's rights. We delete what is eligible, explain any lawful hold, restrict access, and keep an audit record of the decision."
- **Proof and limitation:** Demonstrate submission, identity verification, itemized scope, partial approval/hold, execution, and notification. Final schedules and response wording need DPO and Philippine legal review.

### E.23 Audit logs and security logs answer different questions

- **Decision:** Audit logs record accountable business changes; security logs record authentication, authorization failures, and suspicious technical events. Neither should store plaintext secrets or unnecessary sensitive content.
- **Why:** Investigators need to know both "who changed the booking or money record" and "who attempted suspicious access." Mixing them makes monitoring and retention harder.
- **Support:** Data Privacy Act Section 20 supports appropriate security measures, and OWASP Security Logging and Alerting Failures supports monitoring meaningful events while avoiding sensitive-data leakage.
- **Defense answer:** "Audit logs explain business actions and reasons; security logs explain access and attack signals. We link them when needed but limit the data in each."
- **Proof and limitation:** Show actor, action, object, reason, timestamp, and correlation ID without keys, tokens, or full private evidence. Monitoring and off-platform alert delivery remain hosting work.
- **`security_logs` fields:** `created_at`, `event_type` (login success/fail, logout, OTP, authenticator, lockout, password change/reset, session timeout, suspicious activity, webhook signature), `status`, `auth_method`, `user_id`, `target_email` (the address entered, for failed logins with no user), `actor_role` + `actor_is_lister` (snapshot at event time - roles change), `session_id` (Supabase session; ties a login to its later logout), `failure_reason`, `ip_address`, `user_agent`, and a sanitized `details` JSON (a blocked-key filter drops anything matching password/otp/token/secret/cookie). The table is append-only: RLS grants admins `SELECT` and only a validated server route `INSERT`; there is no `UPDATE`/`DELETE` policy. `/admin/security-logs` shows role, IP, parsed device, and the failure reason, filterable by role and date. Server-side write path is `api/record-security-event.ts`; client trigger is `src/lib/securityLog.ts`. Time-based retention and off-platform alerting remain hosting work.

### E.24 Gmail replies use a shared secret and fail safely

- **Decision:** SafeDrive calls the deployed Gmail Apps Script over HTTPS with a server-only shared secret. An inquiry becomes resolved only after the email service confirms success.
- **Why:** A public Apps Script URL should not send arbitrary email for unauthenticated callers, and delivery failure must not falsely close the inquiry.
- **Support:** Shared-secret authentication is a practical server-to-server control for this thesis integration; failure-safe state transitions align with OWASP exceptional-condition guidance.
- **Defense answer:** "The URL alone is not trusted. Both systems share a secret, and SafeDrive keeps the inquiry open and retryable unless the email callback reports success."
- **Proof and limitation:** Test correct secret, wrong secret, old deployment, delivery error, retry, and success. For production scale, a managed transactional-email service with stronger identity, observability, rate limits, and delivery reporting may be preferable.

### E.25 Accessibility and multi-device testing are release evidence

- **Decision:** SafeDrive tests keyboard use, focus, labels, errors, contrast, zoom, responsive sizes, major browsers, screen readers, Android, and iOS where available.
- **Why:** A responsive screenshot does not prove that users with disabilities or different devices can complete booking, payment, evidence, or admin tasks.
- **Support:** WCAG 2.2 provides international success criteria. Philippine NCDA accessible-web guidance demonstrates the country's policy direction, although the cited joint circular directly addresses government websites and does not by itself certify this private platform.
- **Defense answer:** "We use WCAG 2.2 as the measurable test basis and record real browser, keyboard, assistive-technology, and mobile evidence. We do not claim compliance from code inspection alone."
- **Proof and limitation:** The automated mobile/desktop public-route smoke check currently passes and includes semantic labels, headings, image alternatives, overflow, and crash detection. Keep a dated device/browser matrix for authenticated, keyboard, screen-reader, Firefox, Safari, Android, and iOS testing with issue, severity, fix, retest, and evidence. Formal accessibility conformance requires broader testing and should not be claimed prematurely.

### E.26 Local Vite development is independent of Vercel

- **Decision:** The React/Vite interface and local Node-compatible API adapter can run on the development machine while public hosting is deferred.
- **Why:** Vite is the build/development tool; Vercel was one hosting option, not an architectural requirement. Local operation lets the thesis team test safely while comparing hosts.
- **Support:** The technical boundary is the required runtime: static SPA delivery, Node-compatible APIs, HTTPS callbacks, secret storage, logs, and scheduling. A future host must satisfy those capabilities.
- **Defense answer:** "SafeDrive does not depend on the Vercel brand. It depends on documented frontend and server capabilities, so we can test locally and migrate by reconfiguring the deployment layer."
- **Proof and limitation:** Show local direct routes, API calls, restart behavior after environment changes, and a production build. Public callbacks, cron jobs, monitoring, and TLS remain unproven until a host is selected.

### E.27 The database master is consolidated but intentionally selective to run

- **Decision:** `SAFE_DRIVE_DATABASE_MASTER.sql` is the single canonical reference, organized into chapters. Operators run the implementation chapter and then the verification chapter, not the entire file from top to bottom.
- **Why:** Consolidation removes contradictory copies, while chapter boundaries preserve context, migration order, verification, and non-executable explanatory material.
- **Support:** Controlled migrations, transactions, preflight checks, and post-deployment verification are standard database change-management practices. A single file does not make every chapter automatically executable.
- **Defense answer:** "One canonical SQL file prevents drift, but execution remains controlled. We back up, run the designated transaction, then run verification and keep the results as evidence."
- **Proof and limitation:** Show the selected Chapter 14 transaction, Chapter 16 findings, schema objects, RLS tests, and backup. Never run the whole master blindly against production.

### E.28 Historical finance starts at an activation boundary

- **Decision:** The ledger begins from a recorded activation timestamp and does not invent journals for earlier bookings or payments.
- **Why:** Backfilling without complete source evidence could create false accounting history. An explicit boundary is more honest and auditable.
- **Support:** Record integrity is stronger when the system identifies the period its evidence actually covers. Any later historical import must be a separately approved, source-supported migration.
- **Defense answer:** "We start clean at a documented activation time. We do not claim the ledger proves transactions that happened before the ledger existed."
- **Proof and limitation:** Show activation configuration and that pre-activation transactions are excluded. If stakeholders later require comparative history, an accountant-led migration and reconciliation project is needed.

### E.29 Public real-money launch remains a separate decision

- **Decision:** Passing local tests does not automatically authorize public hosting, live PayMongo keys, or real payouts.
- **Why:** Production adds external risks: domain and TLS configuration, secrets, callbacks, monitoring, backups, provider approvals, privacy operations, legal terms, insurance representations, tax/accounting treatment, and incident response.
- **Support:** OWASP, ISO/IEC 25010, PCI scope-management practice, Data Privacy Act safeguards, consumer rules, and provider terms all require operational evidence beyond a local build.
- **Defense answer:** "The thesis can demonstrate implemented controls in a controlled environment while honestly marking production dependencies. We will not call the system production-ready until provider, hosting, legal, privacy, accounting, accessibility, and recovery evidence is complete."
- **Proof and limitation:** Use the release checklist and Evidence Capture Register. Avoid claims of formal OWASP, ISO, PCI, legal, insurance, or accessibility certification unless an authorized assessment has actually been completed.

### E.30 Quick source-to-decision map

- **Data Privacy Act and NPC guidance:** minimal guest fields, optional location, access control, private evidence, retention schedules, erasure/blocking requests, lawful holds, and security measures.
- **E-Commerce Act (RA 8792):** electronic agreement, version, hash, acceptance, timestamp, and integrity evidence.
- **Internet Transactions Act (RA 11967):** transparent offers and prices, responsive redress, platform diligence, merchant verification, accurate descriptions, privacy precautions, and electronic receipts.
- **BIR Revenue Regulations No. 7-2024:** retention of financial books, accounting records, source documents, and longer preservation where a claim or investigation remains open.
- **Insurance Commission guidance:** CTPL should not be represented as comprehensive vehicle-damage or rental-use protection.
- **PayMongo documentation and terms:** hosted payment behavior, provider identifiers/statuses, refunds, reconciliation, payout capabilities, pricing, and merchant responsibilities.
- **OWASP Top 10:2025:** server-side access control, secure configuration, integrity, business-logic design, logging, and failure-safe handling.
- **ISO/IEC 25010:2023:** functional suitability, reliability, security, compatibility, usability/interaction capability, maintainability, flexibility, performance, and safety as quality review dimensions.
- **PCI DSS v4.0.1 scope-reduction practice:** hosted checkout reduces direct card-data exposure but does not remove merchant responsibilities or create certification.
- **WCAG 2.2 and Philippine accessibility guidance:** measurable keyboard, focus, labels, contrast, error, zoom, responsive, and assistive-technology evidence.

This handbook is a design-defense aid, not a substitute for advice from a Philippine lawyer, Data Protection Officer, accountant/tax adviser, insurer, accessibility specialist, PayMongo, or the selected hosting provider.

## Appendix F. Change Register and Host-Migration Reversal Map

This appendix is the weekly migration reference requested by the group. "Reverse" does not mean removing safety controls or rewriting data. It means separating host-specific configuration from permanent SafeDrive behavior, preserving rollback evidence, and reverting only an unproven deployment adapter if necessary.

Dated, change-by-change entries (what changed, why, which files, follow-up) are kept in the repository root `CHANGELOG.md`. That file is the running log; this appendix stays as the structural reference for what is permanent versus host-specific.

### F.1 Permanent application and database behavior

Keep these changes when moving from localhost to any host:

- canonical routes, including `/admin/login`, compatibility redirects, role guards, and SPA routing;
- server-side admin/super-admin checks and Supabase RLS;
- multi-topic guest intake, Start review, Gmail failure-safe reply, exact queue age, and admin notifications;
- vehicle re-approval after vehicle/image/agreement changes;
- versioned agreement hashes, booking snapshots, and server acceptance timestamps;
- maintenance/blackout conflict checks;
- independent pickup/return reports, required photo categories, private evidence, and optional consented location;
- separate security-deposit liability, claim review, terminal-state payout gate, and audit trail;
- append-only balanced journals, exact reversals, idempotent event keys, and reconciliation findings;
- privacy-request workflow, documented lawful holds, and restricted super-admin decisions; and
- webhook signature/timestamp validation, amount/state checks, uniqueness guards, and audit/security logs.

Removing these during hosting would be a functional/security regression, not a normal migration step.

### F.2 Host-specific items that may change

| Item | Local form | Hosted form | Rollback rule |
|---|---|---|---|
| Frontend delivery | Vite development server | Static `dist` output with SPA fallback | Keep local commands; remove only the failed host adapter/config |
| API execution | Local `/api/*` adapter | Node-compatible functions/service | Preserve handlers and routes; revert only host wrappers |
| Environment | Ignored `.env` | Encrypted host variables | Never copy secrets into frontend variables or Git; rotate after exposure |
| Public URLs | `127.0.0.1` / localhost | HTTPS domain | Restore prior Supabase/callback allow-list if rollback occurs |
| PayMongo webhook | Local/manual test or tunnel | Public HTTPS `/api/webhooks/paymongo` | Disable failed new endpoint before restoring the previous registered endpoint |
| Gmail callback | Apps Script `/exec` | Same server-only URL/secret | Keep the last known-good Apps Script deployment and secret until cutover succeeds |
| Scheduled jobs | Manual/localhost | Host cron or external scheduler with `CRON_SECRET` | Disable new schedule before restoring previous scheduler |
| Payout simulator | Local `true` only | Omitted/false | Never enable simulator on a hosted origin |
| Logs/monitoring | Local console and database records | Host logs plus alerts | Preserve database audit/reconciliation evidence across rollback |

### F.3 Database migration and rollback discipline

1. Confirm the intended Supabase project URL and take a backup before any SQL.
2. Save a sanitized Chapter 16 preflight result.
3. Apply only Chapter 14 inside its transaction; never run the master from Chapter 1.
4. Run Chapter 16 and role/policy tests.
5. Prefer a forward repair if a new object is wrong. Do not drop tables, finalized journals, audit rows, agreement versions, or evidence merely to return to an earlier application version.
6. If application rollback is required, deploy the previous known-good application while leaving compatible additive database objects in place.
7. Use destructive rollback SQL only after a reviewed impact list, backup/restore proof, and explicit owner approval.

### F.4 Current change inventory

| Chapter | Main repository areas | Verification |
|---|---|---|
| Local/runtime hardening | `src/App.tsx`, layouts, local API adapter, route pages | build, lint, browser smoke, local environment check |
| Admin work center | admin dashboard/layout, notifications, queue helpers | route/role checks and queue-age UI acceptance |
| Guest inquiry | guest/admin pages, create/reply APIs, Resend with Gmail fallback | intake, Start review, failed/success reply acceptance |
| Vehicle/trip/agreement | vehicle and booking pages/APIs, trip/agreement endpoints, SQL Chapter 14 | booking-flow check plus live role/bucket proof |
| Deposit/payout/refund | deposit endpoints/helpers, payout/refund helpers, PayMongo webhook | financial logic tests plus controlled test-mode evidence |
| Ledger/reconciliation | ledger/reconciliation helpers, pages, endpoint, SQL Chapter 14 | financial and reconciliation tests plus live Chapter 16 proof |
| Privacy/retention | privacy request page/API, super-admin review, SQL Chapter 14 | role and lifecycle acceptance tests |
| Documentation/database consolidation | this master and `SAFE_DRIVE_DATABASE_MASTER.sql` | one canonical document and one canonical SQL file |

### F.5 Weekly close-out record

For each work session, record the date, tester, branch/commit after the owner commits, checks run, pass/fail result, sanitized evidence location, unresolved blocker, and next owner action. A failed external check such as Supabase DNS must be recorded as failed/blocked, never silently changed to passed.

## Appendix G. Technical Method, Route, API, Call, Class, and Type Reference

This appendix is the code-facing reference requested by the team. Its scope is every public application route, every server API handler, the exported business/helper surface, the named classes and route guards, the generated database types, and the important service calls. It does not list every component-local callback, state setter, or JSX event handler because those are private implementation details and change frequently; use the file path and exported entry point below to trace them.

### G.1 Runtime and provider chain

1. `src/main.tsx` mounts React into the page.
2. `src/App.tsx` creates the provider order: `ErrorBoundary` -> TanStack `QueryClientProvider` -> theme provider -> declarative `BrowserRouter` -> `ScrollToTop` -> `AuthProvider` -> lazy routes -> toast provider.
3. `src/contexts/AuthContext.tsx` owns the Supabase session/profile state and exposes `AuthProvider` and `useAuth`.
4. `UserRoute`, `AdminRoute`, and `SuperAdminRoute` enforce role boundaries before rendering nested layouts.
5. Pages call the typed Supabase browser client for RLS-protected ordinary data and call `/api/*` for privileged, payment, cross-user, webhook, and scheduled operations.
6. The Vite development adapter in `vite.config.ts` loads the same API handler modules locally; a future host must preserve the request/response contract rather than rewriting the business logic.

### G.2 Frontend route catalogue

| Access | Route | Main component and purpose |
|---|---|---|
| Public | `/` | `LandingPage`; platform introduction and entry actions |
| Public | `/contact` | `GuestInquiryPage`; multi-topic inquiry - signed-in submitters get a linked threaded inquiry, guests get an email-only exchange |
| Public | `/login` | `LoginPage`; registered user login |
| Public | `/auth/confirm` | `AuthConfirmPage`; email/auth callback completion |
| Public | `/signup` | `SignUpPage`; account creation and agreement display |
| Public | `/update-password` | `UpdatePasswordPage`; recovery-token password update |
| Public | `/admin/login` | `AdminLoginPage`; canonical admin login and OTP barrier |
| Redirect | `/admin-login`, `/Safedriveadminlogin` | Compatibility redirects to `/admin/login` |
| Public | `/privacy-policy` | `PrivacyPolicyPage`; privacy notice |
| Public | `/terms` | `TermsPage`; user terms |
| Public | `/platform-agreement` | `PlatformAgreementPage`; platform agreement acceptance surface |
| User | `/browse` | `BrowseCarsPage`; approved vehicle search |
| User | `/cars/:id` | `CarDetailPage`; vehicle detail, inquiry, booking, and price preview |
| User | `/my-bookings` | `MyBookingsPage`; renter booking lifecycle and actions |
| User | `/verify` | `VerificationPage`; identity/KYC submission |
| User | `/my-vehicles` | `MyVehiclesPage`; listing submission and material-edit reapproval |
| User | `/lister-bookings` | `ListerBookingsPage`; owner booking decisions and trip state |
| User | `/notifications` | `NotificationsPage`; personal notifications |
| User | `/car-renewals` | `ListerCarRenewalPage`; expiring document renewal |
| User | `/support` | `SupportTicketsPage`; authenticated Support Tickets (issues, with a reference) |
| User | `/inquiries` | `InquiriesPage`; the signed-in person's own threaded inquiries and replies |
| User | `/payment/success` | `PaymentSuccessPage`; provider-return waiting screen, not payment authority |
| User | `/subscriptions` | `SubscriptionPlansPage`; hosted subscription checkout |
| User | `/vehicle-availability` | `VehicleAvailabilityPage`; maintenance/blackout management |
| User | `/trip-report/:bookingId/:phase` | `TripConditionReportPage`; pickup or return condition report |
| User | `/security-deposit/:bookingId` | `SecurityDepositPage`; deposit status, claim, and response |
| User | `/privacy-request` | `PrivacyRequestPage`; access/correction/deletion/other request |
| Admin | `/admin` | `AdminDashboard`; role-aware operational summary |
| Admin | `/admin/users` | `AdminUsersPage`; profile/KYC review |
| Admin | `/admin/support` | `AdminSupportTicketsPage`; Support Tickets queue and replies |
| Admin | `/admin/guest-inquiries` | `AdminGuestInquiriesPage`; User Inquiries - one-email reply then close (table `guest_inquiries`) |
| Admin | `/admin/notifications` | `AdminNotificationsPage`; actionable work queues and wait time |
| Admin | `/admin/car-catalog` | `AdminCarCatalogPage`; approved make/model catalogue |
| Admin | `/admin/vehicle-approval` | `AdminVehicleApprovalPage`; listing, ownership, insurance, and agreement review |
| Admin | `/admin/audit-trail` | `AdminAuditTrailPage`; business action history |
| Admin | `/admin/audit-logs` | Legacy path; redirects to `/admin/audit-trail` |
| Admin | `/admin/security-logs` | `AdminSecurityLogsPage`; authentication/security events |
| Super-admin | `/admin/admins` | `AdminAdminsPage`; create admin accounts, toggle each admin's permission checklist, disable/re-enable accounts |
| Super-admin | `/admin/platform-settings` | `AdminPlatformSettingsPage`; super-admin only (view and edit) |
| Super-admin | `/admin/payouts` | Legacy redirect to the payout tab in `/admin/financial-reviews` |
| Super-admin | `/admin/refunds` | Legacy redirect to the refund tab in `/admin/financial-reviews` |
| Super-admin | `/admin/financial-reviews` | `AdminFinancialReviewsPage`; combined lister payout, renter refund, and security-deposit review workspace |
| Super-admin | `/admin/financial-ledger` | `AdminFinancialLedgerPage`; journals and balanced entries |
| Super-admin | `/admin/reconciliation` | `AdminReconciliationPage`; provider/local mismatch review |
| Super-admin | `/admin/retention-requests` | `AdminRetentionRequestsPage`; privacy request decision and lawful holds |
| Super-admin | `/admin/security-deposits` | `AdminSecurityDepositsPage`; deposit claim decisions and release |
| Fallback | `*` | Unknown paths redirect to `/` |

### G.3 Server API catalogue

All authenticated endpoints validate a Supabase bearer token on the server. Role/ownership checks are performed after token validation; a hidden button is not accepted as authorization. PayMongo and Supabase service-role keys remain server-only.

| Handler | Method and caller | Main responsibility |
|---|---|---|
| `api/admin-create.ts` | POST; super-admin | Invite a new `role='admin'` account by email and assign its permission checklist; the creator never sets a password |
| `api/admin-reset-authenticator.ts` | POST; super-admin | Clear a standard user's enrolled authenticator so they can re-scan a QR, and audit it |
| `api/admin-reset-password.ts` | POST; super-admin | Reset a non-admin user's password and audit the action |
| `api/booking-action.ts` | POST; booking participant | Accept/reject/cancel/arrive/finish/no-show booking actions with state gates |
| `api/booking-extension-action.ts` | POST; participant | Request, approve, reject, or expire a booking extension |
| `api/cancel-subscription.ts` | POST; subscriber | Cancel the caller's active subscription and audit it |
| `api/create-balance-checkout.ts` | POST; renter | Recalculate eligibility and create PayMongo balance checkout |
| `api/create-booking.ts` | POST; eligible renter | Server-authoritative price/date/overlap validation and booking insertion |
| `api/create-booking-extension-checkout.ts` | POST; renter | Create hosted checkout for an approved extension |
| `api/create-car-inquiry.ts` | POST; authenticated user | Send a listing-specific inquiry to the vehicle owner |
| `api/create-checkout.ts` | POST; renter | Create hosted downpayment/full checkout from server-calculated records |
| `api/create-guest-inquiry.ts` | POST; public (optional bearer), rate/duplicate guarded | Validate fields/topics and enqueue an inquiry; a bearer token links it to the account and seeds the first thread message |
| `api/inquiry-followup.ts` | POST; the inquiry's own account holder | Add a follow-up message to a non-resolved inquiry, re-open it in the queue, notify admins |
| `api/create-security-deposit-checkout.ts` | POST; renter | Create the separate refundable-deposit checkout idempotently |
| `api/create-subscription-checkout.ts` | POST; user | Create hosted subscription checkout |
| `api/data-request.ts` | GET/POST; user | List own privacy requests or submit a new request and notify super-admins |
| `api/expire-booking-deadlines.ts` | GET/POST; cron secret | Expire ignored owner/payment deadlines without browser dependence |
| `api/get-approved-rental-agreement.ts` | GET; participant | Return only the agreement version approved/snapshotted for the booking |
| `api/mark-manual-refund.ts` | POST; super-admin | Record an actually completed manual refund with method/reference |
| `api/process-payout.ts` | POST; super-admin | Run payout eligibility and PayMongo/simulator automation |
| `api/process-refund.ts` | POST; super-admin | Retry one or a controlled batch of refund automation |
| `api/process-security-deposit-release.ts` | POST; super-admin | Create/check PayMongo refund for the refundable deposit remainder |
| `api/record-security-event.ts` | POST; authenticated or allow-listed login event | Sanitize and record security-relevant activity without secrets |
| `api/reply-guest-inquiry.ts` | POST; admin/super-admin | `action: reply` adds a thread message + emails (Resend, Gmail fallback), sets `in_progress`, notifies a linked account; `action: resolve` closes the inquiry |
| `api/reset-my-authenticator.ts` | POST; authenticated | Clear the caller's own enrolled authenticator (self-service after an email-code sign-in) so the login flow can offer a fresh QR |
| `api/run-reconciliation.ts` | POST; super-admin | Compare local payments/journals/deposits with PayMongo and save findings |
| `api/sync-paymongo-refund.ts` | POST; super-admin | Read an existing PayMongo refund state and reconcile only the matching local refund, ledger, and audit record; never creates a new refund |
| `api/security-deposit-action.ts` | POST; participant/super-admin by action | Submit claim, renter response, or final decision with evidence gates |
| `api/send-return-reminders.ts` | GET/POST; cron secret | Notify both booking parties in-app and through Resend; use the Gmail webhook only when Resend is not configured |
| `api/send-verification-decision-email.ts` | POST; admin/super-admin | Send the already-recorded verification approval/rejection notification through the server-only Resend integration |
| `api/send-vehicle-decision-email.ts` | POST; admin/super-admin | Send the already-recorded vehicle approval/rejection/review notification through server-only Resend after rechecking the current vehicle status |
| `api/send-support-ticket-reply-email.ts` | POST; admin/super-admin and original message author | Email a registered user after their administrator's already-recorded support-ticket reply; does not block the in-app reply |
| `api/submit-trip-condition-report.ts` | POST; booking participant | Validate phase/categories/optional location and persist report/photos |
| `api/webhooks/paymongo.ts` | POST; signed PayMongo callback | Idempotently authorize checkout/refund/deposit/subscription state changes and journals |
| `api/webhooks/paymongo-payouts.ts` | POST; signed/callback-guarded provider event | Reconcile payout success/failure and notify/audit without duplicate terminal effects |

### G.4 Exported business methods and helpers

| Module | Exported surface | Purpose |
|---|---|---|
| `api/lib/ledger.ts` | `calculatePaymentLedgerAllocation`, `postCompletedPaymentToLedger`, `postSimpleBalancedJournal`, `postCompletedRefundToLedger` | Centavo-safe allocations and append-only balanced journal posting |
| `api/lib/reconciliation.ts` | `paymentLedgerEventKey`, `findDuplicateProviderTransactions`, `groupCompletedCheckoutPayments`, `extractPayMongoPaymentIds` | Idempotency keys, duplicate detection, checkout grouping, and provider-reference parsing |
| `api/lib/payoutAutomation.ts` | `createSupabaseAdmin`, `processAutomaticPayoutForBooking` | Service client plus payout eligibility/idempotency/provider/simulator flow |
| `api/lib/refundAutomation.ts` | `processAutomaticRefundForBooking` | Refund eligibility, provider attempt, fallback review, audit, and notification |
| `api/lib/securityDeposit.ts` | `calculateSecurityDepositDisposition`, `finalizeSecurityDepositRelease` | Cap approved claims, calculate renter remainder, and post terminal deposit effects |
| `api/lib/email.ts` | `sendTransactionalEmail`, receipt (itemized payout), verification, user-notification, and `sendAdminAlertEmail` helpers | Server-only Resend delivery, HTML/text transactional templates, and idempotency keys; admin alerts fire only on money-movement exceptions |
| `src/contexts/AuthContext.tsx` | `AuthProvider`, `useAuth` | Session/profile/MFA state and auth operations |
| `src/lib/adminWorkQueue.ts` | `loadSupportTicketsNeedingAdminReply` | Find support cases where the newest participant message needs an admin answer |
| `src/lib/authLockout.ts` | `getAuthLockoutState`, `registerAuthFailure`, `clearAuthFailures`, `formatLockoutRemaining` | Browser-side progressive login lockout UX; server auth remains authoritative |
| `src/lib/authPending.ts` | user/admin pending getters, setters, markers, clearers | Keep each login portal's pending state separate across redirects |
| `src/lib/bookingLifecycle.ts` | return/pickup/no-show/reminder calculations and `ensureReturnReminderNotifications` | Shared deadline and reminder decisions |
| `src/lib/bookingExtensions.ts` | display status, label, and tone methods | Normalize extension status presentation |
| `src/lib/contentProvenance.ts` | `inspectContentProvenance`, badge helpers | Flag likely copied/manipulated evidence for human review; never auto-reject |
| `src/lib/guestInquiryTopics.ts` | `GUEST_INQUIRY_TOPICS`, `GuestInquiryTopic` | Single allow-list for selectable public topics |
| `src/lib/platformSettings.ts` | commission normalization/conversion/calculation, processing-fee calculation, fetchers, formatter | Consistent server/UI pricing display and settings reads |
| `src/lib/privateStorage.ts` | signed URL and signed URL map methods | Time-limited access to private evidence objects |
| `src/lib/queueAge.ts` | `formatElapsed`, `getQueueSeverity`, `getQueueTiming`, style map | Exact waiting time and severity for admin queues |
| `src/lib/richText.ts` | sanitize, normalize, visibility, display methods | Safe support/admin text handling |
| `src/lib/securityLog.ts` | `recordSecurityEvent` | Frontend helper for the server security-event endpoint |
| `src/lib/subscriptions.ts` | `calculateSubscriptionEndDate`, `getCurrentSubscription` | Subscription date and active-plan lookup |
| `src/lib/supportTickets.ts` | attachment helpers, tag parse/serialize/filter, draft/no-show paths, notification methods | Shared support workflow behavior |
| `src/lib/uploadUtils.ts` | `uploadFile`, `uploadMultipleFiles` | Validated Supabase Storage upload operations |
| `src/lib/vehicleOcr.ts` | `runVehicleOcrVerification` | OCR-assisted plate/owner/brand/model comparison for admin review |
| `src/lib/utils.ts` | `cn` | Tailwind/class-name merge helper |

### G.5 Classes, components, and types

- `ErrorBoundary` is the only class component. It catches an unexpected React render error and presents a recoverable crash screen.
- `AdminRoute`, `UserRoute`, `ProtectedRoute`, and `SuperAdminRoute` are functional route-guard components. `ProtectedRoute` remains a generic authenticated guard; the role-specific guards protect the current route trees.
- `AdminLayout` and `DashboardLayout` are functional shell components for navigation, role-aware menus, work counts, and nested page output.
- `ArrivalPhotoCapture` is a functional evidence component. Its exported `ArrivalLocationEvidence` type carries optional latitude, longitude, accuracy, and capture time only after permission/consent.
- `src/types/database.ts` exports `Json`, the generated-style `Database` interface, row aliases (`Profile`, `Car`, `Booking`, `Payment`, `GuestInquiry`, and others), and composite `CarWithDetails` / `BookingWithDetails` types.
- The database type surface covers: profiles, verification images, vehicle catalogue/listings/images/documents/renewals, bookings/extensions/reviews, payments, audit logs, guest inquiries, agreement versions/acceptances, vehicle unavailability, trip reports/photos, security deposits/claims, retention requests/rules, financial accounts/journals/entries, reconciliation runs/items, security logs, platform settings, subscriptions, support tickets/messages, notifications, and the `create_ledger_correction` database function.
- `api/lib/supabaseTypes.ts` defines the service-role client type used by server-only finance helpers. It must never be imported into browser code.

### G.6 Important external and internal calls

| Call boundary | Direction | Trust rule |
|---|---|---|
| Supabase Auth | browser/API -> Supabase | Browser receives anon-key capabilities only; server validates bearer user and role |
| Supabase PostgREST/RPC | browser/API -> PostgreSQL | RLS for ordinary browser work; service role only inside server handlers; finance correction uses a controlled RPC |
| Supabase Storage | browser/API -> buckets | KYC, agreements, support, vehicle documents, and trip evidence remain private with signed URLs/policies |
| PayMongo checkout | SafeDrive API -> `api.paymongo.com` | Secret-key Basic auth, server-calculated amount, stable idempotency key, hosted card entry |
| PayMongo webhook | PayMongo -> SafeDrive API | Verify signature and timestamp tolerance, record event id, then make an idempotent state change |
| PayMongo refund | SafeDrive API -> PayMongo | Super-admin/state eligibility, provider reference, retry-safe key, terminal webhook confirmation |
| PayMongo payout/wallet | SafeDrive API -> PayMongo Money Movement | Disabled until account/API approval; demo payout mode never calls this boundary |
| Gmail Apps Script | SafeDrive API -> `/exec` | HTTPS plus matching shared secret; inquiry remains open when delivery fails |
| Resend | SafeDrive API -> Resend Email API | Server-only API key, verified sender domain, transactional receipts and lifecycle notices |
| Browser `/api/*` | page -> same-origin handler | JSON request, bearer token where required, server validation, structured JSON response |
| Cron endpoints | scheduler -> API | `CRON_SECRET`; host selection must provide scheduling and protected HTTPS delivery |

### G.7 How to trace and change a workflow safely

For any feature, trace in this order: route in `src/App.tsx`; page component; imported `src/lib` helpers; same-origin API call; API handler authorization and validation; Supabase table/RPC/storage side effects; PayMongo/Gmail call if any; audit/notification side effects; related SQL chapter; related test. Change the smallest shared layer that owns the rule, then run `npm run build:clean`, `npm run check:all`, `npm audit`, and the relevant authenticated/live acceptance test.

Do not duplicate price, eligibility, authorization, payout, refund, deposit, or ledger decisions only in JSX. The browser may preview and explain; the server/database must authorize the effect.

## Appendix H. Philippine Law, Provider Rule, and Standards Control Map

This appendix distinguishes a repository control from legal compliance. A green application test proves only that the tested software behavior worked. It does not by itself prove registration, lawful processing, tax compliance, insurance coverage, accounting correctness, provider approval, accessibility conformance, or legal enforceability. The team must keep the evidence named below and obtain professional review before a public real-money launch.

### H.1 Current control map

| Authority or reference | Why it matters to SafeDrive | Repository/control evidence | Status and required follow-up |
|---|---|---|---|
| Data Privacy Act of 2012, RA 10173, and its IRR | Personal data must be processed transparently, for a legitimate purpose, proportionately, securely, and no longer than necessary. Data subjects also have statutory rights. | Minimal guest fields; role gates and RLS; private evidence buckets; privacy-request workflow; retention states; audit/security records; server-only privileged keys. | **Partly implemented.** Determine the proper Personal Information Controller/Processor roles; name and train a DPO or responsible privacy officer; create the privacy management program, records of processing, privacy impact assessment, retention schedule, processor contracts, and approved request procedure. |
| NPC Circular 2022-04 and current NPC registration guidance | Some PICs/PIPs and data processing systems must be registered; others may register voluntarily or document an exemption, depending on workforce, scale, sensitive-data volume, and risk. | The master identifies sensitive KYC, license, identity, location, trip, payment, and support data. | **Decision/evidence missing.** Make a documented applicability assessment using the current NPC criteria, then retain the certificate or sworn exemption evidence. Do not assume a thesis project is automatically exempt. |
| NPC Circular 2023-06 security requirements | Current NPC guidance expects risk-based organizational, physical, and technical safeguards, including privacy impact assessment, training, continuity, and backup/restore capability. | Access controls, private storage, logging, server validation, clean dependency audit, and test scripts support the technical portion. | **Operational proof missing.** Add staff access review, training record, vendor review, incident contacts, business-continuity plan, encrypted backup schedule, and a recorded restore test. |
| NPC personal-data-breach rules | Qualifying breaches require assessment, documentation, containment, and notification; applicable notification can be time-limited, including the 72-hour rule. | Security-event API and logs provide evidence inputs. | **Procedure missing.** Create a breach playbook with severity criteria, evidence preservation, DPO escalation, affected-person/NPC notification decision, 72-hour clock, post-incident review, and tabletop test. |
| Electronic Commerce Act, RA 8792 | Electronic records and signatures should have integrity, accessibility, and attribution evidence if relied on for agreements. | Immutable agreement version, content hash, booking snapshot, accepting user, server timestamp, and audit trail. | **Good technical support, legal review pending.** Preserve the exact rendered agreement and consent wording; obtain Philippine counsel review for enforceability and evidentiary use. |
| Internet Transactions Act, RA 11967, and DTI JAO 24-03 | Online platforms and merchants may have transparency, redress, diligence, transaction-record, privacy, and consumer-protection duties. Application depends on SafeDrive's final commercial role. | Clear fee preview; listing approval; support and guest-inquiry queues; lister identity evidence; electronic records; refund/reconciliation workflow. | **Applicability and launch review required.** Confirm whether SafeDrive is treated as an e-marketplace/digital platform, required business/merchant disclosures, and how complaints, takedowns, receipts, and liability notices must operate. |
| Consumer Act, RA 7394 | Price, advertising, refund/cancellation, quality, and redress statements must not be deceptive or unfair. | Server-authoritative price calculation; disclosed platform commission; support workflow; provider-confirmed payment state; refund records. | **Partly implemented.** Have counsel review advertising, prohibited listings, cancellation/no-show/refund rules, warranty disclaimers, complaint escalation, and final Terms. Test that every displayed price matches the charged amount. |
| BIR Revenue Regulations No. 7-2024 and applicable tax/invoicing rules | Electronic books, accounting records, source documents, invoices/receipts, and records under audit or claim may have prescribed retention and registration requirements. | Append-only balanced booking ledger, provider transaction IDs, correction by reversal, activation boundary, reconciliation findings, exportable operational records. | **Not a tax-ledger certification.** A Philippine accountant must decide chart of accounts, commission and fee treatment, withholding/VAT/percentage-tax obligations, invoicing format, BIR registration, retention duration, and reconciliation sign-off. Never present the internal ledger as a substitute for statutory books. |
| Insurance Code/LTO CTPL requirements and Insurance Commission guidance | CTPL is mandatory for vehicle registration but principally covers third-party/passenger death or bodily injury up to applicable limits; it is not comprehensive collision, theft, own damage, or automatic peer-to-peer rental-use coverage. | Vehicle review records insurance/CTPL details and warnings; agreement and trip evidence preserve operational facts. | **Coverage proof required.** Require an insurer-issued policy/certificate and written confirmation that peer-to-peer rental/commercial use is covered. Do not promise that CTPL protects the vehicle, deposit, platform, renter, or lister from every loss. |
| PayMongo API/webhook and reconciliation guidance | Hosted checkout, signed webhooks, retry behavior, provider IDs/statuses, refunds, payouts, and three-way reconciliation must be handled without treating a redirect as payment proof. | Hosted checkout; signature/timestamp validation; idempotency and uniqueness; provider status checks; append-only ledger; internal-provider-bank reconciliation design; safe local simulator. | **Test implementation ready; live approval missing.** Obtain the correct wallet/payout capability from PayMongo, register the public HTTPS webhook, run signed test events and failure recovery, reconcile provider exports and recipient-bank evidence, and leave the simulator disabled on any host. |
| WCAG 2.2 | Accessibility requires testable perceivable, operable, understandable, and robust behavior; automated checks alone cannot prove conformance. | Public-route desktop/mobile browser smoke and semantic component patterns. | **Partial evidence only.** Perform keyboard-only, focus, screen-reader, zoom/reflow, contrast, form-error, authenticated-route, device, and multiple-browser testing. Record defects and retests before making a WCAG conformance claim. |
| NCDA accessible website design guidance | Philippine accessibility guidance supports inclusive web design; the cited joint circular directly enjoins government sites and is useful policy direction, but it is not automatic private-site certification. | Mobile-responsive public/admin layouts and accessibility test plan. | **Use as a design baseline.** Document scope and test results; obtain specialist review for any formal claim. |
| OWASP Top 10:2025 and ASVS-style verification | These are security risk and verification guides, not laws or automatic certifications. | Server authorization, RLS, secret separation, webhook validation, idempotency, audit logs, dependency audit, and failure-safe email/payment behavior. | **Controls implemented in part.** Add a threat model, abuse cases, rate-limit proof, SAST/secret scan, dependency monitoring, penetration test, incident drill, and remediation register. Do not say “OWASP certified.” |
| ISO/IEC 25010:2023 | It supplies quality characteristics for functional suitability, reliability, performance, compatibility, interaction capability, security, maintainability, flexibility, and safety. | Layered architecture, typed APIs, business checks, clean build, browser smoke, and change register. | **Evaluation framework only.** Map thesis test cases and measured results to selected characteristics; do not claim ISO certification. |
| React Router security advisory GHSA-qwww-vcr4-c8h2 | React Router versions from 7.12.0 before 8.3.0 were affected in unstable RSC APIs. | Project now uses `react-router` 8.3.0 with React/React DOM 19.2.7 and Node 22.22+ requirement; `npm audit` reports zero known vulnerabilities on 6 August 2026. | **Remediated for the checked lockfile.** Keep automated dependency review and repeat `npm audit` before release. |

### H.2 Legal and operational evidence still required before public real-money launch

1. Signed legal review of Terms, Privacy Notice, platform/lister/renter agreement roles, cancellation, refund, deposit, dispute, prohibited-use, insurance, and liability language.
2. DPO/privacy-responsible-person designation; NPC registration certificate or documented exemption assessment; records of processing; privacy impact assessment; privacy management program; request procedure; breach playbook; staff training; and processor/vendor agreements.
3. Accountant-approved chart of accounts, tax registration and invoice/receipt process, provider-fee treatment, commission recognition, source-document retention, month-end reconciliation, and sign-off owner.
4. Insurer evidence that each listed vehicle's policy permits the intended rental use; written coverage/claims procedure; and accurate user-facing limitations.
5. PayMongo live account/capability approval, public signed webhooks, wallet/payout test, refund/deposit test, bank evidence, failure recovery, and provider reconciliation.
6. Selected host evidence for TLS, encrypted secrets, SPA fallback, Node API compatibility, cron authentication, logs/alerts, backups, restore testing, domain ownership, and rollback.
7. Manual accessibility and compatibility report covering public and authenticated flows on representative mobile/desktop devices, Chromium, Firefox, Safari/WebKit where available, keyboard, zoom, and screen reader.
8. Security release review covering threat model, abuse/rate-limit tests, dependency and secret scans, least-privilege service access, backup protection, penetration testing, and incident drill.

### H.3 Primary references verified on 6 August 2026

- National Privacy Commission, Data Privacy Act: https://privacy.gov.ph/data-privacy-act/
- National Privacy Commission, Implementing Rules and Regulations: https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/
- National Privacy Commission, current registration FAQs: https://privacy.gov.ph/pips-and-pics/faqs/
- National Privacy Commission, Circular 2023-06 security announcement: https://privacy.gov.ph/npc-issues-circulars-to-strengthen-personal-data-protection-in-ph/
- National Privacy Commission, DPO/DPS registration reminder: https://privacy.gov.ph/reminder-on-mandatory-data-protection-officer-and-data-processing-system-registration/
- National Privacy Commission, personal data breach management circular: https://privacy.gov.ph/wp-content/uploads/2016/12/sgd-npc-circular-16-03-personal-data-breach-management.pdf
- Lawphil, Electronic Commerce Act, RA 8792: https://lawphil.net/statutes/repacts/ra2000/ra_8792_2000.html
- Lawphil, Internet Transactions Act, RA 11967: https://lawphil.net/statutes/repacts/ra2023/ra_11967_2023.html
- Department of Trade and Industry, E-Commerce laws and JAO 24-03: https://ecommerce.dti.gov.ph/related-laws-policy-issuance/
- Lawphil, Consumer Act, RA 7394: https://lawphil.net/statutes/repacts/ra1992/ra_7394_1992.html
- Bureau of Internal Revenue, Revenue Regulations No. 7-2024: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%207-%202024.pdf
- Insurance Commission, FAQs: https://www.insurance.gov.ph/faqs/
- PayMongo, disbursement reconciliation: https://docs.paymongo.com/docs/money-movement-disbursements-reconciliation
- PayMongo, ledger entries: https://docs.paymongo.com/reference/list-ledger-entries
- PayMongo, webhook resource: https://docs.paymongo.com/reference/webhook-resource
- W3C, Web Content Accessibility Guidelines 2.2: https://www.w3.org/TR/WCAG22/
- National Council on Disability Affairs, Accessible Website Design Guidelines: https://ncda.gov.ph/disability-laws/joint-circulars/accessible-website-design-guidelines/
- GitHub Advisory Database, GHSA-qwww-vcr4-c8h2: https://github.com/advisories/GHSA-qwww-vcr4-c8h2
- React Router v8 upgrade guide: https://reactrouter.com/upgrading/v7

## Appendix I. Repository, Build, Dependency, and Documentation Audit

### I.1 Audit scope and result

The latest 16 August 2026 pass inspected source, API handlers, SQL, configuration, scripts, retained documentation, dependency metadata, public and protected routes, live schema/workflow surfaces, authenticated roles, PayMongo test-wallet connectivity, and generated build behavior. It excluded secret `.env` values, `node_modules`, generated `dist`, logs/output, Git internals, and binary/static assets from semantic text review. The reproducible alignment audit read 166 repository text files and 59,863 lines. The most recent separately recorded dependency-advisory pass remains dated 6 August 2026 and must be repeated before release.

**Update, 31 August 2026:** the alignment audit now reads ~181 text files / ~63,500 lines (Resend email endpoints, the next-day booking change, CHAPTER 17, CI and scheduler workflows, and `CHANGELOG.md` were added). `npm run build` now also type-checks `api/**` (`tsc -p tsconfig.api.json`). `npm run lint` was changed to explicit globs because `eslint .` under ESLint 9 flat config did not traverse `src/`/`api/` on every platform. A GitHub Actions CI workflow (`.github/workflows/ci.yml`) runs lint, API types, logic/static checks, alignment, and build on push/PR.

| Check | Result | What the result proves and does not prove |
|---|---|---|
| `npm run build:clean` | Pass | Safely removes only repository `dist` and Vite cache, then creates a current production bundle. It does not deploy it. |
| `npm run check:all` | Pass | Lint, API TypeScript, booking, finance, reconciliation, browser routes/viewports, and local environment names passed in the checked environment. |
| `npm run check:alignment` | Pass: 166 files / 59,863 lines | Detects malformed JSON, conflict markers, encoding corruption, undocumented routes/APIs/env names, missing SQL relations, extra canonical SQL/Word files, and selected stale claims. It is systematic repository coverage, not a claim that automated rules prove every business or legal interpretation. |
| Booking-flow smoke | Pass | Required route/code markers and selected lifecycle expectations are present; it is not a full live end-to-end payment test. |
| Financial logic | 8/8 pass | Tested ledger/deposit/payout/refund invariants pass with local fixtures. |
| Reconciliation logic | 6/6 pass | Tested mismatch classifications and balanced-ledger conditions pass with local fixtures. |
| Browser smoke | 16 route/viewport checks pass | Selected public, admin-login, compatibility, policy, and unauthorized admin routes load at desktop/mobile sizes. It is not manual assistive-technology testing. |
| Local environment check | Pass with one deliberate warning | Required variable names are present; the local payout simulator is enabled only for local test use. Secret validity is not printed or proven. |
| `npm audit` | Zero known vulnerabilities | The checked lockfile had no advisories known to npm at that time; this is not a penetration test or future guarantee. |
| Live Supabase verification | Pass with legacy warnings | Required relations, buckets, settings, accounts, and queried integrity checks pass. REST cannot prove every catalog definition; Chapter 16 remains authoritative. |
| Live role matrix | 12/12 pass | Ordinary user, admin, and super-admin access boundaries behaved as designed; three temporary identities were removed. |
| Disposable live booking journey | 13/13 pass | Agreement-backed booking, actor authorization, overlap protection, lister acceptance, unpaid PayMongo test checkout, audit, notifications, and cleanup passed. It is intentionally not a paid provider/webhook test. |
| PayMongo read-only verification | Pass | The test secret authenticated and the configured wallet matches an activated test wallet; no transfer, refund, payment, or database write occurred. |
| `git diff --check` | Pass | No whitespace-error diff was detected; line-ending conversion warnings on Windows are informational. |

### I.2 Dependency and runtime decisions

- React and React DOM are pinned to 19.2.7, React Router is pinned to 8.3.0, and the project requires Node 22.22 or newer for the current router line.
- Imports use `react-router`; the obsolete parallel `react-router-dom` package was removed to avoid duplicate surfaces and to apply the current patched release.
- Vite groups React, Supabase, date, UI, and OCR dependencies into purposeful chunks while allowing Rollup to place unclassified dependencies safely.
- The local Vite adapter serves the same `/api/*` handler modules used by a future Node-compatible host, which keeps business logic host-neutral.
- Generated `dist` and dependency/cache folders are not sources of truth. Run the safe clean/build command instead of manually deleting broad folders.

### I.3 Documentation consolidation decisions

- `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` and its Word rendering are the single current project paper and operational/defense reference.
- `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` is the single current database reference; it is chaptered and must be applied selectively, never executed top-to-bottom without review.
- The useful route, architecture, method, service-call, type, and dependency material from the old `docs/technical-documentation.md` has been consolidated into Appendices G-I. The stale duplicate is removed because it named obsolete versions, files, and hosting assumptions.
- `plans/todo.md` is the current short weekly verification checklist and `plans/implementation-plan.md` is the current short implementation/launch plan. Both defer detailed evidence and authority to this master.
- The March design record is intentionally short historical evidence; obsolete detailed two-SPA instructions were removed to avoid competing requirements.
- Both Mermaid files now show the current one-application, guest, agreement, trip, deposit, finance, privacy, and role boundaries.
- `docs/system-process.md` is a short supplementary flow map. When it conflicts with the master or current code, the master and current code control.
- Secrets remain in ignored local/host configuration. Documentation contains variable names and placeholders only, never actual key values.

### I.4 How to reproduce this audit

From a PowerShell terminal in the repository root, use Node 22.22 or newer:

```powershell
npm.cmd install
npm.cmd run build:clean
npm.cmd run check:all
npm.cmd run check:alignment
npm.cmd audit
npm.cmd run check:live-supabase
npm.cmd run check:live-workflows
npm.cmd run check:live-roles
npm.cmd run check:paymongo-readonly
npm.cmd run check:live-booking-journey
git diff --check
```

The live commands are intentionally separate because they reach external infrastructure and some create disposable identities/records. Run them only with the intended Supabase project and PayMongo test credentials. The booking journey stops before payment and cleans its temporary Supabase data; its unpaid PayMongo test checkout cannot be deleted through the application. Record exact sanitized results and never convert an external blocker into a pass. Before any deployment, repeat the checks, capture the host/provider tests in the Evidence Register, and have the legal/privacy/accounting/insurance owners sign their respective launch items.

## Appendix J. Payment Acknowledgment and Electronic Invoicing Boundary

### J.1 Decision recorded for the thesis

The team selected **Option 2: SafeDrive as the proposed principal transaction issuer**. In the thesis design, the renter pays SafeDrive for the rental transaction, SafeDrive records the gross customer payment, and SafeDrive later pays the lister after the completion and review conditions are satisfied. If this model becomes a real business, the commercial contracts, accounting treatment, tax registration, and statutory invoice responsibility must all describe the same principal role.

This is a **system-design decision, not a current legal or tax conclusion**. An accountant and Philippine counsel must confirm whether the facts make SafeDrive a principal, agent, marketplace operator, or another type of intermediary. A label in the application cannot decide that legal classification. The lister may also retain separate tax obligations for the income or service supplied through the platform.

### J.2 What the application generates now

SafeDrive currently generates a branded **Payment Acknowledgment** PDF from the payment record already stored for a booking. It contains an acknowledgment number, payer, lister, vehicle/booking description, booking ID, payment type, payment method, provider reference, recorded timestamp, amount, record ID, and an explicit document notice.

The acknowledgment is operational evidence that SafeDrive recorded a payment. It is useful for the renter, support staff, reconciliation, and dispute tracing. It does not create a new database table and it does not change payment, payout, refund, ledger, or PayMongo webhook logic.

The generated PDF expressly says that it is not a BIR tax invoice, official receipt, proof of BIR accreditation, or a document valid for claiming input VAT. PayMongo confirmation supports payment verification, but it does not replace an invoice required by law.

### J.3 Why it is called an acknowledgment instead of a receipt or invoice

BIR guidance distinguishes a sales/commercial invoice from supplementary documents such as official receipts, collection receipts, or payment/acknowledgment receipts. The invoice is the primary document evidencing the sale; a payment acknowledgment is not automatically a substitute. Calling the current download a Payment Acknowledgment accurately limits the software claim while the project has no implemented or validated BIR invoicing integration.

### J.4 Electronic-invoicing timeline for the group

| Stage | What the group should understand | SafeDrive action |
|---|---|---|
| Current thesis/test stage | The project records provider-confirmed payments and can produce a Payment Acknowledgment. It is not registered or represented as a BIR electronic invoicing system. | Demonstrate transaction traceability and the acknowledgment disclaimer. Do not present it as a tax document. |
| Before a real-money public launch | Confirm SafeDrive's principal/agent classification, taxpayer category, invoicing duty, invoice data fields, serial/control requirements, VAT or non-VAT treatment, withholding treatment, and record-retention process with a Philippine accountant and counsel. | Write and approve an invoicing requirements specification before changing the database or UI. |
| BIR electronic-invoice transition | RR No. 11-2025 describes structured electronic invoices for covered taxpayers. RR No. 26-2025 moved the compliance deadline for covered small, medium, and large e-commerce taxpayers and specified other covered groups to **31 December 2026**. Micro taxpayers are exempt from mandatory electronic-invoice issuance under that rule, subject to the actual classification and other applicable invoicing duties. | Re-check the latest BIR issuances near launch; do not assume that a PDF alone is a structured electronic invoice. |
| Electronic sales-data reporting | RR No. 26-2025 treats electronic sales reporting as a separate step that starts when the BIR has an operational receiving system and issues the necessary implementing rules. | Do not build or claim live BIR reporting until the technical specification and applicable effective date are confirmed. |
| Online business registration display | RMC No. 38-2026 introduced a BIR Registration Seal for covered online websites, marketplaces, and digital platforms. Applicability depends on the actual launched business and registration. | Add the required registration/compliance display only after the business obtains the proper BIR evidence. Never place a mock seal in the thesis application. |

This timeline is a planning aid verified against the cited BIR materials on **12 August 2026**. BIR rules and implementation dates can change, so the team must re-check the current rules before launch.

### J.5 Statements the thesis must not make

Do not state:

- “SafeDrive generates valid BIR invoices.”
- “SafeDrive is BIR accredited.”
- “This receipt can be used for input VAT.”
- “All listers are legally registered rental businesses.”
- “PayMongo's payment confirmation replaces an invoice.”

### J.6 Accurate statements the group may use

The group may state:

- “SafeDrive generates a payment acknowledgment from a recorded booking payment.”
- “The acknowledgment includes the stored provider reference and SafeDrive record identifiers for traceability.”
- “PayMongo payment status is used as provider evidence, while SafeDrive separately keeps its booking and payment records.”
- “The present thesis prototype does not claim BIR accreditation or statutory electronic-invoice capability.”
- “The design records SafeDrive as the proposed principal transaction issuer, subject to professional confirmation before commercialization.”
- “A production invoicing module is intentionally deferred until the team confirms legal classification, registration, invoice fields, and current BIR technical requirements.”

### J.7 Future production gate—no database change in this thesis step

No BIR-specific database migration is authorized or required for the current Payment Acknowledgment. If the project later proceeds to commercialization, create a separate reviewed migration and implementation plan covering immutable invoice numbers, issuer identity and TIN/branch data, buyer fields when required, taxable/exempt/zero-rated breakdowns where applicable, discounts, taxes and totals, cancellation/credit-note relationships, structured electronic payloads, transmission status, retry/audit evidence, and retention/export controls. The exact fields must come from the then-current BIR requirements and professional advice rather than assumptions in this thesis.

### J.8 Primary references for this decision

- Bureau of Internal Revenue, RMC No. 77-2024 digest on invoices and supplementary documents: https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024%20Digest.pdf
- Bureau of Internal Revenue, RR No. 11-2025 digest on electronic invoicing: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%2011-2025%20Digest.pdf
- Bureau of Internal Revenue, RR No. 26-2025 digest on the extended compliance timeline and electronic sales reporting: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2026-2025%20Digest.pdf
- Bureau of Internal Revenue, RMC No. 38-2026 digest on the BIR Registration Seal for online businesses: https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2038-2026%20Digest.pdf

## Appendix K. Deep Research Decision Register

This register turns the remaining design questions into defensible product decisions. It was verified on **12 August 2026** against current primary government, provider, standards, and comparable-platform sources. A comparable platform is evidence that a workflow is practical; it is not proof that the same rule is legally required in the Philippines.

### K.1 Executive conclusion and implementation order

| Priority | Decision | SafeDrive action | Current status |
|---|---|---|---|
| 1 | Simplify long operational pages | Put the current task and status first; collapse timeline, extension history, payment breakdown, reports, and secondary actions under accessible disclosure panels. Keep mobile cards single-column and desktop summaries compact. | **Implement next.** Lister and renter booking pages are still the largest visual debt. |
| 2 | Put support tickets before self-help | Open the Support page on **My tickets** with Open, Waiting for staff, Waiting for user, and Resolved tabs. Move Quick answers into a separate Help tab and keep “This did not solve it” as a ticket shortcut. | **Implement next.** The current ticket list is below the FAQ area. |
| 3 | Make one vehicle workspace | Group **Listings**, **Availability and maintenance**, and **Renewals and documents** as accessible tabs under Vehicles. Every availability or renewal action must first identify the vehicle by photo, model, plate, and ID. | **Implement next.** Header grouping exists, but the work is still split across separate pages. |
| 4 | Keep the bell small and actionable | The bell popover shows unread work, exact elapsed wait, ownership/review state, and a deep link. A separate Work Center remains available for filtering and bulk review. | **Implemented; verify keyboard and mobile behavior.** |
| 5 | Replace the rigid three-day rule with a shorter processing window | A trip may start as early as the next day. The existing 24-hour owner-response and 24-hour reservation-payment windows still apply, but both are now capped so they never run past the pickup time; a request that is not accepted and paid before pickup auto-cancels and releases the car. Same-day starts stay disabled pending transport/insurance/handover review. | **Implemented 31 August 2026** on team instruction (Moises Bien): `api/create-booking.ts`, `api/booking-action.ts`, `src/pages/CarDetailPage.tsx`, `src/pages/MyBookingsPage.tsx`, plus Terms and Platform Agreement copy. See the change log. |
| 6 | Preserve the exact lister agreement | The booking must display the owner-uploaded, admin-approved PDF. The renter accepts that exact version before payment; SafeDrive stores version, hash, account, server time, and booking snapshot. | **Implemented in schema/API; live old-path and end-to-end proof still required.** |
| 7 | Treat trip evidence as evidence, not an automatic verdict | Both parties submit pickup and return condition reports. Time-stamped photos are required; optional location is collected only with consent and stored with accuracy. Disputes still require human review. | **Implemented foundation; full authenticated workflow proof remains.** |
| 8 | Separate deposits, provider money, and earned revenue | Keep the refundable deposit in a liability state. Hold payout while a claim, refund, failed provider event, or reconciliation issue is unresolved. | **Implemented foundation; PayMongo test and accounting sign-off remain.** |
| 9 | Reconcile provider truth with application truth | Signed webhooks and idempotency handle normal events; scheduled reconciliation detects missing, duplicated, mismatched, failed, or unbalanced records. Never repair finalized finance by overwriting history. | **Implemented test logic; provider pagination, missed-event recovery, and live wallet capability remain unproven.** |
| 10 | Keep privacy requests out of daily lister navigation | Put access, correction, deletion/anonymization, and restriction requests under Profile > Privacy. Super-admins review identity, scope, lawful holds, and execution. Do not offer instant destructive deletion. | **Implemented route and review queue; DPO procedure and retention approval remain.** |
| 11 | Keep the download as a Payment Acknowledgment | It may show transaction and booking evidence, but it must not claim to be a BIR invoice, BIR-accredited document, or input-VAT support. | **Implemented. Accountant/BIR-system work is deferred.** |
| 12 | Block public real-money launch on transport and insurance review | Do not claim that a private vehicle, CTPL, comprehensive policy, or the 2025 LTO lease memorandum automatically permits every peer-to-peer rental. Obtain written insurer confirmation and Philippine transport/legal advice. | **External launch blocker.** |

### K.2 Why the three-day booking rule was shortened

No reviewed Philippine source establishes a universal three-day advance-booking requirement for a peer-to-peer car-rental platform. The former 72-hour minimum was a **SafeDrive preparation and risk policy**, not a legal mandate. The team's operating experience was that a strict 72-hour floor wastes a car that is sitting idle and could be rented for the very next day.

**Implemented policy (31 August 2026):**

1. A trip may start as early as **the next calendar day**. Same-day starts remain blocked.
2. The two existing safety windows are unchanged in length: the lister has **24 hours to accept** a request and the renter then has **24 hours to pay** the reservation.
3. Both windows are now **capped at the scheduled pickup time**. For a next-day booking that means the effective deadline can be shorter than 24 hours.
4. `api/expire-booking-deadlines.ts` (the cron worker) cancels a request whose owner-response or payment deadline has passed. So the outcome the team asked for holds: if the full flow — accept, then pay — is finished before pickup, the meetup proceeds; if not, the request auto-cancels and the car is released for someone else.
5. The system still blocks unavailable dates, missing approved agreement versions, incomplete verification, expired required vehicle evidence, and unpaid amounts.
6. A chat message such as "I agree" does not change dates or price. The user must submit the formal booking action so availability, total, agreement, payment, notification, and audit logic run together.
7. Same-day requests stay disabled until the team can show staffing, insurer acceptance of the intended use, transport-law review, and a workable pickup/condition-report process for very short notice.

A per-vehicle configurable advance-notice setting (the earlier "expedited request" design) is still a reasonable future refinement but was not built; the single next-day rule above is simpler to operate and explain.

Research support:

- Turo trip-preference guidance—configurable advance notice, buffers, and trip duration: https://help.turo.com/setting-trip-duration-BJZpGUJIc
- Turo extension guidance—formal in-platform requests and availability checks: https://help.turo.com/en_us/managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45
- DTI e-commerce guidance—clear service information, payment, tracking, support, refunds, and dispute handling: https://bps.dti.gov.ph/press-releases/28-2021/259-dti-issues-national-standard-guidelines-for-e-commerce-transactions

### K.3 Cleaner information architecture and accessibility rules

Tabs are appropriate only for closely related views within one task area; they are not a substitute for every route. The recommended structure is:

- **Vehicles:** Listings | Availability and maintenance | Renewals and documents.
- **Bookings:** Needs action | Upcoming | Active | Completed | Cancelled, with a vehicle filter when the user owns several cars.
- **Support:** My tickets | Help and quick answers. Open the current or newest unresolved ticket automatically on wide screens; on mobile, use a list-to-thread flow.
- **Admin finance:** Payouts | Refunds | Deposits in the Financial Reviews section; Ledger | Reconciliation in a separate Financial Records section for super-admins.
- **Profile:** Account and security | Privacy and data requests. Do not keep Data Requests as a primary lister navigation item.

For long booking cards, show vehicle, counterpart, dates, amount, status, next action, and urgent warning first. Put extension history, payment history, return reports, receipts, and audit-like details behind named disclosure controls such as “Payment details” and “Trip history.” Do not hide a required action inside a collapsed panel.

Implementation accessibility requirements:

- Real tabs use `tablist`, `tab`, `tabpanel`, `aria-selected`, and `aria-controls`; Left/Right arrows move through tabs and Enter/Space activates when activation is manual.
- Notification popovers and disclosures must be dismissible by Escape, keep a logical focus order, return focus to the invoking button, and never trap a keyboard user.
- Interactive targets meet WCAG 2.2 minimum target-size/spacing requirements, visible focus is not obscured by sticky navigation or popovers, and content reflows without horizontal task-level scrolling.
- Empty states must say what the user can do next, not only “No records.”

Research support:

- W3C ARIA Authoring Practices, Tabs Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- W3C Web Content Accessibility Guidelines 2.2: https://www.w3.org/TR/WCAG22/
- W3C WAI-ARIA overview: https://www.w3.org/WAI/standards-guidelines/aria/

### K.4 Guest inquiries, registered support, and admin notifications

The public form should remain limited to name, email, optional phone, multi-select topics, and message. This supports a visitor who wants to understand the site or ask whether a vehicle category could be accepted without creating an account. Vehicle registration, booking, payment, refund, dispute, and identity-specific questions should move to authenticated tickets because staff need verified account and transaction context.

The bell is a staff work surface, not a substitute for the complete queue. Each popover item should answer four questions: **what happened, how long has it waited, who owns the review, and where do I act?** Routine cron sweeps with zero affected records should remain available in raw audit evidence but hidden from the default human-action view.

This design follows privacy proportionality by avoiding unnecessary visitor fields, and DTI's e-commerce guidance specifically supports accessible inquiry, complaint, and dispute mechanisms.

Research support:

- National Privacy Commission, Data Privacy Act Section 11 principles: https://privacy.gov.ph/data-privacy-act/
- National Privacy Commission, Data Privacy Act IRR and retention/process requirements: https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/
- DTI PNS 2155 e-commerce guidance: https://bps.dti.gov.ph/press-releases/28-2021/259-dti-issues-national-standard-guidelines-for-e-commerce-transactions

### K.5 Agreement, trip evidence, and optional location

The vehicle-specific agreement shown to the renter must be the PDF uploaded for that car and approved in the listing review. SafeDrive's platform Terms remain separate. If the lister replaces the agreement or materially changes the listing, the vehicle returns to review; an old booking continues to reference its accepted snapshot.

Republic Act No. 8792 recognizes electronic documents and signatures when attribution, reliability, integrity, and display requirements are satisfied. SafeDrive's version, hash, account, server timestamp, and immutable booking snapshot are therefore sensible evidence controls. They do **not** make unlawful clauses valid, replace required formalities, or guarantee enforceability without counsel review.

Pre/post-trip photos, odometer, fuel/battery level, and notes help compare condition and handover performance. Turo's published claims guidance similarly relies on time-sensitive pre/post-trip photos, showing that structured trip evidence is practical in an established peer-to-peer rental workflow. Location remains optional because privacy law favors necessary and proportionate collection; accuracy and consent must accompany any stored coordinate.

Research support:

- Electronic Commerce Act, RA 8792: https://lawphil.net/statutes/repacts/ra2000/ra_8792_2000.html
- Turo trip-photo guide, used only as an industry comparator: https://help.turo.com/en_us/trip-photos-guide-or-hosts-BkKcBEeN5
- National Privacy Commission, Data Privacy Act: https://privacy.gov.ph/data-privacy-act/

### K.6 PayMongo wallet, webhooks, deposits, ledger, and reconciliation

The PayMongo dashboard wallet screen proves only that a test wallet is activated. It does not prove that SafeDrive knows a payout wallet ID, has production Money Movement API access, has an approved recipient, or completed a real transfer. SafeDrive must never derive or invent a wallet identifier from a screenshot.

Provider-confirmed payment state must come from a verified webhook or a controlled provider-status recovery—not from the browser redirect. PayMongo requires signature verification, distinguishes test and live signatures, expects a successful response promptly, retries failed delivery, and can disable a webhook after retry exhaustion. Because provider events can be missed or repeated, SafeDrive needs both idempotent event handling and reconciliation.

Recommended operations:

1. Store provider checkout, payment, refund, transfer/payout, and webhook event references separately.
2. Verify the raw webhook body, signature, mode, and timestamp before applying state.
3. Return a 2xx response only after SafeDrive has safely recorded or idempotently recognized the event.
4. Reconciliation flags provider-only payment, SafeDrive-only completion, amount mismatch, duplicate reference, stale/failed payout, refund mismatch, deposit counted as revenue, or unbalanced ledger.
5. The safe default for a mismatch is **hold and investigate**. Corrections use reversals and new journals, not destructive edits.
6. The deposit remains a refundable liability and is excluded from earned platform revenue until a documented disposition is final.
7. Local sandbox payout/refund completion remains clearly simulated and disabled in any public/live environment.

Research support:

- PayMongo webhook setup and signature verification: https://docs.paymongo.com/docs/developer-tools-webhook-setup-management
- PayMongo webhook resource and retry/disable behavior: https://docs.paymongo.com/reference/webhook-resource
- PayMongo Money Movement transfers: https://docs.paymongo.com/docs/money-movement-moving-money-with-api
- PayMongo Seeds/Platforms terminology, wallet, payout, and cleared-funds concepts: https://paymongo.help/en/articles/10123689-paymongo-seeds-terms-and-definitions

### K.7 Privacy requests and retention are controlled decisions

A Terms clause can explain how SafeDrive processes privacy requests, but it cannot waive statutory data-subject rights. The correct user experience is a request in Profile > Privacy followed by identity verification, scope review, legal-hold/legitimate-purpose analysis, a recorded decision, restricted access where appropriate, and confirmed execution.

The Data Privacy Act requires data to be adequate and not excessive and retained only as long as necessary, while expressly recognizing legal claims, legitimate business purposes, and periods required by law. NPC guidance also allows an erasure request to be denied wholly or partly on those grounds. Therefore the system should support partial approval, anonymization, restriction, and lawful hold instead of a single immediate delete button.

SafeDrive still needs a DPO-approved records inventory and retention schedule. The numbers seeded in the current schema are planning defaults, not automatically correct legal periods for every record category.

Research support:

- National Privacy Commission, Data Privacy Act: https://privacy.gov.ph/data-privacy-act/
- National Privacy Commission, Right to Erasure or Blocking: https://privacy.gov.ph/right-to-erasure-or-blocking/
- National Privacy Commission, retention advisory opinion: https://privacy.gov.ph/wp-content/uploads/2022/01/NPC_AdvisoryOpinionNo._2017-024.pdf

### K.8 Payment acknowledgment and current BIR timeline

SafeDrive's PDF should remain a **Payment Acknowledgment** for transaction traceability. It does not become a tax invoice because it is formatted professionally or contains a PayMongo reference. The separate BIR invoicing decision depends on SafeDrive's actual taxpayer classification, commercial role, registration, invoice issuer, tax treatment, and approved system.

RR No. 26-2025 extended the electronic-invoice compliance period for covered small, medium, and large e-commerce/internet taxpayers and specified other groups to **31 December 2026**; micro taxpayers are exempted from that mandatory electronic-invoice rule, subject to classification and other invoicing duties. The group must re-check later issuances and obtain an accountant's written determination before commercialization. No BIR database migration is authorized by this research.

Research support:

- BIR RR No. 11-2025 full regulation: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2011-2025.pdf
- BIR RR No. 26-2025 digest and 31 December 2026 transition: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2026-2025%20Digest.pdf
- Appendix J contains the approved thesis wording and prohibited claims.

### K.9 Supabase authorization and document storage

Sensitive identity, agreement, trip-condition, claim, and financial data needs both database privileges and row-level policies. A hidden React route is never the authorization boundary. Supabase documents that elevated secret/service-role keys bypass RLS; they must stay only in trusted server code. The browser receives a publishable/anon key and remains constrained by RLS.

Private storage buckets are correct for agreements and trip evidence. Downloads should use an authenticated request checked by storage RLS or a short-lived signed URL after server authorization. A public URL is inappropriate for these documents because public-bucket reads bypass object download controls.

One new planning item must be added before the end of 2026: Supabase is moving from legacy `anon`/`service_role` keys toward publishable and secret keys. SafeDrive should migrate only through a controlled secret-rotation plan after host selection; do not expose a new secret key in Vite variables.

Research support:

- Supabase API keys and legacy-key deprecation guidance: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase Data API security, grants, and RLS: https://supabase.com/docs/guides/api/securing-your-api
- Supabase private bucket access: https://supabase.com/docs/guides/storage/buckets/fundamentals
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control

### K.10 Philippine transport and insurance launch gate

This is the highest-risk unresolved business question. Official LTO enforcement materials continue to treat use of a private vehicle as an unauthorized public utility vehicle for compensation as a colorum risk. A 2025 LTO memorandum directing temporary non-apprehension for certain vans under lease agreements was issued while legal review was ongoing and is too narrow to establish blanket legality for SafeDrive's intended peer-to-peer marketplace.

SafeDrive must therefore avoid these statements: “all private cars may legally be rented,” “CTPL covers rental use,” “comprehensive insurance automatically covers peer-to-peer rental,” or “the platform has LTFRB/LTO approval.” Before public real-money launch, the team needs:

1. A written Philippine transport-law opinion covering SafeDrive's exact principal/agent/platform model and vehicle/driver arrangement.
2. Written LTO/LTFRB guidance or counsel-backed applicability analysis for private vehicles, leasing, compensation, and colorum rules.
3. Insurer-issued confirmation for each listed vehicle that the intended rental/commercial/peer-to-peer use is permitted and how claims are handled.
4. Final user-facing limitations, prohibited uses, evidence duties, accident procedure, and suspension rules reviewed by counsel and the insurer.

Research support:

- LTO anti-colorum enforcement explanation: https://lto.gov.ph/news/colorum-is-a-crime-lto-to-implement-no-release-policy-vs-vehicles-impounded-in-anti-colorum-operations/
- LTO 8 April 2025 lease-agreement memorandum, narrow and pending legal review: https://lto.gov.ph/wp-content/uploads/2025/09/Memo-04082025.pdf
- Insurance Commission motor-insurance memoranda and circulars: https://www.insurance.gov.ph/memoranda/

### K.11 Safe claims for the thesis defense

The group may say:

- “A trip can start as soon as the next day. The lister still gets 24 hours to accept and the renter 24 hours to pay, but both are capped at the pickup time, and an unpaid request auto-cancels so the car is not held. Same-day starts stay disabled pending transport and insurance review.”
- “The renter accepts the exact approved lister agreement version; SafeDrive preserves the version, hash, account, and server timestamp as electronic evidence.”
- “Webhook verification and idempotency handle normal PayMongo events; reconciliation handles disagreement or missed-event risk.”
- “The payment download is a SafeDrive Payment Acknowledgment, not a BIR invoice.”
- “Privacy deletion is a reviewed statutory request, not a right that SafeDrive tries to waive in its Terms.”
- “The thesis demonstrates software controls locally and in PayMongo test mode; it does not claim production payout, legal transport approval, insurance coverage, BIR accreditation, or formal accessibility certification.”

### K.12 Evidence still needed from the project owner or professionals

- **Project owner:** the next-day booking rule is now live (K.2); provide test accounts; run an authenticated end-to-end check of a next-day booking (request late in the day, confirm the shorter accept/pay deadlines and the auto-cancel path); perform authenticated mobile/browser acceptance; retain screenshots of provider and database evidence.
- **PayMongo:** confirm Money Movement/API eligibility, wallet and recipient identifiers through official channels, supported transfer/refund flow, pricing, test/live webhook endpoints, and provider reports.
- **Privacy/DPO:** approve purposes, privacy notice, records inventory, retention schedule, request procedure, breach procedure, and processor/vendor agreements.
- **Accountant/tax adviser:** confirm business/taxpayer classification, invoice issuer, chart of accounts, commission, processing-fee and deposit treatment, withholding/VAT/percentage-tax duties, and current electronic-invoice timeline.
- **Transport counsel/LTO/LTFRB and insurer:** confirm whether the exact operating model is permitted and insured. This is required before public real-money vehicle rental.
- **Accessibility tester:** verify the completed flows with keyboard, screen reader, zoom/reflow, multiple browsers, Android, and iOS; record defects and retests.
- **Hosting provider, later:** prove Node-compatible APIs, public HTTPS callbacks, raw webhook body access, encrypted server secrets, SPA fallback, cron authorization, logs/alerts, backups, restore, and rollback.
