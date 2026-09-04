# SafeDrive 2.0 Current Implementation and Launch Plan

This is the short operational plan. The authoritative details, evidence,
methods, controls, and defense notes are in
`project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`.

## Implemented locally

- One React 19 and TypeScript application built by Vite, with public, user,
  admin, and super-admin route guards.
- Supabase Auth, PostgreSQL, Storage, RLS-oriented access controls, and one
  chaptered database reference.
- Guest inquiries with selectable topics, admin attention counts, Gmail Apps
  Script delivery, and resolve-only-after-delivery behavior.
- KYC and vehicle approval, private evidence, re-review after material listing
  changes, maintenance blackouts, booking overlap protection, and agreement
  version acceptance.
- PayMongo hosted checkout and signed webhook processing, payout review,
  append-only balanced ledger, and reconciliation.
- Independent pickup and return condition reports with required photo classes
  and optional consented location evidence.
- Privacy-request intake and super-admin review rather than automatic deletion.
- Audit events and role-aware admin notification/dashboard queues.

## Work allowed before choosing a host

1. Keep lint, TypeScript, logic, browser-route, environment, documentation, and
   clean-build checks passing.
2. Run the Chapter 16 read-only database verification against the live Supabase
   project and save non-secret output.
3. Exercise PayMongo test checkout, signed webhook replay/idempotency, refund,
   payout eligibility, test wallet movement where the account supports it, and
   reconciliation without treating simulated success as real money movement.
4. Complete manual keyboard, screen-reader, mobile-width, and supported-browser
   test records.
5. Obtain Philippine legal, privacy, insurance, consumer, tax, and accounting
   review before public launch or real-money use.

## Deferred until hosting is selected

1. Choose a host that supports the Vite SPA rewrite, Node-compatible `/api/*`
   handlers, secrets, HTTPS, scheduled jobs, logs, and webhook endpoints.
2. Add host secrets from `.env.example`; never expose server-only values with a
   `VITE_` prefix.
3. configure Supabase Site URL and allowed redirect URLs for the final origin.
4. Register PayMongo webhook and payout configuration for the final HTTPS API.
5. Configure cron authentication, monitoring, backup/restore evidence, and
   production Gmail webhook URLs.
6. Repeat the complete test matrix on the production-like deployment before
   enabling live keys or money movement.

## Launch rule

Local checks prove repository behavior only. SafeDrive is not launch-ready
until the master checklist has evidence for the live database, provider events,
hosted routes, security operations, accessibility, and professional reviews.
