import { existsSync, readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
const requestTimeoutMilliseconds = 12_000;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("[FAIL] VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

let supabaseHost;
try {
  supabaseHost = new URL(supabaseUrl).hostname;
} catch {
  console.error("[FAIL] VITE_SUPABASE_URL is not a valid URL.");
  process.exit(1);
}

try {
  await lookup(supabaseHost);
} catch (error) {
  console.error(
    `[FAIL] The configured Supabase project hostname is unavailable (${error.code || "DNS error"}).`,
  );
  console.error("       Resume/restore the project or replace VITE_SUPABASE_URL with its current Project URL.");
  process.exit(1);
}

const fetchWithTimeout = async (input, init = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMilliseconds);
  const abortFromCaller = () => controller.abort();

  if (init.signal) init.signal.addEventListener("abort", abortFromCaller, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (init.signal) init.signal.removeEventListener("abort", abortFromCaller);
  }
};

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: fetchWithTimeout },
});

const requiredTables = [
  "guest_inquiries",
  "booking_extensions",
  "audit_log",
  "security_logs",
  "car_agreement_versions",
  "booking_agreement_acceptances",
  "vehicle_unavailability",
  "trip_condition_reports",
  "trip_condition_photos",
  "security_deposits",
  "security_deposit_claims",
  "data_retention_requests",
  "financial_accounts",
  "ledger_journals",
  "ledger_entries",
  "reconciliation_runs",
  "reconciliation_items",
];

const expectedAccounts = new Set([
  "1010",
  "1020",
  "2010",
  "2020",
  "2030",
  "2040",
  "4010",
  "4020",
  "5010",
]);

const expectedBuckets = new Map([
  ["user-verification", false],
  ["support-attachments", false],
  ["vehicle-private-documents", false],
  ["car-documents", false],
  ["trip-condition-evidence", false],
]);

let failures = 0;
let warnings = 0;
const existingTables = new Set();

const pass = (message) => console.log(`[OK]   ${message}`);
const warn = (message) => {
  warnings += 1;
  console.warn(`[WARN] ${message}`);
};
const fail = (message) => {
  failures += 1;
  console.error(`[FAIL] ${message}`);
};

console.log("SafeDrive live Supabase verification (read-only; secret values and row data are not printed)\n");

for (const table of requiredTables) {
  process.stdout.write(`[....] checking ${table}\r`);
  // A normal one-row read is intentional here. Some PostgREST/client combinations
  // can hide relation errors on HEAD requests, producing a false "table exists"
  // result. Row data is never printed by this verifier.
  const { error } = await supabase.from(table).select("*").limit(1);
  process.stdout.write(" ".repeat(80) + "\r");
  if (error) {
    fail(`${table} is unavailable (${error.code || "query error"})`);
  } else {
    existingTables.add(table);
    pass(`${table} exists and is readable with the server verifier`);
  }
}

console.log("\nPlatform settings:");
const { data: settings, error: settingsError } = await supabase
  .from("platform_settings")
  .select("ledger_activated_at,payment_processing_fee_rate,payment_processing_fixed_centavos")
  .eq("id", "default")
  .maybeSingle();

if (settingsError) {
  fail(`required financial platform settings are unavailable (${settingsError.code || "query error"})`);
} else if (!settings) {
  fail("the default platform_settings row is missing");
} else {
  pass("ledger activation and both processing-fee controls exist");
  if (!settings.ledger_activated_at) fail("ledger_activated_at has not been activated");
  else pass("ledger_activated_at is configured");
}

console.log("\nFinancial accounts:");
if (existingTables.has("financial_accounts")) {
  const { data: accounts, error } = await supabase
    .from("financial_accounts")
    .select("code,name,account_type,active");
  if (error) {
    fail(`financial account seed could not be verified (${error.code || "query error"})`);
  } else {
    const foundCodes = new Set((accounts || []).map((account) => account.code));
    const missingCodes = [...expectedAccounts].filter((code) => !foundCodes.has(code));
    if (missingCodes.length) fail(`${missingCodes.length} required financial account(s) are missing`);
    else pass("all nine required financial accounts are seeded");
  }
}

console.log("\nPrivate storage buckets:");
const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
if (bucketError) {
  fail(`storage buckets could not be listed (${bucketError.name || "storage error"})`);
} else {
  const byId = new Map((buckets || []).map((bucket) => [bucket.id, bucket]));
  for (const [bucketId, expectedPublic] of expectedBuckets) {
    const bucket = byId.get(bucketId);
    if (!bucket) fail(`${bucketId} bucket is missing`);
    else if (Boolean(bucket.public) !== expectedPublic) fail(`${bucketId} has an unexpected public setting`);
    else pass(`${bucketId} exists and is private`);
  }
}

console.log("\nOptional arrival evidence columns:");
const arrivalColumns = [
  "renter_arrival_latitude",
  "renter_arrival_longitude",
  "renter_arrival_accuracy_meters",
  "renter_arrival_location_captured_at",
  "lister_arrival_latitude",
  "lister_arrival_longitude",
  "lister_arrival_accuracy_meters",
  "lister_arrival_location_captured_at",
];
const { error: arrivalError } = await supabase
  .from("bookings")
  .select(arrivalColumns.join(","))
  .limit(1);
if (arrivalError) fail(`one or more arrival evidence columns are unavailable (${arrivalError.code || "query error"})`);
else pass("all eight optional arrival evidence columns exist");

console.log("\nIntegrity checks:");

const activeBookingStatuses = [
  "pending",
  "confirmed",
  "awaiting_payment",
  "downpayment_paid",
  "fully_paid",
  "active",
];
const { data: activeBookings, error: bookingError } = await supabase
  .from("bookings")
  .select("id,car_id,start_date,end_date,status")
  .in("status", activeBookingStatuses)
  .limit(10000);
if (bookingError) {
  fail(`booking-overlap data could not be checked (${bookingError.code || "query error"})`);
} else {
  let overlaps = 0;
  const bookings = activeBookings || [];
  for (let left = 0; left < bookings.length; left += 1) {
    for (let right = left + 1; right < bookings.length; right += 1) {
      const a = bookings[left];
      const b = bookings[right];
      if (a.car_id !== b.car_id) continue;
      if (a.start_date <= b.end_date && b.start_date <= a.end_date) overlaps += 1;
    }
  }
  if (overlaps) fail(`${overlaps} active booking overlap(s) require investigation`);
  else pass("no active booking overlaps were found");
  if (bookings.length === 10000) warn("booking overlap check reached the 10,000-row safety limit");
}

const { data: paymentRows, error: paymentError } = await supabase
  .from("payments")
  .select("booking_id,payment_type,status,transaction_id")
  .limit(10000);
if (paymentError) {
  fail(`payment uniqueness data could not be checked (${paymentError.code || "query error"})`);
} else {
  const payoutCounts = new Map();
  const checkoutCounts = new Map();
  for (const payment of paymentRows || []) {
    if (payment.payment_type === "payout" && ["pending", "completed"].includes(payment.status)) {
      payoutCounts.set(payment.booking_id, (payoutCounts.get(payment.booking_id) || 0) + 1);
    }
    if (
      payment.status === "completed" &&
      ["downpayment", "balance", "extension"].includes(payment.payment_type) &&
      payment.transaction_id
    ) {
      const key = `${payment.booking_id}:${payment.payment_type}:${payment.transaction_id}`;
      checkoutCounts.set(key, (checkoutCounts.get(key) || 0) + 1);
    }
  }
  const duplicatePayouts = [...payoutCounts.values()].filter((count) => count > 1).length;
  const duplicateCheckoutEvents = [...checkoutCounts.values()].filter((count) => count > 1).length;
  if (duplicatePayouts) fail(`${duplicatePayouts} booking(s) have duplicate active payouts`);
  else pass("no duplicate active payouts were found");
  if (duplicateCheckoutEvents) fail(`${duplicateCheckoutEvents} duplicate completed checkout event(s) were found`);
  else pass("no duplicate completed checkout events were found");
  if ((paymentRows || []).length === 10000) warn("payment uniqueness check reached the 10,000-row safety limit");
}

const { data: activeSubscriptions, error: subscriptionError } = await supabase
  .from("subscriptions")
  .select("user_id")
  .eq("status", "active")
  .limit(10000);
if (subscriptionError) {
  fail(`active subscription uniqueness could not be checked (${subscriptionError.code || "query error"})`);
} else {
  const counts = new Map();
  for (const subscription of activeSubscriptions || []) {
    counts.set(subscription.user_id, (counts.get(subscription.user_id) || 0) + 1);
  }
  const duplicates = [...counts.values()].filter((count) => count > 1).length;
  if (duplicates) fail(`${duplicates} user(s) have duplicate active subscriptions`);
  else pass("no duplicate active subscriptions were found");
}

if (existingTables.has("security_deposit_claims")) {
  const { data: openClaims, error } = await supabase
    .from("security_deposit_claims")
    .select("security_deposit_id")
    .in("status", ["submitted", "renter_responded"])
    .limit(10000);
  if (error) {
    fail(`open deposit-claim uniqueness could not be checked (${error.code || "query error"})`);
  } else {
    const counts = new Map();
    for (const claim of openClaims || []) {
      counts.set(claim.security_deposit_id, (counts.get(claim.security_deposit_id) || 0) + 1);
    }
    const duplicates = [...counts.values()].filter((count) => count > 1).length;
    if (duplicates) fail(`${duplicates} security deposit(s) have duplicate open claims`);
    else pass("no duplicate open security-deposit claims were found");
  }
}

if (existingTables.has("ledger_journals") && existingTables.has("ledger_entries")) {
  const [{ data: journals, error: journalError }, { data: entries, error: entryError }] = await Promise.all([
    supabase.from("ledger_journals").select("id").limit(10000),
    supabase.from("ledger_entries").select("journal_id,debit_centavos,credit_centavos").limit(10000),
  ]);
  if (journalError || entryError) {
    fail(`ledger balance data could not be checked (${journalError?.code || entryError?.code || "query error"})`);
  } else {
    const totals = new Map((journals || []).map((journal) => [journal.id, { debit: 0, credit: 0 }]));
    for (const entry of entries || []) {
      const total = totals.get(entry.journal_id) || { debit: 0, credit: 0 };
      total.debit += Number(entry.debit_centavos || 0);
      total.credit += Number(entry.credit_centavos || 0);
      totals.set(entry.journal_id, total);
    }
    const unbalanced = [...totals.values()].filter(
      (total) => total.debit === 0 || total.debit !== total.credit,
    ).length;
    if (unbalanced) fail(`${unbalanced} ledger journal(s) are empty or unbalanced`);
    else pass("all queried ledger journals balance in centavos");
    if ((journals || []).length === 10000 || (entries || []).length === 10000) {
      warn("ledger balance check reached the 10,000-row safety limit");
    }
  }
}

console.log("\nChecks not provable through the service-role REST interface:");
warn("index, constraint, trigger, function signature, and RLS policy definitions still require Chapter 16 in SQL Editor");
warn("role-matrix behavior still requires authenticated renter, lister, admin, super-admin, and unrelated-user tests");

console.log(`\nSummary: ${failures} failure(s), ${warnings} warning(s).`);
process.exit(failures ? 1 : 0);
