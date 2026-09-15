import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "../server/email.js";

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

    // The account holder is told, in the app and by email, whenever someone
    // else changes how they sign in - the standard account-security notice, and
    // the only way a reset they never asked for gets noticed. The password is
    // already changed at this point, so a failed notice is logged, not returned
    // as a failed reset. The temporary password itself is never included.
    let noticeEmail = "failed";
    try {
      const title = "Your password was reset by SafeDrive";
      const message =
        "A SafeDrive administrator set a temporary password for your account. Sign in with the temporary password SafeDrive support gave you, then change it. If you did not ask for this, open a support case right away.";
      await supabase.from("notifications").insert({
        user_id: payload.targetUserId,
        title,
        message,
        type: "warning",
        link: "/support",
      });
      const result = await sendUserNotificationEmail(supabase, {
        userId: payload.targetUserId,
        title,
        message,
        link: "/support",
        baseOrigin: new URL(req.url).origin,
        eventKey: `admin-password-reset:${payload.targetUserId}:${Date.now()}`,
      });
      noticeEmail = result.state;
    } catch (noticeError) {
      console.error("Password reset notice failed", noticeError);
    }

    return jsonResponse({ success: true, noticeEmail });
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
