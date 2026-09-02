import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type ResetPasswordPayload = {
  targetUserId?: string;
  newPassword?: string;
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

const isStrongPassword = (value: string) =>
  value.length >= 8 &&
  /[A-Z]/.test(value) &&
  /[0-9]/.test(value) &&
  /[!@#$%^&*(),.?":{}|<>]/.test(value);

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const payload = (await req.json()) as ResetPasswordPayload;
    if (!payload.targetUserId || !payload.newPassword) {
      return jsonResponse(
        { error: "Target user ID and new password are required" },
        400,
      );
    }

    if (!isStrongPassword(payload.newPassword)) {
      return jsonResponse(
        { error: "Temporary password does not meet the password rules" },
        400,
      );
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user: requester },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !requester) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: requesterProfile, error: requesterProfileError } = await supabase
      .from("profiles")
      .select("role, email")
      .eq("id", requester.id)
      .single();

    if (requesterProfileError || !requesterProfile) {
      return jsonResponse({ error: "Requester profile not found" }, 403);
    }

    if (requesterProfile.role !== "super_admin") {
      return jsonResponse(
        { error: "Only a super admin can reset another user's password" },
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

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      payload.targetUserId,
      {
        password: payload.newPassword,
      },
    );

    if (updateError) {
      return jsonResponse(
        { error: updateError.message || "Failed to reset password" },
        500,
      );
    }

    await supabase.from("audit_log").insert({
      user_id: requester.id,
      action: "super_admin_reset_user_password",
      entity_type: "profile",
      entity_id: payload.targetUserId,
      details: {
        target_email: targetProfile.email,
        actor_email: requesterProfile.email,
      },
    });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected password reset error",
      },
      500,
    );
  }
}
