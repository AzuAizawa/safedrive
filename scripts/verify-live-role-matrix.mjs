import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
}

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error("VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required");
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const createdUserIds = [];
let failures = 0;

const report = (condition, label, detail = "") => {
  if (condition) console.log(`[OK]   ${label}`);
  else {
    failures += 1;
    console.error(`[FAIL] ${label}${detail ? ` (${detail})` : ""}`);
  }
};

const makeIdentity = async (role) => {
  const nonce = crypto.randomBytes(12).toString("hex");
  const email = `safedrive-role-test-${role}-${nonce}@example.com`;
  const password = `Sd!${crypto.randomBytes(24).toString("base64url")}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `SafeDrive ${role} test` },
  });
  if (error || !data.user) throw error || new Error(`Could not create ${role} test identity`);
  createdUserIds.push(data.user.id);

  const { error: profileError } = await service.from("profiles").upsert({
    id: data.user.id,
    email,
    full_name: `SafeDrive ${role} test`,
    role,
    verified_status: role === "user" ? "unverified" : "verified",
    is_lister: false,
    deleted_at: null,
  });
  if (profileError) throw profileError;

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
};

const rpcBoolean = async (client, name) => {
  const { data, error } = await client.rpc(name);
  if (error) throw error;
  return data === true;
};

const visibleCount = async (client, table) => {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
};

console.log("SafeDrive live role-matrix verification (temporary test identities; no credentials are printed)\n");

try {
  const ordinary = await makeIdentity("user");
  const admin = await makeIdentity("admin");
  const superAdmin = await makeIdentity("super_admin");

  report(!(await rpcBoolean(ordinary, "is_admin")), "ordinary user is not treated as staff");
  report(!(await rpcBoolean(ordinary, "is_super_admin")), "ordinary user is not treated as super admin");
  report((await visibleCount(ordinary, "guest_inquiries")) === 0, "ordinary user cannot read guest inquiries");
  report((await visibleCount(ordinary, "financial_accounts")) === 0, "ordinary user cannot read financial accounts");

  report(await rpcBoolean(admin, "is_admin"), "admin is recognized as staff");
  report(!(await rpcBoolean(admin, "is_super_admin")), "admin is not promoted to super admin");
  report((await visibleCount(admin, "guest_inquiries")) > 0, "admin can read the guest-inquiry queue");
  report((await visibleCount(admin, "financial_accounts")) === 0, "admin cannot read super-admin financial accounts");

  report(await rpcBoolean(superAdmin, "is_admin"), "super admin is recognized as staff");
  report(await rpcBoolean(superAdmin, "is_super_admin"), "super admin is recognized as super admin");
  report((await visibleCount(superAdmin, "guest_inquiries")) > 0, "super admin can read the guest-inquiry queue");
  report((await visibleCount(superAdmin, "financial_accounts")) >= 9, "super admin can read the complete chart of accounts");
} finally {
  for (const userId of createdUserIds) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) {
      failures += 1;
      console.error("[FAIL] a generated test identity could not be removed");
    }
  }
  console.log(`\nTemporary test identities removed: ${createdUserIds.length}`);
}

if (failures) {
  console.error(`Role-matrix summary: ${failures} failure(s).`);
  process.exitCode = 1;
} else {
  console.log("Role-matrix summary: all checks passed.");
}
