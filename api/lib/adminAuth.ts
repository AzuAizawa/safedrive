import { createSupabaseAdmin } from "./payoutAutomation.js";
import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";

/**
 * Shared staff-authorization helper for /api handlers.
 *
 * Background: every admin handler used to inline its own
 *   `profiles.role !== 'super_admin'`  /  `!['admin','super_admin'].includes(role)`
 * check. Chapter 19 of the database master adds a per-admin permission checklist
 * (`public.admin_permissions` + `public.admin_can_for(uid, key)`), where a
 * super_admin implicitly passes every key. This helper is the single place the
 * server resolves the bearer token and asks the database whether the caller
 * holds a given permission key.
 *
 * Phase 3 of the RBAC rollout swaps the inline checks in the individual
 * handlers over to `requirePermission(req, "<key>")`. Until then nothing imports
 * this file, so adding it changes no behaviour.
 */

const getBearerToken = (req: Request): string | null => {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice("bearer ".length).trim();
};

export type AuthorizedCaller = {
  ok: true;
  userId: string;
  email: string | null;
  role: string;
  supabase: ServiceRoleSupabaseClient;
};

export type AuthorizationFailure = {
  ok: false;
  status: 401 | 403 | 500;
  error: string;
};

export type AuthorizationResult = AuthorizedCaller | AuthorizationFailure;

/**
 * Resolve the caller from the request's bearer token and confirm they hold
 * `permissionKey` (super_admin passes everything). On success the returned
 * object carries a ready service-role client so the handler does not build a
 * second one.
 *
 * Handlers turn a failure into a Response themselves, e.g.:
 *
 *   const auth = await requirePermission(req, "vehicles.review");
 *   if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
 *   // ...use auth.userId / auth.supabase
 */
export async function requirePermission(
  req: Request,
  permissionKey: string,
): Promise<AuthorizationResult> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: "Missing authorization token" };
  }

  let supabase: ServiceRoleSupabaseClient;
  try {
    supabase = createSupabaseAdmin() as ServiceRoleSupabaseClient;
  } catch {
    return { ok: false, status: 500, error: "Server auth is not configured" };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return { ok: false, status: 401, error: "Unauthorized request" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, email, deleted_at, admin_disabled_at")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { ok: false, status: 403, error: "Staff profile not found" };
  }
  if (profile.deleted_at || profile.admin_disabled_at) {
    return { ok: false, status: 403, error: "This staff account is not active" };
  }

  const { data: allowed, error: rpcError } = await supabase.rpc("admin_can_for", {
    p_uid: user.id,
    p_key: permissionKey,
  });

  if (rpcError) {
    return { ok: false, status: 500, error: "Permission check failed" };
  }
  if (allowed !== true) {
    return {
      ok: false,
      status: 403,
      error: `Missing required permission: ${permissionKey}`,
    };
  }

  return {
    ok: true,
    userId: user.id,
    email: profile.email ?? user.email ?? null,
    role: profile.role,
    supabase,
  };
}

/**
 * Convenience: assert the caller is a super_admin. Use for the domains that are
 * never expressed as checklist keys - finance, platform settings, privacy
 * requests, admin governance (see project_docs/RBAC_DESIGN.md section 4).
 */
export async function requireSuperAdmin(
  req: Request,
): Promise<AuthorizationResult> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: "Missing authorization token" };
  }

  let supabase: ServiceRoleSupabaseClient;
  try {
    supabase = createSupabaseAdmin() as ServiceRoleSupabaseClient;
  } catch {
    return { ok: false, status: 500, error: "Server auth is not configured" };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return { ok: false, status: 401, error: "Unauthorized request" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, email, deleted_at")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.role !== "super_admin" || profile.deleted_at) {
    return { ok: false, status: 403, error: "Super admin access required" };
  }

  return {
    ok: true,
    userId: user.id,
    email: profile.email ?? user.email ?? null,
    role: profile.role,
    supabase,
  };
}
