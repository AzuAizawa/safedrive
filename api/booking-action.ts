import {
  bookingCompliance,
  complianceBlockedResponse,
  vehicleGuardMessage,
} from "../server/vehicleCompliance.js";
import { addDays } from "date-fns";
import { createClient } from "@supabase/supabase-js";
import { processAutomaticRefundForBooking } from "../server/refundAutomation.js";
import { runBookingCompletionSideEffects } from "../server/bookingCompletion.js";
import { sendUserNotificationEmail } from "../server/email.js";
import { blockedIpResponse } from "../server/ipBlock.js";

export const config = {
  runtime: "edge",
};

type BookingAction =
  | "accept"
  | "reject"
  | "cancel"
  | "arrive"
  | "handover_confirm"
  | "handover_receive"
  | "return_arrive"
  | "complete";

type BookingActionPayload = {
  bookingId?: string;
  action?: BookingAction;
  arrivalPhotoUrl?: string | null;
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
  end_date: string;
  pickup_time: string | null;
  dropoff_time: string | null;
  commission: number | string;
  total_price: number | string;
  refund_full_hours_snapshot: number | string | null;
  refund_late_renter_percent_snapshot: number | string | null;
  owner_response_deadline: string | null;
  renter_completed: boolean;
  owner_completed: boolean;
  renter_arrived_at: string | null;
  lister_arrived_at: string | null;
  lister_handover_confirmed_at: string | null;
  renter_handover_received_at: string | null;
  renter_return_arrived_at: string | null;
  lister_return_arrived_at: string | null;
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

// Every trip condition report - pickup or return, either role - now uses
// free-form live-camera photos (process-planning redesign): at least one of
// these 4 generic slots satisfies the requirement. The fixed front/back/
// odometer/fuel_or_battery category system is retired.
const LIVE_PHOTO_CATEGORIES = [
  "live_photo_1",
  "live_photo_2",
  "live_photo_3",
  "live_photo_4",
] as const;

const hasRequiredTripPhotos = (
  report: {
    trip_condition_photos?: Array<{ category: string }> | null;
    evidence_waived?: boolean | null;
  },
  // Kept for call-site clarity even though the check no longer branches on
  // it - both phases use the same live-photo rule.
  _phase: "pickup" | "return",
) => {
  if (report.evidence_waived) return true;
  const categories = new Set(
    (report.trip_condition_photos ?? []).map((photo) => photo.category),
  );
  return LIVE_PHOTO_CATEGORIES.some((category) => categories.has(category));
};
const REFUNDABLE_BOOKING_PAYMENT_TYPES = ["downpayment", "balance"];

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

// Same Manila-correct pattern as getBookingPickupMs, for the ORIGINAL
// scheduled return instant. api/booking-early-return-action.ts's "approve"
// action deliberately never rewrites bookings.end_date/dropoff_time - those
// columns permanently mean "the original agreed return date+time" - so this
// always returns the original instant. Approved-early-return awareness is
// layered on top via getOperativeDropoffMs/getReturnCheckinEligibleMs below.
const getBookingDropoffMs = (booking: BookingRecord) => {
  const [year, month, day] = (booking.end_date || "")
    .split("-")
    .map((part) => Number(part));
  const [hour, minute] = (booking.dropoff_time || "18:00")
    .split(":")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour || 0, minute || 0);
  return asUtc - 8 * 60 * 60 * 1000;
};

type ApprovedEarlyReturn = {
  status: string;
  requested_end_date: string;
  requested_end_time: string;
} | null;

const getInstantMs = (dateOnly: string, time: string | null, fallback = "18:00") => {
  const [year, month, day] = (dateOnly || "").split("-").map((part) => Number(part));
  const [hour, minute] = (time || fallback).split(":").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day, hour || 0, minute || 0) - 8 * 60 * 60 * 1000;
};

// Concept B (server) - mirrors getReturnCheckinEligibleDeadline; never
// re-closes once an early return is approved, even after a missed-early-
// return fallback makes the original instant operative again (concept A).
const getReturnCheckinEligibleMs = (booking: BookingRecord, approvedEarly: ApprovedEarlyReturn) => {
  if (approvedEarly?.status === "approved") {
    const earlyMs = getInstantMs(approvedEarly.requested_end_date, approvedEarly.requested_end_time);
    if (earlyMs !== null) return earlyMs;
  }
  return getBookingDropoffMs(booking);
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

    // Refuse anything state-changing from a blocked address (CHAPTER 67).
    // Placed right after the client so it runs before any work or any write.
    const ipBlocked = await blockedIpResponse(supabase, req);
    if (ipBlocked) return ipBlocked;
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
        end_date,
        pickup_time,
        dropoff_time,
        commission,
        total_price,
        refund_full_hours_snapshot,
        refund_late_renter_percent_snapshot,
        owner_response_deadline,
        renter_completed,
        owner_completed,
        renter_arrived_at,
        lister_arrived_at,
        lister_handover_confirmed_at,
        renter_handover_received_at,
        renter_return_arrived_at,
        lister_return_arrived_at,
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

    if (["accept", "arrive", "handover_confirm", "handover_receive"].includes(payload.action)) {
      if (!(await bookingCompliance(supabase, bookingRecord.id)).eligible) return complianceBlockedResponse();
    }

    if ((payload.action === "cancel" && renter) || (payload.action === "complete" && bookingRecord.status !== "active")) {
      if (!(await bookingCompliance(supabase, bookingRecord.id)).eligible) {
        return jsonResponse({ error: "This booking needs vehicle document review. Contact support or ask the lister to resolve cancellation/refund; this must not be recorded as a renter no-show or late cancellation.", code: "VEHICLE_DOCUMENTS_REQUIRED" }, 409);
      }
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
      // Reuse getBookingPickupMs() (already Manila-correct, -8h from naive
      // UTC) instead of a separate inline calc - a prior duplicate here was
      // missing that offset and let the cap run up to 8h past real pickup.
      const tripStartMs = getBookingPickupMs(bookingRecord);
      const paymentDeadline = new Date(
        Math.min(
          addDays(new Date(), 1).getTime(),
          tripStartMs ?? addDays(new Date(), 1).getTime(),
        ),
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

      // Arrival is a quick, unconditional presence check for both sides -
      // it never changes booking status on its own. Once both have arrived,
      // the lister must submit required pickup photos and confirm handover
      // ("handover_confirm"), then the renter must confirm receipt
      // ("handover_receive") - only that last step activates the trip.
      // Arrival no longer captures a device location. The only consumer that
      // could act on it compared it against the car's listed pickup pin, and
      // that pin was retired - so the reading fed nothing, while still costing
      // the user a location-permission prompt. The columns stay in the table:
      // bookings that recorded one before this keep their evidence.
      const arrivalTime = new Date().toISOString();
      const updatePayload: Record<string, string | number | null> = {};
      const ownArrivalField = renter ? "renter_arrived_at" : "lister_arrived_at";

      let bothArrivedAfterThis = false;

      if (renter) {
        if (bookingRecord.renter_arrived_at) {
          return jsonResponse(
            { error: "Renter arrival has already been recorded" },
            409,
          );
        }
        updatePayload.renter_arrived_at = arrivalTime;
        updatePayload.renter_arrival_photo_url = payload.arrivalPhotoUrl ?? null;
        if (bookingRecord.lister_arrived_at) {
          bothArrivedAfterThis = true;
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
        if (bookingRecord.renter_arrived_at) {
          bothArrivedAfterThis = true;
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

      if (updateError) throw updateError;
      if (!bookingStateChanged) {
        return jsonResponse(
          {
            error:
              "This booking changed state before arrival could be recorded. Please refresh and try again.",
          },
          409,
        );
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: renter ? "renter_arrived_booking" : "owner_arrived_booking",
        entity_type: "booking",
        entity_id: bookingRecord.id,
        details: {
          arrival_time: arrivalTime,
          has_arrival_photo: Boolean(payload.arrivalPhotoUrl),
          both_arrived: bothArrivedAfterThis,
        },
      });

      const counterpartyId = renter ? bookingRecord.owner_id : bookingRecord.renter_id;

      const arrivalTitle = renter ? "Renter Arrived for Pickup" : "Lister Arrived for Pickup";
      const arrivalMessage = renter
        ? `The renter arrived for the pickup of ${getVehicleLabel(bookingRecord)}.`
        : `The lister arrived for the pickup of ${getVehicleLabel(bookingRecord)}. Confirm your own arrival so the lister can hand over the car.`;
      await supabase.from("notifications").insert({
        user_id: counterpartyId,
        title: arrivalTitle,
        message: arrivalMessage,
        type: "info",
        link: renter ? "/lister-bookings" : "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: counterpartyId,
        title: arrivalTitle,
        message: arrivalMessage,
        link: renter ? "/lister-bookings" : "/my-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `arrive:${renter ? "renter" : "lister"}:${bookingRecord.id}`,
      });

      // Auto-post the arrival into the booking's conversation thread, with a
      // clickable map link when a location was shared - mirrors the exact
      // find-or-create-ticket pattern already used for pickup/return
      // condition-report photos (api/submit-trip-condition-report.ts). Never
      // let a chat hiccup fail an already-recorded arrival.
      try {
        let conversationTicketId: string | null = null;
        const { data: existingConversation } = await supabase
          .from("support_tickets")
          .select("id")
          .eq("booking_id", bookingRecord.id)
          .not("participant_user_id", "is", null)
          .maybeSingle();
        if (existingConversation?.id) {
          conversationTicketId = existingConversation.id;
        } else {
          const { data: newConversation, error: newConversationError } = await supabase
            .from("support_tickets")
            .insert({
              user_id: bookingRecord.renter_id,
              participant_user_id: bookingRecord.owner_id,
              booking_id: bookingRecord.id,
              subject: `Booking conversation: ${getVehicleLabel(bookingRecord)} (${bookingRecord.start_date} to ${bookingRecord.end_date})`,
              tag: "booking_conversation",
              status: "open",
            })
            .select("id")
            .single();
          if (!newConversationError && newConversation) {
            conversationTicketId = newConversation.id;
          }
        }

        if (conversationTicketId) {
          const roleLabel = renter ? "Renter" : "Lister";
          await supabase.from("ticket_messages").insert({
            ticket_id: conversationTicketId,
            sender_id: user.id,
            message: `${roleLabel} arrived at pickup.`,
          });
        }
      } catch (chatError) {
        console.error("Failed to post arrival to booking conversation", chatError);
      }

      if (bothArrivedAfterThis) {
        await supabase.from("notifications").insert([
          {
            user_id: bookingRecord.renter_id,
            title: "Both Parties Arrived",
            message: `You and the lister have both arrived for ${getVehicleLabel(bookingRecord)}. Please wait for the lister to submit pickup photos and hand over the car.`,
            type: "success",
            link: "/my-bookings",
          },
          {
            user_id: bookingRecord.owner_id,
            title: "Both Parties Arrived",
            message: `You and the renter have both arrived for ${getVehicleLabel(bookingRecord)}. Submit your pickup condition report, then tap "Hand Over the Car."`,
            type: "success",
            link: "/lister-bookings",
          },
        ]);
        await sendUserNotificationEmail(supabase, {
          userId: bookingRecord.owner_id,
          title: "Both Parties Arrived",
          message: `You and the renter have both arrived for ${getVehicleLabel(bookingRecord)}. Submit your pickup condition report, then tap "Hand Over the Car."`,
          link: "/lister-bookings",
          baseOrigin: new URL(req.url).origin,
          eventKey: `both-arrived:${bookingRecord.id}`,
        });
      }

      return jsonResponse({
        success: true,
        bookingId: bookingRecord.id,
        state: "arrived",
        status: nextStatus,
      });
    }

    if (payload.action === "handover_confirm") {
      if (!owner) {
        return jsonResponse(
          { error: "Only the lister can hand over the car" },
          403,
        );
      }
      if (bookingRecord.status !== "fully_paid") {
        return jsonResponse(
          { error: "This booking is not ready for handover" },
          409,
        );
      }
      if (!bookingRecord.renter_arrived_at || !bookingRecord.lister_arrived_at) {
        return jsonResponse(
          {
            error:
              "Both you and the renter must confirm arrival before handing over the car",
          },
          409,
        );
      }
      if (bookingRecord.lister_handover_confirmed_at) {
        return jsonResponse(
          { error: "You already confirmed the handover" },
          409,
        );
      }

      const { data: pickupReport, error: pickupReportError } = await supabase
        .from("trip_condition_reports")
        .select("id, evidence_waived, trip_condition_photos(category)")
        .eq("booking_id", bookingRecord.id)
        .eq("reporter_id", user.id)
        .eq("phase", "pickup")
        .maybeSingle();
      if (pickupReportError) throw pickupReportError;
      if (!pickupReport || !hasRequiredTripPhotos(pickupReport, "pickup")) {
        return jsonResponse(
          {
            error:
              "Submit your pickup condition report with live photos before handing over the car.",
          },
          409,
        );
      }

      const handoverTime = new Date().toISOString();
      const { data: handoverChanged, error: handoverError } = await supabase
        .from("bookings")
        .update({ lister_handover_confirmed_at: handoverTime })
        .eq("id", bookingRecord.id)
        .eq("status", "fully_paid")
        .is("lister_handover_confirmed_at", null)
        .select("id")
        .maybeSingle();
      if (handoverError) {
        const guarded = vehicleGuardMessage(handoverError);
        if (guarded) return jsonResponse({ error: guarded }, 409);
        throw handoverError;
      }
      if (!handoverChanged) {
        return jsonResponse(
          {
            error:
              "This booking changed state before the handover could be recorded. Please refresh and try again.",
          },
          409,
        );
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "owner_confirmed_handover",
        entity_type: "booking",
        entity_id: bookingRecord.id,
        details: { handover_time: handoverTime },
      });

      const handoverTitle = "Car Handed Over";
      const handoverMessage = `The lister handed over ${getVehicleLabel(bookingRecord)}. Open the booking and tap "I Have Received the Car" to start your trip.`;
      await supabase.from("notifications").insert({
        user_id: bookingRecord.renter_id,
        title: handoverTitle,
        message: handoverMessage,
        type: "info",
        link: "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: bookingRecord.renter_id,
        title: handoverTitle,
        message: handoverMessage,
        link: "/my-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `handover-confirmed:${bookingRecord.id}`,
      });

      return jsonResponse({
        success: true,
        bookingId: bookingRecord.id,
        state: "handover_confirmed",
        status: nextStatus,
      });
    }

    if (payload.action === "handover_receive") {
      if (!renter) {
        return jsonResponse(
          { error: "Only the renter can confirm receiving the car" },
          403,
        );
      }
      if (bookingRecord.status !== "fully_paid") {
        return jsonResponse(
          { error: "This booking is not ready for receipt confirmation" },
          409,
        );
      }
      if (!bookingRecord.lister_handover_confirmed_at) {
        return jsonResponse(
          { error: "Wait for the lister to hand over the car first" },
          409,
        );
      }
      if (bookingRecord.renter_handover_received_at) {
        return jsonResponse(
          { error: "You already confirmed receiving the car" },
          409,
        );
      }

      const receiptTime = new Date().toISOString();
      nextStatus = "active";
      const { data: receiptChanged, error: receiptError } = await supabase
        .from("bookings")
        .update({
          renter_handover_received_at: receiptTime,
          status: nextStatus,
        })
        .eq("id", bookingRecord.id)
        .eq("status", "fully_paid")
        .is("renter_handover_received_at", null)
        .select("id")
        .maybeSingle();
      if (receiptError) {
        const guarded = vehicleGuardMessage(receiptError);
        if (guarded) return jsonResponse({ error: guarded }, 409);
        throw receiptError;
      }
      if (!receiptChanged) {
        return jsonResponse(
          {
            error:
              "This booking changed state before receipt could be recorded. Please refresh and try again.",
          },
          409,
        );
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "renter_confirmed_handover_receipt",
        entity_type: "booking",
        entity_id: bookingRecord.id,
        details: { receipt_time: receiptTime },
      });

      await supabase.from("notifications").insert([
        {
          user_id: bookingRecord.renter_id,
          title: "Trip Started",
          message: `You confirmed receiving ${getVehicleLabel(bookingRecord)}. Your trip is now active.`,
          type: "success",
          link: "/my-bookings",
        },
        {
          user_id: bookingRecord.owner_id,
          title: "Trip Started",
          message: `The renter confirmed receiving ${getVehicleLabel(bookingRecord)}. The rental is now active.`,
          type: "success",
          link: "/lister-bookings",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: bookingRecord.owner_id,
        title: "Trip Started",
        message: `The renter confirmed receiving ${getVehicleLabel(bookingRecord)}. The rental is now active.`,
        link: "/lister-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `handover-received:${bookingRecord.id}`,
      });

      return jsonResponse({
        success: true,
        bookingId: bookingRecord.id,
        state: "handover_received",
        status: nextStatus,
      });
    }

    // Mutual "I have arrived" at the return point, mirroring pickup arrival.
    // Each side confirms independently; once both have, the lister submits
    // their required return-phase live-photo report and taps "Confirm - Car
    // Received" (the "complete" action) to finish the trip.
    if (payload.action === "return_arrive") {
      if (!renter && !owner) {
        return jsonResponse(
          {
            error: "You are not allowed to confirm return arrival for this booking",
          },
          403,
        );
      }
      if (bookingRecord.status !== "active") {
        return jsonResponse(
          { error: "This booking is not at the return stage." },
          409,
        );
      }

      const ownReturnField: "renter_return_arrived_at" | "lister_return_arrived_at" =
        renter ? "renter_return_arrived_at" : "lister_return_arrived_at";
      if (bookingRecord[ownReturnField]) {
        return jsonResponse(
          { error: "You already confirmed arrival at the return" },
          409,
        );
      }

      // Mirrors the pickup arrival-check-in window: opens the same
      // configured number of hours before the scheduled return instant, so
      // neither side can prematurely announce a return far ahead of the
      // agreed time (that's what "request an early return" is for instead).
      // Once an approved early return exists, this permanently uses ITS
      // instant instead of the original (getReturnCheckinEligibleMs,
      // "concept B") - it must never re-close even if both sides later miss
      // that early window and the return deadline shown elsewhere falls
      // back to the original instant for labeling purposes.
      const { data: approvedEarly } = await supabase
        .from("booking_early_returns")
        .select("status, requested_end_date, requested_end_time")
        .eq("booking_id", bookingRecord.id)
        .eq("status", "approved")
        .order("approved_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const checkinEligibleMs = getReturnCheckinEligibleMs(bookingRecord, approvedEarly ?? null);
      if (checkinEligibleMs !== null) {
        const leadHours = await fetchArrivalCheckinLeadHours(supabase);
        const opensAtMs = checkinEligibleMs - leadHours * 60 * 60 * 1000;
        if (Date.now() < opensAtMs) {
          return jsonResponse(
            {
              error: `You can confirm arrival at the return ${leadHours} hour${leadHours === 1 ? "" : "s"} before the agreed return time (from ${formatManilaStamp(opensAtMs)}).${renter ? ' Returning earlier than that? Use "Request early return" instead.' : ""}`,
            },
            409,
          );
        }
      }

      const returnArrivalTime = new Date().toISOString();
      const returnUpdatePayload: Record<string, string> = {
        [ownReturnField]: returnArrivalTime,
      };
      const { data: returnArrivalChanged, error: returnArrivalError } =
        await supabase
          .from("bookings")
          .update(returnUpdatePayload)
          .eq("id", bookingRecord.id)
          .eq("status", "active")
          .is(ownReturnField, null)
          .select("id")
          .maybeSingle();
      if (returnArrivalError) throw returnArrivalError;
      if (!returnArrivalChanged) {
        return jsonResponse(
          {
            error:
              "This booking changed state before the return could be recorded. Please refresh and try again.",
          },
          409,
        );
      }

      const bothArrivedForReturn = renter
        ? Boolean(bookingRecord.lister_return_arrived_at)
        : Boolean(bookingRecord.renter_return_arrived_at);

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: renter ? "renter_return_arrived" : "owner_return_arrived",
        entity_type: "booking",
        entity_id: bookingRecord.id,
        details: { return_arrival_time: returnArrivalTime, both_arrived: bothArrivedForReturn },
      });

      const returnCounterpartyId = renter
        ? bookingRecord.owner_id
        : bookingRecord.renter_id;
      const returnArrivalTitle = renter
        ? "Renter Arrived for Return"
        : "Lister Arrived for Return";
      const returnArrivalMessage = renter
        ? `The renter arrived to return ${getVehicleLabel(bookingRecord)}. Confirm your own arrival, then inspect the vehicle and submit your return photos.`
        : `The lister arrived to receive ${getVehicleLabel(bookingRecord)}. Confirm your own arrival so it is on record that you were there.`;
      await supabase.from("notifications").insert({
        user_id: returnCounterpartyId,
        title: returnArrivalTitle,
        message: returnArrivalMessage,
        type: "info",
        link: renter ? "/lister-bookings" : "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: returnCounterpartyId,
        title: returnArrivalTitle,
        message: returnArrivalMessage,
        link: renter ? "/lister-bookings" : "/my-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `return-arrive:${renter ? "renter" : "lister"}:${bookingRecord.id}`,
      });

      if (bothArrivedForReturn) {
        await supabase.from("notifications").insert([
          {
            user_id: bookingRecord.renter_id,
            title: "Both Parties Arrived for Return",
            message: `You and the lister are both at the return point for ${getVehicleLabel(bookingRecord)}. The lister will inspect the vehicle and submit return photos.`,
            type: "success",
            link: "/my-bookings",
          },
          {
            user_id: bookingRecord.owner_id,
            title: "Both Parties Arrived for Return",
            message: `You and the renter are both at the return point for ${getVehicleLabel(bookingRecord)}. Submit your return condition report, then tap "Confirm - Car Received."`,
            type: "success",
            link: "/lister-bookings",
          },
        ]);
        await sendUserNotificationEmail(supabase, {
          userId: bookingRecord.owner_id,
          title: "Both Parties Arrived for Return",
          message: `You and the renter are both at the return point for ${getVehicleLabel(bookingRecord)}. Submit your return condition report, then tap "Confirm - Car Received."`,
          link: "/lister-bookings",
          baseOrigin: new URL(req.url).origin,
          eventKey: `both-arrived-return:${bookingRecord.id}`,
        });
      }

      return jsonResponse({
        success: true,
        bookingId: bookingRecord.id,
        state: "return_arrived",
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
      // The lister carries the evidentiary burden at both ends of the trip
      // now (process-planning redesign): a required live-photo report at
      // pickup AND at return. The renter's own reports at either phase are
      // optional - their own record for their own protection, never a
      // blocker. The renter can complete any time after arrival with no
      // report requirement at all.
      if (owner) {
        // Only the lister's own check-in, deliberately - NOT the renter's.
        // At pickup a two-sided handshake is the only proof the car changed
        // hands, so that one stays. At the return it proves nothing the
        // lister has not already asserted: they are holding the car and
        // filing photos of it. Requiring the renter's tap here handed a
        // renter who had already driven off, and had nothing left to gain,
        // a veto over the lister's payout - which is released by this very
        // confirmation. A renter who never taps again cannot be made to.
        if (
          bookingRecord.status === "active" &&
          !bookingRecord.lister_return_arrived_at
        ) {
          return jsonResponse(
            {
              error:
                "Confirm your own arrival at the return before you can confirm receipt.",
            },
            409,
          );
        }
        const pickupReport = (conditionReports ?? []).find((r) => r.phase === "pickup");
        if (!pickupReport || !hasRequiredTripPhotos(pickupReport, "pickup")) {
          return jsonResponse(
            { error: "Submit your pickup condition report with live photos before finishing the trip." },
            409,
          );
        }
        const returnReport = (conditionReports ?? []).find((r) => r.phase === "return");
        if (!returnReport || !hasRequiredTripPhotos(returnReport, "return")) {
          return jsonResponse(
            { error: "Submit your return condition report with live photos before confirming receipt." },
            409,
          );
        }
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
        // Their own check-in only, mirroring the lister guard above. A
        // renter waiting on a lister who has not tapped yet can still record
        // that they handed the car back; the lister's silence is then the
        // lister-completion timeout's problem, not a wall for the renter.
        if (
          bookingRecord.status === "active" &&
          !bookingRecord.renter_return_arrived_at
        ) {
          return jsonResponse(
            {
              error:
                "Confirm your arrival at the return before you can mark the car returned.",
            },
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
        // The lister tapping "Car Received" finalizes the trip on its own.
        // They are the one party who can be certain the car is physically
        // back, and they cannot reach this point without having filed both
        // required photo reports - so there is nothing left to wait for.
        //
        // What was actually broken was the OTHER side: the renter's button
        // used to be gated on owner_completed, so it only appeared after the
        // booking was already completed, by which point this endpoint
        // rejected their call. The renter could never record their half, and
        // the lister-unresponsive safety net in expire-booking-deadlines.ts
        // (which needs renter_completed=true AND owner_completed=false) could
        // never match a booking. That gate is now removed in
        // MyBookingsPage.tsx - the renter can go first, which is what arms
        // the safety net.
        nextStatus = "completed";
        updatePayload.status = nextStatus;
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

      // The renter went first and the trip is not closed yet. A clock is now
      // running: after the lister-completion timeout this auto-completes and
      // releases the payout. The lister was never told any of that -
      // notifications only fired once a booking actually completed - so a
      // lister who simply forgot never got a nudge, and a lister who never
      // received the car back had no prompt to report it before the timeout
      // ran. Both need this message.
      if (renter && !completedByThisRequest) {
        const returnedTitle = "Renter marked the car returned";
        const returnedMessage = `The renter marked ${getVehicleLabel(bookingRecord)} as returned. Confirm you received it - or report a problem if the car was not actually handed back to you.`;
        await supabase.from("notifications").insert({
          user_id: bookingRecord.owner_id,
          title: returnedTitle,
          message: returnedMessage,
          type: "warning",
          link: "/lister-bookings",
        });
        await sendUserNotificationEmail(supabase, {
          userId: bookingRecord.owner_id,
          title: returnedTitle,
          message: returnedMessage,
          link: "/lister-bookings",
          baseOrigin: new URL(req.url).origin,
          eventKey: `renter-marked-returned:${bookingRecord.id}`,
        });
      }

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
    const coverageMessage = vehicleGuardMessage(error);
    if (coverageMessage) return jsonResponse({ error: coverageMessage }, 409);
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Booking action error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
