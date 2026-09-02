import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const environmentPath = resolve(process.cwd(), ".env");
if (!existsSync(environmentPath)) throw new Error(".env was not found");

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
  ) value = value.slice(1, -1);
  environment.set(name, value);
}

const supabaseUrl = environment.get("VITE_SUPABASE_URL") || "";
const serviceRoleKey = environment.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server configuration is missing");

const apply = process.argv.includes("--apply");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const users = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  users.push(...data.users);
  if (data.users.length < 1000) break;
}

const { data: profiles, error: profileError } = await supabase.from("profiles").select("id");
if (profileError) throw profileError;
const profileIds = new Set((profiles || []).map((profile) => profile.id));
const orphans = users.filter((user) => !profileIds.has(user.id));

console.log(`Orphan authenticated users found: ${orphans.length}`);
if (!apply) {
  console.log("Dry run only. Add --apply to create conservative unverified user profiles.");
  process.exit(orphans.length > 0 ? 2 : 0);
}

let repaired = 0;
let skipped = 0;
for (const user of orphans) {
  if (!user.email) {
    skipped += 1;
    continue;
  }
  const metadata = user.user_metadata || {};
  const fullName =
    (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata.name === "string" && metadata.name.trim()) ||
    null;
  const { error } = await supabase.from("profiles").insert({
    id: user.id,
    email: user.email.toLowerCase(),
    full_name: fullName,
    role: "user",
    verified_status: "unverified",
    is_lister: false,
  });
  if (error) throw error;
  repaired += 1;
}

console.log(`Profiles repaired: ${repaired}`);
console.log(`Users skipped because no email was available: ${skipped}`);
