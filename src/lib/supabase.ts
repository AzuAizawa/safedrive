import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// A production build that boots without real Supabase config would silently run
// against a fake backend. Fail loudly instead. The placeholder fallback is kept
// only for local tooling (build-time analysis, smoke checks) where DEV is set.
if (import.meta.env.PROD && (!rawUrl || !rawAnonKey)) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set for a production build.",
  );
}

const supabaseUrl = rawUrl || "https://placeholder.supabase.co";
const supabaseAnonKey = rawAnonKey || "placeholder";

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
