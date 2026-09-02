# SafeDrive 2.0

SafeDrive is a peer-to-peer car rental platform built with React, TypeScript,
Vite, Supabase, PayMongo, and host-neutral Node-compatible API handlers. Vercel
configuration is retained as one deployment adapter, but local development and
the application architecture do not depend on an active Vercel subscription.

## Local Run

Install dependencies:

```powershell
npm install
```

Create the private local environment file from the safe template, then fill in
the real values without committing `.env`:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run check:local-env
```

Start the local dev server:

```powershell
npm run dev
```

Local development does not require Vercel. The Vite development server also
loads the handlers under `/api`, so the frontend and server routes are available
from the same `http://127.0.0.1:5173` origin. Put the server-only values in the
local `.env` file, then run `npm run dev`.

SafeDrive uses one strict IPv4 listener on port 5173. If another SafeDrive
server is already using that address, the second server exits instead of moving
to another port or mixing React dependency caches. Run only one local terminal.
After dependency or Vite configuration changes, use:

```powershell
npm run dev:clean
```

The local server is for development only. Keep the terminal open while testing;
closing it stops both the frontend and the local API routes. PayMongo callbacks
from the public internet cannot reach localhost unless a secure tunnel is used,
so use manual/local callback tests until a public host is configured.

If PowerShell blocks `npm.ps1`, use the Windows command shim:

```powershell
npm.cmd run dev
```

The local app usually runs at:

```text
http://127.0.0.1:5173
```

The local admin portal is available at:

```text
http://127.0.0.1:5173/admin/login
```

In Supabase Authentication URL Configuration, allow these local redirects:

```text
http://127.0.0.1:5173/**
http://127.0.0.1:5173/update-password
http://127.0.0.1:5173/auth/confirm
```

## Verification Commands

Use Node 22.22 or newer. Run these before pushing or deploying:

```powershell
npm.cmd run build:clean
npm.cmd run check:all
npm.cmd run check:alignment
npm.cmd audit
git diff --check
```

`check:all` covers lint, API TypeScript, booking markers, financial and
reconciliation logic, repository documentation/code alignment, selected
desktop/mobile browser routes, and local environment names. The alignment check
reports its reviewed text-file and line totals and cross-checks application
routes, API handlers, Supabase relation names, environment names, canonical
artifacts, and stale claims. Run `npm.cmd run check:live-supabase` separately
when the configured Supabase project is reachable; an external DNS,
paused-project, or credential failure must not be reported as a local pass.

## Database Updates

The single chaptered database reference is:

```text
database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql
```

It includes the historical archive, the live-update script, every dated
migration, and read-only verification queries. It is a reference/apply-by-chapter
file and must not be run from top to bottom. The standalone SQL copies were
removed after full-text and SHA-256 verification; each chapter preserves its
original filename and hash.

Chapters 1-13 preserve historical schema and migration context. For the current
consolidated implementation, back up the intended Supabase project, save the
sanitized preflight result, apply only the reviewed Chapter 14 transaction, and
then run the read-only Chapter 16 verification. Never execute the master from
top to bottom.

The July 22 migrations add the public guest-question queue, private KYC/support/vehicle-document buckets, database-owned user audit events, and trusted support-reply notifications. A migration is a SQL update that must be run in the Supabase SQL Editor (staging first, then production); keeping the file in Git does not apply it to the live database.

Chapter 17 (2026-08-31 security and integrity hardening) removes participant/`authenticated`
write access to `public.payments` (all payment writes are server-only), makes `encrypt_pii`
raise instead of falling back to a shared key, and revokes `encrypt_pii`/`decrypt_pii` from
`anon`/`authenticated`. Before applying it, set an independent random
`app.settings.encryption_key` on the Supabase project (e.g.
`alter database postgres set app.settings.encryption_key = '<64-hex value>';`, then reconnect);
otherwise KYC writes will fail loudly by design. Re-run the Chapter 16 verification and
`npm run check:live-roles` afterwards.

The app still records normal timestamp-only arrival if the location evidence migration has not been applied yet, but optional location evidence will not persist until the columns exist. For the uniqueness/overlap guards, check for existing duplicate rows first using the comments inside the applicable master chapter.

## Hosting Deployment

The selected host must serve the Vite `dist` output with an SPA fallback and run
the same Node-compatible `/api/*` handlers. It must also provide encrypted
server environment variables, public HTTPS callbacks, logs, and a protected
scheduler. The checked-in `vercel.json` is an existing adapter, not a hosting
requirement. Build with:

```powershell
npm run build
```

Required frontend environment variables include:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_PAYMONGO_PUBLIC_KEY
```

Server-side API routes also require:

```text
SUPABASE_SERVICE_ROLE_KEY
PAYMONGO_SECRET_KEY
PAYMONGO_WEBHOOK_SECRET
PAYMONGO_PAYOUT_WALLET_ID
PAYMONGO_WEBHOOK_TOLERANCE_SECONDS
CRON_SECRET
GUEST_INQUIRY_HASH_SALT
GMAIL_GUEST_INQUIRY_WEBHOOK_URL
GMAIL_RETURN_REMINDER_WEBHOOK_URL
GMAIL_WEBHOOK_SHARED_SECRET
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_REPLY_TO
```

`PAYMONGO_PAYOUT_WALLET_ID` must come from an account/API response or written
instruction that PayMongo confirms is valid for the merchant's approved Money
Movement integration. Do not infer it from a masked dashboard number. Automatic
lister payout code uses a stable idempotency key and the callback at
`/api/webhooks/paymongo-payouts`, but must remain disabled until the account,
source, recipients, provider endpoint, and callback behavior are proven.

`PAYMONGO_WEBHOOK_TOLERANCE_SECONDS=300` limits accepted signed webhook
timestamps to a five-minute window. `GUEST_INQUIRY_HASH_SALT` creates a private
duplicate/rate-limit fingerprint without storing the raw visitor address in the
fingerprint. The return-reminder URL is optional only if reminder email is not
being used.

`GMAIL_GUEST_INQUIRY_WEBHOOK_URL` is the legacy fallback for admin replies to visitors who use the public `/contact` form. It is used only when Resend is not configured. If neither Resend nor this fallback is available, inquiries can still be received and reviewed, but the API will not mark a reply as sent.

`GMAIL_WEBHOOK_SHARED_SECRET` must match the `SAFEDRIVE_WEBHOOK_SECRET`
Script Property in the Gmail Apps Script web app. See Appendix C of
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md` and the copy-ready
`project_docs/SafeDrive_Email_Webhook_Code.gs` source.

`RESEND_API_KEY` and `RESEND_FROM_EMAIL` enable SafeDrive's server-side
transactional email. The sender must use a domain verified in Resend. Do not
use a `VITE_` prefix: the Resend key must never reach the browser. When these
variables are configured, SafeDrive sends branded receipts after confirmed
PayMongo payments and refunds, plus account-verification and extension-status
notifications, vehicle-review decisions, and guest-inquiry replies.
Return reminders now notify both renter and lister through Resend. `RESEND_REPLY_TO`
is optional. The existing Gmail Apps Script delivery remains the fallback for
guest-inquiry replies and return reminders only when Resend is not configured.

Optional demo payout flag:

```text
PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION=true
```

With this flag on, the admin **Auto Payout** button completes the payout without
calling PayMongo: it records the lister's earnings (`base_price`, already net of
SafeDrive commission), posts the ledger journal, and sends the receipt email +
notification. It accepts only a PayMongo test key (or no key) - a live
`sk_live_` key auto-disables the demo path. Use this for a thesis/demo build
that will never move real money. **Unset it for any launch that takes real
payments.** Without the flag and without usable PayMongo Money Movement
credentials (`PAYMONGO_PAYOUT_WALLET_ID` + an approved account), Auto Payout
skips and you fall back to the manual payout (admin sends the money outside
SafeDrive, then records the reference).

`CRON_SECRET` is required for the booking-deadline expiry and return-reminder
workers. Vercel's Hobby plan only allows once-a-day cron jobs, which is too slow
for the next-day booking flow, so scheduling is done with an **external
scheduler** instead of `vercel.json` `crons`. Point a free scheduler
(cron-job.org, GitHub Actions `schedule`, Supabase `pg_cron` + `pg_net`, etc.) at:

- `GET https://<domain>/api/expire-booking-deadlines` every ~15 minutes
- `GET https://<domain>/api/send-return-reminders` every ~60 minutes

Each request must send the header `Authorization: Bearer <CRON_SECRET>`. Without a
scheduler these two workers never run (bookings never auto-expire, reminders
never send). If the project moves to Vercel Pro, the jobs can instead be declared
in `vercel.json` under `crons` with any schedule.

For the authoritative system status, architecture, environment, database,
PayMongo, Gmail, testing, migration, legal/control map, and the complete route,
API, helper, class, type, and call-boundary reference, use:

```text
project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md
```

`CHANGELOG.md` in the repository root is the running, dated log of intentional
changes (what changed, why, which files, follow-up).

`project_docs/SYSTEM_FLOWS.md` is the end-to-end flow reference (guest through
payout/refund): which endpoint runs, what it checks, what state it changes.

For the fillable weekly action list, evidence register, launch gates, and
researched provider/legal source links, use the companion Word file:

```text
project_docs/SAFEDRIVE_ACTION_AND_LAUNCH_CHECKLIST.docx
```

## Current Booking Flow Notes

- A trip can start as early as the next calendar day (same-day starts stay
  disabled). The lister has 24 hours to accept and the renter then has 24 hours
  to pay, but both deadlines are capped at the pickup time; a request that is not
  accepted and paid before pickup is auto-cancelled by the deadline cron worker.
- Platform commission is configurable in Admin Platform Settings.
- Arrival confirmation is one-tap first; photos and browser location are optional evidence.
- No-show review uses arrival timestamps, optional evidence, booking-linked support reports, and admin timeline review.
- Completion wording is `Finish Trip`.
- Ratings can be skipped for now, and duplicate submissions are blocked.

Specialized files under `docs/`, `plans/`, and `project_docs/` are retained when
they provide technical, defense, standards, evidence, or operational detail.
Superseded general-status copies were removed after being preserved in Git
history. When retained material conflicts, the current code and master
documentation above take precedence.
