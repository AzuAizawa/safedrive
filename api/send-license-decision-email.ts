import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type Payload = {
  userId?: string;
  decision?: "approved" | "rejected";
  reason?: string | null;
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const bearer = (req: Request) => {
  const header = req.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    const token = bearer(req);
    if (!url || !key) return respond({ error: "Missing Supabase server configuration" }, 503);
    if (!token) return respond({ error: "Missing authorization token" }, 401);

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user: actor }, error: actorError } = await supabase.auth.getUser(token);
    if (actorError || !actor) return respond({ error: "Unauthorized request" }, 401);

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const userId = payload.userId?.trim();
    if (!userId || !["approved", "rejected"].includes(payload.decision || "")) {
      return respond({ error: "User and licence decision are required" }, 400);
    }
    const decision = payload.decision === "approved" ? "approved" : "rejected";
    const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 500) : null;

    const { data: actorProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", actor.id)
      .maybeSingle();
    if (!actorProfile || !["admin", "super_admin"].includes(actorProfile.role)) {
      return respond({ error: "Administrator access required" }, 403);
    }
    const { data: canVerify } = await supabase.rpc("admin_can_for", {
      p_uid: actor.id,
      p_key: "users.verify",
    });
    if (canVerify !== true) {
      return respond({ error: "Missing permission: users.verify" }, 403);
    }

    const { data: targetProfile, error: targetError } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", userId)
      .single();
    if (targetError || !targetProfile) return respond({ error: "User not found" }, 404);

    const title =
      decision === "approved"
        ? "Driver's licence reviewed"
        : "Driver's licence resubmission rejected";
    const message =
      decision === "approved"
        ? "An admin has reviewed your updated driver's licence. Your booking access reflects the new details."
        : `Your resubmitted driver's licence was not accepted.${reason ? ` Reason: ${reason}.` : ""} Please resubmit a clear, valid licence photo.`;

    const result = await sendUserNotificationEmail(supabase, {
      userId: targetProfile.id,
      title,
      message,
      link: "/verify",
      baseOrigin: new URL(req.url).origin,
      eventKey: `license-decision:${userId}:${decision}:${Date.now()}`,
    });

    await supabase.from("audit_log").insert({
      user_id: actor.id,
      action: "license_decision_email_attempted",
      entity_type: "profile",
      entity_id: targetProfile.id,
      details: { decision, reason, delivery_state: result.state },
    });

    return respond({ success: result.state === "sent", deliveryState: result.state });
  } catch (error) {
    console.error("Licence decision email failed", error);
    return respond({ error: "Unable to send licence decision email" }, 500);
  }
}
