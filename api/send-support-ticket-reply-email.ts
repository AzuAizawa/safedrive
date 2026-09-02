import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "./lib/email.js";

export const config = { runtime: "edge" };

type Payload = { ticketId?: string; messageId?: string };

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
 * Delivers an email only for a message the requesting administrator actually
 * posted to the specified support ticket. The browser still records the
 * ticket reply and in-app notification first; an absent/broken email service
 * therefore cannot prevent customer support from working.
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
    const ticketId = payload.ticketId?.trim();
    const messageId = payload.messageId?.trim();
    if (!ticketId || !messageId) return respond({ error: "Ticket and message are required" }, 400);

    const [{ data: actorProfile }, { data: message, error: messageError }, { data: ticket, error: ticketError }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", actor.id).maybeSingle(),
      supabase
        .from("ticket_messages")
        .select("id, ticket_id, sender_id, message")
        .eq("id", messageId)
        .eq("ticket_id", ticketId)
        .maybeSingle(),
      supabase
        .from("support_tickets")
        .select("id, user_id, subject")
        .eq("id", ticketId)
        .maybeSingle(),
    ]);
    if (!actorProfile || !["admin", "super_admin"].includes(actorProfile.role)) {
      return respond({ error: "Administrator access required" }, 403);
    }
    if (messageError || !message || message.sender_id !== actor.id) {
      return respond({ error: "Support reply was not found for this administrator" }, 404);
    }
    if (ticketError || !ticket) return respond({ error: "Support ticket not found" }, 404);

    const reply = message.message.trim();
    const result = await sendUserNotificationEmail(supabase, {
      userId: ticket.user_id,
      title: `Support replied: ${ticket.subject}`,
      message: reply || "SafeDrive Support added an attachment to your ticket.",
      link: "/support",
      baseOrigin: new URL(req.url).origin,
      eventKey: `support-ticket-reply:${ticket.id}:${message.id}`,
    });

    await supabase.from("audit_log").insert({
      user_id: actor.id,
      action: "support_ticket_reply_email_attempted",
      entity_type: "support_ticket",
      entity_id: ticket.id,
      details: { message_id: message.id, delivery_state: result.state },
    });
    return respond({ success: result.state === "sent", deliveryState: result.state });
  } catch (error) {
    console.error("Support ticket reply email failed", error);
    return respond({ error: "Unable to send support reply email" }, 500);
  }
}
