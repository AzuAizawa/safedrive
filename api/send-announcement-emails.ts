import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "../server/email.js";

export const config = { runtime: "edge" };

type Payload = { announcementId?: string };

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const bearer = (req: Request) => {
  const header = req.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
};

/**
 * Emails an announcement that a super admin chose to also send by email
 * (CHAPTER 101). The bell notifications are already written by
 * send_platform_announcement before this is ever called, so a missing or
 * failing mail provider cannot stop an announcement from being delivered.
 *
 * Safe to retry. Each recipient's email carries an idempotency key built from
 * the announcement and the recipient, so a request that times out halfway can
 * simply be sent again: the ones that already went out are not sent twice.
 * `emailed_at` is stamped only once the run finishes, which is what makes that
 * retry possible - a half-finished run leaves it null and stays retryable,
 * while a finished one is refused rather than quietly mailed again.
 */
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
    const announcementId = payload.announcementId?.trim();
    if (!announcementId) return respond({ error: "Announcement is required" }, 400);

    // Announcements are a super-admin power in the database function too; this
    // is the same gate, not a second opinion.
    const { data: actorProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", actor.id)
      .maybeSingle();
    if (actorProfile?.role !== "super_admin") {
      return respond({ error: "Super administrator access required" }, 403);
    }

    const { data: announcement, error: announcementError } = await supabase
      .from("platform_announcements")
      .select("id, title, message, audience, emailed_at")
      .eq("id", announcementId)
      .maybeSingle();
    if (announcementError || !announcement) {
      return respond({ error: "Announcement not found" }, 404);
    }
    if (announcement.emailed_at) {
      return respond({ error: "This announcement was already emailed" }, 409);
    }

    // The same audience rule the database function uses: a lister is someone
    // who owns a car, never profiles.is_lister (a per-session UI flag).
    const [{ data: members, error: membersError }, { data: carOwners, error: carsError }] =
      await Promise.all([
        supabase.from("profiles").select("id").is("deleted_at", null).eq("role", "user"),
        supabase.from("cars").select("owner_id"),
      ]);
    if (membersError || carsError || !members) {
      return respond({ error: "Could not resolve the announcement audience" }, 500);
    }
    const owners = new Set((carOwners ?? []).map((row) => row.owner_id as string));
    const recipients = (members as { id: string }[])
      .map((row) => row.id)
      .filter((id) =>
        announcement.audience === "all"
          ? true
          : announcement.audience === "listers"
            ? owners.has(id)
            : !owners.has(id),
      );

    const baseOrigin = new URL(req.url).origin;
    let sent = 0;
    let notConfigured = false;
    for (const userId of recipients) {
      const result = await sendUserNotificationEmail(supabase, {
        userId,
        title: announcement.title,
        message: announcement.message,
        link: "/notifications",
        baseOrigin,
        eventKey: `announcement:${announcement.id}`,
      });
      if (result.state === "sent") sent += 1;
      else if (result.state === "not_configured") notConfigured = true;
    }

    await supabase
      .from("platform_announcements")
      .update({ emailed_at: new Date().toISOString(), email_sent_count: sent })
      .eq("id", announcement.id);

    await supabase.from("audit_log").insert({
      user_id: actor.id,
      action: "platform_announcement_emailed",
      entity_type: "platform_announcements",
      entity_id: announcement.id,
      details: {
        audience: announcement.audience,
        recipients: recipients.length,
        emails_sent: sent,
        title: announcement.title,
      },
    });

    return respond({
      success: !notConfigured && sent === recipients.length,
      deliveryState: notConfigured ? "not_configured" : sent === recipients.length ? "sent" : "partial",
      sent,
      recipients: recipients.length,
    });
  } catch (error) {
    console.error("Announcement email send failed", error);
    return respond({ error: "Unable to send announcement emails" }, 500);
  }
}
