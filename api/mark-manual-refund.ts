import { createSupabaseAdmin } from "./lib/payoutAutomation.js";
import { sendRefundReceiptEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type ManualRefundPayload = {
  paymentId?: string;
  refundMethod?: string;
  referenceNumber?: string;
  note?: string | null;
};

type RefundPaymentRecord = {
  id: string;
  booking_id: string;
  amount: number;
  payment_type: string;
  status: string;
  payment_method: string | null;
  transaction_id: string | null;
  bookings: {
    id: string;
    renter_id: string;
    cars: {
      plate_number: string;
      car_models: {
        name: string;
        car_brands: { name: string };
      };
    };
  };
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

const normalizeRefundMethod = (value: string | undefined | null) => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "gcash") return "GCash";
  if (normalized === "maya") return "Maya";
  return null;
};

const getVehicleLabel = (payment: RefundPaymentRecord) =>
  `${payment.bookings.cars.car_models.car_brands.name} ${payment.bookings.cars.car_models.name} (${payment.bookings.cars.plate_number})`;

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const payload = (await req.json().catch(() => ({}))) as ManualRefundPayload;
    const paymentId = payload.paymentId?.trim();
    const refundMethod = normalizeRefundMethod(payload.refundMethod);
    const referenceNumber = payload.referenceNumber?.trim();
    const note = payload.note?.trim() || null;

    if (!paymentId || !refundMethod || !referenceNumber) {
      return jsonResponse(
        {
          error:
            "Refund payment, GCash/Maya return method, and reference number are required.",
        },
        400,
      );
    }

    const supabase = createSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: requesterProfile, error: requesterError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (requesterError || requesterProfile?.role !== "super_admin") {
      return jsonResponse(
        { error: "Only a super admin can mark refunds as released." },
        403,
      );
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select(
        `
        id,
        booking_id,
        amount,
        payment_type,
        status,
        payment_method,
        transaction_id,
        bookings(
          id,
          renter_id,
          cars(plate_number, car_models(name, car_brands(name)))
        )
      `,
      )
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      return jsonResponse({ error: "Refund payment record not found." }, 404);
    }

    const refundPayment = payment as unknown as RefundPaymentRecord;

    if (refundPayment.payment_type !== "refund") {
      return jsonResponse({ error: "Selected payment is not a refund." }, 422);
    }

    if (refundPayment.status === "completed") {
      return jsonResponse({ error: "This refund is already completed." }, 409);
    }

    const providerRefundStillPending =
      refundPayment.status === "pending" &&
      refundPayment.payment_method?.toLowerCase() === "paymongo" &&
      Boolean(refundPayment.transaction_id);

    if (providerRefundStillPending) {
      return jsonResponse(
        {
          error:
            "A PayMongo refund is already pending. Wait for provider confirmation or retry only after it fails before using manual fallback.",
        },
        409,
      );
    }

    const notes = [
      `Refund released by super admin through ${refundMethod}.`,
      note,
    ]
      .filter(Boolean)
      .join(" ");

    let releaseRefundQuery = supabase
      .from("payments")
      .update({
        status: "completed",
        payment_method: refundMethod,
        transaction_id: referenceNumber,
        notes,
      })
      .eq("id", refundPayment.id)
      .eq("payment_type", "refund")
      .eq("status", refundPayment.status);

    releaseRefundQuery = refundPayment.payment_method
      ? releaseRefundQuery.eq("payment_method", refundPayment.payment_method)
      : releaseRefundQuery.is("payment_method", null);

    releaseRefundQuery = refundPayment.transaction_id
      ? releaseRefundQuery.eq("transaction_id", refundPayment.transaction_id)
      : releaseRefundQuery.is("transaction_id", null);

    const { data: manualRefundStateChanged, error: updateError } =
      await releaseRefundQuery.select("id").maybeSingle();

    if (updateError) throw updateError;

    if (!manualRefundStateChanged) {
      return jsonResponse(
        {
          error:
            "This refund changed state before it could be marked released. Please refresh and try again.",
        },
        409,
      );
    }

    await supabase
      .from("support_tickets")
      .update({ status: "closed" })
      .eq("booking_id", refundPayment.booking_id)
      .eq("tag", "manual_refund");

    await supabase.from("notifications").insert({
      user_id: refundPayment.bookings.renter_id,
      title: "Refund Released",
      message: `Your SafeDrive refund for ${getVehicleLabel(refundPayment)} was marked released through ${refundMethod}. Reference: ${referenceNumber}.`,
      type: "success",
      link: "/my-bookings",
    });

    const receipt = await sendRefundReceiptEmail(supabase, {
      bookingId: refundPayment.booking_id,
      amount: Math.abs(Number(refundPayment.amount)),
      refundId: referenceNumber,
      refundMethod,
      baseOrigin: new URL(req.url).origin,
    });
    if (receipt.state !== "sent" && receipt.state !== "not_configured") {
      console.warn("Manual refund receipt email was not delivered", {
        state: receipt.state,
        bookingId: refundPayment.booking_id,
      });
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "refund_marked_manual",
      entity_type: "payment",
      entity_id: refundPayment.id,
      details: {
        amount: Math.abs(Number(refundPayment.amount)),
        refund_method: refundMethod,
        reference_number: referenceNumber,
        booking_id: refundPayment.booking_id,
        mode: "manual",
      },
    });

    return jsonResponse({
      success: true,
      state: "completed",
      paymentId: refundPayment.id,
      transactionId: referenceNumber,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected manual refund error",
      },
      500,
    );
  }
}
