import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "edge" };

type Payload = { inquiryId?: string; message?: string };

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
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const payload = (await req.json()) as Payload;
    const inquiryId = payload.inquiryId?.trim();
    const message = payload.message?.trim();
    if (!inquiryId || !message || message.length > 3000) {
      return jsonResponse({ error: "A follow-up message is required" }, 400);
    }

    const { data: inquiry, error: inquiryError } = await supabase
      .from("guest_inquiries")
      .select("id, status, subject, submitted_by_user_id")
      .eq("id", inquiryId)
      .single();
    if (inquiryError || !inquiry) return jsonResponse({ error: "Inquiry not found" }, 404);
    if (inquiry.submitted_by_user_id !== user.id) {
      return jsonResponse({ error: "This inquiry belongs to another account" }, 403);
    }
    if (["resolved", "closed"].includes(inquiry.status)) {
      return jsonResponse({ error: "This inquiry is resolved. Ask a new question to start again." }, 409);
    }

    const { error: messageError } = await supabase.from("guest_inquiry_messages").insert({
      inquiry_id: inquiry.id,
      sender_id: user.id,
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
          message: `A user added a follow-up to their inquiry about ${inquiry.subject || "SafeDrive"}.`,
          type: "info",
          link: `/admin/guest-inquiries?inquiry=${inquiry.id}`,
        })),
      );
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
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
