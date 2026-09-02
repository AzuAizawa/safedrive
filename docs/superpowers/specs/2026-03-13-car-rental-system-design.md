# SafeDrive 2.0 Original Design Record

This file records the design direction approved on 13 March 2026. It is kept
for thesis history, not as current implementation authority.

## Original direction

The initial proposal separated user and admin single-page applications, used
Supabase for authentication/database/storage, used PayMongo test mode for
payments, and centered on KYC, vehicle approval, booking, downpayment/balance,
manual payout review, and audit logging.

## Decisions superseded during implementation

- SafeDrive now has one React application with public, user, admin, and
  super-admin route guards instead of two independently deployed SPAs.
- Server APIs and database controls recalculate booking/payment decisions;
  browser redirects and client values are not authoritative.
- Guest inquiry, lister agreement versioning, maintenance blackout, condition
  reports, security deposit, privacy request, ledger, reconciliation, and
  role-aware notification workflows were added.
- Sensitive documents use private storage policies and signed access rather
  than a generic mixed public/private vehicle bucket.
- Payouts/refunds and financial review are super-admin functions. PayMongo
  capabilities remain account- and environment-dependent, and test simulation
  is never evidence of live settlement.
- The "manual payout review" step was removed. Payouts run only through the
  in-app Auto Payout action (demo simulation now, PayMongo Money Movement when
  approved); there is no out-of-app admin-sends-money-by-hand path.
- The project no longer promises regulated escrow, automatic permanent
  deletion after 30 days, unsupported cancellation percentages, or insurance
  coverage that has not been professionally verified.

## Current authority

Use these files for any implementation, thesis defense, deployment, or test:

1. `project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md`
2. `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`
3. `docs/system-process.md`
4. current source code and automated checks

If this historical record conflicts with those sources, the current sources
take precedence.
