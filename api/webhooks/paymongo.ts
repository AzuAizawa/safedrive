import { createClient } from "@supabase/supabase-js";
import type { ServiceRoleSupabaseClient } from "../lib/supabaseTypes.js";
import { postCompletedPaymentToLedger, postCompletedRefundToLedger } from "../lib/ledger.js";
import { sendPaymentReceiptEmail, sendRefundReceiptEmail, sendUserNotificationEmail } from "../lib/email.js";

export const config = {
  runtime: "edge",
};

type PaymongoSignatureParts = {
  t?: string;
  te?: string;
  li?: string;
};

type BookingRecord = {
  id: string;
  status: string;
  renter_id: string;
  owner_id: string;
  total_price?: number;
  downpayment_amount: number;
  paymongo_checkout_id: string | null;
  balance_amount?: number;
  paymongo_balance_checkout_id?: string | null;
  start_date?: string;
  pickup_time?: string | null;
};

type SubscriptionPlanDefinition = {
  id: "pro" | "premium";
  label: string;
  additionalSlots: number;
  amountPhp: number;
};

type PaymongoWebhookEvent = {
  id?: string;
  attributes?: {
    type?: string;
    livemode?: boolean;
    data?: {
      id?: string;
      attributes?: Record<string, unknown>;
    };
  };
};

type CompletedBookingPaymentType = "downpayment" | "balance" | "extension";

const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlanDefinition> = {
  pro: {
    id: "pro",
    label: "Pro",
    additionalSlots: 5,
    amountPhp: 199,
  },
  premium: {
    id: "premium",
    label: "Premium",
    additionalSlots: 10,
    amountPhp: 299,
  },
};

const encoder = new TextEncoder();

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

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !supabaseServiceKey ||
    supabaseServiceKey === "paste_the_secret_key_here"
  ) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const DEFAULT_BALANCE_DEADLINE_HOURS = 24;

// Same Manila-correct pattern used across booking-action.ts /
// booking-incident-action.ts / api/lib/cancellationRefundPlan.ts -
// start_date is a plain calendar date, pickup time is treated as Manila
// local time (-8h from the naive UTC instant).
const getBookingPickupMs = (booking: Pick<BookingRecord, "start_date" | "pickup_time">) => {
  const [year, month, day] = (booking.start_date || "")
    .split("-")
    .map((part) => Number(part));
  const [hour, minute] = (booking.pickup_time || "09:00")
    .split(":")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour || 0, minute || 0);
  return asUtc - 8 * 60 * 60 * 1000;
};

// CHAPTER 42: how long, from the moment the downpayment succeeds, the renter
// has to pay the remaining balance - capped at pickup time, mirroring the
// same "never past pickup" rule already used for the original
// payment_deadline. Live setting (not snapshotted per booking).
const fetchBalanceDeadlineHours = async (supabase: ServiceRoleSupabaseClient) => {
  const { data } = await supabase
    .from("platform_settings")
    .select("balance_deadline_hours")
    .eq("id", "default")
    .maybeSingle();
  const parsed = Number(data?.balance_deadline_hours);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 168
    ? Math.round(parsed)
    : DEFAULT_BALANCE_DEADLINE_HOURS;
};

const recordWebhookSecurityEvent = async (
  status: "success" | "failed" | "info",
  details: Record<string, unknown>,
) => {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return;

    await supabase.from("security_logs").insert({
      event_type:
        status === "failed"
          ? "webhook_signature_failed"
          : "webhook_signature_verified",
      status,
      details: {
        source: "paymongo_webhook",
        ...details,
        recorded_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to record webhook security event", error);
  }
};

const getNumeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const extractPaidAmountInCentavos = (attributes: Record<string, unknown>) => {
  const directCandidates = [
    attributes.amount_total,
    attributes.amount,
    attributes.total_amount,
  ];

  for (const candidate of directCandidates) {
    const numeric = getNumeric(candidate);
    if (numeric !== null) return numeric;
  }

  const payments = Array.isArray(attributes.payments)
    ? attributes.payments
    : null;

  if (payments?.length) {
    for (const payment of payments) {
      if (!payment || typeof payment !== "object") continue;

      const paymentRecord = payment as Record<string, unknown>;
      const nestedAttributes =
        paymentRecord.attributes && typeof paymentRecord.attributes === "object"
          ? (paymentRecord.attributes as Record<string, unknown>)
          : null;

      const numeric = getNumeric(
        nestedAttributes?.amount ?? paymentRecord.amount,
      );
      if (numeric !== null) return numeric;
    }
  }

  return null;
};

const getPaymentMethodLabel = (attributes: Record<string, unknown>) => {
  const paymentMethodTypes = Array.isArray(attributes.payment_method_types)
    ? attributes.payment_method_types
    : [];
  if (paymentMethodTypes.length > 0 && typeof paymentMethodTypes[0] === "string") {
    return paymentMethodTypes[0];
  }

  const paymentHandlers = Array.isArray(attributes.payment_handlers)
    ? attributes.payment_handlers
    : [];
  if (paymentHandlers.length > 0 && typeof paymentHandlers[0] === "string") {
    return paymentHandlers[0];
  }

  return "paymongo";
};

const extractPayMongoPaymentMetadata = (attributes: Record<string, unknown>) => {
  const payments = Array.isArray(attributes.payments) ? attributes.payments : [];

  for (const payment of payments) {
    if (!payment || typeof payment !== "object") continue;

    const paymentRecord = payment as Record<string, unknown>;
    const nestedAttributes =
      paymentRecord.attributes && typeof paymentRecord.attributes === "object"
        ? (paymentRecord.attributes as Record<string, unknown>)
        : null;

    const paymentId =
      typeof paymentRecord.id === "string"
        ? paymentRecord.id
        : typeof nestedAttributes?.id === "string"
          ? nestedAttributes.id
          : null;

    const paymentIntentId =
      typeof nestedAttributes?.payment_intent_id === "string"
        ? nestedAttributes.payment_intent_id
        : null;

    const sourceId =
      nestedAttributes?.source &&
      typeof nestedAttributes.source === "object" &&
      typeof (nestedAttributes.source as Record<string, unknown>).id === "string"
        ? ((nestedAttributes.source as Record<string, unknown>).id as string)
        : null;

    if (paymentId || paymentIntentId || sourceId) {
      return { paymentId, paymentIntentId, sourceId };
    }
  }

  return { paymentId: null, paymentIntentId: null, sourceId: null };
};

const buildPaymentNotes = (
  baseNote: string,
  metadata: { paymentId: string | null; paymentIntentId: string | null; sourceId: string | null },
) =>
  [
    baseNote,
    metadata.paymentId ? `PayMongo payment ID: ${metadata.paymentId}` : null,
    metadata.paymentIntentId
      ? `PayMongo payment intent ID: ${metadata.paymentIntentId}`
      : null,
    metadata.sourceId ? `PayMongo source ID: ${metadata.sourceId}` : null,
  ]
    .filter(Boolean)
    .join("\n");

const formatDateOnly = (date: Date) => date.toISOString().slice(0, 10);

const calculateSubscriptionEndDate = (startDate = new Date()) => {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 30);
  return formatDateOnly(endDate);
};

const insertCompletedPaymentIfMissing = async (
  supabase: ServiceRoleSupabaseClient,
  payment: {
    bookingId: string;
    amount: number;
    paymentType: CompletedBookingPaymentType;
    paymentMethod: string;
    transactionId: string;
    notes: string;
    allocationOverride?: {
      ownerPesos: number;
      commissionPesos: number;
      feePesos: number;
    };
  },
  baseOrigin: string,
  receipt: { amount: number; paymentType: "downpayment" | "balance" | "extension" | "full_payment" } | false = {
    amount: payment.amount,
    paymentType: payment.paymentType,
  },
) => {
  const { data: existingPayment } = await supabase
    .from("payments")
    .select("id")
    .eq("booking_id", payment.bookingId)
    .eq("payment_type", payment.paymentType)
    .eq("transaction_id", payment.transactionId)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();

  if (existingPayment) {
    await postCompletedPaymentToLedger(supabase, payment);
    return { inserted: false };
  }

  const { error } = await supabase.from("payments").insert({
    booking_id: payment.bookingId,
    amount: payment.amount,
    payment_type: payment.paymentType,
    status: "completed",
    payment_method: payment.paymentMethod,
    transaction_id: payment.transactionId,
    notes: payment.notes,
  });

  if (error?.code === "23505") {
    await postCompletedPaymentToLedger(supabase, payment);
    return { inserted: false };
  }

  if (error) throw error;

  await postCompletedPaymentToLedger(supabase, payment);
  if (receipt) {
    const receiptResult = await sendPaymentReceiptEmail(supabase, {
      bookingId: payment.bookingId,
      amount: receipt.amount,
      paymentType: receipt.paymentType,
      paymentMethod: payment.paymentMethod,
      transactionId: payment.transactionId,
      baseOrigin,
    });
    if (receiptResult.state !== "sent" && receiptResult.state !== "not_configured") {
      console.warn("Payment receipt email was not delivered", {
        state: receiptResult.state,
        paymentType: receipt.paymentType,
        bookingId: payment.bookingId,
      });
    }
    return { inserted: true, receipt: receiptResult };
  }

  return { inserted: true, receipt: null };
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const signature = req.headers.get("Paymongo-Signature");
    const rawBody = await req.text();
    const body = JSON.parse(rawBody) as { data?: PaymongoWebhookEvent };
    const event = body.data;
    const livemode = Boolean(event?.attributes?.livemode);

    const signatureCheck = await verifyPaymongoSignature(
      signature,
      rawBody,
      livemode,
    );

    if (!signatureCheck.ok) {
      await recordWebhookSecurityEvent("failed", {
        reason: signatureCheck.reason,
        event_id: event?.id,
        event_type: event?.attributes?.type,
        livemode,
      });
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (["payment.refunded", "payment.refund.updated"].includes(event?.attributes?.type || "")) {
      const refundId = event?.attributes?.data?.id;
      const refundAttributes = event?.attributes?.data?.attributes || {};
      const refundStatus = typeof refundAttributes.status === "string" ? refundAttributes.status : null;
      const supabase = getSupabaseAdmin();
      if (!supabase || !refundId) return new Response(JSON.stringify({ statusCode: 200, body: { message: "IGNORED" } }), { status: 200, headers: { "Content-Type": "application/json" } });
      const { data: refundPayment } = await supabase
        .from("payments")
        .select("id, booking_id, amount, status")
        .eq("payment_type", "refund")
        .eq("transaction_id", refundId)
        .maybeSingle();
      if (!refundPayment) return new Response(JSON.stringify({ statusCode: 200, body: { message: "IGNORED" } }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (refundStatus === "succeeded") {
        const { data: completedRefund, error: completedRefundError } = await supabase
          .from("payments")
          .update({ status: "completed" })
          .eq("id", refundPayment.id)
          .in("status", ["pending", "failed"])
          .select("id")
          .maybeSingle();
        if (completedRefundError) throw completedRefundError;
        await postCompletedRefundToLedger(supabase, { bookingId: refundPayment.booking_id, amount: Math.abs(Number(refundPayment.amount)), refundId });
        if (completedRefund) {
          const receipt = await sendRefundReceiptEmail(supabase, {
            bookingId: refundPayment.booking_id,
            amount: Math.abs(Number(refundPayment.amount)),
            refundId,
            refundMethod: "PayMongo",
            baseOrigin: new URL(req.url).origin,
          });
          if (receipt.state !== "sent" && receipt.state !== "not_configured") {
            console.warn("Refund receipt email was not delivered", { state: receipt.state, bookingId: refundPayment.booking_id });
          }
        }
      } else if (refundStatus === "failed") {
        await supabase.from("payments").update({ status: "failed" }).eq("id", refundPayment.id).eq("status", "pending");
      }
      await recordWebhookSecurityEvent(refundStatus === "failed" ? "failed" : "success", { reason: "Booking refund webhook handled", event_id: event.id, event_type: event.attributes?.type, refund_id: refundId, refund_status: refundStatus, payment_record_id: refundPayment.id, booking_id: refundPayment.booking_id, livemode });
      return new Response(JSON.stringify({ statusCode: 200, body: { message: "SUCCESS" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (event?.attributes?.type !== "checkout_session.payment.paid") {
      return new Response(
        JSON.stringify({ statusCode: 200, body: { message: "IGNORED" } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const checkoutId = event.attributes.data?.id;
    const checkoutAttributes =
      event.attributes.data?.attributes &&
      typeof event.attributes.data.attributes === "object"
        ? (event.attributes.data.attributes as Record<string, unknown>)
        : null;

    const referenceNumber =
      typeof checkoutAttributes?.reference_number === "string"
        ? checkoutAttributes.reference_number
        : null;

    if (!referenceNumber || !checkoutId || !checkoutAttributes) {
      await recordWebhookSecurityEvent("failed", {
        reason: "Webhook missing reference or checkout payload",
        event_id: event.id,
        checkout_id: checkoutId,
        livemode,
      });
      return new Response("OK", { status: 200 });
    }

    const paidAmountInCentavos = extractPaidAmountInCentavos(checkoutAttributes);
    const paymongoPaymentMetadata = extractPayMongoPaymentMetadata(checkoutAttributes);
    if (paidAmountInCentavos === null) {
      await recordWebhookSecurityEvent("failed", {
        reason: "Unable to resolve paid amount from webhook payload",
        reference_number: referenceNumber,
        checkout_id: checkoutId,
        event_id: event.id,
        livemode,
      });
      return new Response(
        JSON.stringify({ error: "Webhook payload missing amount" }),
        {
          status: 422,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      throw new Error(
        "CRITICAL: Missing SUPABASE_SERVICE_ROLE_KEY. Webhook cannot run securely without it.",
      );
    }

    if (referenceNumber.startsWith("subscription:")) {
      const [, userId, planId] = referenceNumber.split(":");
      const plan = planId ? SUBSCRIPTION_PLANS[planId] : null;

      if (!userId || !plan) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Invalid subscription reference number",
          reference_number: referenceNumber,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Invalid subscription reference number" }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const expectedAmountInCentavos = plan.amountPhp * 100;
      if (paidAmountInCentavos !== expectedAmountInCentavos) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Subscription paid amount mismatch",
          reference_number: referenceNumber,
          checkout_id: checkoutId,
          expected_amount_in_centavos: expectedAmountInCentavos,
          received_amount_in_centavos: paidAmountInCentavos,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Paid amount does not match subscription plan" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const { data: existingAudit } = await supabase
        .from("audit_log")
        .select("id")
        .eq("action", "subscription_payment_confirmed")
        .eq("entity_id", checkoutId)
        .limit(1)
        .maybeSingle();

      if (existingAudit) {
        await recordWebhookSecurityEvent("info", {
          reason: "Duplicate subscription webhook event",
          reference_number: referenceNumber,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const { data: currentSubscriptions } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active");

      if (currentSubscriptions && currentSubscriptions.length > 0) {
        const currentIds = currentSubscriptions.map((subscription) => subscription.id);
        const { error: cancelError } = await supabase
          .from("subscriptions")
          .update({
            status: "cancelled",
            end_date: new Date().toISOString().slice(0, 10),
          })
          .in("id", currentIds);

        if (cancelError) {
          console.error("Failed to cancel previous subscriptions", cancelError);
          throw cancelError;
        }
      }

      const startDate = new Date();
      const { error: insertSubscriptionError } = await supabase
        .from("subscriptions")
        .insert({
          user_id: userId,
          plan_type: plan.id,
          additional_slots: plan.additionalSlots,
          start_date: formatDateOnly(startDate),
          end_date: calculateSubscriptionEndDate(startDate),
          status: "active",
          provider_checkout_id: checkoutId,
          provider_payment_id: paymongoPaymentMetadata.paymentId,
          amount_centavos: paidAmountInCentavos,
          paid_at: new Date().toISOString(),
        });

      if (insertSubscriptionError?.code === "23505") {
        await recordWebhookSecurityEvent("info", {
          reason: "Duplicate subscription webhook found an already-active subscription",
          reference_number: referenceNumber,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (insertSubscriptionError) {
        console.error("Failed to activate subscription from webhook", insertSubscriptionError);
        throw insertSubscriptionError;
      }

      await supabase.from("notifications").insert({
        user_id: userId,
        title: `${plan.label} Plan Activated`,
        message: `Your ${plan.label} plan payment was confirmed. You now have ${plan.additionalSlots} extra vehicle slots.`,
        type: "success",
        link: "/subscriptions",
      });

      await supabase.from("audit_log").insert({
        user_id: userId,
        action: "subscription_payment_confirmed",
        entity_type: "subscription_plan",
        entity_id: checkoutId,
        details: {
          plan_id: plan.id,
          amount_php: plan.amountPhp,
          amount_in_centavos: paidAmountInCentavos,
          reference_number: referenceNumber,
          provider_payment_id: paymongoPaymentMetadata.paymentId,
          test_mode: true,
        },
      });

      await recordWebhookSecurityEvent("success", {
        event_id: event.id,
        event_type: event.attributes.type,
        checkout_id: checkoutId,
        reference_number: referenceNumber,
        livemode,
        paid_amount_in_centavos: paidAmountInCentavos,
      });

      return new Response(
        JSON.stringify({ statusCode: 200, body: { message: "SUCCESS" } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (referenceNumber.startsWith("booking-balance:")) {
      const [, bookingId] = referenceNumber.split(":");

      if (!bookingId) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Invalid balance payment reference number",
          reference_number: referenceNumber,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Invalid balance reference number" }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(
          "id, status, renter_id, owner_id, balance_amount, paymongo_balance_checkout_id",
        )
        .eq("id", bookingId)
        .single();

      if (bookingError || !booking) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Booking not found for balance webhook reference",
          booking_id: bookingId,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response("OK", { status: 200 });
      }

      const bookingRecord = booking as BookingRecord;
      const expectedAmountInCentavos = Math.round(
        Number(bookingRecord.balance_amount) * 100,
      );

      if (bookingRecord.paymongo_balance_checkout_id !== checkoutId) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Balance checkout ID mismatch",
          booking_id: bookingId,
          checkout_id: checkoutId,
          stored_checkout_id: bookingRecord.paymongo_balance_checkout_id,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({
            error: "Balance checkout session does not match booking",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (paidAmountInCentavos !== expectedAmountInCentavos) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Paid amount does not match expected balance",
          booking_id: bookingId,
          checkout_id: checkoutId,
          expected_amount_in_centavos: expectedAmountInCentavos,
          received_amount_in_centavos: paidAmountInCentavos,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Paid amount does not match booking balance" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (
        bookingRecord.status === "fully_paid" ||
        bookingRecord.status === "active" ||
        bookingRecord.status === "completed"
      ) {
        await recordWebhookSecurityEvent("info", {
          reason: "Duplicate or already-processed balance webhook event",
          booking_id: bookingId,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (bookingRecord.status !== "downpayment_paid") {
        await recordWebhookSecurityEvent("failed", {
          reason: "Booking not in payable balance state",
          booking_id: bookingId,
          checkout_id: checkoutId,
          booking_status: bookingRecord.status,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Booking is not awaiting a balance payment" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      await insertCompletedPaymentIfMissing(supabase, {
        bookingId,
        amount: Number(bookingRecord.balance_amount),
        paymentType: "balance",
        paymentMethod: getPaymentMethodLabel(checkoutAttributes),
        transactionId: checkoutId,
        notes: buildPaymentNotes(
          "Automated balance payment via PayMongo webhook",
          paymongoPaymentMetadata,
        ),
      }, new URL(req.url).origin);

      const { data: balanceStateChanged, error: updateError } = await supabase
        .from("bookings")
        .update({ status: "fully_paid" })
        .eq("id", bookingId)
        .eq("status", "downpayment_paid")
        .select("id")
        .maybeSingle();

      if (updateError) {
        console.error("Failed to update booking balance status", updateError);
        throw updateError;
      }

      if (!balanceStateChanged) {
        await recordWebhookSecurityEvent("info", {
          reason: "Balance webhook payment row existed but booking state was already claimed",
          booking_id: bookingId,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const { error: auditError } = await supabase.from("audit_log").insert({
        action: "balance_paid",
        entity_type: "booking",
        entity_id: bookingId,
        details: {
          amount: Number(bookingRecord.balance_amount),
          amount_in_centavos: paidAmountInCentavos,
          webhook: true,
          checkout_id: checkoutId,
        },
        user_id: bookingRecord.renter_id,
      });

      if (auditError) {
        console.error("Failed to write audit log for balance payment", auditError);
      }

      await supabase.from("notifications").insert([
        {
          user_id: bookingRecord.renter_id,
          title: "Balance Payment Confirmed",
          message: "Your remaining balance payment was confirmed. This booking is now fully paid.",
          type: "success",
          link: "/my-bookings",
        },
        {
          user_id: bookingRecord.owner_id,
          title: "Booking Fully Paid",
          message: "The renter completed the remaining balance payment. This booking is now fully paid.",
          type: "success",
          link: "/lister-bookings",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: bookingRecord.owner_id,
        title: "Booking Fully Paid",
        message: `The renter paid the remaining balance for this booking. SafeDrive holds the full payment - your share (rental minus the SafeDrive commission) is released to your payout method after the trip is completed.`,
        link: "/lister-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `lister-balance:${bookingId}`,
      });

      await recordWebhookSecurityEvent("success", {
        event_id: event.id,
        event_type: event.attributes.type,
        booking_id: bookingId,
        checkout_id: checkoutId,
        reference_number: referenceNumber,
        livemode,
        paid_amount_in_centavos: paidAmountInCentavos,
      });

      return new Response(
        JSON.stringify({ statusCode: 200, body: { message: "SUCCESS" } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (referenceNumber.startsWith("booking-extension:")) {
      const [, extensionId] = referenceNumber.split(":");

      if (!extensionId) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Invalid extension payment reference number",
          reference_number: referenceNumber,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Invalid extension reference number" }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const { data: extension, error: extensionError } = await supabase
        .from("booking_extensions")
        .select(
          "id, booking_id, renter_id, owner_id, status, total_additional_amount, paymongo_checkout_id, requested_end_date, extension_days, extension_amount, fuel_top_up_amount",
        )
        .eq("id", extensionId)
        .single();

      if (extensionError || !extension) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Booking extension not found for webhook reference",
          extension_id: extensionId,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response("OK", { status: 200 });
      }

      const expectedAmountInCentavos = Math.round(
        Number(extension.total_additional_amount) * 100,
      );

      if (extension.paymongo_checkout_id !== checkoutId) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Extension checkout ID mismatch",
          extension_id: extensionId,
          checkout_id: checkoutId,
          stored_checkout_id: extension.paymongo_checkout_id,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Extension checkout session does not match request" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (paidAmountInCentavos !== expectedAmountInCentavos) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Paid amount does not match expected extension amount",
          extension_id: extensionId,
          checkout_id: checkoutId,
          expected_amount_in_centavos: expectedAmountInCentavos,
          received_amount_in_centavos: paidAmountInCentavos,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Paid amount does not match extension amount" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (extension.status === "paid") {
        await recordWebhookSecurityEvent("info", {
          reason: "Duplicate or already-processed extension webhook event",
          extension_id: extensionId,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (extension.status !== "approved") {
        await recordWebhookSecurityEvent("failed", {
          reason: "Extension not in payable state",
          extension_id: extensionId,
          checkout_id: checkoutId,
          extension_status: extension.status,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Extension is not awaiting payment" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const { data: booking, error: extensionBookingError } = await supabase
        .from("bookings")
        .select("id, end_date, total_days, base_price, commission, total_price")
        .eq("id", extension.booking_id)
        .single();

      if (extensionBookingError || !booking) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Booking not found for extension payment",
          extension_id: extensionId,
          booking_id: extension.booking_id,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response("OK", { status: 200 });
      }

      const extensionRentalAmount = Number(extension.extension_amount);
      const extensionFuelTopUp = Math.max(0, Number(extension.fuel_top_up_amount));
      const extensionCommission = Math.max(
        0,
        Number(extension.total_additional_amount) -
          extensionRentalAmount -
          extensionFuelTopUp,
      );

      // Claim the extension row first - this is the idempotency gate. A retried
      // webhook that finds it already `paid` returns before touching the booking
      // totals, the payment ledger, or the emails a second time.
      const { data: extensionStateChanged, error: extensionUpdateError } =
        await supabase
          .from("booking_extensions")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
          })
          .eq("id", extensionId)
          .eq("status", "approved")
          .select("id")
          .maybeSingle();

      if (extensionUpdateError) {
        console.error("Failed to mark extension as paid", extensionUpdateError);
        throw extensionUpdateError;
      }

      if (!extensionStateChanged) {
        await recordWebhookSecurityEvent("info", {
          reason: "Extension webhook payment row existed but extension state was already claimed",
          extension_id: extensionId,
          booking_id: extension.booking_id,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const { error: bookingUpdateError } = await supabase
        .from("bookings")
        .update({
          end_date: extension.requested_end_date,
          total_days: Number(booking.total_days) + Number(extension.extension_days),
          base_price: Number(booking.base_price) + extensionRentalAmount,
          commission: Number(booking.commission) + extensionCommission,
          total_price: Number(booking.total_price) + Number(extension.total_additional_amount),
        })
        .eq("id", extension.booking_id);

      if (bookingUpdateError) {
        console.error("Failed to update booking after extension payment", bookingUpdateError);
        throw bookingUpdateError;
      }

      // Record the extension payment against the now-updated booking. The
      // explicit split routes the extension rental + fuel top-up to the lister
      // payable and only the extension commission to the deferred-fee account -
      // the booking-wide ratio would smear the fuel reimbursement across
      // commission and fees.
      await insertCompletedPaymentIfMissing(supabase, {
        bookingId: extension.booking_id,
        amount: Number(extension.total_additional_amount),
        paymentType: "extension",
        paymentMethod: getPaymentMethodLabel(checkoutAttributes),
        transactionId: checkoutId,
        notes: buildPaymentNotes(
          "Automated extension payment via PayMongo webhook",
          paymongoPaymentMetadata,
        ),
        allocationOverride: {
          ownerPesos: extensionRentalAmount + extensionFuelTopUp,
          commissionPesos: extensionCommission,
          feePesos: 0,
        },
      }, new URL(req.url).origin);

      await supabase.from("audit_log").insert({
        action: "booking_extension_paid",
        entity_type: "booking_extension",
        entity_id: extensionId,
        details: {
          booking_id: extension.booking_id,
          amount: Number(extension.total_additional_amount),
          amount_in_centavos: paidAmountInCentavos,
          checkout_id: checkoutId,
          requested_end_date: extension.requested_end_date,
          extension_amount: extensionRentalAmount,
          extension_commission: extensionCommission,
          fuel_top_up_amount: extensionFuelTopUp,
          webhook: true,
        },
        user_id: extension.renter_id,
      });

      await supabase.from("notifications").insert([
        {
          user_id: extension.renter_id,
          title: "Extension Payment Confirmed",
          message: "Your extension payment was confirmed and the booking return date was updated.",
          type: "success",
          link: "/my-bookings",
        },
        {
          user_id: extension.owner_id,
          title: "Booking Extension Paid",
          message: "The renter paid the approved extension. The booking now reflects the updated return date.",
          type: "success",
          link: "/lister-bookings",
        },
      ]);

      await sendUserNotificationEmail(supabase, {
        userId: extension.owner_id,
        title: "Extension Payment Received",
        message:
          `The renter paid the approved ${Number(extension.extension_days)}-day extension for this booking. ` +
          "SafeDrive holds the payment - the added rental" +
          (extensionFuelTopUp > 0 ? " and fuel/charge reimbursement" : "") +
          " (minus the SafeDrive commission) is released to your payout method after the trip is completed, in the same payout as the rest of the booking.",
        link: "/lister-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `lister-extension:${extensionId}`,
      });

      await recordWebhookSecurityEvent("success", {
        event_id: event.id,
        event_type: event.attributes.type,
        extension_id: extensionId,
        booking_id: extension.booking_id,
        checkout_id: checkoutId,
        reference_number: referenceNumber,
        livemode,
        paid_amount_in_centavos: paidAmountInCentavos,
      });

      return new Response(
        JSON.stringify({ statusCode: 200, body: { message: "SUCCESS" } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (referenceNumber.startsWith("booking-full:")) {
      const [, bookingId] = referenceNumber.split(":");
      if (!bookingId) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Malformed full-payment booking reference",
          reference_number: referenceNumber,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response("OK", { status: 200 });
      }

      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(
          "id, status, renter_id, owner_id, total_price, downpayment_amount, balance_amount, paymongo_checkout_id",
        )
        .eq("id", bookingId)
        .single();

      if (bookingError || !booking) {
        console.error("Booking not found for full-payment webhook:", bookingId, bookingError);
        await recordWebhookSecurityEvent("failed", {
          reason: "Booking not found for full-payment webhook reference",
          booking_id: bookingId,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response("OK", { status: 200 });
      }

      const bookingRecord = booking as BookingRecord;
      const expectedAmountInCentavos = Math.round(Number(bookingRecord.total_price) * 100);

      if (bookingRecord.paymongo_checkout_id !== checkoutId) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Checkout ID mismatch for full payment",
          booking_id: bookingId,
          checkout_id: checkoutId,
          stored_checkout_id: bookingRecord.paymongo_checkout_id,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Checkout session does not match booking" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (paidAmountInCentavos !== expectedAmountInCentavos) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Paid amount does not match expected full payment",
          booking_id: bookingId,
          checkout_id: checkoutId,
          expected_amount_in_centavos: expectedAmountInCentavos,
          received_amount_in_centavos: paidAmountInCentavos,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Paid amount does not match booking amount" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (
        bookingRecord.status === "fully_paid" ||
        bookingRecord.status === "active" ||
        bookingRecord.status === "completed"
      ) {
        await recordWebhookSecurityEvent("info", {
          reason: "Duplicate or already-processed full-payment webhook event",
          booking_id: bookingId,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (
        bookingRecord.status !== "awaiting_payment" &&
        bookingRecord.status !== "confirmed"
      ) {
        await recordWebhookSecurityEvent("failed", {
          reason: "Booking not in payable state for full payment",
          booking_id: bookingId,
          checkout_id: checkoutId,
          booking_status: bookingRecord.status,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ error: "Booking is not awaiting a full payment" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      await insertCompletedPaymentIfMissing(supabase, {
        bookingId,
        amount: Number(bookingRecord.downpayment_amount),
        paymentType: "downpayment",
        paymentMethod: getPaymentMethodLabel(checkoutAttributes),
        transactionId: checkoutId,
        notes: buildPaymentNotes(
          "Captured as part of full booking payment via PayMongo webhook",
          paymongoPaymentMetadata,
        ),
      }, new URL(req.url).origin, false);

      const computedBalance = Math.max(
        0,
        Number(bookingRecord.total_price) - Number(bookingRecord.downpayment_amount),
      );
      const balanceAmount =
        Number.isFinite(Number(bookingRecord.balance_amount)) &&
        Number(bookingRecord.balance_amount) > 0
          ? Number(bookingRecord.balance_amount)
          : computedBalance;

      await insertCompletedPaymentIfMissing(supabase, {
        bookingId,
        amount: balanceAmount,
        paymentType: "balance",
        paymentMethod: getPaymentMethodLabel(checkoutAttributes),
        transactionId: checkoutId,
        notes: buildPaymentNotes(
          "Captured as part of full booking payment via PayMongo webhook",
          paymongoPaymentMetadata,
        ),
      }, new URL(req.url).origin, false);

      const { data: fullPaymentStateChanged, error: updateError } = await supabase
        .from("bookings")
        .update({ status: "fully_paid" })
        .eq("id", bookingId)
        .in("status", ["confirmed", "awaiting_payment"])
        .select("id")
        .maybeSingle();

      if (updateError) {
        console.error("Failed to update booking full-payment status", updateError);
        throw updateError;
      }

      if (!fullPaymentStateChanged) {
        await recordWebhookSecurityEvent("info", {
          reason: "Full-payment webhook payment rows existed but booking state was already claimed",
          booking_id: bookingId,
          checkout_id: checkoutId,
          event_id: event.id,
          livemode,
        });
        return new Response(
          JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const fullReceipt = await sendPaymentReceiptEmail(supabase, {
        bookingId,
        amount: Number(bookingRecord.downpayment_amount) + balanceAmount,
        paymentType: "full_payment",
        paymentMethod: getPaymentMethodLabel(checkoutAttributes),
        transactionId: checkoutId,
        baseOrigin: new URL(req.url).origin,
      });
      if (fullReceipt.state !== "sent" && fullReceipt.state !== "not_configured") {
        console.warn("Full payment receipt email was not delivered", {
          state: fullReceipt.state,
          bookingId,
        });
      }

      const { error: auditError } = await supabase.from("audit_log").insert({
        action: "full_payment_paid",
        entity_type: "booking",
        entity_id: bookingId,
        details: {
          amount: Number(bookingRecord.total_price),
          amount_in_centavos: paidAmountInCentavos,
          webhook: true,
          checkout_id: checkoutId,
        },
        user_id: bookingRecord.renter_id,
      });

      if (auditError) {
        console.error("Failed to write audit log for full payment", auditError);
      }

      await supabase.from("notifications").insert([
        {
          user_id: bookingRecord.renter_id,
          title: "Full Booking Payment Confirmed",
          message:
            "Your full booking payment was confirmed. No remaining balance is due before handoff.",
          type: "success",
          link: "/my-bookings",
        },
        {
          user_id: bookingRecord.owner_id,
          title: "Booking Fully Paid",
          message:
            "The renter settled the full booking amount. The trip can move to handoff once the schedule begins.",
          type: "success",
          link: "/lister-bookings",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: bookingRecord.owner_id,
        title: "Booking Fully Paid",
        message: `The renter paid this booking in full. SafeDrive holds the payment - your share (rental minus the SafeDrive commission) is released to your payout method after the trip is completed.`,
        link: "/lister-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `lister-fullpayment:${bookingId}`,
      });

      await recordWebhookSecurityEvent("success", {
        event_id: event.id,
        event_type: event.attributes.type,
        booking_id: bookingId,
        checkout_id: checkoutId,
        reference_number: referenceNumber,
        livemode,
        paid_amount_in_centavos: paidAmountInCentavos,
      });

      return new Response(
        JSON.stringify({ statusCode: 200, body: { message: "SUCCESS" } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const bookingId = referenceNumber;

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        "id, status, renter_id, owner_id, downpayment_amount, paymongo_checkout_id, start_date, pickup_time",
      )
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      console.error("Booking not found for webhook:", bookingId, bookingError);
      await recordWebhookSecurityEvent("failed", {
        reason: "Booking not found for webhook reference",
        booking_id: bookingId,
        checkout_id: checkoutId,
        event_id: event.id,
        livemode,
      });
      return new Response("OK", { status: 200 });
    }

    const bookingRecord = booking as BookingRecord;
    const expectedAmountInCentavos = Math.round(
      Number(bookingRecord.downpayment_amount) * 100,
    );

    if (bookingRecord.paymongo_checkout_id !== checkoutId) {
      await recordWebhookSecurityEvent("failed", {
        reason: "Checkout ID mismatch",
        booking_id: bookingId,
        checkout_id: checkoutId,
        stored_checkout_id: bookingRecord.paymongo_checkout_id,
        event_id: event.id,
        livemode,
      });
      return new Response(
        JSON.stringify({ error: "Checkout session does not match booking" }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (paidAmountInCentavos !== expectedAmountInCentavos) {
      await recordWebhookSecurityEvent("failed", {
        reason: "Paid amount does not match expected downpayment",
        booking_id: bookingId,
        checkout_id: checkoutId,
        expected_amount_in_centavos: expectedAmountInCentavos,
        received_amount_in_centavos: paidAmountInCentavos,
        event_id: event.id,
        livemode,
      });
      return new Response(
        JSON.stringify({ error: "Paid amount does not match booking amount" }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (
      bookingRecord.status === "downpayment_paid" ||
      bookingRecord.status === "active" ||
      bookingRecord.status === "fully_paid" ||
      bookingRecord.status === "completed"
    ) {
      await recordWebhookSecurityEvent("info", {
        reason: "Duplicate or already-processed webhook event",
        booking_id: bookingId,
        checkout_id: checkoutId,
        event_id: event.id,
        livemode,
      });
      return new Response(
        JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (
      bookingRecord.status !== "awaiting_payment" &&
      bookingRecord.status !== "confirmed"
    ) {
      await recordWebhookSecurityEvent("failed", {
        reason: "Booking not in payable state",
        booking_id: bookingId,
        checkout_id: checkoutId,
        booking_status: bookingRecord.status,
        event_id: event.id,
        livemode,
      });
      return new Response(
        JSON.stringify({ error: "Booking is not awaiting a downpayment" }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    await insertCompletedPaymentIfMissing(supabase, {
      bookingId,
      amount: Number(bookingRecord.downpayment_amount),
      paymentType: "downpayment",
      paymentMethod: getPaymentMethodLabel(checkoutAttributes),
      transactionId: checkoutId,
      notes: buildPaymentNotes(
        "Automated via PayMongo webhook",
        paymongoPaymentMetadata,
      ),
    }, new URL(req.url).origin);

    // CHAPTER 42: stamp when the remaining balance must be paid by, capped at
    // pickup so a booking created close to pickup gets whatever time is
    // actually left rather than a full window running past the trip start.
    const balanceDeadlineHours = await fetchBalanceDeadlineHours(supabase);
    const pickupMs = getBookingPickupMs(bookingRecord);
    const balanceDeadline = new Date(
      Math.min(
        Date.now() + balanceDeadlineHours * 60 * 60 * 1000,
        pickupMs ?? Date.now() + balanceDeadlineHours * 60 * 60 * 1000,
      ),
    ).toISOString();

    const { data: downpaymentStateChanged, error: updateError } = await supabase
      .from("bookings")
      .update({ status: "downpayment_paid", balance_deadline: balanceDeadline })
      .eq("id", bookingId)
      .in("status", ["confirmed", "awaiting_payment"])
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("Failed to update booking payment status", updateError);
      throw updateError;
    }

    if (!downpaymentStateChanged) {
      await recordWebhookSecurityEvent("info", {
        reason: "Downpayment webhook payment row existed but booking state was already claimed",
        booking_id: bookingId,
        checkout_id: checkoutId,
        event_id: event.id,
        livemode,
      });
      return new Response(
        JSON.stringify({ statusCode: 200, body: { message: "ALREADY_PROCESSED" } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const { error: auditError } = await supabase.from("audit_log").insert({
      action: "downpayment_paid",
      entity_type: "booking",
      entity_id: bookingId,
      details: {
        amount: Number(bookingRecord.downpayment_amount),
        amount_in_centavos: paidAmountInCentavos,
        webhook: true,
        checkout_id: checkoutId,
      },
      user_id: bookingRecord.renter_id,
    });

    if (auditError) {
      console.error("Failed to write audit log for downpayment", auditError);
    }

    await supabase.from("notifications").insert([
      {
        user_id: bookingRecord.renter_id,
        title: "Booking Successfully Reserved",
        message: "Your downpayment was confirmed. Your booking is now reserved in SafeDrive.",
        type: "success",
        link: "/my-bookings",
      },
      {
        user_id: bookingRecord.owner_id,
        title: "Booking Successfully Reserved",
        message: "The renter's downpayment was confirmed. The booking is now secured in SafeDrive.",
        type: "success",
        link: "/lister-bookings",
      },
    ]);
    await sendUserNotificationEmail(supabase, {
      userId: bookingRecord.owner_id,
      title: "Downpayment Received",
      message: `The renter's downpayment for this booking was confirmed by PayMongo. SafeDrive holds the payment - your share (the rental amount minus the SafeDrive commission) is released to your payout method after the trip is completed.`,
      link: "/lister-bookings",
      baseOrigin: new URL(req.url).origin,
      eventKey: `lister-downpayment:${bookingId}`,
    });

    await recordWebhookSecurityEvent("success", {
      event_id: event.id,
      event_type: event.attributes.type,
      booking_id: bookingId,
      checkout_id: checkoutId,
      livemode,
      paid_amount_in_centavos: paidAmountInCentavos,
    });

    return new Response(
      JSON.stringify({ statusCode: 200, body: { message: "SUCCESS" } }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown webhook error";
    console.error("Webhook Error:", message);
    return new Response("Webhook Error", { status: 500 });
  }
}
