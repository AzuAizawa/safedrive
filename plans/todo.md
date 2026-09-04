# SafeDrive Weekly Verification Checklist

Use this short list during the week. Record detailed proof in the canonical
master document instead of creating another report.

## Repository checks

- [ ] `npm run check:all` passes.
- [ ] `npm run build:clean` passes.
- [ ] `npm audit` reports no unresolved production vulnerability.
- [ ] `git diff --check` passes apart from harmless line-ending notices.
- [ ] `npm run check:alignment` reports every reviewed text file and line count.

## Live Supabase proof

- [ ] Chapter 14 has been reviewed and applied to the intended project only.
- [ ] Chapter 17 (security & integrity hardening) has been applied, after a backup and after `app.settings.encryption_key` is set.
- [ ] Chapter 16 returns expected objects and zero duplicate/overlap/unbalanced rows.
- [ ] Public, user, admin, and super-admin RLS/storage access is tested with real test accounts.
- [ ] Backup and restore evidence is saved without credentials or personal data.

## PayMongo test proof

- [ ] Hosted checkout success and failure paths are tested.
- [ ] Signed webhook rejects bad signatures and accepts valid, timely events.
- [ ] Replaying the same event does not duplicate payment or ledger records.
- [ ] Refund and payout review paths preserve provider evidence and failures stay reviewable.
- [ ] Test wallet/payout simulation is clearly labeled and never treated as live settlement.
- [ ] Reconciliation identifies intentional mismatch fixtures and clears resolved items with evidence.

## Manual product checks

- [ ] Guest asks without an account; admin is notified; Gmail reply succeeds; only then is it resolved.
- [ ] KYC and vehicle approval/rejection/re-review work with correct roles.
- [ ] Booking, agreement acceptance, payment, pickup, return, completion, and payout states are exercised.
- [ ] Admin sees operational queues; only super-admin sees protected finance and retention pages.
- [ ] Keyboard, focus, labels, contrast, screen reader, mobile widths, and supported browsers are recorded.

## Before public or real-money launch

- [ ] Hosting, HTTPS, secrets, SPA rewrites, API routes, cron, logs, alerts, and redirects are verified.
- [ ] Live PayMongo capabilities and account approval are confirmed directly with PayMongo.
- [ ] Philippine counsel reviews platform, lister, rental, cancellation, privacy, consumer, and dispute terms.
- [ ] Insurance professionals confirm rental-use, own-damage, theft, passenger, third-party, and claim handling.
- [ ] A Philippine accountant confirms fees, taxes, invoices/receipts, withholding, books, and reconciliation treatment.
- [ ] NPC registration/DPO duties, privacy operations, breach response, retention schedule, and request procedures are completed as applicable.
