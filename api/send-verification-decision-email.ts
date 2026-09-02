import { createClient } from "@supabase/supabase-js";
import { sendVerificationDecisionEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type Payload = {
  userId?: string;
  status?: "verified" | "rejected";
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
    if (!userId || !["verified", "rejected"].includes(payload.status || "")) {
      return respond({ error: "User and verification decision are required" }, 400);
    }
    const status = payload.status === "verified" ? "verified" : "rejected";

    const [{ data: actorProfile }, { data: targetProfile, error: targetError }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", actor.id).maybeSingle(),
      supabase
        .from("profiles")
        .select("id, email, full_name, verified_status, rejection_reason")
        .eq("id", userId)
        .single(),
    ]);
    if (!actorProfile || !["admin", "super_admin"].includes(actorProfile.role)) {
      return respond({ error: "Administrator access required" }, 403);
    }
    if (targetError || !targetProfile) return respond({ error: "User not found" }, 404);
    if (targetProfile.verified_status !== status) {
      return respond({ error: "Verification status changed; refresh before sending email" }, 409);
    }

    const result = await sendVerificationDecisionEmail({
      to: targetProfile.email,
      name: targetProfile.full_name,
      status,
      rejectionReason: targetProfile.rejection_reason,
      baseOrigin: new URL(req.url).origin,
      userId: targetProfile.id,
    });

    await supabase.from("audit_log").insert({
      user_id: actor.id,
      action: "verification_decision_email_attempted",
      entity_type: "profile",
      entity_id: targetProfile.id,
      details: { decision: status, delivery_state: result.state },
    });

    return respond({ success: result.state === "sent", deliveryState: result.state });
  } catch (error) {
    console.error("Verification decision email failed", error);
    return respond({ error: "Unable to send verification decision email" }, 500);
  }
}
