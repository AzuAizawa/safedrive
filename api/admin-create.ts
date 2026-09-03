import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type CreateAdminPayload = {
  email?: string;
  fullName?: string;
  permissionKeys?: string[];
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin environment variables");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice("bearer ".length).trim();
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Create a new `role='admin'` account (super-admin only).
 *
 * The super admin supplies email + name + the permission checklist. We invite
 * the person by email (they set their own password, then enrol MFA on first
 * admin login) - the creator never types or sees a password. See
 * project_docs/RBAC_DESIGN.md section 6.
 */
export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: requester, error: requesterError } = await supabase
      .from("profiles")
      .select("role, deleted_at")
      .eq("id", user.id)
      .single();
    if (
      requesterError ||
      !requester ||
      requester.role !== "super_admin" ||
      requester.deleted_at
    ) {
      return jsonResponse({ error: "Super admin access required" }, 403);
    }

    const payload = (await req.json().catch(() => ({}))) as CreateAdminPayload;
    const email = String(payload.email ?? "").trim().toLowerCase();
    const fullName = String(payload.fullName ?? "").trim();
    const requestedKeys = Array.isArray(payload.permissionKeys)
      ? payload.permissionKeys.map(String)
      : [];

    if (!EMAIL_RE.test(email)) {
      return jsonResponse({ error: "A valid email address is required" }, 400);
    }
    if (fullName.length < 2) {
      return jsonResponse({ error: "A full name is required" }, 400);
    }

    // Only keys that actually exist in the catalog are honoured.
    const { data: catalog, error: catalogError } = await supabase
      .from("admin_permission_catalog")
      .select("key");
    if (catalogError) {
      return jsonResponse({ error: "Permission catalog is unavailable" }, 500);
    }
    const validKeys = new Set((catalog ?? []).map((row) => row.key));
    const grantKeys = [...new Set(requestedKeys)].filter((key) =>
      validKeys.has(key),
    );

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existingProfile) {
      return jsonResponse(
        { error: "An account with this email already exists" },
        409,
      );
    }

    const origin = new URL(req.url).origin;
    const { data: invited, error: inviteError } =
      await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/auth/confirm?next=recovery`,
        data: { full_name: fullName, invited_as: "admin" },
      });
    if (inviteError || !invited?.user) {
      return jsonResponse(
        { error: inviteError?.message ?? "The invitation could not be sent" },
        500,
      );
    }

    const newUserId = invited.user.id;

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: newUserId,
        email,
        full_name: fullName,
        role: "admin",
        verified_status: "verified",
        admin_created_by: user.id,
      },
      { onConflict: "id" },
    );
    if (profileError) {
      return jsonResponse(
        { error: `Profile could not be created: ${profileError.message}` },
        500,
      );
    }

    if (grantKeys.length > 0) {
      const { error: grantError } = await supabase
        .from("admin_permissions")
        .insert(
          grantKeys.map((key) => ({
            admin_id: newUserId,
            permission_key: key,
            granted_by: user.id,
          })),
        );
      if (grantError) {
        return jsonResponse(
          { error: `Permissions could not be assigned: ${grantError.message}` },
          500,
        );
      }
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "admin_account_created",
      entity_type: "profile",
      entity_id: newUserId,
      details: { email, full_name: fullName, permissions: grantKeys },
    });

    return jsonResponse({ success: true, userId: newUserId, permissions: grantKeys });
  } catch (error) {
    console.error("admin-create failed", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Admin creation failed" },
      500,
    );
  }
}
