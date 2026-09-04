import { addDays } from "date-fns";
import { createClient } from "@supabase/supabase-js";
import { processAutomaticRefundForBooking } from "./lib/refundAutomation.js";
import { runBookingCompletionSideEffects } from "./lib/bookingCompletion.js";
import { sendUserNotificationEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type BookingAction =
  | "accept"
  | "reject"
  | "cancel"
  | "arrive"
  | "complete";

type BookingActionPayload = {
  bookingId?: string;
  action?: BookingAction;
  arrivalPhotoUrl?: string | null;
  arrivalLocation?: {
    latitude?: number;
    longitude?: number;
    accuracyMeters?: number | null;
    capturedAt?: string | null;
  } | null;
  note?: string | null;
  // Set by the lister "take car offline" flow when the reason is stolen /
  // damaged and an incident case is open: the cancellation is still recorded
  // but excluded from the completion rate and the auto-pause strike count.
  waiveStrike?: boolean;
};

type BookingRecord = {
  id: string;
  renter_id: string;
  owner_id: string;
  car_id: string;
  status: string;
  start_date: string;
  pickup_time: string | null;
  commission: number | string;
  total_price: number | string;
  refund_full_hours_snapshot: number | string | null;
  refund_late_renter_percent_snapshot: number | string | null;
  owner_response_deadline: string | null;
  renter_completed: boolean;
  owner_completed: boolean;
  renter_arrived_at: string | null;
  lister_arrived_at: string | null;
  payments: Array<{
    id: string;
    payment_type: string;
    status: string;
    amount: number;
    transaction_id: string | null;
    payment_method: string | null;
    notes: string | null;
    created_at: string;
  }>;
  cars: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: {
        name: string;
      };
    };
  } | null;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin environment variables");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

const getVehicleLabel = (booking: BookingRecord) => {
  if (!booking.cars) return `Booking ${booking.id}`;
  return `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`;
};

const isOwner = (booking: BookingRecord, userId: string) =>
  booking.owner_id === userId;

const isRenter = (booking: BookingRecord, userId: string) =>
  booking.renter_id === userId;

const REQUIRED_TRIP_PHOTO_CATEGORIES = [
  "front",
  "back",
  "odometer",
  "fuel_or_battery",
] as const;

const hasRequiredTripPhotos = (report: {
  trip_condition_photos?: Array<{ category: string }> | null;
  evidence_waived?: boolean | null;
}) => {
  if (report.evidence_waived) return true;
  const categories = new Set(
    (report.trip_condition_photos ?? []).map((photo) => photo.category),
  );
  return REQUIRED_TRIP_PHOTO_CATEGORIES.every((category) => categories.has(category));
};
const REFUNDABLE_BOOKING_PAYMENT_TYPES = ["downpayment", "balance"];

const normalizeArrivalLocation = (
  value: BookingActionPayload["arrivalLocation"],
) => {
  if (!value) return null;

  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const accuracyMeters =
    value.accuracyMeters === null || value.accuracyMeters === undefined
      ? null
      : Number(value.accuracyMeters);
  const capturedAt = value.capturedAt ? new Date(value.capturedAt) : new Date();

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
    accuracyMeters:
      accuracyMeters !== null && Number.isFinite(accuracyMeters)
        ? Math.max(0, Math.round(accuracyMeters))
        : null,
    capturedAt: Number.isNaN(capturedAt.getTime())
      ? new Date().toISOString()
      : capturedAt.toISOString(),
  };
};

const getFirstCapturedBookingPaymentAt = (booking: BookingRecord) => {
  const timestamps = booking.payments
    .filter(
      (payment) =>
        REFUNDABLE_BOOKING_PAYMENT_TYPES.includes(payment.payment_type) &&
        payment.status === "completed" &&
        Number(payment.amount) > 0,
    )
    .map((payment) => new Date(payment.created_at).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  return timestamps.length ? timestamps[0] : null;
};

const getCapturedBookingPaymentTotal = (booking: BookingRecord) =>
  booking.payments
    .filter(
      (payment) =>
        REFUNDABLE_BOOKING_PAYMENT_TYPES.includes(payment.payment_type) &&
        payment.status === "completed" &&
        Number(payment.amount) > 0,
    )
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);

const DEFAULT_REFUND_FULL_HOURS = 24;
const DEFAULT_REFUND_LATE_RENTER_PERCENT = 50;

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
};

const DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS = 3;

// Live (never snapshotted) - how early before pickup the arrival check-in opens.
const fetchArrivalCheckinLeadHours = async (
  supabase: ReturnType<typeof getSupabaseAdmin>,
) => {
  const { data } = await supabase
    .from("platform_settings")
    .select("arrival_checkin_lead_hours")
    .eq("id", "default")
    .maybeSingle();
  return Math.round(
    clampNumber(data?.arrival_checkin_lead_hours, 0, 48, DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS),
  );
};

const formatManilaStamp = (ms: number) =>
  new Date(ms).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const getBookingPickupMs = (booking: BookingRecord) => {
  const [year, month, day] = (booking.start_date || "")
    .split("-")
    .map((part) => Number(part));
  const [hour, minute] = (booking.pickup_time || "09:00")
    .split(":")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  // start_date is a plain calendar date; treat pickup as Manila local time.
  const asUtc = Date.UTC(year, month - 1, day, hour || 0, minute || 0);
  return asUtc - 8 * 60 * 60 * 1000;
};

/**
 * Cancellation-refund policy (Terms 6.1/6.2, values snapshot per booking):
 * cancelling >= refund_full_hours before pickup earns an automatic full refund;
 * inside that window the renter's share is refund_late_renter_percent and the
 * rest is short-notice lister compensation, released through admin review.
 */
const getCancellationRefundPlan = (booking: BookingRecord) => {
  const capturedTotal = getCapturedBookingPaymentTotal(booking);
  const fullHours = Math.round(
    clampNumber(
      booking.refund_full_hours_snapshot,
      0,
      720,
      DEFAULT_REFUND_FULL_HOURS,
    ),
  );
  const lateRenterPercent = clampNumber(
    booking.refund_late_renter_percent_snapshot,
    0,
    100,
    DEFAULT_REFUND_LATE_RENTER_PERCENT,
  );
  const pickupMs = getBookingPickupMs(booking);
  const hoursToPickup =
    pickupMs === null ? null : (pickupMs - Date.now()) / (60 * 60 * 1000);
  const isLate = hoursToPickup !== null && hoursToPickup < fullHours;
  const pastPickup = hoursToPickup !== null && hoursToPickup <= 0;

  const recommendedRenterRefund = !isLate
    ? capturedTotal
    : pastPickup
      ? 0
      : Math.round(capturedTotal * (lateRenterPercent / 100) * 100) / 100;

  return {
    capturedTotal,
    fullHours,
    lateRenterPercent,
    hoursToPickup,
    isLate,
    pastPickup,
    recommendedRenterRefund,
    listerCompensation:
      Math.round((capturedTotal - recommendedRenterRefund) * 100) / 100,
  };
};

const createManualRefundReview = async (
  supabase: ReturnType<typeof getSupabaseAdmin>,
  booking: BookingRecord,
  userId: string,
  manualDestinationNote: string | null,
  automaticFailureReason: string,
  recommendedRefundAmount?: number,
) => {
  const capturedTotal = getCapturedBookingPaymentTotal(booking);
  if (!Number.isFinite(capturedTotal) || capturedTotal <= 0) {
    throw new Error(
      "Manual refund review cannot be created without a captured refundable amount.",
    );
  }
  const hasRecommendation =
    typeof recommendedRefundAmount === "number" &&
    Number.isFinite(recommendedRefundAmount) &&
    recommendedRefundAmount >= 0 &&
    recommendedRefundAmount <= capturedTotal;
  const refundAmount = hasRecommendation ? recommendedRefundAmount : capturedTotal;

  const safeDestinationNote =
    manualDestinationNote ||
    "Admin must choose and record the manual refund return method during refund review.";
  const note = [
    "Manual refund review required.",
    hasRecommendation
      ? `Policy recommendation: refund PHP ${refundAmount.toLocaleString()} of PHP ${capturedTotal.toLocaleString()} captured (short-notice cancellation). Admin confirms or adjusts.`
      : null,
    safeDestinationNote,
    `Automatic refund result: ${automaticFailureReason}`,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 450);

  const { data: existingRefundPayment, error: existingRefundPaymentError } =
    await supabase
      .from("payments")
      .select("id")
      .eq("booking_id", booking.id)
      .eq("payment_type", "refund")
      .eq("status", "pending")
      .eq("payment_method", "manual_review")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (existingRefundPaymentError) throw existingRefundPaymentError;

  let refundPaymentId = existingRefundPayment?.id as string | undefined;

  if (!refundPaymentId) {
    const { data: refundPayment, error: refundPaymentError } = await supabase
      .from("payments")
      .insert({
        booking_id: booking.id,
        amount: -Math.abs(refundAmount),
        payment_type: "refund",
        status: "pending",
        payment_method: "manual_review",
        transaction_id: null,
        notes: note,
      })
      .select("id")
      .single();

    if (refundPaymentError) throw refundPaymentError;
    refundPaymentId = refundPayment?.id as string | undefined;
  }

  const { data: existingTicket, error: existingTicketError } = await supabase
    .from("support_tickets")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("tag", "manual_refund")
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingTicketError) throw existingTicketError;

  const reusedExistingTicket = Boolean(existingTicket?.id);
  const { data: ticket, error: ticketError } = reusedExistingTicket
    ? { data: existingTicket, error: null }
    : await supabase
        .from("support_tickets")
        .insert({
          user_id: userId,
          subject: `Manual refund review: ${getVehicleLabel(booking)}`,
          tag: "manual_refund",
          booking_id: booking.id,
          status: "open",
        })
        .select("id")
        .single();

  if (ticketError) throw ticketError;

  if (ticket?.id && !reusedExistingTicket) {
    await supabase.from("ticket_messages").insert({
      ticket_id: ticket.id,
      sender_id: userId,
      message: note,
    });
  }

  return refundPaymentId;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const payload = (await req.json()) as BookingActionPayload;
    if (!payload.bookingId || !payload.action) {
      return jsonResponse(
        { error: "Booking ID and action are required" },
        400,
      );
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        `
        id,
        renter_id,
        owner_id,
        car_id,
        status,
        start_date,
        pickup_time,
        commission,
        total_price,
        refund_full_hours_snapshot,
        refund_late_renter_percent_snapshot,
        owner_response_deadline,
        renter_completed,
        owner_completed,
        renter_arrived_at,
        lister_arrived_at,
        payments (
          id,
          payment_type,
          status,
          amount,
          transaction_id,
          payment_method,
          notes,
          created_at
        ),
        cars (
          plate_number,
          car_models (
            name,
            car_brands (name)
          )
        )
      `,
      )
      .eq("id", payload.bookingId)
      .single();

    if (bookingError || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    const bookingRecord = booking as unknown as BookingRecord;
    const owner = isOwner(bookingRecord, user.id);
    const renter = isRenter(bookingRecord, user.id);

    if (!owner && !renter) {
      return jsonResponse(
        { error: "You are not allowed to modify this booking" },
        403,
      );
    }

    const auditDetails: Record<string, unknown> = {};
    const actionNote = payload.note?.trim() || null;
    let nextStatus = bookingRecord.status;

    if (payload.action === "accept") {
      if (!owner) {
        return jsonResponse(
          { error: "Only the lister can accept this booking" },
          403,
        );
      }
      if (bookingRecord.status !== "pending") {
        return jsonResponse(
          { error: "Only pending bookings can be accepted" },
          409,
        );
      }

      if (
        bookingRecord.owner_response_deadline &&
        new Date(bookingRecord.owner_response_deadline).getTime() <= Date.now()
      ) {
        const { error: expiryError } = await supabase
          .from("bookings")
          .update({ status: "rejected", owner_response_deadline: null })
          .eq("id", bookingRecord.id)
          .eq("status", "pending")
          .lte("owner_response_deadline", new Date().toISOString());

        if (expiryError) throw expiryError;

        return jsonResponse(
          {
            error:
              "The 24-hour response window has passed. This booking request was released automatically.",
          },
          409,
        );
      }

      nextStatus = "confirmed";
      // 24 hours to pay the reservation, but never past the trip's pickup time
      // so a next-day booking that stalls is auto-cancelled instead of blocking
      // the car. Matches the owner-response cap in api/create-booking.ts.
      const [tripYear, tripMonth, tripDay] = bookingRecord.start_date
        .split("-")
        .map(Number);
      const [pickupHour, pickupMinute] = (bookingRecord.pickup_time || "09:00")
        .split(":")
        .map(Number);
      const tripStartMs = Date.UTC(
        tripYear,
        (tripMonth || 1) - 1,
        tripDay || 1,
        pickupHour || 9,
        pickupMinute || 0,
      );
      const paymentDeadline = new Date(
        Math.min(addDays(new Date(), 1).getTime(), tripStartMs),
      ).toISOString();
      const { data: bookingStateChanged, error: updateError } = await supabase
        .from("bookings")
        .update({
          status: nextStatus,
          payment_deadline: paymentDeadline,
        })
        .eq("id", bookingRecord.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!bookingStateChanged) {
        return jsonResponse(
          {
            error:
              "This booking changed state before it could be accepted. Please refresh and try again.",
          },
          409,
        );
      }

      await supabase.from("notifications").insert({
        user_id: bookingRecord.renter_id,
        title: "Booking Accepted!",
        message: `Your booking for ${getVehicleLabel(bookingRecord)} has been accepted. Complete the reservation payment within 24 hours by paying the required downpayment or the full amount.`,
        type: "success",
        link: "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: bookingRecord.renter_id,
        title: "Booking Accepted",
        message: `Your booking for ${getVehicleLabel(bookingRecord)} has been accepted. Complete the reservation payment within 24 hours by paying the required downpayment or the full amount.`,
        link: "/my-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `booking-accepted:${bookingRecord.id}`,
      });

      auditDetails.payment_deadline = paymentDeadline;
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "owner_accepted_booking",
        entity_type: "booking",
        entity_id: bookingRecord.id,
        details: auditDetails,
      });

      return jsonResponse({
        success: true,
        bookingId: bookingRecord.id,
        state: "accepted",
        status: nextStatus,
      });
    }

    if (payload.action === "reject") {
      if (!owner) {
        return jsonResponse(
          { error: "Only the lister can reject this booking" },
          403,
        );
      }
      if (bookingRecord.status !== "pending") {
        return jsonResponse(
          { error: "Only pending bookings can be rejected" },
          409,
        );
      }

      nextStatus = "rejected";
      const { data: bookingStateChanged, error: updateError } = await supabase
        .from("bookings")
        .update({ status: nextStatus })
        .eq("id", bookingRecord.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!bookingStateChanged) {
        return jsonResponse(
          {
            error:
              "This booking changed state before it could be rejected. Please refresh and try again.",
          },
          409,
        );
      }

      await supabase.from("notifications").insert({
        user_id: bookingRecord.renter_id,
        title: "Booking Declined",
        message: actionNote
          ? `Your booking for ${getVehicleLabel(bookingRecord)} was declined by the lister. Reason: ${actionNote}`
          : `Your booking for ${getVehicleLabel(bookingRecord)} was declined by the lister.`,
        type: "error",
        link: "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: bookingRecord.renter_id,
        title: "Booking Declined",
        message: actionNote
          ? `Your booking for ${getVehicleLabel(bookingRecord)} was declined by the lister. Reason: ${actionNote}`
          : `Your booking for ${getVehicleLabel(bookingRecord)} was declined by the lister.`,
        link: "/my-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `booking-declined:${bookingRecord.id}`,
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "owner_rejected_booking",
        entity_type: "booking",
        entity_id: bookingRecord.id,
        details: actionNote ? { reason: actionNote } : null,
      });

      return jsonResponse({
        success: true,
        bookingId: bookingRecord.id,
        state: "rejected",
        status: nextStatus,
      });
    }

    if (payload.action === "cancel") {
      if (!renter && !owner) {
        return jsonResponse(
          { error: "You are not allowed to cancel this booking" },
          403,
        );
      }

      const hasCapturedBookingPayment = bookingRecord.payments.some(
        (payment) =>
          REFUNDABLE_BOOKING_PAYMENT_TYPES.includes(payment.payment_type) &&
          payment.status === "completed" &&
          Number(payment.amount) > 0,
      );

      const isPreTripCancellation =
        !bookingRecord.renter_arrived_at &&
        !bookingRecord.lister_arrived_at &&
        !["active", "completed"].includes(bookingRecord.status);

      if (!isPreTripCancellation) {
        return jsonResponse(
          {
            error:
              "This booking can no longer be cancelled automatically because the trip has already started or was completed.",
          },
          409,
        );
      }

      if (
        ![
          "pending",
          "confirmed",
          "awaiting_payment",
          "downpayment_paid",
          "fully_paid",
        ].includes(bookingRecord.status)
      ) {
        return jsonResponse(
          { error: "This booking is not in a cancellable state." },
          409,
        );
      }

      const refundPlan = hasCapturedBookingPayment
        ? getCancellationRefundPlan(bookingRecord)
        : null;
      // A renter cancelling a paid booking inside the "full refund" window keeps
      // the automatic full-refund path. Inside the short-notice window the
      // cancellation still goes through, but the refund is a policy-recommended
      // partial handled by admin review rather than an automatic full return.
      const renterLateCancellation = Boolean(
        renter && refundPlan && refundPlan.isLate,
      );

      if (hasCapturedBookingPayment) {
        const firstPaymentAt = getFirstCapturedBookingPaymentAt(bookingRecord);
        if (renter && !firstPaymentAt) {
          return jsonResponse(
            { error: "This paid booking is missing its captured payment timestamp." },
            409,
          );
        }
      }

      const updateFields: Record<string, string | null> = {
        status: "cancelled",
        payment_deadline: null,
      };
      let cancelState = "cancelled";
      let cancelMessage = renter
        ? "Booking request cancelled successfully."
        : "Booking cancelled by the lister.";

      // Claim the cancellable booking row before starting refund work.
      nextStatus = "cancelled";
      const { data: bookingStateChanged, error: updateError } = await supabase
        .from("bookings")
        .update(updateFields)
        .eq("id", bookingRecord.id)
        .in("status", [
          "pending",
          "confirmed",
          "awaiting_payment",
          "downpayment_paid",
          "fully_paid",
        ])
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!bookingStateChanged) {
        return jsonResponse(
          {
            error:
              "This booking changed state before it could be cancelled. Please refresh and try again.",
          },
          409,
        );
      }

      if (hasCapturedBookingPayment && renterLateCancellation && refundPlan) {
        // Short-notice renter cancellation: policy-recommended partial refund,
        // released by admin review (Terms 6.2 - no automatic money movement).
        const manualRefundPaymentId = await createManualRefundReview(
          supabase,
          bookingRecord,
          user.id,
          [
            actionNote,
            `Renter cancelled ${
              refundPlan.hoursToPickup !== null
                ? `${Math.max(0, Math.round(refundPlan.hoursToPickup))}h`
                : "shortly"
            } before pickup (policy threshold ${refundPlan.fullHours}h).`,
            refundPlan.pastPickup
              ? "Pickup time had already passed with no check-in."
              : `Recommended renter share ${refundPlan.lateRenterPercent}%; short-notice lister compensation PHP ${refundPlan.listerCompensation.toLocaleString()}.`,
          ]
            .filter(Boolean)
            .join(" "),
          "Short-notice cancellation - automatic full refund not applied.",
          refundPlan.recommendedRenterRefund,
        );
        cancelState = "cancelled_refund_pending";
        cancelMessage = refundPlan.pastPickup
          ? "Booking cancelled. Because pickup had already passed, any refund is decided by SafeDrive support review."
          : `Booking cancelled. Because this was a short-notice cancellation, SafeDrive support will review and release the recommended ${refundPlan.lateRenterPercent}% refund.`;
        auditDetails.refund_state = "manual_review";
        auditDetails.refund_payment_ids = manualRefundPaymentId
          ? [manualRefundPaymentId]
          : [];
        auditDetails.refund_auto_reason = "short_notice_partial_policy";
        auditDetails.recommended_renter_refund = refundPlan.recommendedRenterRefund;
        auditDetails.lister_compensation = refundPlan.listerCompensation;
      } else if (hasCapturedBookingPayment) {
        const refundResult = await processAutomaticRefundForBooking({
          supabase,
          bookingId: bookingRecord.id,
          initiatedByUserId: user.id,
          reason: renter ? "requested_by_customer" : "others",
          note: [
            renter
              ? "Renter cancelled the paid booking inside the full-refund window."
              : "Lister cancelled the accepted paid booking before the trip started; renter refund must be handled regardless of the renter grace window.",
            actionNote,
          ]
            .filter(Boolean)
            .join(" "),
          allowedPaymentTypes: REFUNDABLE_BOOKING_PAYMENT_TYPES,
          baseOrigin: new URL(req.url).origin,
        });

        const payMongoRefundAlreadyPending =
          refundResult.state === "skipped" &&
          refundResult.reason ===
            "A PayMongo refund is already pending for this booking.";

        if (payMongoRefundAlreadyPending) {
          cancelState = "cancelled_refund_pending";
          cancelMessage =
            "Booking cancelled. PayMongo is already finalizing the refund.";
          auditDetails.refund_state = "pending";
          auditDetails.refund_auto_reason = refundResult.reason;
        } else if (refundResult.state === "failed" || refundResult.state === "skipped") {
          const manualRefundPaymentId = await createManualRefundReview(
            supabase,
            bookingRecord,
            user.id,
            actionNote,
            refundResult.reason ||
              "SafeDrive could not finish the refund automatically.",
          );

          cancelState = "cancelled_refund_pending";
          cancelMessage =
            "Booking cancelled. Automatic refund was unavailable, so admin review has started for manual refund release.";
          auditDetails.refund_state = "manual_review";
          auditDetails.refund_payment_ids = manualRefundPaymentId
            ? [manualRefundPaymentId]
              : [];
          auditDetails.refund_auto_reason = refundResult.reason;
        } else {
          cancelState =
            refundResult.state === "pending"
              ? "cancelled_refund_pending"
              : "cancelled_refunded";
          cancelMessage =
            refundResult.state === "pending"
              ? "Booking cancelled. PayMongo is still finalizing the refund."
              : "Booking cancelled and refund completed.";

          auditDetails.refund_state = refundResult.state;
          auditDetails.refund_payment_ids = refundResult.refundPaymentIds;
          auditDetails.refund_ids = refundResult.refundIds;
        }
      } else {
        if (!renter && !owner) {
          return jsonResponse(
            { error: "Only the booking participants can cancel this booking" },
            403,
          );
        }
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: renter ? "renter_cancelled_booking" : "owner_cancelled_booking",
        entity_type: "booking",
        entity_id: bookingRecord.id,
        details: auditDetails,
      });

      // Record the cancellation for two-sided reliability signals. "Late" uses
      // the booking's own refund_full_hours window - the same threshold the
      // renter already faces, so both sides are judged symmetrically.
      const cancelPickupMs = getBookingPickupMs(bookingRecord);
      const hoursBeforePickup =
        cancelPickupMs === null
          ? null
          : (cancelPickupMs - Date.now()) / 3_600_000;
      const cancelFullHours = Math.round(
        clampNumber(
          bookingRecord.refund_full_hours_snapshot,
          0,
          720,
          DEFAULT_REFUND_FULL_HOURS,
        ),
      );
      const cancelWasLate =
        hoursBeforePickup !== null && hoursBeforePickup < cancelFullHours;
      const strikeWaived = !renter && payload.waiveStrike === true;

      await supabase.from("booking_cancellations").upsert(
        {
          booking_id: bookingRecord.id,
          cancelled_by_role: renter ? "renter" : "lister",
          cancelled_by_id: user.id,
          lister_id: bookingRecord.owner_id,
          renter_id: bookingRecord.renter_id,
          car_id: bookingRecord.car_id,
          reason: actionNote,
          hours_before_pickup:
            hoursBeforePickup === null ? null : Math.round(hoursBeforePickup),
          was_late: cancelWasLate,
          had_captured_payment: hasCapturedBookingPayment,
        },
        { onConflict: "booking_id" },
      );

      // Separate write so a deploy that lands before CHAPTER 31 (no
      // strike_waived column) still records the cancellation above.
      if (strikeWaived) {
        await supabase
          .from("booking_cancellations")
          .update({ strike_waived: true })
          .eq("booking_id", bookingRecord.id);
      }

      // Lister strike + auto-pause: 3 late cancellations of a paid booking
      // inside 60 days pulls every one of the lister's live listings offline
      // pending a support review.
      if (!renter && cancelWasLate && hasCapturedBookingPayment && !strikeWaived) {
        const sixtyDaysAgo = new Date(
          Date.now() - 60 * 24 * 3_600_000,
        ).toISOString();
        const { count: recentLateCancels } = await supabase
          .from("booking_cancellations")
          .select("booking_id", { count: "exact", head: true })
          .eq("lister_id", bookingRecord.owner_id)
          .eq("cancelled_by_role", "lister")
          .eq("was_late", true)
          .eq("had_captured_payment", true)
          .eq("strike_waived", false)
          .gte("cancelled_at", sixtyDaysAgo);

        if ((recentLateCancels ?? 0) >= 3) {
          const { data: pausedCars } = await supabase
            .from("cars")
            .update({ status: "inactive" })
            .eq("owner_id", bookingRecord.owner_id)
            .in("status", ["approved", "active"])
            .select("id");
          const pausedCount = pausedCars?.length ?? 0;
          if (pausedCount > 0) {
            await supabase.from("notifications").insert({
              user_id: bookingRecord.owner_id,
              title: "Listings paused",
              message: `Your ${pausedCount} active listing${
                pausedCount === 1 ? " was" : "s were"
              } paused after repeated last-minute cancellations. Contact SafeDrive support to reactivate.`,
              type: "error",
              link: "/lister-bookings",
            });
            await supabase.from("audit_log").insert({
              user_id: bookingRecord.owner_id,
              action: "lister_listings_auto_paused",
              entity_type: "profile",
              entity_id: bookingRecord.owner_id,
              details: {
                reason: "repeated_late_cancellations",
                window_days: 60,
                late_cancellations: recentLateCancels,
                cars_paused: pausedCount,
              },
            });
          }
        }
      }

      const counterpartyId = renter
        ? bookingRecord.owner_id
        : bookingRecord.renter_id;

      await supabase.from("notifications").insert([
        {
          user_id: user.id,
          title: "Booking Cancelled",
          message: cancelMessage,
          type: "info",
          link: renter ? "/my-bookings" : "/lister-bookings",
        },
        {
          user_id: counterpartyId,
          title: renter ? "Renter Cancelled the Booking" : "Lister Cancelled the Booking",
          message: renter
            ? hasCapturedBookingPayment
              ? `The renter cancelled ${getVehicleLabel(bookingRecord)}. Refund processing has started if it was still inside the 24-hour grace period.`
              : `The renter cancelled ${getVehicleLabel(bookingRecord)} before payment capture.`
            : hasCapturedBookingPayment
              ? `The lister cancelled ${getVehicleLabel(bookingRecord)} before the trip started. Your full refund is being processed - browse other cars to rebook.`
              : `The lister cancelled ${getVehicleLabel(bookingRecord)} before the trip started. Browse other cars to rebook.`,
          type: renter ? (hasCapturedBookingPayment ? "info" : "error") : "error",
          link: renter ? "/lister-bookings" : "/browse",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: counterpartyId,
        title: renter ? "Renter Cancelled the Booking" : "Lister Cancelled the Booking",
        message: renter
          ? hasCapturedBookingPayment
            ? `The renter cancelled ${getVehicleLabel(bookingRecord)}. Refund processing has started if it was still inside the 24-hour grace period.`
            : `The renter cancelled ${getVehicleLabel(bookingRecord)} before payment capture.`
          : hasCapturedBookingPayment
            ? `The lister cancelled ${getVehicleLabel(bookingRecord)} before the trip started. Renter refund processing has started.`
            : `The lister cancelled ${getVehicleLabel(bookingRecord)} before the trip started.`,
        link: renter ? "/lister-bookings" : "/my-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `booking-cancelled:${bookingRecord.id}:${renter ? "renter" : "lister"}`,
      });

      return jsonResponse({
        success: true,
        bookingId: bookingRecord.id,
        state: cancelState,
        status: nextStatus,
      });
    }

    if (payload.action === "arrive") {
      if (
        bookingRecord.status !== "fully_paid" &&
        bookingRecord.status !== "active"
      ) {
        return jsonResponse(
          { error: "This booking is not ready for arrival check-in" },
          409,
        );
      }

      const pickupMs = getBookingPickupMs(bookingRecord);
      if (pickupMs !== null) {
        const leadHours = await fetchArrivalCheckinLeadHours(supabase);
        const opensAtMs = pickupMs - leadHours * 60 * 60 * 1000;
        if (Date.now() < opensAtMs) {
          return jsonResponse(
            {
              error: `Arrival check-in opens ${leadHours} hour${leadHours === 1 ? "" : "s"} before pickup (from ${formatManilaStamp(opensAtMs)}).`,
            },
            409,
          );
        }
      }

      const { data: requiredDeposit, error: requiredDepositError } = await supabase
        .from("security_deposits")
        .select("id, status")
        .eq("booking_id", bookingRecord.id)
        .maybeSingle();
      if (requiredDepositError) throw requiredDepositError;
      if (requiredDeposit && requiredDeposit.status !== "paid") {
        return jsonResponse(
          {
            error:
              "The refundable security deposit must be confirmed before either party can record arrival.",
          },
          409,
        );
      }

      // The lister owns the "before" evidence, so only the lister must file a
      // pickup condition report before the handover. The renter's pickup report
      // is optional; the renter just confirms they received the car.
      if (owner) {
        const { data: pickupReport, error: pickupReportError } = await supabase
          .from("trip_condition_reports")
          .select("id, evidence_waived, trip_condition_photos(category)")
          .eq("booking_id", bookingRecord.id)
          .eq("reporter_id", user.id)
          .eq("phase", "pickup")
          .maybeSingle();
        if (pickupReportError) throw pickupReportError;
        if (!pickupReport || !hasRequiredTripPhotos(pickupReport)) {
          return jsonResponse(
            { error: "Submit your pickup condition report and photos before confirming the handover" },
            409,
          );
        }
      }

      const arrivalTime = new Date().toISOString();
      const arrivalLocation = normalizeArrivalLocation(payload.arrivalLocation);
      const updatePayload: Record<string, string | number | null> = {};
      const ownArrivalField = renter ? "renter_arrived_at" : "lister_arrived_at";
      const addLocationEvidence = (prefix: "renter" | "lister") => {
        if (!arrivalLocation) return;
        updatePayload[`${prefix}_arrival_latitude`] = arrivalLocation.latitude;
        updatePayload[`${prefix}_arrival_longitude`] = arrivalLocation.longitude;
        updatePayload[`${prefix}_arrival_accuracy_meters`] =
          arrivalLocation.accuracyMeters;
        updatePayload[`${prefix}_arrival_location_captured_at`] =
          arrivalLocation.capturedAt;
      };

      if (renter) {
        if (bookingRecord.renter_arrived_at) {
          return jsonResponse(
            { error: "Your arrival has already been recorded" },
            409,
          );
        }
        updatePayload.renter_arrived_at = arrivalTime;
        updatePayload.renter_arrival_photo_url = payload.arrivalPhotoUrl ?? null;
        addLocationEvidence("renter");
        if (bookingRecord.lister_arrived_at && bookingRecord.status === "fully_paid") {
          nextStatus = "active";
          updatePayload.status = nextStatus;
        }
      } else if (owner) {
        if (bookingRecord.lister_arrived_at) {
          return jsonResponse(
            { error: "Your arrival has already been recorded" },
            409,
          );
        }
        updatePayload.lister_arrived_at = arrivalTime;
        updatePayload.lister_arrival_photo_url = payload.arrivalPhotoUrl ?? null;
        addLocationEvidence("lister");
        if (bookingRecord.renter_arrived_at && bookingRecord.status === "fully_paid") {
          nextStatus = "active";
          updatePayload.status = nextStatus;
        }
      }

      const updateArrival = (payloadToSave: Record<string, string | number | null>) =>
        supabase
          .from("bookings")
          .update(payloadToSave)
          .eq("id", bookingRecord.id)
          .in("status", ["fully_paid", "active"])
          .is(ownArrivalField, null)
          .select("id")
          .maybeSingle();

      const { data: bookingStateChanged, error: updateError } =
        await updateArrival(updatePayload);

      let arrivalLocationStored = Boolean(arrivalLocation);
      if (updateError) {
        if (!arrivalLocation) throw updateError;

        const fallbackPayload = Object.fromEntries(
          Object.entries(updatePayload).filter(
            ([key]) =>
              !key.includes("_arrival_latitude") &&
              !key.includes("_arrival_longitude") &&
              !key.includes("_arrival_accuracy_meters") &&
              !key.includes("_arrival_location_captured_at"),
          ),
        );

        const { data: fallbackStateChanged, error: fallbackError } =
          await updateArrival(fallbackPayload);

        if (fallbackError) throw updateError;
        if (!fallbackStateChanged) {
          return jsonResponse(
            {
              error:
                "This booking changed state before arrival could be recorded. Please refresh and try again.",
            },
            409,
          );
        }
        arrivalLocationStored = false;
      } else if (!bookingStateChanged) {
        return jsonResponse(
          {
            error:
              "This booking changed state before arrival could be recorded. Please refresh and try again.",
          },
          409,
        );
      }

      let activatedByThisRequest = nextStatus === "active";
      if (!activatedByThisRequest) {
        const { data: refreshedBooking, error: refreshError } = await supabase
          .from("bookings")
          .select("status, renter_arrived_at, lister_arrived_at")
          .eq("id", bookingRecord.id)
          .single();

        if (refreshError) throw refreshError;

        if (
          refreshedBooking?.status === "fully_paid" &&
          refreshedBooking.renter_arrived_at &&
          refreshedBooking.lister_arrived_at
        ) {
          const { data: activatedBooking, error: activationError } = await supabase
            .from("bookings")
            .update({ status: "active" })
            .eq("id", bookingRecord.id)
            .eq("status", "fully_paid")
            .select("id")
            .maybeSingle();

          if (activationError) throw activationError;
          if (activatedBooking) {
            nextStatus = "active";
            activatedByThisRequest = true;
          }
        }
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: renter ? "renter_arrived_booking" : "owner_arrived_booking",
        entity_type: "booking",
        entity_id: bookingRecord.id,
        details: {
          arrival_time: arrivalTime,
          has_arrival_photo: Boolean(payload.arrivalPhotoUrl),
          has_arrival_location: Boolean(arrivalLocation),
          arrival_location_stored: arrivalLocationStored,
          arrival_location_accuracy_meters:
            arrivalLocation?.accuracyMeters ?? null,
          transitioned_to: nextStatus,
        },
      });

      const counterpartyId = renter
        ? bookingRecord.owner_id
        : bookingRecord.renter_id;

      await supabase.from("notifications").insert({
        user_id: counterpartyId,
        title: renter ? "Renter Confirmed Pickup" : "Handover Confirmed by Lister",
        message: renter
          ? `The renter confirmed they have the car for ${getVehicleLabel(bookingRecord)}${arrivalLocation ? " with an optional location check." : "."}`
          : `The lister confirmed the handover for ${getVehicleLabel(bookingRecord)}. Open the booking and tap "Confirm - I have the car" to start your trip.`,
        type: "info",
        link: renter ? "/lister-bookings" : "/my-bookings",
      });

      if (activatedByThisRequest) {
        await supabase.from("notifications").insert([
          {
            user_id: bookingRecord.renter_id,
            title: "Trip Check-in Complete",
            message: `Both parties have arrived for ${getVehicleLabel(bookingRecord)}. Your booking is now active.`,
            type: "success",
            link: "/my-bookings",
          },
          {
            user_id: bookingRecord.owner_id,
            title: "Trip Check-in Complete",
            message: `Both parties have arrived for ${getVehicleLabel(bookingRecord)}. The rental is now active.`,
            type: "success",
            link: "/lister-bookings",
          },
        ]);
      }

      return jsonResponse({
        success: true,
        bookingId: bookingRecord.id,
        state: "arrived",
        status: nextStatus,
      });
    }

    if (payload.action === "complete") {
      if (
        bookingRecord.status !== "fully_paid" &&
        bookingRecord.status !== "active"
      ) {
        return jsonResponse(
          { error: "This booking is not ready for completion" },
          409,
        );
      }

      const completePickupMs = getBookingPickupMs(bookingRecord);
      if (completePickupMs !== null && Date.now() < completePickupMs) {
        return jsonResponse(
          {
            error: `You can't finish a trip before it starts. Pickup is ${formatManilaStamp(completePickupMs)}.`,
          },
          409,
        );
      }

      const { data: openExtension, error: openExtensionError } = await supabase
        .from("booking_extensions")
        .select("id, status")
        .eq("booking_id", bookingRecord.id)
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openExtensionError) throw openExtensionError;
      if (openExtension) {
        return jsonResponse(
          {
            error:
              openExtension.status === "approved"
                ? "The approved extension must be paid or cancelled before either side can complete the agreement."
                : "Resolve the pending extension request before completing the agreement.",
          },
          409,
        );
      }

      const { data: conditionReports, error: conditionReportError } = await supabase
        .from("trip_condition_reports")
        .select("id, phase, evidence_waived, trip_condition_photos(category)")
        .eq("booking_id", bookingRecord.id)
        .eq("reporter_id", user.id)
        .in("phase", ["pickup", "return"]);

      if (conditionReportError) {
        if (conditionReportError.code === "42P01") {
          return jsonResponse(
            { error: "Run the SafeDrive operations database chapter before completing trips" },
            503,
          );
        }
        throw conditionReportError;
      }
      // Asymmetric evidence: the lister must have filed the pickup ("before")
      // report; the renter must have filed the return ("after") report. The
      // other phase is optional for each side.
      const requiredReportPhase = renter ? "return" : "pickup";
      const requiredReport = (conditionReports ?? []).find(
        (report) => report.phase === requiredReportPhase,
      );
      if (!requiredReport || !hasRequiredTripPhotos(requiredReport)) {
        return jsonResponse(
          {
            error: renter
              ? "Submit your return condition report with photos before finishing the trip."
              : "Submit your pickup condition report with photos before finishing the trip.",
          },
          409,
        );
      }

      const updatePayload: Record<string, boolean | string> = {};
      const ownCompletionField = renter ? "renter_completed" : "owner_completed";
      const completionStamp = new Date().toISOString();

      if (renter) {
        if (!bookingRecord.renter_arrived_at) {
          return jsonResponse(
            { error: "Record your arrival before completing the agreement" },
            409,
          );
        }
        if (bookingRecord.renter_completed) {
          return jsonResponse(
            { error: "You have already confirmed completion" },
            409,
          );
        }
        updatePayload.renter_completed = true;
        updatePayload.renter_completed_at = completionStamp;
        if (bookingRecord.owner_completed) {
          nextStatus = "completed";
          updatePayload.status = nextStatus;
        }
      } else if (owner) {
        if (!bookingRecord.lister_arrived_at) {
          return jsonResponse(
            { error: "Record your arrival before completing the agreement" },
            409,
          );
        }
        if (bookingRecord.owner_completed) {
          return jsonResponse(
            { error: "You have already confirmed completion" },
            409,
          );
        }
        updatePayload.owner_completed = true;
        updatePayload.owner_completed_at = completionStamp;
        if (bookingRecord.renter_completed) {
          nextStatus = "completed";
          updatePayload.status = nextStatus;
        }
      }

      const { data: bookingStateChanged, error: updateError } = await supabase
        .from("bookings")
        .update(updatePayload)
        .eq("id", bookingRecord.id)
        .in("status", ["fully_paid", "active"])
        .eq(ownCompletionField, false)
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!bookingStateChanged) {
        return jsonResponse(
          {
            error:
              "This booking changed state before completion could be recorded. Please refresh and try again.",
          },
          409,
        );
      }

      let completedByThisRequest = nextStatus === "completed";
      if (!completedByThisRequest) {
        const { data: refreshedBooking, error: refreshError } = await supabase
          .from("bookings")
          .select("status, renter_completed, owner_completed")
          .eq("id", bookingRecord.id)
          .single();

        if (refreshError) throw refreshError;

        if (
          refreshedBooking &&
          refreshedBooking.status !== "completed" &&
          refreshedBooking.renter_completed &&
          refreshedBooking.owner_completed
        ) {
          const { data: completedBooking, error: completionError } =
            await supabase
              .from("bookings")
              .update({ status: "completed" })
              .eq("id", bookingRecord.id)
              .in("status", ["fully_paid", "active"])
              .select("id")
              .maybeSingle();

          if (completionError) throw completionError;
          if (completedBooking) {
            nextStatus = "completed";
            completedByThisRequest = true;
          }
        }
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: renter ? "renter_completed_booking" : "owner_completed_booking",
        entity_type: "booking",
        entity_id: bookingRecord.id,
        details: {
          transitioned_to: nextStatus,
        },
      });

      if (completedByThisRequest) {
        await runBookingCompletionSideEffects(
          supabase,
          {
            id: bookingRecord.id,
            owner_id: bookingRecord.owner_id,
            renter_id: bookingRecord.renter_id,
            commission: bookingRecord.commission,
          },
          { initiatedByUserId: user.id, baseOrigin: new URL(req.url).origin },
        );
      }

      return jsonResponse({
        success: true,
        bookingId: bookingRecord.id,
        state: "completed_acknowledged",
        status: nextStatus,
      });
    }

    return jsonResponse({ error: "Unsupported booking action" }, 400);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Booking action error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
