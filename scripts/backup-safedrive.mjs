/**
 * SafeDrive backup - every table row and every stored file, into one dated
 * folder on this machine.
 *
 *   node scripts/backup-safedrive.mjs
 *
 * WHY THIS EXISTS
 * The schema is already safe: SAFE_DRIVE_DATABASE_MASTER.sql is in git, so
 * running that file rebuilds every table, policy and function. What is NOT
 * safe is the DATA and the FILES - both live in exactly one place, the
 * Supabase project, with no copy anywhere else. This closes that gap and gives
 * the "3-2-1" rule something to count: copy 1 is Supabase, copy 2 is the
 * folder this writes, copy 3 is that folder uploaded to a private drive.
 *
 * WHY NOT pg_dump / the Supabase CLI
 * Both are better at schema, and the schema is already handled. Both also mean
 * installing tooling nobody needs to work on this repo. This uses the same
 * service-role client and the same .env parsing every other script in here
 * already uses, so it runs with no new setup.
 *
 * WHAT THIS DOES NOT COVER - say this out loud rather than discover it during
 * a restore: auth.users. Password hashes and MFA factors live in Supabase's
 * own auth schema, which the service role cannot read through the REST API. A
 * restore brings back every booking, payment and photo, but existing users
 * cannot sign in until they reset their password.
 *
 * PRIVACY - the output contains KYC identity documents, selfies, addresses and
 * payout account numbers. backups/ is gitignored. Never commit it, never mail
 * it, and keep the off-site copy in a PRIVATE drive.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// --- .env, same parsing as scripts/verify-live-supabase.mjs ----------------
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

/**
 * The table list is READ from src/types/database.ts rather than typed here.
 * A hand-kept list is a list that goes stale: add a table, forget this file,
 * and the backup quietly stops covering it while still reporting success.
 * Everything between "Tables: {" and "Views:" is the inventory.
 */
const readTableNames = () => {
  const typesPath = resolve(process.cwd(), "src/types/database.ts");
  const source = readFileSync(typesPath, "utf8");
  const start = source.indexOf("    Tables: {");
  const end = source.indexOf("    Views:");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "Could not find the Tables block in src/types/database.ts - the shape of that file changed.",
    );
  }
  const names = [];
  for (const line of source.slice(start, end).split(/\r?\n/)) {
    const match = /^ {6}([a-z_][a-z0-9_]*): \{$/.exec(line);
    if (match) names.push(match[1]);
  }
  if (names.length === 0) throw new Error("No tables found in src/types/database.ts.");
  return names.sort();
};

// Every bucket declared in SAFE_DRIVE_DATABASE_MASTER.sql, plus the two the
// application also reads from. Kept explicit because storage.buckets is not
// listable through the REST client the way public tables are.
const BUCKETS = [
  "user-verification",
  "support-attachments",
  "vehicle-private-documents",
  "car-documents",
  "vehicle-documents",
  "trip-condition-evidence",
];

// PostgREST caps rows per response. A backup that silently stops at the cap
// looks successful and is not, so every table is paged to exhaustion and the
// manifest records the count for checking against the live database.
const PAGE_SIZE = 1000;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .slice(0, 16);
const outputRoot = resolve(process.cwd(), "backups", stamp);

const writeFileEnsuringDirectory = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};

const failures = [];

const backupTable = async (table) => {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      failures.push(`table ${table}: ${error.message}`);
      return null;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  writeFileEnsuringDirectory(
    resolve(outputRoot, "tables", `${table}.json`),
    JSON.stringify(rows, null, 2),
  );
  return rows.length;
};

/**
 * storage.list() returns one directory level at a time and marks folders with
 * a null id, so this walks down rather than assuming a flat bucket.
 */
const listBucketObjects = async (bucket, prefix = "") => {
  const found = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 100, offset });
    if (error) {
      failures.push(`bucket ${bucket} (${prefix || "/"}): ${error.message}`);
      return found;
    }
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        found.push(...(await listBucketObjects(bucket, path)));
      } else {
        found.push(path);
      }
    }
    if (!data || data.length < 100) break;
  }
  return found;
};

const backupBucket = async (bucket) => {
  const paths = await listBucketObjects(bucket);
  let bytes = 0;
  let saved = 0;
  for (const path of paths) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) {
      failures.push(`file ${bucket}/${path}: ${error?.message ?? "no data"}`);
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    writeFileEnsuringDirectory(resolve(outputRoot, "storage", bucket, path), buffer);
    bytes += buffer.length;
    saved += 1;
  }
  return { listed: paths.length, saved, bytes };
};

const run = async () => {
  const tables = readTableNames();
  console.log(`SafeDrive backup -> backups/${stamp}`);
  console.log(`Project: ${new URL(supabaseUrl).hostname}`);
  console.log(`${tables.length} tables, ${BUCKETS.length} buckets\n`);

  const tableCounts = {};
  for (const table of tables) {
    const count = await backupTable(table);
    if (count === null) {
      console.log(`  [FAIL] ${table}`);
      continue;
    }
    tableCounts[table] = count;
    console.log(`  ${table}: ${count} rows`);
  }

  console.log("");
  const bucketCounts = {};
  for (const bucket of BUCKETS) {
    const result = await backupBucket(bucket);
    bucketCounts[bucket] = result;
    console.log(
      `  ${bucket}: ${result.saved}/${result.listed} files, ${(result.bytes / 1024).toFixed(0)} KB`,
    );
  }

  const totalRows = Object.values(tableCounts).reduce((sum, n) => sum + n, 0);
  const totalFiles = Object.values(bucketCounts).reduce((sum, b) => sum + b.saved, 0);

  writeFileEnsuringDirectory(
    resolve(outputRoot, "manifest.json"),
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        project: new URL(supabaseUrl).hostname,
        tables: tableCounts,
        buckets: bucketCounts,
        totals: { rows: totalRows, files: totalFiles },
        failures,
        notCovered:
          "auth.users - passwords and MFA factors are in Supabase's auth schema and are not reachable through the service-role REST API. After a restore, existing users must reset their password before they can sign in.",
      },
      null,
      2,
    ),
  );

  console.log(`\nTotal: ${totalRows} rows, ${totalFiles} files`);
  console.log(`Manifest: backups/${stamp}/manifest.json`);

  if (failures.length > 0) {
    console.error(`\n[FAIL] ${failures.length} problem(s) - this backup is INCOMPLETE:`);
    for (const failure of failures.slice(0, 20)) console.error(`  - ${failure}`);
    if (failures.length > 20) console.error(`  ... and ${failures.length - 20} more`);
    process.exit(1);
  }

  console.log("\nBackup complete.");
  console.log(
    "Copy this folder to a PRIVATE cloud drive - that is the off-site third copy.",
  );
  console.log(
    "It contains identity documents and payout details. Never commit it, never email it.",
  );
};

run().catch((error) => {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
