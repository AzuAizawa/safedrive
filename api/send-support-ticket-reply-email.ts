import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "../server/email.js";
import type { ServiceRoleSupabaseClient } from "../server/supabaseTypes.js";

export const config = { runtime: "edge" };

type Payload = { ticketId?: string; messageId?: string; status?: string };

type ServiceClient = ServiceRoleSupabaseClient;

const STATUS_EMAIL: Record<string, (subject: string, reopenDays: number) => { title: string; message: string }> = {
  in_progress: (subject) => ({
    title: `Support is working on: ${subject}`,
    message: "SafeDrive Support is working on your ticket. We will reply in the ticket.",
  }),
  waiting_for_user: (subject) => ({
    title: `Support needs your reply: ${subject}`,
    message: "SafeDrive Support needs more information from you. Open the ticket and reply to continue.",
  }),
  resolved: (subject, reopenDays) => ({
    title: `Ticket resolved: ${subject}`,
    message: `SafeDrive Support marked your ticket resolved. If it is not, you can reopen it from the Support page within ${reopenDays} days.`,
  }),
  closed: (subject) => ({
    title: `Ticket closed: ${subject}`,
    message: "Your ticket is closed. Open a new ticket from the Support page if you still need help.",
  }),
};

/**
 * CHAPTER 130: the status email that follows set_support_ticket_status. Sent
 * only for the status the ticket actually has now, by staff who may handle
 * support, so it cannot be used to send a member a made-up update. Keyed on
 * the ticket's own status_changed_at, so a retry never emails twice.
 */
async function emailStatusChange(
  supabase: ServiceClient,
  actorId: string,
  ticketId: string,
  status: string,
  baseOrigin: string,
) {
  const template = STATUS_EMAIL[status];
  if (!template) return respond({ error: "Unknown ticket status" }, 400);
  const [{ data: canHandleSupport }, { data: ticket, error: ticketError }, { data: settings }] = await Promise.all([
    supabase.rpc("admin_can_for", { p_uid: actorId, p_key: "support.handle" }),
    supabase
      .from("support_tickets")
      .select("id, user_id, subject, status, status_changed_at, participant_user_id")
      .eq("id", ticketId)
      .maybeSingle(),
    supabase.from("platform_settings").select("ticket_reopen_days").eq("id", "default").maybeSingle(),
  ]);
  if (canHandleSupport !== true) return respond({ error: "Missing permission: support.handle" }, 403);
  const row = ticket as {
    id: string;
    user_id: string;
    subject: string;
    status: string;
    status_changed_at: string | null;
    participant_user_id: string | null;
  } | null;
  if (ticketError || !row || row.participant_user_id) return respond({ error: "Support ticket not found" }, 404);
  if (row.status !== status) return respond({ error: "The ticket no longer has this status" }, 409);

  const reopenDays = Number((settings as { ticket_reopen_days?: number } | null)?.ticket_reopen_days) || 7;
  const { title, message } = template(row.subject, reopenDays);
  const result = await sendUserNotificationEmail(supabase, {
    userId: row.user_id,
    title,
    message,
    link: "/support",
    baseOrigin,
    eventKey: `support-ticket-status:${row.id}:${status}:${row.status_changed_at ?? ""}`,
  });
  return respond({ success: result.state === "sent", deliveryState: result.state });
}

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
    const statusChange = payload.status?.trim();
    if (ticketId && statusChange && !messageId) {
      return await emailStatusChange(supabase, actor.id, ticketId, statusChange, new URL(req.url).origin);
    }
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
    const { data: canHandleSupport } = await supabase.rpc("admin_can_for", {
      p_uid: actor.id,
      p_key: "support.handle",
    });
    if (canHandleSupport !== true) {
      return respond({ error: "Missing permission: support.handle" }, 403);
    }
    if (messageError || !message || message.sender_id !== actor.id) {
      return respond({ error: "Support reply was not found for this administrator" }, 404);
    }
    if (ticketError || !ticket) return respond({ error: "Support ticket not found" }, 404);

    // A ticket support opened itself has no reply to be the answer to, and
    // "Support replied" would be the first thing the person reads about a
    // conversation they never started. Decided from the ticket's own earliest
    // message rather than a flag from the browser, so the wording cannot be
    // set to something the ticket does not actually show.
    const { data: firstMessage } = await supabase
      .from("ticket_messages")
      .select("id")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const opensTheTicket = firstMessage?.id === message.id;

    const reply = message.message.trim();
    const result = await sendUserNotificationEmail(supabase, {
      userId: ticket.user_id,
      title: opensTheTicket
        ? `SafeDrive Support opened a ticket: ${ticket.subject}`
        : `Support replied: ${ticket.subject}`,
      message: reply || "SafeDrive Support added an attachment to your ticket.",
      link: "/support",
      baseOrigin: new URL(req.url).origin,
      eventKey: `${opensTheTicket ? "support-ticket-opened" : "support-ticket-reply"}:${ticket.id}:${message.id}`,
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
