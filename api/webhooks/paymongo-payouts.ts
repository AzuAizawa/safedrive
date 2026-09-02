import { createSupabaseAdmin } from "../lib/payoutAutomation";
import { sendPayoutReceiptEmail } from "../lib/email.js";

export const config = {
  runtime: "edge",
};

type PaymongoSignatureParts = {
  t?: string;
  te?: string;
  li?: string;
};

type PayoutCallbackPayload = {
  data?: {
    id?: string;
    attributes?: Record<string, unknown> & {
      status?: string;
      reference_number?: string;
      provider_reference_number?: string;
      provider_error?: string | null;
      provider_error_code?: string | null;
      failure_code?: string | null;
      failure_message?: string | null;
      metadata?: Record<string, unknown>;
      transfers?: unknown[];
      data?: {
        id?: string;
        attributes?: Record<string, unknown>;
      };
    };
  };
};

const encoder = new TextEncoder();

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const parsePaymongoSignature = (header: string): PaymongoSignatureParts =>
  header.split(",").reduce<PaymongoSignatureParts>((parts, item) => {
    const [key, ...valueParts] = item.trim().split("=");
    if (key === "t" || key === "te" || key === "li") {
      parts[key] = valueParts.join("=");
    }
    return parts;
  }, {});

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const constantTimeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
};

const computePaymongoSignature = async (
  timestamp: string,
  rawBody: string,
  secret: string,
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = `${timestamp}.${rawBody}`;
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
};

const verifyPaymongoSignature = async (
  signatureHeader: string | null,
  rawBody: string,
  livemode: boolean,
) => {
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return { ok: false, reason: "Missing PAYMONGO_WEBHOOK_SECRET" };
  }
  if (!signatureHeader) {
    return { ok: false, reason: "Missing Paymongo-Signature header" };
  }

  const signature = parsePaymongoSignature(signatureHeader);
  const requestTimestamp = Number(signature.t);
  if (!signature.t || Number.isNaN(requestTimestamp)) {
    return { ok: false, reason: "Invalid Paymongo-Signature timestamp" };
  }

  const toleranceSeconds = Number(
    process.env.PAYMONGO_WEBHOOK_TOLERANCE_SECONDS ?? 300,
  );
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTimestamp - requestTimestamp) > toleranceSeconds) {
    return { ok: false, reason: "PayMongo webhook timestamp outside tolerance" };
  }

  const providedSignature = livemode ? signature.li : signature.te;
  if (!providedSignature) {
    return {
      ok: false,
      reason: livemode
        ? "Missing live-mode webhook signature"
        : "Missing test-mode webhook signature",
    };
  }

  const expectedSignature = await computePaymongoSignature(
    signature.t,
    rawBody,
    webhookSecret,
  );

  if (!constantTimeEqual(expectedSignature, providedSignature)) {
    return { ok: false, reason: "PayMongo webhook signature mismatch" };
  }

  return { ok: true, reason: "verified" };
};

const getFirstTransferAttributes = (
  attributes: Record<string, unknown> | null | undefined,
) => {
  const transfers = attributes?.transfers;
  if (!Array.isArray(transfers) || !transfers[0] || typeof transfers[0] !== "object") {
    return null;
  }

  const firstTransfer = transfers[0] as Record<string, unknown>;
  return firstTransfer.attributes && typeof firstTransfer.attributes === "object"
    ? (firstTransfer.attributes as Record<string, unknown>)
    : firstTransfer;
};

const getFirstTransferId = (
  attributes: Record<string, unknown> | null | undefined,
) => {
  const transfers = attributes?.transfers;
  if (!Array.isArray(transfers) || !transfers[0] || typeof transfers[0] !== "object") {
    return null;
  }

  const firstTransfer = transfers[0] as Record<string, unknown>;
  return typeof firstTransfer.id === "string" ? firstTransfer.id : null;
};

const getNestedAttributes = (payload: PayoutCallbackPayload) => {
  const direct = payload.data?.attributes;
  const nested =
    direct?.data &&
    typeof direct.data === "object" &&
    "attributes" in direct.data
      ? (direct.data.attributes as Record<string, unknown>)
      : null;

  return nested ?? getFirstTransferAttributes(direct) ?? direct ?? {};
};

const getNestedId = (payload: PayoutCallbackPayload) => {
  const directId = payload.data?.id;
  const nestedData = payload.data?.attributes?.data;
  if (
    nestedData &&
    typeof nestedData === "object" &&
    "id" in nestedData &&
    typeof nestedData.id === "string"
  ) {
    return nestedData.id;
  }
  return getFirstTransferId(payload.data?.attributes) ?? directId ?? null;
};

const safeString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const normalizeTransferStatus = (status: string) =>
  status.trim().toLowerCase();

const isCompletedTransferStatus = (status: string) =>
  ["succeeded", "completed"].includes(normalizeTransferStatus(status));

const isFailedTransferStatus = (status: string) =>
  ["failed", "cancelled", "canceled"].includes(normalizeTransferStatus(status));

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const rawBody = await req.text();
    const payload = JSON.parse(rawBody) as PayoutCallbackPayload;
    const directAttributes = payload.data?.attributes ?? {};
    const livemode = Boolean(directAttributes.livemode);

    const signatureCheck = await verifyPaymongoSignature(
      req.headers.get("Paymongo-Signature"),
      rawBody,
      livemode,
    );

    if (!signatureCheck.ok) {
      return jsonResponse({ error: "Invalid signature" }, 401);
    }

    const supabase = createSupabaseAdmin();
    const transactionId = getNestedId(payload);
    const attributes = getNestedAttributes(payload);
    const metadata =
      attributes.metadata && typeof attributes.metadata === "object"
        ? (attributes.metadata as Record<string, unknown>)
        : {};

    const bookingId = safeString(metadata.booking_id);
    const listerId = safeString(metadata.lister_id);
    const status = safeString(attributes.status) ?? "pending";
    const referenceNumber =
      safeString(attributes.reference_number) ??
      safeString(attributes.provider_reference_number);
    const providerError =
      safeString(attributes.failure_message) ??
      safeString(attributes.failure_code) ??
      safeString(attributes.provider_error) ??
      safeString(attributes.provider_error_code);

    if (!transactionId || !bookingId) {
      return jsonResponse(
        {
          error: "Payout callback is missing transaction or booking metadata",
        },
        422,
      );
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("id, booking_id, status, amount, payment_method, notes")
      .eq("booking_id", bookingId)
      .eq("payment_type", "payout")
      .eq("transaction_id", transactionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!payment) {
      return jsonResponse(
        { error: "No payout payment row found for this callback" },
        404,
      );
    }

    if (payment.status === "completed" && !isCompletedTransferStatus(status)) {
      await supabase.from("audit_log").insert({
        action: "payout_callback_ignored_terminal_state",
        entity_type: "booking",
        entity_id: bookingId,
        details: {
          booking_id: bookingId,
          payment_id: payment.id,
          transaction_id: transactionId,
          existing_status: payment.status,
          callback_status: status,
          reference_number: referenceNumber,
        },
        user_id: null,
      });

      return jsonResponse({ success: true, state: "completed_unchanged" });
    }

    if (
      payment.status === "failed" &&
      !isFailedTransferStatus(status) &&
      !isCompletedTransferStatus(status)
    ) {
      await supabase.from("audit_log").insert({
        action: "payout_callback_ignored_terminal_state",
        entity_type: "booking",
        entity_id: bookingId,
        details: {
          booking_id: bookingId,
          payment_id: payment.id,
          transaction_id: transactionId,
          existing_status: payment.status,
          callback_status: status,
          reference_number: referenceNumber,
        },
        user_id: null,
      });

      return jsonResponse({ success: true, state: "failed_unchanged" });
    }

    if (isCompletedTransferStatus(status)) {
      if (payment.status !== "completed") {
        await supabase
          .from("payments")
          .update({
            status: "completed",
            notes: [
              "Payout confirmed by PayMongo callback.",
              referenceNumber ? `Reference: ${referenceNumber}` : null,
            ]
              .filter(Boolean)
              .join(" "),
          })
          .eq("id", payment.id);

        if (listerId) {
          await supabase.from("notifications").insert({
            user_id: listerId,
            title: "Payout Released",
            message:
              "Your SafeDrive payout finished processing and was confirmed by PayMongo.",
            type: "success",
            link: "/lister-bookings",
          });
          await sendPayoutReceiptEmail(supabase, {
            bookingId,
            amount: Number(payment.amount),
            payoutId: payment.id,
            payoutMethod: payment.payment_method || "PayMongo",
            transactionId: transactionId || referenceNumber,
            baseOrigin: new URL(req.url).origin,
          });
        }

        await supabase.from("audit_log").insert({
          action: "payout_sent_auto",
          entity_type: "booking",
          entity_id: bookingId,
          details: {
            booking_id: bookingId,
            payment_id: payment.id,
            transaction_id: transactionId,
            reference_number: referenceNumber,
            callback_confirmed: true,
          },
          user_id: null,
        });
      }

      return jsonResponse({ success: true, state: "completed" });
    }

    if (isFailedTransferStatus(status)) {
      if (payment.status !== "failed") {
        await supabase
          .from("payments")
          .update({
            status: "failed",
            notes: [
              "Payout failed at PayMongo callback.",
              referenceNumber ? `Reference: ${referenceNumber}` : null,
              providerError ? `Provider note: ${providerError}` : null,
            ]
              .filter(Boolean)
              .join(" "),
          })
          .eq("id", payment.id);

        const { data: admins } = await supabase
          .from("profiles")
          .select("id")
          .in("role", ["admin", "super_admin"]);

        if (admins?.length) {
          await supabase.from("notifications").insert(
            admins.map((admin) => ({
              user_id: admin.id,
              title: "Auto payout failed",
              message:
                "A booking payout callback reported failure. Review the payout queue for retry or manual follow-up.",
              type: "error",
              link: "/admin/payouts",
            })),
          );
        }

        await supabase.from("audit_log").insert({
          action: "payout_auto_failed",
          entity_type: "booking",
          entity_id: bookingId,
          details: {
            booking_id: bookingId,
            payment_id: payment.id,
            transaction_id: transactionId,
            reference_number: referenceNumber,
            provider_error: providerError,
            callback_status: status,
          },
          user_id: null,
        });
      }

      return jsonResponse({ success: true, state: "failed" });
    }

    await supabase
      .from("payments")
      .update({
        status: "pending",
        notes: [
          "Payout is still pending at PayMongo.",
          referenceNumber ? `Reference: ${referenceNumber}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      })
      .eq("id", payment.id);

    return jsonResponse({ success: true, state: "pending" });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected payout callback error",
      },
      500,
    );
  }
}
