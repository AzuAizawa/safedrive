import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const environmentPath = resolve(process.cwd(), ".env");

if (!existsSync(environmentPath)) {
  console.error("[FAIL] .env was not found. Copy .env.example to .env and add private values.");
  process.exit(1);
}

const values = new Map();
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
  values.set(name, value);
}

const isConfigured = (name) => {
  const value = values.get(name) || "";
  return Boolean(
    value &&
      !value.includes("YOUR_") &&
      // `<...>`-style unfilled placeholders only. A real value like the Resend
      // sender `SafeDrive <receipts@send.safedrive.cfd>` legitimately contains
      // angle brackets, so do not treat a bare `<` as a placeholder.
      !/<[A-Z][A-Z0-9_]*>/.test(value) &&
      !value.includes("...") &&
      !value.startsWith("GENERATE_"),
  );
};

const startupRequired = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const featureConfiguration = [
  ["VITE_PAYMONGO_PUBLIC_KEY", "PayMongo checkout in the browser"],
  ["PAYMONGO_SECRET_KEY", "PayMongo checkout/refund server APIs"],
  ["PAYMONGO_WEBHOOK_SECRET", "PayMongo webhook verification"],
  ["PAYMONGO_PAYOUT_WALLET_ID", "automatic PayMongo payouts"],
  ["RESEND_API_KEY", "SafeDrive payment receipts and lifecycle emails"],
  ["RESEND_FROM_EMAIL", "verified Resend sender address"],
  ["CRON_SECRET", "protected reminder/deadline jobs"],
  ["GUEST_INQUIRY_HASH_SALT", "privacy-preserving guest inquiry hashes"],
  ["GMAIL_WEBHOOK_SHARED_SECRET", "authenticated Gmail Apps Script delivery"],
  ["GMAIL_GUEST_INQUIRY_WEBHOOK_URL", "legacy fallback for guest inquiry replies"],
  ["GMAIL_RETURN_REMINDER_WEBHOOK_URL", "return reminder emails"],
];

let failed = false;
console.log("SafeDrive local environment check (values are never printed)\n");

for (const name of startupRequired) {
  if (isConfigured(name)) {
    console.log(`[OK]   ${name}`);
  } else {
    console.error(`[FAIL] ${name} is required to start SafeDrive locally`);
    failed = true;
  }
}

console.log("");
for (const [name, purpose] of featureConfiguration) {
  if (isConfigured(name)) {
    console.log(`[OK]   ${name}`);
  } else {
    console.warn(`[WARN] ${name} is missing; ${purpose} will not be fully available`);
  }
}

const urlChecks = [
  "GMAIL_GUEST_INQUIRY_WEBHOOK_URL",
  "GMAIL_RETURN_REMINDER_WEBHOOK_URL",
];
for (const name of urlChecks) {
  if (!isConfigured(name)) continue;
  const value = values.get(name);
  if (!value.startsWith("https://script.google.com/") || !value.endsWith("/exec")) {
    console.warn(`[WARN] ${name} should be the HTTPS Apps Script web-app URL ending in /exec`);
  }
}

for (const name of ["CRON_SECRET", "GUEST_INQUIRY_HASH_SALT", "GMAIL_WEBHOOK_SHARED_SECRET"]) {
  if (isConfigured(name) && values.get(name).length < 32) {
    console.warn(`[WARN] ${name} should contain at least 32 random characters`);
  }
}

const publicKey = values.get("VITE_PAYMONGO_PUBLIC_KEY") || "";
const secretKey = values.get("PAYMONGO_SECRET_KEY") || "";
if (isConfigured("VITE_PAYMONGO_PUBLIC_KEY") && isConfigured("PAYMONGO_SECRET_KEY")) {
  const publicMode = publicKey.includes("_test_") ? "test" : publicKey.includes("_live_") ? "live" : "unknown";
  const secretMode = secretKey.includes("_test_") ? "test" : secretKey.includes("_live_") ? "live" : "unknown";
  if (publicMode !== "unknown" && secretMode !== "unknown" && publicMode !== secretMode) {
    console.error("[FAIL] PayMongo public and secret keys are from different modes");
    failed = true;
  }
}

if ((values.get("PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION") || "").toLowerCase() === "true") {
  if (isConfigured("PAYMONGO_SECRET_KEY") && !secretKey.startsWith("sk_test_")) {
    console.error("[FAIL] Demo payout mode requires a PayMongo test key (a live key auto-disables it)");
    failed = true;
  } else {
    console.warn(
      "[WARN] Demo payout mode enabled: the Auto Payout button records the lister earnings (net of commission) + ledger + receipt without a real PayMongo transfer. Unset this for a real launch.",
    );
  }
}

console.log("\nLocal URL: http://127.0.0.1:5173");
console.log("Use `npm run dev:clean` after dependency or Vite configuration changes.");

process.exit(failed ? 1 : 0);
