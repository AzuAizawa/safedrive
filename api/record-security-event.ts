import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "edge" };

type SecurityPayload = {
  action?: string;
  details?: Record<string, unknown>;
};

const actionMap: Record<string, string> = {
  user_login_success: "login_success",
  admin_login_success: "login_success",
  user_login_failed: "login_failed",
  admin_login_failed: "login_failed",
  user_logout: "logout",
  admin_logout: "logout",
  user_mfa_enrolled: "authenticator_verified",
  admin_mfa_enrolled: "authenticator_verified",
  lockout_started: "lockout_started",
  password_reset_requested: "password_reset_requested",
  password_reset_completed: "password_reset_completed",
  session_timeout: "session_timeout",
};

const anonymousActions = new Set([
  "user_login_failed",
  "admin_login_failed",
  "lockout_started",
  "password_reset_requested",
]);

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
};

// Read one claim from a JWT payload without verifying the signature - the token
// is already verified by supabase.auth.getUser() below; this only pulls the
// Supabase `session_id` so a login row can be tied to its later logout row.
const readJwtClaim = (token: string | null, claim: string): string | null => {
  if (!token) return null;
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as Record<string, unknown>;
    const value = parsed[claim];
    return typeof value === "string" && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
};

const cleanEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) && trimmed.length <= 320
    ? trimmed
    : null;
};

const sanitizeDetails = (details: Record<string, unknown>) => {
  const blockedKey = /password|passcode|otp|token|secret|authorization|cookie/i;
  const safeEntries = Object.entries(details)
    .filter(([key]) => !blockedKey.test(key))
    .slice(0, 20)
    .map(([key, value]) => [
      key,
      typeof value === "string" ? value.slice(0, 500) : value,
    ]);
  const safe = Object.fromEntries(safeEntries);
  return JSON.stringify(safe).length <= 4000 ? safe : { truncated: true };
};

export default async function handler(req: Request) {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Security logging is not configured");

    const payload = (await req.json()) as SecurityPayload;
    const action = typeof payload.action === "string" ? payload.action : "";
    const eventType = actionMap[action];
    if (!eventType) return jsonResponse({ error: "Unsupported security event" }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = getBearerToken(req);
    const authenticatedUser = token
      ? (await supabase.auth.getUser(token)).data.user
      : null;

    if (!authenticatedUser && !anonymousActions.has(action)) {
      return jsonResponse({ error: "Authentication required for this security event" }, 401);
    }

    // Snapshot the actor's role / lister flag at event time - roles change, and a
    // forensic log must record what they were when the event happened.
    let actorRole: string | null = null;
    let actorIsLister: boolean | null = null;
    if (authenticatedUser) {
      const { data: actorProfile } = await supabase
        .from("profiles")
        .select("role, is_lister")
        .eq("id", authenticatedUser.id)
        .maybeSingle();
      actorRole =
        actorProfile?.role &&
        ["user", "admin", "super_admin"].includes(actorProfile.role)
          ? actorProfile.role
          : null;
      actorIsLister =
        typeof actorProfile?.is_lister === "boolean" ? actorProfile.is_lister : null;
    }
    const sessionId = readJwtClaim(token, "session_id");

    const details = sanitizeDetails(payload.details ?? {});
    const failureReason =
      typeof details.reason === "string" ? details.reason.slice(0, 500) : null;
    const targetEmail = cleanEmail(details.email);
    const authMethod = ["password", "email_otp", "authenticator", "recovery_code", "support_recovery"]
      .includes(String(details.method))
      ? String(details.method)
      : details.method === "magic_link"
        ? "email_otp"
        : null;
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;

    if (!authenticatedUser && ipAddress) {
      const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("security_logs")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ipAddress)
        .gte("created_at", since);
      if ((count ?? 0) >= 30) return jsonResponse({ success: true }, 202);
    }

    const { error } = await supabase.from("security_logs").insert({
      user_id: authenticatedUser?.id ?? null,
      event_type: eventType,
      auth_method: authMethod,
      status: eventType === "login_failed" ? "failed" : "success",
      ip_address: ipAddress,
      user_agent: req.headers.get("user-agent")?.slice(0, 1000) ?? null,
      actor_role: actorRole,
      actor_is_lister: actorIsLister,
      session_id: sessionId,
      failure_reason: failureReason,
      target_email: targetEmail,
      details: {
        ...details,
        action,
        recorded_at: new Date().toISOString(),
      },
    });
    if (error) throw error;

    return jsonResponse({ success: true }, 201);
  } catch (error) {
    console.error("Security event recording failed", error);
    return jsonResponse({ error: "Security event was not recorded" }, 500);
  }
}
