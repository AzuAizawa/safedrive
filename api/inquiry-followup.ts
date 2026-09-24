import { createClient } from "@supabase/supabase-js";
import { GUEST_INQUIRY_TOKEN_PATTERN, hashGuestInquiryToken } from "../server/guestInquiryToken.js";

export const config = { runtime: "edge" };

// A visitor without an account proves the inquiry is theirs with the secret
// their browser was handed when they asked (CHAPTER 107), not a session.
type Payload = { inquiryId?: string; message?: string; guestToken?: string };

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async function handler(req: Request) {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !key) throw new Error("Inquiry service is not configured");

    const payload = (await req.json()) as Payload;
    const guestToken =
      !token && typeof payload.guestToken === "string" && GUEST_INQUIRY_TOKEN_PATTERN.test(payload.guestToken)
        ? payload.guestToken
        : null;
    if (!token && !guestToken) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let user: { id: string } | null = null;
    if (token) {
      const { data, error: authError } = await supabase.auth.getUser(token);
      if (authError || !data.user) return jsonResponse({ error: "Unauthorized" }, 401);
      user = data.user;
    }

    const inquiryId = payload.inquiryId?.trim();
    const message = payload.message?.trim();
    if (!inquiryId || !message || message.length > 3000) {
      return jsonResponse({ error: "A follow-up message is required" }, 400);
    }

    const { data: inquiry, error: inquiryError } = await supabase
      .from("guest_inquiries")
      .select("id, status, subject, submitted_by_user_id, guest_token_hash")
      .eq("id", inquiryId)
      .single();
    if (inquiryError || !inquiry) return jsonResponse({ error: "Inquiry not found" }, 404);
    if (user) {
      if (inquiry.submitted_by_user_id !== user.id) {
        return jsonResponse({ error: "This inquiry belongs to another account" }, 403);
      }
    } else if (
      inquiry.submitted_by_user_id ||
      !inquiry.guest_token_hash ||
      inquiry.guest_token_hash !== (await hashGuestInquiryToken(guestToken!))
    ) {
      return jsonResponse({ error: "Inquiry not found" }, 404);
    }
    if (["resolved", "closed"].includes(inquiry.status)) {
      return jsonResponse({ error: "This inquiry is resolved. Ask a new question to start again." }, 409);
    }

    // Nothing but the secret stands behind a guest's follow-up, and each one
    // notifies every admin - so a burst on one thread is refused.
    if (!user) {
      const { count } = await supabase
        .from("guest_inquiry_messages")
        .select("id", { count: "exact", head: true })
        .eq("inquiry_id", inquiry.id)
        .eq("sender_role", "inquirer")
        .gte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
      if ((count ?? 0) >= 5) {
        return jsonResponse({ error: "Too many follow-ups. Please wait for SafeDrive to reply." }, 429);
      }
    }

    const { error: messageError } = await supabase.from("guest_inquiry_messages").insert({
      inquiry_id: inquiry.id,
      sender_id: user?.id ?? null,
      sender_role: "inquirer",
      message,
    });
    if (messageError) throw messageError;

    // Put it back at the front of the admin queue.
    await supabase
      .from("guest_inquiries")
      .update({ status: "open" })
      .eq("id", inquiry.id)
      .in("status", ["open", "in_progress"]);

    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["admin", "super_admin"])
      .is("deleted_at", null);
    if (admins?.length) {
      await supabase.from("notifications").insert(
        admins.map((admin) => ({
          user_id: admin.id,
          title: "Inquiry Follow-up",
          message: `${user ? "A user" : "A guest"} added a follow-up to their inquiry about ${inquiry.subject || "SafeDrive"}.`,
          type: "info",
          link: `/admin/guest-inquiries?inquiry=${inquiry.id}`,
        })),
      );
    }

    await supabase.from("audit_log").insert({
      user_id: user?.id ?? null,
      action: "guest_inquiry_followup",
      entity_type: "guest_inquiry",
      entity_id: inquiry.id,
    });

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Inquiry follow-up failed", error);
    return jsonResponse({ error: "Unable to send the follow-up" }, 500);
  }
}
