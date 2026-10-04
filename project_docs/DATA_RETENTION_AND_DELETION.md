# SafeDrive — Data Retention & Account Deletion

How SafeDrive handles a data-subject request under RA 10173 (Data Privacy Act
of 2012). This mirrors what is actually implemented in code and the database;
it is not aspirational.

## 1. Guiding rule

A member exercises their rights themselves; nothing waits on an admin
(CHAPTER 121). Deleting an account is satisfied by **anonymization** whenever
financial, contract, dispute, fraud, tax, or legal-hold records must be
retained. This follows DPA principles (legitimate purpose, proportionality)
and the GDPR Art. 17(3) carve-outs that PH practice tracks.

## 2. How each right is exercised

| Right | Where | What happens |
|---|---|---|
| Access / portability | **Your Data** (`/privacy-request`) → "Download my data" (`GET /api/data-request`) | One JSON file of the member's own profile, bookings, payments, vehicles, reviews and support tickets. ID numbers and images, arrival locations and photos, and other people's details are left out. Audited as `personal_data_exported`. |
| Erasure | Account settings → **Delete account** (CHAPTER 96) | Scheduled `account_deletion_grace_days` ahead (default 30); hidden meanwhile; signing in and keeping it cancels; `run_due_account_deletions()` anonymizes on the day. |
| Erasure of an unused account | Automatic: `flag_dormant_accounts()` daily (CHAPTER 121) | No sign-in for `dormant_account_days` (default 365) schedules the same deletion; the owner is notified and emailed. Skips suspended accounts and any with a booking, refund, payout or booking case still open. |
| Rectification, restriction, objection, anything else | Support ticket tagged **Privacy / Data** | Answered in the ticket. A restriction is applied by suspending the account in User Management; a suspended member who wants deletion is anonymized from User Management ("Anonymize"). |

Every scheduled deletion is listed, read-only, on **Account Deletions**
(`/admin/retention-requests`) with the retention schedule. A deletion that is
held (a suspension, or something still open on its date) shows there and on
the admin dashboard as "Deletions on hold", and is resolved from User
Management. `POST` / `PATCH /api/data-request` answer 410: requests are no
longer filed.

## 3. What blocks a hard delete

`bookings.renter_id` / `bookings.owner_id` reference `profiles(id)` with **no
`ON DELETE` action** (NO ACTION), and `booking_agreement_acceptances` and
`trip_condition_reports` use `ON DELETE RESTRICT`. Any of these rows makes
`DELETE FROM auth.users` (which would cascade to `profiles`) fail at the
database. This is deliberate — those are legal and financial evidence.

A true hard delete is therefore only possible for an account with **zero**
bookings / agreement acceptances / incident reports, done server-side via
`supabase.auth.admin.deleteUser` (see `api/admin-delete.ts` for the
staff-account equivalent). Every other account is **anonymized**.

## 4. Scripted anonymization — `public.anonymize_user(p_user_id, p_request_id)`

`SECURITY DEFINER`, super-admin only, one transaction. Run by the daily
scheduled-deletion job and by "Anonymize" in User Management
(`api/account-deletion.ts`); the returned report is stored as the execution
note and an `user_anonymized` audit row is written.

**Refuses** if: the caller is not a super admin; the target is `admin` /
`super_admin` (demote first); the account is already `deleted_at`; or the user
has a booking in `confirmed` / `awaiting_payment` / `downpayment_paid` /
`fully_paid` / `active`.

### Cleared automatically

| Area | Action |
|---|---|
| `profiles` | `email` → `deleted+<id8>@safedrive.invalid`; `full_name` → "Deleted user"; `first/middle/last_name`, `phone`, `secondary_phone`, `address`, `birthday`, `driver_license`, `national_id`, `secondary_id_type`, `avatar_url`, `gender`, `payout_method`, `payout_account_name`, `payout_account_number`, `emergency_contact_number`, `login_block_reason` → NULL; `is_lister` → false; `deleted_at` → now() |
| `storage.objects` (`user-verification/<id>/…`) | deleted |
| `verification_images` | rows deleted |
| `cars` (owned) | `status` → `inactive`; `contact_number`, `additional_info` → NULL |
| `bookings` (both roles) | arrival latitude/longitude/accuracy/captured_at + arrival photo URL → NULL |
| `trip_condition_reports` (as reporter) | latitude/longitude/accuracy → NULL |
| `notifications` (addressed to user) | deleted |
| `audit_log` (the user's own rows) | PII keys removed from `details`: `email`, `admin_email`, `renter_email`, `owner_email`, `full_name`, `admin_name`, `name`, `phone` |
| `data_retention_requests` (subject) | `requester_email` → `redacted@safedrive.invalid` |

### Kept (transactional / evidentiary — now anonymous by association)

`bookings`, `payments`, `booking_agreement_acceptances`,
`booking_reviews` rows and ratings, ledger journals.

### Flagged for manual review (returned as counts in the report)

Free text that cannot be auto-scrubbed without destroying dispute / safety
evidence: `booking_reviews.feedback`, `ticket_messages` bodies,
`trip_condition_reports.damage_notes`, `guest_inquiries`. A human decides
case-by-case.

## 5. Retention schedule

Live in `public.retention_policy_rules` and shown on
`/admin/retention-requests`. Current categories:

| Category | Days | Rationale |
|---|---|---|
| `abandoned_guest_inquiry` | 90 | Minimize unused visitor data |
| `resolved_guest_inquiry` | 365 | Answer history and service quality |
| `rejected_kyc_after_appeal` | 90 | Short appeal and fraud-review window |
| `support_case` | 730 | Dispute and service history |
| `trip_condition_no_dispute` | 730 | Vehicle-condition evidence window |
| `financial_source_record` | 1825 | Five-year BIR accounting/source-record baseline |
| `agreement_acceptance` | 3650 | Written-contract evidence; confirm with PH counsel |
| `security_audit_log` | 730 | Security investigation and accountability |
| `unsuccessful_login_telemetry` | 90 | Short security telemetry window unless incident-related |

These are **provisional** pending privacy, legal, tax, and accounting review.

## 6. Known limitations / future work

- **External processors.** PayMongo (payments) and Resend (transactional
  email) hold PII outside SafeDrive. Anonymization here does not reach them; a
  processor-level deletion request is a separate manual runbook.
- **No automated data export** for `access` requests — the admin records that
  access was provided; there is no generated portable bundle.
- **No overdue escalation** on `due_at`.
- **Free-text scrubbing is manual** (section 4, last table).
- `auth.users` is not deleted by the retention flow even in the clean-delete
  case; a super admin does that in the Supabase dashboard.
- **Storage backend.** `anonymize_user` deletes the `storage.objects` rows for
  the user's verification files, which makes them immediately unreachable (no
  signed URL, no RLS match). The underlying bytes in the bucket backend are
  removed on the next storage GC / by a dashboard bulk-delete of the
  `user-verification/<id>/` prefix — worth doing as a periodic sweep.
