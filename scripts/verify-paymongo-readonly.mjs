import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const environmentPath = resolve(process.cwd(), ".env");
if (!existsSync(environmentPath)) {
  console.error("[FAIL] .env was not found");
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

const secretKey = environment.get("PAYMONGO_SECRET_KEY") || "";
const publicKey = environment.get("VITE_PAYMONGO_PUBLIC_KEY") || "";
const walletId = environment.get("PAYMONGO_PAYOUT_WALLET_ID") || "";
if (!secretKey || !publicKey || !walletId) {
  console.error("[FAIL] PayMongo keys and PAYMONGO_PAYOUT_WALLET_ID are required");
  process.exit(1);
}

const testMode = secretKey.startsWith("sk_test_") && publicKey.startsWith("pk_test_");
if (!testMode) {
  console.error("[FAIL] Read-only integration verification is restricted to PayMongo test keys");
  process.exit(1);
}

const headers = {
  Accept: "application/json",
  Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
};

const requestJson = async (url) => {
  const response = await fetch(url, { headers });
  const body = await response.json().catch(() => ({}));
  return { response, body };
};

console.log("SafeDrive PayMongo test-mode verification (read-only; identifiers are not printed)\n");

let institutions = await requestJson(
  "https://api.paymongo.com/v2/transfers/receiving_institutions?provider=instapay",
);
if ([404, 405].includes(institutions.response.status)) {
  institutions = await requestJson(
    "https://api.paymongo.com/v1/wallets/receiving_institutions?provider=instapay",
  );
}
if (institutions.response.ok && Array.isArray(institutions.body.data)) {
  console.log(`[OK] Test secret key authenticated; ${institutions.body.data.length} InstaPay institution(s) are available`);
} else {
  console.error(`[FAIL] Receiving-institutions request returned HTTP ${institutions.response.status}`);
  process.exitCode = 1;
}

const encodedWalletId = encodeURIComponent(walletId);
let wallets = await requestJson(
  `https://api.paymongo.com/v2/wallets/${encodedWalletId}?fields=account`,
);
if (wallets.response.status === 404) {
  wallets = await requestJson(
    "https://api.paymongo.com/v2/wallets?status=activated&fields=account",
  );
}

if (!wallets.response.ok) {
  console.error(`[FAIL] Wallet lookup returned HTTP ${wallets.response.status}`);
  process.exitCode = 1;
} else {
  const records = Array.isArray(wallets.body.data)
    ? wallets.body.data
    : wallets.body.data
      ? [wallets.body.data]
      : [];
  const matched = records.some((item) => {
    const attributes = item?.attributes || {};
    const account =
      item?.source_account ||
      item?.account ||
      attributes.source_account ||
      attributes.account ||
      attributes;
    return [item?.id, account?.id, account?.account_number, account?.number]
      .filter(Boolean)
      .some((candidate) => candidate === walletId);
  });
  if (matched) console.log("[OK] Configured payout wallet matches an activated PayMongo test wallet");
  else {
    console.error("[FAIL] Configured payout wallet did not match the wallet data returned by PayMongo");
    process.exitCode = 1;
  }
}

console.log("\n[INFO] No transfer, payment, refund, email, or database write was made.");
