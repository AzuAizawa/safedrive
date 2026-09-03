# SafeDrive — Admin RBAC Design (Discord-style permission checklist)

Status: proposal / not yet implemented
Author: derived from a full sweep of `src/pages/admin/*`, `src/components/Admin*`, `api/*`, and `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`
Date: 2026-09-03

---

## 0. The two-tier model (settled)

There are exactly two staff tiers, and they do **not** share a permission list.

| | **Admin** | **Super admin** |
|---|---|---|
| How created | By a super admin, in-app (§6) | **Always** seeded directly in the database (§1.1). There is no in-app way to create or promote a super admin. |
| Powers | A **checklist of 9 operational permissions** (§3), toggled on/off per admin by a super admin | **Everything** — all admin powers, plus the super-admin-exclusive powers (§4) that an admin can never be granted or even see |
| Can manage other admins | No | Yes |
| Can move money / change platform settings | No, never | Yes |

The checklist only ever contains the 9 operational keys. Finance, platform settings, privacy requests, and admin governance are **not** in the checklist, are **not** shown in a plain admin's UI, and cannot be delegated.

---

## 1. Answers to the original questions

### 1.1 "Super admin can only be made in the database — true and standard?"

**True and standard.** SafeDrive deliberately keeps **every** super admin database-only — not just the first. Rationale:

- The first super admin *must* be seeded anyway (bootstrap / break-glass — nothing exists yet to grant the role).
- Extending the same rule to all super admins removes an entire class of risk: there is no in-app button, RPC, or flow that can hand out unrestricted access, so it cannot be abused, mis-clicked, or reached through a bug. For a money-handling system with a small trusted operator team this is the safer choice.
- The trade-off (someone needs Supabase SQL access to add a super admin) is acceptable at this scale and is itself a useful control.

The exact SQL is documented in `SAFE_DRIVE_DATABASE_MASTER.sql` lines 98–112 ("Restore a super admin"): insert/upsert a `public.profiles` row with `role = 'super_admin'` for the target `auth.users` id. Every such change should be recorded in an operations log outside the app.

An `admin` is **never** promoted to `super_admin` from the UI. To make someone a super admin: create/keep them as a normal account, then run the SQL.

### 1.2 "Admin is created by a super admin on the website, with a module that sets email + password"

The module is correct. **One change: the super admin must not type a password and hand it over** — that leaks it through chat/email/logs.

Standard flow:
1. Super admin enters **email + name**, picks a **role template**, ticks the **9-item checklist**.
2. Server creates the auth user and **emails an invite link** (or a one-time temp password forced to change on first login).
3. The new admin sets their **own** password, then **must enrol MFA** (admin login already enforces a second factor — `AdminRoute.tsx` `pendingSecondFactor`).
4. Everything is written to `audit_log`.

### 1.3 "Discord-style permission checklist per admin, toggleable later by super admin"

**Yes — textbook RBAC.** Today SafeDrive only has a 3-value `role` column and two coarse gates (`is_admin()`, `is_super_admin()`). This document adds the granular layer: a fixed catalog of 9 operational permissions, granted per-admin, enforced in **Postgres RLS + `/api` handlers**. The UI checklist is cosmetic — "hiding a menu item is never authorization" (`AdminRoute.tsx:83`, master doc §2.4).

---

## 2. Full capability inventory (what staff can actually do today)

Swept from `src/App.tsx` (routes), `src/components/AdminLayout.tsx` (nav), every `src/pages/admin/*` page, and every `api/*` handler. "Tier" = which tier this belongs to under the new model.

### Domain A — User / KYC management  (`/admin/users`, `AdminUsersPage.tsx`) — **Admin tier**

| # | Capability | Code | Enforced at today | New key |
|---|---|---|---|---|
| A1 | View user list, profiles, KYC images | `:182,194,368` | RLS `is_admin()` | `users.verify` (read) |
| A2 | Approve identity verification | `:424` | RLS `is_admin()` | `users.verify` |
| A3 | Reject identity verification (with reason) | `:485` | RLS `is_admin()` | `users.verify` |
| A4 | Re-review a flagged KYC image | `:364,368` | RLS `is_admin()` | `users.verify` |
| A5 | Send verification decision email | `api/send-verification-decision-email.ts` | `role in (admin, super_admin)` | `users.verify` |
| A6 | Block a user's login | `:554` | RLS `is_admin()` | `users.moderate` |
| A7 | Unblock a user's login | `:597` | RLS `is_admin()` | `users.moderate` |
| A8 | **Reset a user's password** | `api/admin-reset-password.ts` | **`role='super_admin'`** | **super-admin only** (§4) |
| A9 | **Reset a user's authenticator/MFA** | `api/admin-reset-authenticator.ts` | **`role='super_admin'`** | **super-admin only** (§4) |

### Domain B — Vehicle approval  (`/admin/vehicle-approval`, `AdminVehicleApprovalPage.tsx`) — **Admin tier**

| # | Capability | Code | New key |
|---|---|---|---|
| B1 | View pending vehicles + car documents | `:79` | `vehicles.review` (read) |
| B2 | Approve vehicle | `:422` | `vehicles.review` |
| B3 | Reject vehicle (reason) | `:494` | `vehicles.review` |
| B4 | Revoke an approved vehicle | `:562` | `vehicles.review` |
| B5 | **Delete a vehicle record** | `:602` | `vehicles.delete` |
| B6 | Re-review flagged car documents | `:431,499` | `vehicles.review` |
| B7 | Send vehicle decision email | `api/send-vehicle-decision-email.ts` | `vehicles.review` |
| B8 | Update `car_renewals` (renewal review) | RLS `:752` | `vehicles.review` |

### Domain C — Car catalog  (`/admin/car-catalog`, `AdminCarCatalogPage.tsx`) — **Admin tier**

| # | Capability | Code | New key |
|---|---|---|---|
| C1–C4 | Add / delete car brand, add / delete car model | `:117,216,140,174` | `catalog.manage` |

### Domain D — Support tickets  (`/admin/support`, `AdminSupportTicketsPage.tsx`) — **Admin tier**

| # | Capability | Code | New key |
|---|---|---|---|
| D1 | View all tickets + messages | `:539` | `support.handle` |
| D2 | Reply to a ticket | `:480,627` | `support.handle` |
| D3 | Close a ticket | `:539` | `support.handle` |
| D4 | Reopen a ticket | `:568` | `support.handle` |
| D5 | Create a ticket on behalf of a user | `:608` | `support.handle` |
| D6 | Send ticket reply email | `api/send-support-ticket-reply-email.ts` | `support.handle` |

### Domain E — Guest / user inquiries  (`/admin/guest-inquiries`, `AdminGuestInquiriesPage.tsx`) — **Admin tier**

| # | Capability | Code | New key |
|---|---|---|---|
| E1 | View inquiries + threads | `:115` | `inquiries.handle` |
| E2 | Claim an inquiry (`in_progress`, `assigned_admin_id`) | `:115` | `inquiries.handle` |
| E3 | Reply to an inquiry | `api/reply-guest-inquiry.ts` (`action:reply`) | `inquiries.handle` |
| E4 | Mark an inquiry resolved | `api/reply-guest-inquiry.ts` (`action:resolve`) | `inquiries.handle` |

### Domain F — Logs  (`/admin/audit-trail`, `/admin/audit-logs`, `/admin/security-logs`) — **Admin tier**

| # | Capability | Code | New key |
|---|---|---|---|
| F1 | View audit trail (accountable business/admin actions) | RLS `Admin read audit log` | `audit.view` |
| F2 | View security logs (append-only auth events) | RLS `Admin read security logs` | `security.view` |

### Domain G — Platform settings  (`/admin/platform-settings`) — **SUPER ADMIN ONLY**

Currently a plain admin can *view* this page (`AdminLayout.tsx:51` puts it in `operationalNavItems`). **Change: remove it from the admin nav entirely** — move the route inside `SuperAdminRoute`.

| # | Capability | Code | Tier |
|---|---|---|---|
| G1 | View platform settings | `AdminPlatformSettingsPage.tsx:236` | super-admin only |
| G2 | Propose a settings change | `propose_platform_setting_change` RPC | `is_super_admin()` |
| G3 | Vote on a settings change (2/3 threshold) | `vote_platform_setting_change` RPC | `is_super_admin()` |
| G4 | Cancel own proposal | `cancel_platform_setting_change` RPC | proposer |
| G5 | Set platform contact email | `set_platform_contact_email` RPC | `is_super_admin()` |

### Domain H — Finance  (`/admin/financial-*`, `/admin/reconciliation`) — **SUPER ADMIN ONLY**

| # | Capability | Code | Tier |
|---|---|---|---|
| H1 | Process a payout | `api/process-payout.ts` | `role='super_admin'` |
| H2 | Process a refund | `api/process-refund.ts` | `role='super_admin'` |
| H3 | Sync a PayMongo refund | `api/sync-paymongo-refund.ts` | `role='super_admin'` |
| H4 | Mark a manual (off-platform) refund | `api/mark-manual-refund.ts` | `role='super_admin'` |
| H5 | Decide a security-deposit claim (approve / partial / reject) | `api/security-deposit-action.ts`, `api/process-security-deposit-release.ts` | `role='super_admin'` |
| H6 | View financial ledger | `AdminFinancialLedgerPage.tsx` | super-admin route |
| H7 | Create a ledger correction (double-entry reversal) | `create_ledger_correction` RPC | super-admin route |
| H8 | Run reconciliation | `api/run-reconciliation.ts` | `role='super_admin'` |

### Domain I — Privacy / data-retention  (`/admin/retention-requests`) — **SUPER ADMIN ONLY**

| # | Capability | Code | Tier |
|---|---|---|---|
| I1 | Create a data retention / deletion request | `AdminRetentionRequestsPage.tsx:40` | super-admin route |
| I2 | Change retention request status | `:49` | super-admin route |
| I3 | Approve / deny retention request (decision + reason) | `:59` | super-admin route |
| I4 | Mark retention request executed (with proof) | `:69` | super-admin route |
| I5 | Handle privacy request pipeline | `api/data-request.ts` | notifies super admins |

### Domain J — Admin governance  (does NOT exist yet — to build) — **SUPER ADMIN ONLY**

| # | Capability |
|---|---|
| J1 | Create an admin account (email + template + 9-item checklist → invite) |
| J2 | Edit an admin's checklist (toggle on/off) |
| J3 | Disable / re-enable an admin account |
| J4 | View the admin roster + per-admin audit of permission changes |

Note: there is **no** "promote to super admin" capability. Super admins are database-only (§1.1).

### Read-only utility (any authenticated staff, no permission key)

- `/admin` dashboard metrics (`AdminDashboard.tsx`)
- `/admin/notifications` work center — only the staff member's own `notifications` rows

---

## 3. The admin checklist — 9 operational permissions

This is the entire catalog of toggles shown when creating or editing an admin. Nothing else.

| Key | "Job" | Covers | Default in "General Admin" template |
|---|---|---|---|
| `users.verify` | Verify users | A1–A5: KYC approve / reject / re-review + decision email | ✅ |
| `users.moderate` | Moderate users | A6–A7: block / unblock login | ✅ |
| `vehicles.review` | Verify cars | B1–B4, B6–B8: approve / reject / revoke / re-review + renewals + email | ✅ |
| `vehicles.delete` | Delete cars | B5: delete a vehicle record | ❌ (off by default) |
| `catalog.manage` | Manage catalog | C1–C4: car brands & models | ✅ |
| `support.handle` | Handle tickets | D1–D6: support tickets | ✅ |
| `inquiries.handle` | Handle inquiries | E1–E4: user / guest inquiries | ✅ |
| `audit.view` | View audit trail | F1 | ✅ |
| `security.view` | View security logs | F2 | ✅ |

### Role templates (presets — just pre-tick the checklist)

| Template | Permissions |
|---|---|
| **Verification Officer** | `users.verify`, `users.moderate`, `vehicles.review`, `catalog.manage`, `audit.view` |
| **Support Agent** | `support.handle`, `inquiries.handle`, `users.verify`, `audit.view` |
| **Catalog / Fleet Admin** | `vehicles.review`, `vehicles.delete`, `catalog.manage`, `audit.view` |
| **Compliance Viewer** | `audit.view`, `security.view` |
| **General Admin** | all ✅ keys above |
| **Custom** | start empty, tick manually |

### Not in the checklist (super-admin only, invisible to admin)

`reset user password / MFA` (A8–A9), all of Domain G (platform settings), all of Domain H (finance), all of Domain I (privacy/retention), all of Domain J (admin governance).

> Note: A8/A9 stay super-admin only (current behaviour, safest — account-takeover risk). If you later want a support lead to handle lockouts, add a 10th key `users.security` (off by default). Not in scope now.

---

## 4. Data model

```sql
-- 4.1  Static catalog of the 9 operational keys (seeded, read-only to admins)
create table public.admin_permission_catalog (
  key          text primary key,
  job_label    text not null,
  description  text,
  sort_order   int  not null default 0
);

-- 4.2  Per-admin grants  (the "checklist")
create table public.admin_permissions (
  admin_id        uuid not null references public.profiles(id) on delete cascade,
  permission_key  text not null references public.admin_permission_catalog(key) on delete cascade,
  granted_by      uuid references public.profiles(id) on delete set null,
  granted_at      timestamptz not null default now(),
  primary key (admin_id, permission_key)
);
create index admin_permissions_admin_idx on public.admin_permissions (admin_id);

-- 4.3  Templates (optional convenience)
create table public.admin_permission_templates (
  id              text primary key,
  label           text not null,
  permission_keys text[] not null default '{}'
);

-- 4.4  Admin account lifecycle
alter table public.profiles
  add column if not exists admin_disabled_at timestamptz,
  add column if not exists admin_created_by  uuid references public.profiles(id);
```

No JSONB blob — a join table makes "toggle one permission + audit it" trivial and queryable.

### 4.5 The gate helper

```sql
create or replace function public.admin_can(p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_super_admin()                       -- super admin: everything, always
    or exists (
      select 1
      from public.admin_permissions ap
      join public.profiles p on p.id = ap.admin_id
      where ap.admin_id = auth.uid()
        and ap.permission_key = p_key
        and p.role = 'admin'
        and p.deleted_at is null
        and p.admin_disabled_at is null
    );
$$;
grant execute on function public.admin_can(text) to authenticated;
```

`is_admin()` keeps one job only: "can this person load the admin shell / see generic admin reads". Every *action* moves to `admin_can('...')`. The super-admin-only domains (G/H/I/J) keep using `is_super_admin()` — they are never expressed as `admin_can` keys.

---

## 5. Enforcement changes

### 5.1 RLS (pattern repeats per table)

```sql
drop policy if exists "Admins can update cars" on public.cars;
create policy "Vehicle reviewers can update cars" on public.cars
  for update using (auth.uid() = owner_id or public.admin_can('vehicles.review'))
  with check   (auth.uid() = owner_id or public.admin_can('vehicles.review'));

drop policy if exists "Admins can delete cars" on public.cars;
create policy "Vehicle deleters can delete cars" on public.cars
  for delete using (public.admin_can('vehicles.delete'));

drop policy if exists "Admin read audit log" on public.audit_log;
create policy "Audit viewers read audit log" on public.audit_log
  for select using (public.admin_can('audit.view'));
```

`profiles` is special: KYC fields (`verified_status`, `rejection_reason`) → `users.verify`; moderation fields (`login_blocked_until`, `login_block_reason`) → `users.moderate`. Split this inside the existing `profiles` before-update trigger (master SQL ~line 1487), not with two UPDATE policies.

Tables to revisit (currently `is_admin()`): `profiles`, `cars`, `car_documents`, `car_renewals`, `car_brands`, `car_models`, `support_tickets`, `ticket_messages`, `guest_inquiries`, `guest_inquiry_messages`, `audit_log`, `security_logs`, `notifications` (admin-write), `booking_reviews` (read).

### 5.2 API handlers — shared helper

```ts
// api/lib/adminAuth.ts
export async function requirePermission(req, res, key: string) {
  const user = await getUserFromReq(req);
  const { data: ok } = await serviceClient.rpc('admin_can_for', { p_uid: user.id, p_key: key });
  if (!ok) { res.status(403).json({ error: `Missing permission: ${key}` }); return null; }
  return user;
}
```

| Handler | New gate |
|---|---|
| `send-verification-decision-email.ts` | `users.verify` |
| `send-vehicle-decision-email.ts` | `vehicles.review` |
| `send-support-ticket-reply-email.ts` | `support.handle` |
| `reply-guest-inquiry.ts` | `inquiries.handle` |
| `admin-reset-password.ts`, `admin-reset-authenticator.ts` | unchanged — `is_super_admin()` |
| `process-payout/refund/…`, `run-reconciliation.ts`, `data-request.ts` | unchanged — `is_super_admin()` |

### 5.3 Front-end

```ts
// AuthContext: load permissions with the profile
const { data: perms } = await supabase.from('admin_permissions')
  .select('permission_key').eq('admin_id', userId);
// expose:  permissions: string[]   +   can(key) => role === 'super_admin' || permissions.includes(key)
```

```tsx
// src/components/PermissionRoute.tsx  — for the 9 operational routes
export default function PermissionRoute({ anyOf }: { anyOf: string[] }) {
  const { can } = useAuth();
  return anyOf.some(can) ? <Outlet /> : <Navigate to="/admin" replace />;
}
```

- `AdminLayout.tsx`: rebuild nav from a `[route, label, icon, permission]` table filtered by `can(...)`. **Move `platform-settings` out of `operationalNavItems`** into the super-admin group; keep `financial-*`, `reconciliation`, `retention-requests` there.
- Pages: guard action buttons with `can(...)` — cosmetic; server stays authoritative.
- `SuperAdminRoute.tsx` stays as-is for Domains G/H/I/J.

---

## 6. New: admin governance module  (`/admin/admins`, super-admin only)

### 6.1 Create — `POST /api/admin-create`

Form: email, full name, template dropdown, 9 checkboxes grouped by job.

1. `is_super_admin()` — else 403.
2. Reject if the email already has a profile.
3. `supabase.auth.admin.generateLink({ type: 'invite', email })` (or `inviteUserByEmail`) — sends the invite. The creator sets **no** password.
4. Insert `profiles`: `role='admin'`, `verified_status='verified'`, `admin_created_by=<creator>`.
5. Insert `admin_permissions` rows for each ticked key.
6. `audit_log`: `action='admin_account_created'`, details `{ email, permissions, template }`.
7. New admin opens invite → sets password → first admin login forces MFA enrolment (already built).

### 6.2 Edit checklist later — `/admin/admins/:id`

Same 9 checkboxes, pre-filled. Save = diff → `insert` added / `delete` removed → one `audit_log` row per change (`admin_permission_granted` / `admin_permission_revoked` with `granted_by`).

Timing: `AuthContext` subscribes to realtime `admin_permissions` changes for the current user → a revoke takes effect within seconds without re-login. (No sensitive/finance keys exist in the checklist, so a forced sign-out is not needed here.)

### 6.3 Disable / re-enable

Set / clear `profiles.admin_disabled_at`. `admin_can()` and the route guard already check it. Keep the row for history.

### 6.4 Making another super admin

Not an app feature. A super admin is added by running the SQL in `SAFE_DRIVE_DATABASE_MASTER.sql` lines 98–112 against Supabase (upsert `profiles.role = 'super_admin'` for the target user id), then recording it in the operations log. The `/admin/admins` module only ever creates and manages `role='admin'` accounts.

---

## 7. Build phases

1. **Schema + helper + seed + backfill.** — ✅ **DONE (code written, not yet run on the DB).**
   - `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` Chapter 19: 3 tables (`admin_permission_catalog`, `admin_permissions`, `admin_permission_templates`), 2 `profiles` columns, `admin_can()` + `admin_can_for()`, seeded 9 keys + 5 templates, backfill of every existing admin.
   - `api/lib/adminAuth.ts`: `requirePermission()` / `requireSuperAdmin()` helpers (nothing imports them yet).
   - `src/types/database.ts`: new tables + functions + `ADMIN_PERMISSION_KEYS` typed.
   - **To activate: run Chapter 19's SQL in the Supabase SQL editor** (safe + re-runnable). `npm run build` passes.
2. **Move platform-settings to super-admin.** Route inside `SuperAdminRoute`, drop from `operationalNavItems`. (Small, do it early.)
3. **Swap enforcement.** — ⏳ NEXT (risky; needs Phase 1 live + tested). Migrate the Domain A–F RLS policies + API handlers from `is_admin()` to `admin_can('...')`, plus per-button `can()` guards on `AdminUsersPage` (verify vs moderate) and `AdminVehicleApprovalPage` (review vs delete). Behaviour identical on day 1 thanks to the backfill.
4. **Front-end plumbing.** — ✅ DONE (needs deploy + test).
   - `src/contexts/AuthContext.tsx`: `permissions` + `can(key)`, loaded from `admin_permissions` with a realtime subscription (a super_admin toggling a grant takes effect in seconds).
   - `src/components/PermissionRoute.tsx`: gates route groups by `anyOf` keys.
   - `src/lib/permissions.ts`: `hasPermission` / `hasAnyPermission`.
   - `src/App.tsx`: the 9 operational routes wrapped in `PermissionRoute`; **`/admin/platform-settings` moved under `SuperAdminRoute`**.
   - `src/components/AdminLayout.tsx`: nav built from one table, filtered by `can()` / super-admin.
   - `src/types/database.ts`: new tables/functions typed. `npm run build` + `lint` pass.
5. **Admin governance module.** `/admin/admins` list + create + edit + disable, `/api/admin-create`, audit logging.
6. **Docs + tests.** Extend `npm run check:live-roles` to assert each of the 9 keys gates its endpoints; update master documentation §2.

Phases 1–3 are the risky part (touch every Domain A–F policy); 4–6 are additive.
