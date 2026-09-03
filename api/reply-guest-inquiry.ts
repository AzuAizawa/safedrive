import { createClient } from "@supabase/supabase-js";
import { sendGuestInquiryReplyEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type ReplyPayload = {
  inquiryId?: string;
  reply?: string;
  action?: "reply" | "resolve";
};

type GmailWebhookResult = {
  ok?: boolean;
  error?: string;
};

const describeGmailFailure = (
  status: number,
  responseText: string,
  result: GmailWebhookResult | null,
) => {
  const providerError = result?.error?.trim() || "";
  const normalized = `${providerError}\n${responseText}`.toLowerCase();

  if (normalized.includes("unauthorized")) {
    return {
      code: "gmail_webhook_unauthorized",
      message:
        "Gmail webhook rejected the shared secret. Make GMAIL_WEBHOOK_SHARED_SECRET match the Apps Script SAFEDRIVE_WEBHOOK_SECRET property.",
    };
  }

  if (normalized.includes("typeerror") || normalized.includes("script function not found")) {
    return {
      code: "gmail_apps_script_error",
      message:
        "Gmail Apps Script has an execution error. Replace Code.gs with the SafeDrive webhook code and deploy a new version.",
    };
  }

  if (
    normalized.includes("sign in") ||
    normalized.includes("permission") ||
    normalized.includes("access denied")
  ) {
    return {
      code: "gmail_webhook_not_public",
      message:
        "Gmail Apps Script is not accessible to SafeDrive. Deploy it as a web app that executes as you and allows anyone to access it.",
    };
  }

  if (providerError && providerError.length <= 160) {
    return {
      code: "gmail_webhook_rejected",
      message: `Gmail webhook rejected the email: ${providerError}`,
    };
  }

  return {
    code: "gmail_delivery_failed",
    message: `Gmail delivery failed (webhook status ${status}); the inquiry was not marked resolved.`,
  };
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
};

export const isMissingResolvedAtColumn = (
  error: { code?: string; message?: string } | null,
) =>
  Boolean(
    error &&
      ["42703", "PGRST204"].includes(error.code || "") &&
      (error.message || "").includes("resolved_at"),
  );

export default async function handler(req: Request) {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase server configuration");

    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized request" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || !["admin", "super_admin"].includes(profile.role)) {
      return jsonResponse({ error: "Administrator access required" }, 403);
    }
    const { data: canHandleInquiries } = await supabase.rpc("admin_can_for", {
      p_uid: user.id,
      p_key: "inquiries.handle",
    });
    if (canHandleInquiries !== true) {
      return jsonResponse({ error: "Missing permission: inquiries.handle" }, 403);
    }

    const payload = (await req.json()) as ReplyPayload;
    const inquiryId = payload.inquiryId?.trim();
    const action = payload.action === "resolve" ? "resolve" : "reply";
    const reply = payload.reply?.trim();

    const { data: inquiry, error: inquiryError } = await supabase
      .from("guest_inquiries")
      .select("id, name, email, subject, status, submitted_by_user_id")
      .eq("id", inquiryId ?? "")
      .single();
    if (inquiryError || !inquiry) return jsonResponse({ error: "Inquiry not found" }, 404);

    // --- Resolve: close the thread, no email.
    if (action === "resolve") {
      if (["resolved", "closed"].includes(inquiry.status)) {
        return jsonResponse({ success: true, alreadyResolved: true });
      }
      const resolvedAt = new Date().toISOString();
      const { error: resolveError } = await supabase
        .from("guest_inquiries")
        .update({ status: "resolved", resolved_at: resolvedAt, assigned_admin_id: user.id })
        .eq("id", inquiry.id);
      if (resolveError) throw resolveError;
      if (inquiry.submitted_by_user_id) {
        await supabase.from("notifications").insert({
          user_id: inquiry.submitted_by_user_id,
          title: "Inquiry Resolved",
          message: `Your inquiry about ${inquiry.subject || "SafeDrive"} was marked resolved. Reopen it by asking a new question.`,
          type: "success",
          link: "/inquiries",
        });
      }
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "guest_inquiry_resolved",
        entity_type: "guest_inquiry",
        entity_id: inquiry.id,
      });
      return jsonResponse({ success: true });
    }

    if (!inquiryId || !reply || reply.length > 3000) {
      return jsonResponse({ error: "Inquiry and reply are required" }, 400);
    }
    if (["resolved", "closed"].includes(inquiry.status)) {
      return jsonResponse({ error: "This inquiry has already been completed" }, 409);
    }

    // Record the reply as a thread message first so the email idempotency key
    // is per-message: each reply in a thread emails exactly once.
    const { data: threadMessage } = await supabase
      .from("guest_inquiry_messages")
      .insert({ inquiry_id: inquiry.id, sender_id: user.id, sender_role: "admin", message: reply })
      .select("id")
      .maybeSingle();

    const resendResult = await sendGuestInquiryReplyEmail({
      to: inquiry.email,
      name: inquiry.name,
      subject: inquiry.subject,
      reply,
      inquiryId: inquiry.id,
      messageId: threadMessage?.id,
      baseOrigin: new URL(req.url).origin,
    });
    let deliveryProvider = "resend";

    // Gmail remains a migration fallback only while Resend is absent. Do not
    // retry through a second provider after an attempted Resend request: a
    // network failure can have delivered the first message already.
    if (resendResult.state === "not_configured") {
      const emailWebhook = process.env.GMAIL_GUEST_INQUIRY_WEBHOOK_URL;
      const emailWebhookSecret = process.env.GMAIL_WEBHOOK_SHARED_SECRET;
      if (!emailWebhook || !emailWebhookSecret) {
        return jsonResponse(
          { error: "Guest inquiry email delivery is not configured. Configure Resend or the legacy Gmail fallback." },
          503,
        );
      }

      const emailResponse = await fetch(emailWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: emailWebhookSecret,
          to: inquiry.email,
          subject: `SafeDrive response: ${inquiry.subject}`,
          body: `Hello ${inquiry.name},\n\n${reply}\n\nSafeDrive Support`,
          idempotencyKey: `guest-inquiry-reply:${inquiry.id}`,
        }),
      });
      const emailResponseText = await emailResponse.text();
      let emailResult: GmailWebhookResult | null = null;
      try {
        emailResult = JSON.parse(emailResponseText) as GmailWebhookResult;
      } catch {
        // Apps Script execution/deployment errors can return a small HTML page.
      }

      if (!emailResponse.ok || emailResult?.ok !== true) {
        const failure = describeGmailFailure(
          emailResponse.status,
          emailResponseText,
          emailResult,
        );
        console.warn("Guest inquiry Gmail webhook failed", {
          status: emailResponse.status,
          code: failure.code,
        });
        return jsonResponse(
          { error: failure.message, code: failure.code },
          502,
        );
      }
      deliveryProvider = "gmail_webhook";
    } else if (resendResult.state !== "sent") {
      return jsonResponse(
        { error: resendResult.reason || "Resend could not deliver the guest inquiry reply", code: "resend_delivery_failed" },
        502,
      );
    }

    // A reply no longer auto-closes the inquiry - the person can follow up, and
    // an admin marks it resolved separately. `admin_reply` keeps the latest
    // reply as a list preview.
    const repliedAt = new Date().toISOString();
    let { error: updateError } = await supabase
      .from("guest_inquiries")
      .update({
        admin_reply: reply,
        replied_at: repliedAt,
        assigned_admin_id: user.id,
        status: "in_progress",
      })
      .eq("id", inquiry.id);

    if (isMissingResolvedAtColumn(updateError)) {
      ({ error: updateError } = await supabase
        .from("guest_inquiries")
        .update({
          admin_reply: reply,
          replied_at: repliedAt,
          assigned_admin_id: user.id,
          status: "in_progress",
        })
        .eq("id", inquiry.id));
    }
    if (updateError) throw updateError;

    if (inquiry.submitted_by_user_id) {
      await supabase.from("notifications").insert({
        user_id: inquiry.submitted_by_user_id,
        title: "SafeDrive Replied to Your Inquiry",
        message: `SafeDrive support replied about ${inquiry.subject || "your question"}. Open the thread to read it or follow up.`,
        type: "info",
        link: "/inquiries",
      });
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "guest_inquiry_replied",
      entity_type: "guest_inquiry",
      entity_id: inquiry.id,
      details: { recipient: inquiry.email, previous_status: inquiry.status, delivery_provider: deliveryProvider, thread_message_id: threadMessage?.id ?? null },
    });

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Guest inquiry reply failed", error);
    return jsonResponse({ error: "Unable to send the guest inquiry reply" }, 500);
  }
}
