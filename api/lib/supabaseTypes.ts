import type { SupabaseClient } from "@supabase/supabase-js";

// Server functions use the service-role client against tables that are newer
// than the generated frontend schema. Keep the client permissive here while
// request/response records remain explicitly validated in each API module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally permissive; see comment above
export type ServiceRoleSupabaseClient = SupabaseClient<any, "public", "public", any, any>;
