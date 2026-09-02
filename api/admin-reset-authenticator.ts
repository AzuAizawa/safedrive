import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type ResetAuthenticatorPayload = {
  targetUserId?: string;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

/**
 * Super-admin authenticator reset for a standard user who has lost their
 * device and cannot complete the self-service flow. Mirrors
 * admin-reset-password: super_admin only, standard-user targets only. The user
 * re-enrolls a fresh authenticator on their next sign-in.
 */
export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const payload = (await req.json()) as ResetAuthenticatorPayload;
    if (!payload.targetUserId) {
      return jsonResponse({ error: "Target user ID is required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user: requester },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !requester) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: requesterProfile, error: requesterProfileError } =
      await supabase
        .from("profiles")
        .select("role, email")
        .eq("id", requester.id)
        .single();

    if (requesterProfileError || !requesterProfile) {
      return jsonResponse({ error: "Requester profile not found" }, 403);
    }

    if (requesterProfile.role !== "super_admin") {
      return jsonResponse(
        { error: "Only a super admin can reset another user's authenticator" },
        403,
      );
    }

    const { data: targetProfile, error: targetProfileError } = await supabase
      .from("profiles")
      .select("id, email, role")
      .eq("id", payload.targetUserId)
      .single();

    if (targetProfileError || !targetProfile) {
      return jsonResponse({ error: "Target user profile not found" }, 404);
    }

    if (targetProfile.role !== "user") {
      return jsonResponse(
        { error: "This dashboard flow only resets standard user accounts" },
        403,
      );
    }

    const { data: list, error: listError } =
      await supabase.auth.admin.mfa.listFactors({
        userId: payload.targetUserId,
      });
    if (listError) {
      throw listError;
    }

    let cleared = 0;
    for (const factor of list?.factors ?? []) {
      const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({
        userId: payload.targetUserId,
        id: factor.id,
      });
      if (deleteError) {
        console.error("Failed to delete MFA factor", deleteError.message);
      } else {
        cleared += 1;
      }
    }

    await supabase.from("audit_log").insert({
      user_id: requester.id,
      action: "admin_reset_user_mfa",
      entity_type: "auth_factor",
      entity_id: payload.targetUserId,
      details: {
        cleared,
        target_email: targetProfile.email,
        performed_by: requesterProfile.email,
      },
    });

    return jsonResponse({ success: true, cleared });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Admin reset authenticator error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
