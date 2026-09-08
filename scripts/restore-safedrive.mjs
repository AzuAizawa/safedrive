/**
 * SafeDrive restore - put a backup folder back into a Supabase project.
 *
 *   node scripts/restore-safedrive.mjs backups/2026-09-08T14-30
 *
 * WHY THIS EXISTS
 * A backup nobody has restored is a claim, not a control. The point of this
 * script is less "recover from disaster" and more "prove the backup is real" -
 * run it into a second free Supabase project, compare the row counts to
 * manifest.json, and you have evidence instead of a policy document.
 *
 * BEFORE RUNNING
 * 1. Create a NEW Supabase project (the free plan allows a second one).
 * 2. Run database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql in its SQL editor -
 *    that rebuilds every table, policy, function and bucket.
 * 3. Point .env at that project (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 * 4. Set SAFEDRIVE_RESTORE_CONFIRM to that project's ref - the subdomain in
 *    the URL. This must be typed by hand; it is what stops the script from
 *    ever being aimed at production by accident.
 *
 * TWO GUARDS, both deliberately unhelpful:
 *   - the confirmation variable must match the project the .env points at;
 *   - every target table must already be empty.
 * Either one failing aborts the whole run. This script can only ever fill a
 * fresh project. It can never overwrite a live one.
 *
 * NOT RESTORED: auth.users. Passwords and MFA factors are in Supabase's auth
 * schema. Rows referencing a user id are restored, but nobody can sign in
 * until an account is re-invited or its password reset.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const backupArgument = process.argv[2];
if (!backupArgument) {
  console.error("Usage: node scripts/restore-safedrive.mjs <backup folder>");
  process.exit(1);
}
const backupRoot = resolve(process.cwd(), backupArgument);
if (!existsSync(resolve(backupRoot, "manifest.json"))) {
  console.error(`[FAIL] No manifest.json in ${backupArgument} - not a backup folder.`);
  process.exit(1);
}

// --- .env, same parsing as the other scripts ------------------------------
const environmentPath = resolve(process.cwd(), ".env");
if (!existsSync(environmentPath)) {
  console.error("[FAIL] .env was not found.");
  process.exit(1);
}
const environment = new Map();
for (const rawLine of readFileSync(environmentPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const name = line.slice(0, separator).trim();
  let value = line.slice(separator + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  environment.set(name, value);
}

const supabaseUrl = environment.get("VITE_SUPABASE_URL") || "";
const serviceRoleKey = environment.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !serviceRoleKey) {
  console.error("[FAIL] VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

// --- Guard 1: the operator must name the project out loud -----------------
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const confirmation =
  process.env.SAFEDRIVE_RESTORE_CONFIRM || environment.get("SAFEDRIVE_RESTORE_CONFIRM") || "";

if (confirmation !== projectRef) {
  console.error("[FAIL] Restore refused - the target project was not confirmed.");
  console.error("");
  console.error(`  .env points at project: ${projectRef}`);
  console.error(
    confirmation
      ? `  SAFEDRIVE_RESTORE_CONFIRM says:  ${confirmation}`
      : "  SAFEDRIVE_RESTORE_CONFIRM is not set",
  );
  console.error("");
  console.error("  Restoring writes thousands of rows. Typing the project ref by hand");
  console.error("  is what stops this being aimed at the live database by accident.");
  console.error("");
  console.error(`  To proceed:  SAFEDRIVE_RESTORE_CONFIRM=${projectRef} node scripts/restore-safedrive.mjs ${backupArgument}`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Parents before children. Restoring bookings before the profiles and cars
 * they reference would fail on every foreign key, so this order is the
 * dependency order, not alphabetical. Anything not named here is restored
 * afterwards in alphabetical order - safe, because the tables with the
 * deepest chains are all listed.
 */
const ORDERED_TABLES = [
  "profiles",
  "admin_permission_catalog",
  "admin_permission_templates",
  "admin_permissions",
  "platform_settings",
  "financial_accounts",
  "retention_policy_rules",
  "legal_document_versions",
  "car_brands",
  "car_models",
  "cars",
  "car_images",
  "car_documents",
  "car_agreement_versions",
  "car_renewals",
  "vehicle_unavailability",
  "verification_images",
  "subscriptions",
  "bookings",
  "booking_agreement_acceptances",
  "booking_cancellations",
  "booking_early_returns",
  "booking_extensions",
  "booking_reviews",
  "payments",
  "ledger_journals",
  "ledger_entries",
  "trip_condition_reports",
  "trip_condition_photos",
  "support_tickets",
  "ticket_messages",
  "guest_inquiries",
  "guest_inquiry_messages",
  "notifications",
  "data_retention_requests",
  "reconciliation_runs",
  "reconciliation_items",
  "platform_setting_change_requests",
  "platform_setting_change_votes",
  "platform_announcements",
  "audit_log",
  "security_logs",
  "blocked_ips",
];

const CHUNK = 500;

const run = async () => {
  const manifest = JSON.parse(readFileSync(resolve(backupRoot, "manifest.json"), "utf8"));
  const tablesDirectory = resolve(backupRoot, "tables");
  const filesOnDisk = readdirSync(tablesDirectory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => basename(name, ".json"));

  const ordered = [
    ...ORDERED_TABLES.filter((table) => filesOnDisk.includes(table)),
    ...filesOnDisk.filter((table) => !ORDERED_TABLES.includes(table)).sort(),
  ];

  console.log(`Restoring ${backupArgument}`);
  console.log(`Taken:  ${manifest.takenAt} from ${manifest.project}`);
  console.log(`Into:   ${projectRef}\n`);

  // --- Guard 2: refuse anything that is not a fresh project ---------------
  console.log("Checking the target is empty...");
  for (const table of ordered) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) {
      console.error(`[FAIL] Could not read ${table}: ${error.message}`);
      console.error("       Has SAFE_DRIVE_DATABASE_MASTER.sql been run on this project?");
      process.exit(1);
    }
    if ((count ?? 0) > 0) {
      console.error(`\n[FAIL] Restore refused - ${table} already has ${count} row(s).`);
      console.error("       This script only ever fills an empty project. It will not");
      console.error("       merge into or overwrite a database that is already in use.");
      process.exit(1);
    }
  }
  console.log("Target is empty. Proceeding.\n");

  const restored = {};
  const problems = [];

  for (const table of ordered) {
    const rows = JSON.parse(
      readFileSync(resolve(tablesDirectory, `${table}.json`), "utf8"),
    );
    if (rows.length === 0) {
      restored[table] = 0;
      continue;
    }
    let written = 0;
    for (let index = 0; index < rows.length; index += CHUNK) {
      const slice = rows.slice(index, index + CHUNK);
      const { error } = await supabase.from(table).insert(slice);
      if (error) {
        problems.push(`${table} rows ${index}-${index + slice.length - 1}: ${error.message}`);
        continue;
      }
      written += slice.length;
    }
    restored[table] = written;
    const expected = manifest.tables?.[table] ?? rows.length;
    const flag = written === expected ? "" : `  <-- expected ${expected}`;
    console.log(`  ${table}: ${written} rows${flag}`);
  }

  // --- Storage -------------------------------------------------------------
  const storageRoot = resolve(backupRoot, "storage");
  if (existsSync(storageRoot)) {
    console.log("");
    for (const bucket of readdirSync(storageRoot)) {
      const bucketRoot = resolve(storageRoot, bucket);
      if (!statSync(bucketRoot).isDirectory()) continue;

      const walk = (directory, prefix = "") => {
        const found = [];
        for (const entry of readdirSync(directory)) {
          const full = join(directory, entry);
          const path = prefix ? `${prefix}/${entry}` : entry;
          if (statSync(full).isDirectory()) found.push(...walk(full, path));
          else found.push({ full, path });
        }
        return found;
      };

      const files = walk(bucketRoot);
      let uploaded = 0;
      for (const file of files) {
        const { error } = await supabase.storage
          .from(bucket)
          .upload(file.path, readFileSync(file.full), { upsert: true });
        if (error) {
          problems.push(`${bucket}/${file.path}: ${error.message}`);
          continue;
        }
        uploaded += 1;
      }
      console.log(`  ${bucket}: ${uploaded}/${files.length} files`);
    }
  }

  const totalRows = Object.values(restored).reduce((sum, n) => sum + n, 0);
  console.log(`\nRestored ${totalRows} rows. Manifest recorded ${manifest.totals?.rows ?? "?"}.`);

  if (problems.length > 0) {
    console.error(`\n[FAIL] ${problems.length} problem(s):`);
    for (const problem of problems.slice(0, 20)) console.error(`  - ${problem}`);
    if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`);
    process.exit(1);
  }

  console.log("\nRestore complete.");
  console.log(
    "Reminder: sign-in credentials are NOT restored. Existing users must reset",
  );
  console.log("their password, and a super admin has to be re-created by hand");
  console.log('(see "Restore a super admin" in SAFE_DRIVE_DATABASE_MASTER.sql).');
};

run().catch((error) => {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
