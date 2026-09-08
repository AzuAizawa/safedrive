# SafeDrive — Backup and Recovery

How SafeDrive is backed up, how it is restored, and what the backup does not
cover. Written to be executed, not filed.

---

## 1. The 3-2-1 rule, mapped to SafeDrive

The rule is **three copies, on two kinds of storage, one of them off-site**.
Each number answers a different way of losing data: a corrupted file, a dead
machine, and a lost location.

| Copy | Where | Storage kind | Off-site |
|---|---|---|---|
| 1 | Supabase project (live) | cloud database | — |
| 2 | `backups/<timestamp>/` on the development laptop | local disk | no |
| 3 | The same folder uploaded to a **private** cloud drive | cloud drive | **yes** |

The application **code** already satisfies the rule on its own: the working
copy on the laptop plus GitHub is two copies on two kinds of storage with one
off-site. The **database schema** rides along with it — running
`database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` rebuilds every table, policy,
function and storage bucket, and that file is in git.

What was not covered until now, and what this document exists for, is the
**data** (bookings, payments, ledger, profiles) and the **stored files** (KYC
documents, vehicle photos, trip photos). Both lived in exactly one place.

## 2. Mirror backup vs point-in-time — the distinction that matters

A **mirror** is a 1:1 copy kept in sync with the original.

A mirror is not by itself a backup, and this is worth saying plainly rather
than reciting the rule: **a mirror faithfully copies deletions**. Delete a
table by mistake, and the mirror deletes it too, usually within seconds. A
mirror protects against a machine dying. It does not protect against a person
making a mistake, or against ransomware.

That is why copies 2 and 3 above are **point-in-time** — each backup folder is
frozen at the moment it was taken and never changes afterwards. Keeping several
dated folders means an accident discovered a week later is still recoverable.

SafeDrive has no continuous mirror. Supabase provides that as read replicas and
point-in-time recovery on its **paid** plans; this project is on the free plan.
Dated snapshots taken by hand are the honest free-tier substitute, and this
document is what makes them repeatable.

## 3. Taking a backup

```bash
node scripts/backup-safedrive.mjs
```

Reads `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env` — the
same variables the other scripts use, so there is nothing extra to set up.

Output:

```
backups/2026-09-08T14-30/
  tables/       one JSON file per table (43 of them)
  storage/      every file, foldered by bucket
  manifest.json row count per table, file count and size per bucket
```

The table list is read from `src/types/database.ts` at run time, so a table
added later is picked up automatically rather than being silently skipped.
Every table is paged to exhaustion — a backup that stopped at the API's
1,000-row cap would look successful while being incomplete, so `manifest.json`
records the counts for checking.

**The script exits non-zero if anything failed.** A backup that fails quietly
is the entire failure mode being guarded against here; check the exit code, not
just the output.

### How often

- **Before running any new CHAPTER** in the master SQL file. Schema changes are
  the highest-risk moment.
- **Before a defense or demonstration.**
- Otherwise weekly while the project is being actively worked on.

### Then do the third copy

Upload the folder to a **private** cloud drive. Until that upload happens there
are only two copies and neither is off-site — the rule is not satisfied by the
script alone.

## 4. Privacy — read before copying anything anywhere

A backup folder contains, in plain readable form:

- KYC identity documents and selfies (`user-verification`)
- Government ID numbers, addresses, birth dates (`profiles`)
- **Payout account names and numbers** (`profiles`)
- Vehicle registration documents (`vehicle-private-documents`, `car-documents`)
- Support conversations and their attachments

Rules:

1. **Never commit it.** `backups/` is in `.gitignore`. Do not force-add it.
2. **Never email it or put it in a group chat.**
3. The off-site copy goes in a **private** drive folder — not a "anyone with the
   link" share.
4. Delete old backup folders from the laptop when they are no longer needed.

A leaked backup is a worse outcome than having had no backup at all.

## 5. Restoring

The restore is the part that proves the backup is real. Rehearse it; do not
wait for an emergency to find out.

1. **Create a new Supabase project.** The free plan allows a second one on the
   same account.
2. **Run `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql`** in its SQL editor,
   top to bottom. This rebuilds the schema, the policies, the functions and the
   storage buckets — everything except the data.
3. **Point `.env` at the new project** (`VITE_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` from its API settings).
4. **Run the restore**, naming the project ref by hand:

   ```bash
   SAFEDRIVE_RESTORE_CONFIRM=<project-ref> node scripts/restore-safedrive.mjs backups/2026-09-08T14-30
   ```

   The project ref is the subdomain of the Supabase URL.

5. **Compare** the row counts it prints against `manifest.json`.

### The two guards, and why they are deliberately awkward

The restore script refuses unless **both** hold:

- `SAFEDRIVE_RESTORE_CONFIRM` matches the project `.env` points at. Typing the
  ref by hand is what prevents this ever being aimed at production by reflex.
- **Every target table is empty.** The script can only fill a fresh project. It
  will never merge into or overwrite a database in use.

Both are worth testing on purpose — run it without the variable, and run it
twice — because those two behaviours matter more than the happy path.

## 6. What is NOT backed up

**`auth.users` — sign-in credentials.** Password hashes, MFA/TOTP factors and
email-confirmation state live in Supabase's own `auth` schema, which the
service-role REST API cannot export. Rows that reference a user id are backed
up and restored correctly, so bookings, payments and photos all come back
attached to the right person.

What does not come back is the ability to log in. After a restore:

- Existing users must reset their password before they can sign in.
- A super admin has to be re-created by hand — see *"Restore a super admin"*
  near the top of `SAFE_DRIVE_DATABASE_MASTER.sql`.

This is a limitation of the free-tier export path, not an oversight. Recovering
`auth.users` intact requires Supabase's own project-level backup, which is a
paid feature.

**Vercel deployment configuration and environment variables** are also not in
these files. They are re-enterable from the Vercel dashboard, and the variable
*names* are documented in the master documentation.

## 7. Recording the evidence

A restore that was never written down did not happen, as far as a reviewer is
concerned. After each rehearsal, record:

- the date, the backup folder used, and the project restored into;
- a screenshot of the restore output beside `manifest.json`, showing the counts
  match;
- anything that went wrong and what was done about it.

Keep that with the defense materials. It is the difference between *"we have
backups"* and *"we restored one, here is the proof."*
