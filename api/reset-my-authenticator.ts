import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
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
 * Self-service authenticator reset. A signed-in user (typically one who just
 * got in with the "Use Email Code Instead" fallback because they lost their
 * authenticator device) clears their own enrolled TOTP factor(s) so the login
 * flow can walk them through scanning a fresh QR code.
 *
 * This does not lower the security bar: email-code sign-in already bypasses the
 * authenticator, so a party who can reach this endpoint could already sign in.
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

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: list, error: listError } =
      await supabase.auth.admin.mfa.listFactors({ userId: user.id });
    if (listError) {
      throw listError;
    }

    let cleared = 0;
    for (const factor of list?.factors ?? []) {
      const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({
        userId: user.id,
        id: factor.id,
      });
      if (deleteError) {
        console.error("Failed to delete MFA factor", deleteError.message);
      } else {
        cleared += 1;
      }
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "user_mfa_reset",
      entity_type: "auth_factor",
      entity_id: user.id,
      details: { cleared, initiated_by: "self" },
    });

    return jsonResponse({ success: true, cleared });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Reset own authenticator error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
