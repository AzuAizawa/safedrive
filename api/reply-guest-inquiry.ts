import { createClient } from "@supabase/supabase-js";
import { sendGuestInquiryReplyEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type ReplyPayload = {
  inquiryId?: string;
  reply?: string;
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

    const payload = (await req.json()) as ReplyPayload;
    const inquiryId = payload.inquiryId?.trim();
    const reply = payload.reply?.trim();
    if (!inquiryId || !reply || reply.length > 3000) {
      return jsonResponse({ error: "Inquiry and reply are required" }, 400);
    }

    const { data: inquiry, error: inquiryError } = await supabase
      .from("guest_inquiries")
      .select("id, name, email, subject, status")
      .eq("id", inquiryId)
      .single();
    if (inquiryError || !inquiry) return jsonResponse({ error: "Inquiry not found" }, 404);
    if (["resolved", "closed"].includes(inquiry.status)) {
      return jsonResponse({ error: "This inquiry has already been completed" }, 409);
    }

    // The email idempotency key is keyed on inquiry.id alone (not the reply
    // text). Safe only because this handler 409s above once the inquiry is
    // resolved/closed, so a second distinct reply can never reach this point.
    const resendResult = await sendGuestInquiryReplyEmail({
      to: inquiry.email,
      name: inquiry.name,
      subject: inquiry.subject,
      reply,
      inquiryId: inquiry.id,
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

    const resolvedAt = new Date().toISOString();
    let { error: updateError } = await supabase
      .from("guest_inquiries")
      .update({
        admin_reply: reply,
        replied_at: resolvedAt,
        resolved_at: resolvedAt,
        assigned_admin_id: user.id,
        status: "resolved",
      })
      .eq("id", inquiry.id);

    // Keep replies operational while an older live schema is awaiting the
    // additive Chapter 10 migration. replied_at remains the completion proof.
    if (isMissingResolvedAtColumn(updateError)) {
      ({ error: updateError } = await supabase
        .from("guest_inquiries")
        .update({
          admin_reply: reply,
          replied_at: resolvedAt,
          assigned_admin_id: user.id,
          status: "resolved",
        })
        .eq("id", inquiry.id));
    }
    if (updateError) throw updateError;

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "guest_inquiry_replied",
      entity_type: "guest_inquiry",
      entity_id: inquiry.id,
      details: { recipient: inquiry.email, previous_status: inquiry.status, delivery_provider: deliveryProvider },
    });

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Guest inquiry reply failed", error);
    return jsonResponse({ error: "Unable to send the guest inquiry reply" }, 500);
  }
}
