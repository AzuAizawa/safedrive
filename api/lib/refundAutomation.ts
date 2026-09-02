import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";
import { postCompletedRefundToLedger } from "./ledger.js";
import { sendAdminAlertEmail, sendRefundReceiptEmail } from "./email.js";
import { isDemoMoneyMovementEnabled } from "./paymongoMode.js";

type PaymentRecord = {
  id: string;
  payment_type: string;
  status: string;
  amount: number;
  transaction_id: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
};

type BookingForRefund = {
  id: string;
  status: string;
  renter_id: string;
  owner_id: string;
  owner_completed: boolean;
  renter_completed: boolean;
  renter_arrived_at: string | null;
  lister_arrived_at: string | null;
  cars: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: { name: string };
    };
  };
  payments: PaymentRecord[];
};

type RefundOutcome =
  | { state: "skipped"; bookingId: string; reason: string }
  | {
      state: "pending";
      bookingId: string;
      refundPaymentIds: string[];
      refundIds: string[];
      reason?: string;
    }
  | {
      state: "completed";
      bookingId: string;
      refundPaymentIds: string[];
      refundIds: string[];
    }
  | {
      state: "failed";
      bookingId: string;
      refundPaymentIds: string[];
      refundIds: string[];
      reason: string;
    };

type RefundContext = {
  supabase: ServiceRoleSupabaseClient;
  bookingId: string;
  initiatedByUserId?: string | null;
  reason: "requested_by_customer" | "duplicate" | "fraudulent" | "others";
  note?: string | null;
  allowedPaymentTypes?: string[];
  // Required so a future caller cannot silently drop refund receipt emails.
  // Matches PayoutContext, where baseOrigin is also mandatory.
  baseOrigin: string;
};

type RefundGroup = {
  paymentId: string | null;
  checkoutSessionId: string | null;
  amount: number;
  paymentTypes: string[];
  sourceTransactionIds: string[];
};

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

const PAYMONGO_NOTES_LIMIT = 200;

const getPayMongoSecretKey = () => process.env.PAYMONGO_SECRET_KEY;

const getVehicleLabel = (booking: BookingForRefund) =>
  `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`;

const getAuthToken = (secretKey: string) => `Basic ${btoa(`${secretKey}:`)}`;

const limitPayMongoNotes = (value: string) => {
  if (value.length <= PAYMONGO_NOTES_LIMIT) return value;
  return `${value.slice(0, PAYMONGO_NOTES_LIMIT - 3)}...`;
};

const getAppRefundStatus = (status: string | null | undefined) => {
  const normalized = status?.trim().toLowerCase() ?? "pending";
  if (["succeeded", "completed"].includes(normalized)) return "completed";
  if (["failed", "cancelled", "canceled"].includes(normalized)) return "failed";
  return "pending";
};

const extractPayMongoPaymentId = (payment: PaymentRecord) => {
  if (payment.transaction_id?.startsWith("pay_")) {
    return payment.transaction_id;
  }

  const match = payment.notes?.match(/PayMongo payment ID:\s*(pay_[A-Za-z0-9]+)/i);
  return match?.[1] ?? null;
};

const insertAudit = async (
  supabase: ServiceRoleSupabaseClient,
  initiatedByUserId: string | null | undefined,
  action: string,
  booking: BookingForRefund,
  details: Record<string, unknown>,
) => {
  await supabase.from("audit_log").insert({
    user_id: initiatedByUserId ?? null,
    action,
    entity_type: "booking",
    entity_id: booking.id,
    details,
  });
};

const notifyBookingUsers = async (
  supabase: ServiceRoleSupabaseClient,
  booking: BookingForRefund,
  renterTitle: string,
  renterMessage: string,
  ownerTitle: string,
  ownerMessage: string,
  type: "success" | "info" | "error" = "info",
) => {
  await supabase.from("notifications").insert([
    {
      user_id: booking.renter_id,
      title: renterTitle,
      message: renterMessage,
      type,
      link: "/my-bookings",
    },
    {
      user_id: booking.owner_id,
      title: ownerTitle,
      message: ownerMessage,
      type,
      link: "/lister-bookings",
    },
  ]);
};

const createRefundRecord = async (
  supabase: ServiceRoleSupabaseClient,
  bookingId: string,
  amount: number,
  paymentMethod: string | null,
  refundId: string | null,
  status: string,
  notes: string,
) => {
  const { data, error } = await supabase
    .from("payments")
    .insert({
      booking_id: bookingId,
      amount: -Math.abs(amount),
      payment_type: "refund",
      status,
      payment_method: paymentMethod,
      transaction_id: refundId,
      notes: limitPayMongoNotes(notes),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to create refund payment record");
  }

  return data.id as string;
};

const createRefund = async (
  secretKey: string,
  payload: {
    paymentId: string;
    amountInCentavos: number;
    reason: RefundContext["reason"];
    notes: string;
  },
) => {
  const res = await fetch("https://api.paymongo.com/v1/refunds", {
    method: "POST",
    headers: {
      ...jsonHeaders,
      Authorization: getAuthToken(secretKey),
    },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: payload.amountInCentavos,
          payment_id: payload.paymentId,
          reason: payload.reason,
          notes: limitPayMongoNotes(payload.notes),
        },
      },
    }),
  });

  const body = (await res.json().catch(async () => ({ raw: await res.text() }))) as {
    data?: {
      id?: string;
      attributes?: {
        status?: string;
        payment_id?: string;
      };
    };
    errors?: unknown;
    raw?: string;
  };

  if (!res.ok) {
    const errorText = JSON.stringify(body);
    if (
      errorText.includes("parameter_above_maximum") &&
      errorText.includes("notes")
    ) {
      throw new Error(
        "PayMongo rejected the refund note length. SafeDrive shortened the note, so redeploy the latest build and try again.",
      );
    }
    throw new Error(`PayMongo refund failed: ${errorText}`);
  }

  return body;
};

const retrieveCheckoutPaymentId = async (
  secretKey: string,
  checkoutSessionId: string,
) => {
  const res = await fetch(
    `https://api.paymongo.com/v1/checkout_sessions/${checkoutSessionId}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: getAuthToken(secretKey),
      },
    },
  );

  const body = (await res.json().catch(async () => ({ raw: await res.text() }))) as {
    data?: {
      attributes?: Record<string, unknown>;
    };
    errors?: unknown;
    raw?: string;
  };

  if (!res.ok) {
    throw new Error(`PayMongo checkout lookup failed: ${JSON.stringify(body)}`);
  }

  const attributes =
    body.data?.attributes && typeof body.data.attributes === "object"
      ? (body.data.attributes as Record<string, unknown>)
      : null;
  const payments = Array.isArray(attributes?.payments) ? attributes.payments : [];

  for (const payment of payments) {
    if (!payment || typeof payment !== "object") continue;
    const record = payment as Record<string, unknown>;
    if (typeof record.id === "string" && record.id.startsWith("pay_")) {
      return record.id;
    }

    const nestedAttributes =
      record.attributes && typeof record.attributes === "object"
        ? (record.attributes as Record<string, unknown>)
        : null;

    if (typeof nestedAttributes?.id === "string" && nestedAttributes.id.startsWith("pay_")) {
      return nestedAttributes.id;
    }
  }

  return null;
};

const buildRefundGroups = (
  booking: BookingForRefund,
  allowedPaymentTypes: string[],
) => {
  const completedPayout = booking.payments.find(
    (payment) => payment.payment_type === "payout" && payment.status === "completed",
  );
  if (completedPayout) {
    return {
      groups: [] as RefundGroup[],
      blocker: "Payout was already released for this booking.",
    };
  }

  const alreadyRefundedTransactionIds = new Set(
    booking.payments
      .filter((payment) => payment.payment_type === "refund" && payment.notes)
      .flatMap((payment) => {
        const matches =
          payment.notes?.match(/Source transaction IDs:\s*([^.;\n]+)/i)?.[1] ?? "";
        return matches
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
      }),
  );

  const pendingProviderRefund = booking.payments.find(
    (payment) =>
      payment.payment_type === "refund" &&
      payment.status === "pending" &&
      Boolean(payment.transaction_id),
  );
  if (pendingProviderRefund) {
    return {
      groups: [] as RefundGroup[],
      blocker: "A PayMongo refund is already pending for this booking.",
    };
  }

  const groups = new Map<string, RefundGroup>();

  booking.payments
    .filter(
      (payment) =>
        allowedPaymentTypes.includes(payment.payment_type) &&
        payment.status === "completed" &&
        Number(payment.amount) > 0,
    )
    .forEach((payment) => {
      const paymentId = extractPayMongoPaymentId(payment);
      const checkoutSessionId =
        payment.transaction_id?.startsWith("cs_") ? payment.transaction_id : null;

      if (!paymentId && !checkoutSessionId) return;
      if (alreadyRefundedTransactionIds.has(payment.transaction_id ?? payment.id)) return;

      const key = paymentId ?? checkoutSessionId ?? payment.id;
      const existing = groups.get(key);
      if (existing) {
        existing.amount += Number(payment.amount);
        existing.paymentTypes.push(payment.payment_type);
        existing.sourceTransactionIds.push(payment.transaction_id ?? payment.id);
        return;
      }

      groups.set(key, {
        paymentId,
        checkoutSessionId,
        amount: Number(payment.amount),
        paymentTypes: [payment.payment_type],
        sourceTransactionIds: [payment.transaction_id ?? payment.id],
      });
    });

  return { groups: [...groups.values()], blocker: null as string | null };
};

export const processAutomaticRefundForBooking = async ({
  supabase,
  bookingId,
  initiatedByUserId,
  reason,
  note,
  allowedPaymentTypes = ["downpayment", "balance", "extension"],
  baseOrigin,
}: RefundContext): Promise<RefundOutcome> => {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      `
      id,
      status,
      renter_id,
      owner_id,
      owner_completed,
      renter_completed,
      renter_arrived_at,
      lister_arrived_at,
      cars(plate_number, car_models(name, car_brands(name))),
      payments(*)
    `,
    )
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    throw bookingError ?? new Error("Booking not found for refund processing");
  }

  const refundBooking = booking as unknown as BookingForRefund;
  const secretKey = getPayMongoSecretKey();

  const alertRefundNeedsReview = (detail: string) =>
    sendAdminAlertEmail(supabase, {
      subject: "Renter refund needs manual review",
      message: `An automatic refund for ${getVehicleLabel(refundBooking)} could not complete: ${detail}. No money moved. Open Financial Reviews -> Renter refunds to confirm the provider result and record it.`,
      link: "/admin/financial-reviews?view=refunds",
      baseOrigin,
      eventKey: `refund-failed:${bookingId}`,
    }).catch(() => undefined);

  if (!secretKey) {
    return {
      state: "skipped",
      bookingId,
      reason: "PayMongo refund environment is not configured.",
    };
  }

  const { groups, blocker } = buildRefundGroups(refundBooking, allowedPaymentTypes);
  if (blocker) {
    return { state: "skipped", bookingId, reason: blocker };
  }

  if (!groups.length) {
    return {
      state: "skipped",
      bookingId,
      reason: "No refundable PayMongo payment records were found for this booking.",
    };
  }

  // Demo money-movement mode: record the refund (row + ledger + email) without
  // calling PayMongo. Test key only; a live key falls through to the real path.
  if (isDemoMoneyMovementEnabled(secretKey)) {
    const demoRefundPaymentIds: string[] = [];
    const demoRefundIds: string[] = [];
    const demoCompleted: Array<{ refundId: string; amount: number }> = [];
    for (const group of groups) {
      const sandboxRefundId = `sandbox_refund_${bookingId.slice(0, 8)}_${Date.now()}_${demoRefundIds.length}`;
      const notes = limitPayMongoNotes(
        [
          "Demo refund - no PayMongo transfer.",
          `Source transaction IDs: ${group.sourceTransactionIds.join(", ")};`,
          `SafeDrive refund for ${getVehicleLabel(refundBooking)}.`,
          note ?? null,
          `Types: ${group.paymentTypes.join(", ")}.`,
        ]
          .filter(Boolean)
          .join(" "),
      );
      const refundPaymentId = await createRefundRecord(
        supabase,
        refundBooking.id,
        group.amount,
        "demo",
        sandboxRefundId,
        "completed",
        notes,
      );
      demoRefundPaymentIds.push(refundPaymentId);
      demoRefundIds.push(sandboxRefundId);
      await postCompletedRefundToLedger(supabase, {
        bookingId: refundBooking.id,
        amount: group.amount,
        refundId: sandboxRefundId,
        actorId: initiatedByUserId,
      });
      demoCompleted.push({ refundId: sandboxRefundId, amount: group.amount });
    }

    await insertAudit(supabase, initiatedByUserId, "booking_refund_completed_auto", refundBooking, {
      reason,
      refund_ids: demoRefundIds,
      refund_payment_ids: demoRefundPaymentIds,
      mode: "demo",
    });
    await notifyBookingUsers(
      supabase,
      refundBooking,
      "Refund Completed",
      `Your refund for ${getVehicleLabel(refundBooking)} was recorded. This build runs in demo mode, so no real PayMongo transfer was sent.`,
      "Booking Refund Completed",
      `The renter refund for ${getVehicleLabel(refundBooking)} was recorded in demo mode.`,
      "success",
    );
    for (const completedRefund of demoCompleted) {
      const receipt = await sendRefundReceiptEmail(supabase, {
        bookingId: refundBooking.id,
        amount: completedRefund.amount,
        refundId: completedRefund.refundId,
        refundMethod: "Demo refund (no real transfer)",
        baseOrigin,
      });
      if (receipt.state !== "sent" && receipt.state !== "not_configured") {
        console.warn("Demo refund receipt email was not delivered", {
          state: receipt.state,
          bookingId: refundBooking.id,
        });
      }
    }
    return { state: "completed", bookingId, refundPaymentIds: demoRefundPaymentIds, refundIds: demoRefundIds };
  }

  const refundPaymentIds: string[] = [];
  const refundIds: string[] = [];
  const completedRefunds: Array<{ refundId: string; amount: number }> = [];
  let pendingSeen = false;
  let failedSeen = false;
  const failureNotes: string[] = [];

  for (const group of groups) {
    let resolvedPaymentId = group.paymentId;

    if (!resolvedPaymentId && group.checkoutSessionId) {
      try {
        resolvedPaymentId = await retrieveCheckoutPaymentId(
          secretKey,
          group.checkoutSessionId,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown checkout lookup error";

        await insertAudit(
          supabase,
          initiatedByUserId,
          "booking_refund_failed_auto",
          refundBooking,
          {
            reason,
            checkout_session_id: group.checkoutSessionId,
            source_transaction_ids: group.sourceTransactionIds,
            error: message,
          },
        );

        await alertRefundNeedsReview(message);
        return {
          state: "failed",
          bookingId,
          refundPaymentIds,
          refundIds,
          reason: message,
        };
      }
    }

    if (!resolvedPaymentId) {
      return {
        state: "skipped",
        bookingId,
        reason:
          "SafeDrive could not resolve the original PayMongo payment ID for this booking refund.",
      };
    }

    const notes = limitPayMongoNotes(
      [
        `Source transaction IDs: ${group.sourceTransactionIds.join(", ")};`,
        `SafeDrive refund for ${getVehicleLabel(refundBooking)}.`,
        note ?? null,
        `PayMongo payment: ${resolvedPaymentId}.`,
        `Types: ${group.paymentTypes.join(", ")}.`,
        group.checkoutSessionId ? `Checkout: ${group.checkoutSessionId}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );

    try {
      const refund = await createRefund(secretKey, {
        paymentId: resolvedPaymentId,
        amountInCentavos: Math.round(group.amount * 100),
        reason,
        notes,
      });

      const refundId = refund.data?.id ?? null;
      const refundStatus = refund.data?.attributes?.status ?? "pending";
      const appRefundStatus = getAppRefundStatus(refundStatus);
      const refundPaymentId = await createRefundRecord(
        supabase,
        refundBooking.id,
        group.amount,
        "paymongo",
        refundId,
        appRefundStatus,
        notes,
      );

      refundPaymentIds.push(refundPaymentId);
      if (refundId) refundIds.push(refundId);
      if (appRefundStatus === "pending") {
        pendingSeen = true;
      }
      if (appRefundStatus === "failed") {
        failedSeen = true;
        failureNotes.push(`PayMongo returned refund status ${refundStatus}.`);
      }
      if (appRefundStatus === "completed" && refundId) {
        await postCompletedRefundToLedger(supabase, {
          bookingId: refundBooking.id,
          amount: group.amount,
          refundId,
          actorId: initiatedByUserId,
        });
        completedRefunds.push({ refundId, amount: group.amount });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown PayMongo refund error";

      await insertAudit(
        supabase,
        initiatedByUserId,
        "booking_refund_failed_auto",
        refundBooking,
        {
          reason,
          source_payment_id: resolvedPaymentId,
          checkout_session_id: group.checkoutSessionId,
          source_transaction_ids: group.sourceTransactionIds,
          error: message,
        },
      );

      await alertRefundNeedsReview(message);
      return {
        state: "failed",
        bookingId,
        refundPaymentIds,
        refundIds,
        reason: message,
      };
    }
  }

  await insertAudit(
    supabase,
    initiatedByUserId,
    failedSeen
      ? "booking_refund_failed_auto"
      : pendingSeen
        ? "booking_refund_requested_auto"
        : "booking_refund_completed_auto",
    refundBooking,
    {
      reason,
      refund_ids: refundIds,
      refund_payment_ids: refundPaymentIds,
      mode: failedSeen ? "failed" : pendingSeen ? "pending" : "completed",
      failures: failureNotes,
    },
  );

  if (failedSeen) {
    const detail = failureNotes.join(" ") || "PayMongo reported refund failure.";
    await alertRefundNeedsReview(detail);
    return {
      state: "failed",
      bookingId,
      refundPaymentIds,
      refundIds,
      reason: detail,
    };
  }

  await notifyBookingUsers(
    supabase,
    refundBooking,
    pendingSeen ? "Refund In Progress" : "Refund Completed",
    pendingSeen
      ? `Your refund for ${getVehicleLabel(refundBooking)} is being processed by PayMongo.`
      : `Your refund for ${getVehicleLabel(refundBooking)} was completed.`,
    pendingSeen ? "Booking Refund Started" : "Booking Refund Completed",
    pendingSeen
      ? `A refund tied to ${getVehicleLabel(refundBooking)} is now in progress.`
      : `The renter refund for ${getVehicleLabel(refundBooking)} was completed.`,
    pendingSeen ? "info" : "success",
  );

  if (!pendingSeen && completedRefunds.length > 0) {
    for (const completedRefund of completedRefunds) {
      const receipt = await sendRefundReceiptEmail(supabase, {
        bookingId: refundBooking.id,
        amount: completedRefund.amount,
        refundId: completedRefund.refundId,
        refundMethod: "PayMongo",
        baseOrigin,
      });
      if (receipt.state !== "sent" && receipt.state !== "not_configured") {
        console.warn("Automatic refund receipt email was not delivered", {
          state: receipt.state,
          bookingId: refundBooking.id,
        });
      }
    }
  }

  return pendingSeen
    ? {
        state: "pending",
        bookingId,
        refundPaymentIds,
        refundIds,
        reason: "PayMongo accepted the refund and is still finalizing it.",
      }
    : {
        state: "completed",
        bookingId,
        refundPaymentIds,
        refundIds,
      };
};
