import { createSupabaseAdmin } from "./lib/payoutAutomation.js";
import { postCompletedRefundToLedger } from "./lib/ledger.js";
import { sendRefundReceiptEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type SyncRefundPayload = {
  paymentId?: string;
};

type RefundPaymentRecord = {
  id: string;
  booking_id: string;
  amount: number;
  payment_type: string;
  status: string;
  payment_method: string | null;
  transaction_id: string | null;
};

type PayMongoRefundResponse = {
  data?: {
    attributes?: {
      status?: string;
    };
  };
  errors?: unknown;
  raw?: string;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

const getPayMongoAuthorization = (secretKey: string) =>
  `Basic ${btoa(`${secretKey}:`)}`;

const normalizeProviderStatus = (status: string | undefined) =>
  status?.trim().toLowerCase() || "unknown";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [value.message, value.details, value.hint, value.code]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join(" — ") || "Unexpected PayMongo refund synchronization error";
  }
  return "Unexpected PayMongo refund synchronization error";
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

    const payload = (await req.json().catch(() => ({}))) as SyncRefundPayload;
    const paymentId = payload.paymentId?.trim();
    if (!paymentId) return jsonResponse({ error: "Refund payment is required." }, 400);

    const secretKey = process.env.PAYMONGO_SECRET_KEY;
    if (!secretKey) {
      return jsonResponse({ error: "PayMongo is not configured on this deployment." }, 503);
    }

    const supabase = createSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized request" }, 401);

    const { data: requesterProfile, error: requesterError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (requesterError || requesterProfile?.role !== "super_admin") {
      return jsonResponse(
        { error: "Only a super admin can sync PayMongo refund status." },
        403,
      );
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("id, booking_id, amount, payment_type, status, payment_method, transaction_id")
      .eq("id", paymentId)
      .single();
    if (paymentError || !payment) {
      return jsonResponse({ error: "Refund payment record not found." }, 404);
    }

    const refundPayment = payment as RefundPaymentRecord;
    if (refundPayment.payment_type !== "refund") {
      return jsonResponse({ error: "Selected payment is not a refund." }, 422);
    }
    if (refundPayment.payment_method?.toLowerCase() !== "paymongo") {
      return jsonResponse({ error: "This refund was not sent through PayMongo." }, 422);
    }
    if (!refundPayment.transaction_id?.startsWith("ref_")) {
      return jsonResponse({ error: "This PayMongo refund has no valid provider reference." }, 422);
    }
    const providerResponse = await fetch(
      `https://api.paymongo.com/v1/refunds/${refundPayment.transaction_id}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: getPayMongoAuthorization(secretKey),
        },
      },
    );
    const providerBody = (await providerResponse
      .json()
      .catch(async () => ({ raw: await providerResponse.text() }))) as PayMongoRefundResponse;
    if (!providerResponse.ok) {
      return jsonResponse(
        {
          error: "PayMongo refund lookup failed.",
          providerStatus: "unavailable",
        },
        502,
      );
    }

    const providerStatus = normalizeProviderStatus(providerBody.data?.attributes?.status);
    if (providerStatus === "succeeded") {
      let stateChanged = false;
      if (refundPayment.status !== "completed") {
        const { data: updatedPayment, error: updateError } = await supabase
          .from("payments")
          .update({ status: "completed" })
          .eq("id", refundPayment.id)
          .eq("payment_type", "refund")
          .eq("payment_method", "paymongo")
          .eq("transaction_id", refundPayment.transaction_id)
          .in("status", ["pending", "failed"])
          .select("id")
          .maybeSingle();
        if (updateError) throw updateError;
        stateChanged = Boolean(updatedPayment);
      }

      const ledger = await postCompletedRefundToLedger(supabase, {
        bookingId: refundPayment.booking_id,
        amount: Math.abs(Number(refundPayment.amount)),
        refundId: refundPayment.transaction_id,
        actorId: user.id,
      });

      if (stateChanged) {
        const receipt = await sendRefundReceiptEmail(supabase, {
          bookingId: refundPayment.booking_id,
          amount: Math.abs(Number(refundPayment.amount)),
          refundId: refundPayment.transaction_id,
          refundMethod: "PayMongo",
          baseOrigin: new URL(req.url).origin,
        });
        if (receipt.state !== "sent" && receipt.state !== "not_configured") {
          console.warn("Refund receipt email was not delivered", {
            state: receipt.state,
            bookingId: refundPayment.booking_id,
          });
        }
      }

      if (stateChanged || ledger.posted) {
        await supabase.from("audit_log").insert({
          user_id: user.id,
          action: "refund_provider_status_synced",
          entity_type: "payment",
          entity_id: refundPayment.id,
          details: {
            booking_id: refundPayment.booking_id,
            provider: "paymongo",
            provider_refund_id: refundPayment.transaction_id,
            provider_status: providerStatus,
            ledger,
          },
        });
      }

      return jsonResponse({
        success: true,
        state: stateChanged || ledger.posted ? "completed" : "already_reconciled",
        providerStatus,
        ledger,
      });
    }

    if (providerStatus === "failed") {
      const { data: stateChanged, error: updateError } = await supabase
        .from("payments")
        .update({ status: "failed" })
        .eq("id", refundPayment.id)
        .eq("payment_type", "refund")
        .eq("payment_method", "paymongo")
        .eq("transaction_id", refundPayment.transaction_id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;

      if (stateChanged) {
        await supabase.from("audit_log").insert({
          user_id: user.id,
          action: "refund_provider_status_synced",
          entity_type: "payment",
          entity_id: refundPayment.id,
          details: {
            booking_id: refundPayment.booking_id,
            provider: "paymongo",
            provider_refund_id: refundPayment.transaction_id,
            provider_status: providerStatus,
          },
        });
      }

      return jsonResponse({
        success: true,
        state: stateChanged ? "failed" : "already_reconciled",
        providerStatus,
      });
    }

    return jsonResponse({
      success: true,
      state: "pending",
      providerStatus,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : getErrorMessage(error),
      },
      500,
    );
  }
}
