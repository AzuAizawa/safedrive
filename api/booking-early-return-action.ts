import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "./lib/email.js";
import { blockedIpResponse } from "./lib/ipBlock.js";

export const config = {
  runtime: "edge",
};

type EarlyReturnAction = "request" | "approve" | "reject" | "cancel";

type EarlyReturnPayload = {
  bookingId?: string;
  earlyReturnId?: string;
  action?: EarlyReturnAction;
  requestedEndDate?: string;
  requestedEndTime?: string;
  reason?: string | null;
  ownerDecisionNote?: string | null;
  goodwillRefundAmount?: number | string | null;
};

type BookingRecord = {
  id: string;
  car_id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  start_date: string;
  end_date: string;
  dropoff_time: string | null;
  base_price: number | string;
  renter_completed: boolean;
  owner_completed: boolean;
  renter_return_arrived_at: string | null;
  cars: {
    plate_number: string;
    min_early_return_notice_hours: number | string | null;
    car_models: { name: string; car_brands: { name: string } };
  } | null;
};

type EarlyReturnRecord = {
  id: string;
  booking_id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  current_end_date: string;
  current_dropoff_time: string | null;
  requested_end_date: string;
  requested_end_time: string;
  response_deadline: string | null;
};

const RESPONSE_WINDOW_HOURS = 24;

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

const formatTimeLabel = (time: string | null) => {
  if (!time) return "";
  const [hour, minute] = time.split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return "";
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute.toString().padStart(2, "0")} ${period}`;
};

const parseDateOnly = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Manila-local wall time -> epoch ms, same -8h-from-naive-UTC pattern used
// across booking-action.ts / booking-incident-action.ts.
const manilaInstant = (dateOnly: string, time: string | null, fallback: string) => {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const [hh, mm] = (time || fallback).split(":").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0) - 8 * 60 * 60 * 1000;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

    const payload = (await req.json()) as EarlyReturnPayload;
    if (!payload.action) {
      return jsonResponse({ error: "Action is required" }, 400);
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
    const baseOrigin = new URL(req.url).origin;

    // ----------------------------------------------------------------- request
    if (payload.action === "request") {
      if (!payload.bookingId || !payload.requestedEndDate || !payload.requestedEndTime) {
        return jsonResponse(
          { error: "Booking, requested end date, and requested time are required" },
          400,
        );
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.requestedEndTime)) {
        return jsonResponse({ error: "Invalid requested time" }, 400);
      }

      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(
          `
          id, car_id, renter_id, owner_id, status, start_date, end_date, dropoff_time,
          base_price, renter_completed, owner_completed, renter_return_arrived_at,
          cars ( plate_number, min_early_return_notice_hours, car_models ( name, car_brands ( name ) ) )
        `,
        )
        .eq("id", payload.bookingId)
        .single();
      if (bookingError || !booking) {
        return jsonResponse({ error: "Booking not found" }, 404);
      }

      const b = booking as unknown as BookingRecord;
      if (b.renter_id !== user.id) {
        return jsonResponse(
          { error: "Only the renter can request an early return" },
          403,
        );
      }
      // Only an active trip. An early return hands the car back sooner than
      // agreed, which cannot apply before the renter has the car - at
      // fully_paid the handover has not happened yet. Shortening a booking
      // that has not started is a cancellation, and that is a different flow
      // with its own refund policy.
      if (b.status !== "active") {
        return jsonResponse(
          {
            error:
              "An early return can only be requested once the trip is running. Cancel the booking instead if it has not started.",
          },
          409,
        );
      }

      // Already checked in at the return - the car is being handed back now,
      // so there is nothing left to shorten. Same reasoning as the extension
      // guard in api/booking-extension-action.ts.
      if (b.renter_return_arrived_at) {
        return jsonResponse(
          {
            error:
              "You already checked in to return the car, so there is nothing left to shorten.",
          },
          409,
        );
      }
      if (b.renter_completed || b.owner_completed) {
        return jsonResponse(
          { error: "This trip is already being completed." },
          409,
        );
      }

      const reqEnd = parseDateOnly(payload.requestedEndDate);
      const start = parseDateOnly(b.start_date);
      // Instant (date+time) comparisons, not date-only - a same-day early
      // return (same calendar day as the current end_date, but an earlier
      // time) is a valid request as long as it's genuinely earlier than the
      // current agreed return instant.
      const requestedInstant = manilaInstant(
        payload.requestedEndDate,
        payload.requestedEndTime,
        "18:00",
      );
      const currentInstant = manilaInstant(b.end_date, b.dropoff_time, "18:00");
      if (!reqEnd || !start || requestedInstant === null || currentInstant === null) {
        return jsonResponse({ error: "Invalid dates on this booking." }, 422);
      }
      if (requestedInstant >= currentInstant) {
        return jsonResponse(
          { error: "The new return date and time must be earlier than the current return date and time." },
          422,
        );
      }
      if (reqEnd.getTime() <= start.getTime()) {
        return jsonResponse(
          { error: "The new return date must be after the pickup date." },
          422,
        );
      }
      if (requestedInstant < Date.now()) {
        return jsonResponse(
          { error: "The new return date and time cannot be in the past." },
          422,
        );
      }

      // The car's configured minimum early-return notice was shown to the
      // renter but never actually enforced - a renter could request an
      // effectively same-day early return, giving the lister no real time
      // to prepare for the impromptu meetup.
      const minNoticeHours = Number(b.cars?.min_early_return_notice_hours);
      if (Number.isFinite(minNoticeHours) && minNoticeHours > 0) {
        if (requestedInstant - Date.now() < minNoticeHours * 60 * 60 * 1000) {
          return jsonResponse(
            {
              error: `This car requires at least ${minNoticeHours} hour${minNoticeHours === 1 ? "" : "s"} of notice for an early return. Choose a later date or time.`,
            },
            422,
          );
        }
      }

      // Reported rule: once an early return is approved, that's the one
      // shot at it - if it doesn't happen, the fallback (this file's
      // "approve" comment, and src/lib/bookingLifecycle.ts) hands the
      // return back to the ORIGINAL deadline rather than opening the door
      // to an endless string of new early-return attempts. Only a pending
      // request may still be superseded (withdrawn via "cancel", or simply
      // left to expire) before a new one is sent.
      const { data: existingEarly } = await supabase
        .from("booking_early_returns")
        .select("id, status")
        .eq("booking_id", b.id)
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingEarly?.status === "pending") {
        return jsonResponse(
          { error: "An early-return request is already pending." },
          409,
        );
      }
      if (existingEarly?.status === "approved") {
        return jsonResponse(
          {
            error:
              "An early return was already approved for this booking. If it didn't happen, the original return date and time stand - a new early-return request can't be sent for this trip.",
          },
          409,
        );
      }

      const { data: pendingExtension } = await supabase
        .from("booking_extensions")
        .select("id")
        .eq("booking_id", b.id)
        .in("status", ["pending", "approved"])
        .limit(1)
        .maybeSingle();
      if (pendingExtension) {
        return jsonResponse(
          {
            error:
              "This booking has an open extension request. Resolve it before requesting an early return.",
          },
          409,
        );
      }

      // The lister must decide within 24h, capped at the requested (earlier)
      // return instant itself - deciding after the renter already wanted
      // the car back is moot. Same "never past the moment that matters" cap
      // already used for payment_deadline/balance_deadline.
      const responseDeadline = new Date(
        Math.min(Date.now() + RESPONSE_WINDOW_HOURS * 60 * 60 * 1000, requestedInstant),
      ).toISOString();

      const { data: row, error: insertError } = await supabase
        .from("booking_early_returns")
        .insert({
          booking_id: b.id,
          renter_id: b.renter_id,
          owner_id: b.owner_id,
          current_end_date: b.end_date,
          current_dropoff_time: b.dropoff_time,
          requested_end_date: payload.requestedEndDate,
          requested_end_time: payload.requestedEndTime,
          reason: payload.reason?.trim() || null,
          status: "pending",
          response_deadline: responseDeadline,
        })
        .select("*")
        .single();
      if (insertError || !row) {
        throw insertError ?? new Error("Failed to create early-return request");
      }

      const msg = `The renter asked to return ${getVehicleLabel(b)} early, by ${payload.requestedEndDate} at ${formatTimeLabel(payload.requestedEndTime)} instead of ${b.end_date} at ${formatTimeLabel(b.dropoff_time)}.`;
      await supabase.from("notifications").insert({
        user_id: b.owner_id,
        title: "Early return requested",
        message: msg,
        type: "info",
        link: "/lister-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: b.owner_id,
        title: "Early return requested",
        message: msg,
        link: "/lister-bookings",
        baseOrigin,
        eventKey: `early-return-requested:${row.id}`,
      });
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "booking_early_return_requested",
        entity_type: "booking_early_return",
        entity_id: row.id,
        details: {
          booking_id: b.id,
          current_end_date: b.end_date,
          requested_end_date: payload.requestedEndDate,
        },
      });

      return jsonResponse({ success: true, earlyReturn: row, state: "requested" });
    }

    // --------------------------------------------------- approve / reject / cancel
    if (!payload.earlyReturnId) {
      return jsonResponse({ error: "Early-return ID is required" }, 400);
    }

    const { data: early, error: earlyError } = await supabase
      .from("booking_early_returns")
      .select("*")
      .eq("id", payload.earlyReturnId)
      .single();
    if (earlyError || !early) {
      return jsonResponse({ error: "Early-return request not found" }, 404);
    }
    const er = early as EarlyReturnRecord;

    // Defensive freshness check, same idiom as booking-action.ts's accept
    // handler: the cron (api/expire-booking-deadlines.ts) is the primary
    // path that flips a stale pending request to 'expired' with full
    // notifications - this just closes the narrow race window between the
    // deadline passing and the next cron tick, for whichever action arrives
    // first.
    if (
      er.status === "pending" &&
      er.response_deadline &&
      Date.now() > new Date(er.response_deadline).getTime()
    ) {
      await supabase
        .from("booking_early_returns")
        .update({ status: "expired" })
        .eq("id", er.id)
        .eq("status", "pending");
      return jsonResponse(
        { error: "This early-return request expired before it was decided." },
        409,
      );
    }

    if (payload.action === "approve") {
      if (er.owner_id !== user.id) {
        return jsonResponse(
          { error: "Only the lister can approve an early return" },
          403,
        );
      }
      if (er.status !== "pending") {
        return jsonResponse(
          { error: "Only a pending early-return request can be approved." },
          409,
        );
      }

      // The amount arrives straight from the client body, and the floor
      // below used to be the ONLY bound on it - a lister could approve a
      // goodwill refund of any size at all, far beyond what the renter ever
      // paid, and mark-manual-refund.ts would happily release it. Clamp to
      // what was actually captured for this booking, the same way
      // api/booking-incident-action.ts already clamps its recommended
      // refund. Same refundable payment types as
      // api/lib/cancellationRefundPlan.ts.
      const { data: bookingPayments, error: bookingPaymentsError } = await supabase
        .from("payments")
        .select("amount, payment_type, status")
        .eq("booking_id", er.booking_id);
      if (bookingPaymentsError) throw bookingPaymentsError;
      const capturedTotal = (bookingPayments ?? [])
        .filter(
          (payment) =>
            ["downpayment", "balance"].includes(String(payment.payment_type)) &&
            payment.status === "completed" &&
            Number(payment.amount) > 0,
        )
        .reduce((total, payment) => total + Number(payment.amount || 0), 0);

      const requestedGoodwill = Math.max(
        0,
        Number(payload.goodwillRefundAmount ?? 0) || 0,
      );
      const goodwill =
        Math.round(Math.min(requestedGoodwill, Math.max(capturedTotal, 0)) * 100) / 100;
      const decisionNote = payload.ownerDecisionNote?.trim() || null;

      // Deliberately does NOT touch bookings.end_date/dropoff_time - those
      // columns permanently mean "the ORIGINAL agreed return date+time" and
      // stay the sole input to every availability/overlap check elsewhere
      // (the bookings_no_active_date_overlap exclusion constraint,
      // create-booking.ts's overlap check, booking-extension-action.ts's
      // day-math anchor, both renter/lister calendars). The approved early
      // date+time lives only on this row; if both sides miss it, the return
      // flow (api/booking-action.ts, src/lib/bookingLifecycle.ts) falls
      // back to the original instant automatically - a safety net that
      // would be impossible if this handler had already overwritten it.
      const requestedTimeLabel = formatTimeLabel(er.requested_end_time);

      const { data: changed, error: updateError } = await supabase
        .from("booking_early_returns")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
          owner_decision_note: decisionNote,
          goodwill_refund_amount: goodwill,
        })
        .eq("id", er.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!changed) {
        return jsonResponse(
          { error: "This request changed state before it could be approved." },
          409,
        );
      }

      let refundPaymentId: string | null = null;
      if (goodwill > 0) {
        const { data: refundPayment, error: refundError } = await supabase
          .from("payments")
          .insert({
            booking_id: er.booking_id,
            amount: -Math.abs(goodwill),
            payment_type: "refund",
            status: "pending",
            payment_method: "manual_review",
            transaction_id: null,
            notes: `Lister-approved goodwill refund for an early return (requested return ${er.requested_end_date} at ${requestedTimeLabel}). Admin confirms the return method during refund review.`,
          })
          .select("id")
          .single();
        if (refundError) throw refundError;
        refundPaymentId = (refundPayment?.id as string | undefined) ?? null;

        const { data: superAdmins } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "super_admin")
          .is("deleted_at", null);
        if (superAdmins?.length) {
          await supabase.from("notifications").insert(
            superAdmins.map((admin) => ({
              user_id: admin.id,
              title: "Goodwill refund to review",
              message: `A lister approved a PHP ${goodwill.toLocaleString()} goodwill refund for an early return. Confirm and release it in Financial Reviews.`,
              type: "warning",
              link: "/admin/financial-reviews?view=refunds",
            })),
          );
        }
      }

      const renterMsg =
        goodwill > 0
          ? `Your early return was approved. Return by ${er.requested_end_date} at ${requestedTimeLabel} and the lister approved a PHP ${goodwill.toLocaleString()} goodwill refund, which SafeDrive support will release. If neither of you confirms return arrival by then (plus a short grace window), the original return time becomes available again automatically.`
          : `Your early return was approved. Return by ${er.requested_end_date} at ${requestedTimeLabel}. There is no refund for the unused days. If neither of you confirms return arrival by then (plus a short grace window), the original return time becomes available again automatically.`;
      await supabase.from("notifications").insert({
        user_id: er.renter_id,
        title: "Early return approved",
        message: renterMsg,
        type: "success",
        link: "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: er.renter_id,
        title: "Early return approved",
        message: renterMsg,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `early-return-approved:${er.id}`,
      });
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "booking_early_return_approved",
        entity_type: "booking_early_return",
        entity_id: er.id,
        details: {
          booking_id: er.booking_id,
          requested_end_date: er.requested_end_date,
          requested_end_time: er.requested_end_time,
          goodwill_refund_amount: goodwill,
          refund_payment_id: refundPaymentId,
          note: decisionNote,
        },
      });

      return jsonResponse({ success: true, earlyReturnId: er.id, state: "approved" });
    }

    if (payload.action === "reject") {
      if (er.owner_id !== user.id) {
        return jsonResponse(
          { error: "Only the lister can reject an early return" },
          403,
        );
      }
      if (er.status !== "pending") {
        return jsonResponse(
          { error: "Only a pending early-return request can be rejected." },
          409,
        );
      }
      const decisionNote = payload.ownerDecisionNote?.trim() || null;
      const { data: changed, error: updateError } = await supabase
        .from("booking_early_returns")
        .update({
          status: "rejected",
          rejected_at: new Date().toISOString(),
          owner_decision_note: decisionNote,
        })
        .eq("id", er.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!changed) {
        return jsonResponse(
          { error: "This request changed state before it could be rejected." },
          409,
        );
      }

      const msg = decisionNote
        ? `Your early-return request was declined. Reason: ${decisionNote}`
        : "Your early-return request was declined by the lister. The original return date stands.";
      await supabase.from("notifications").insert({
        user_id: er.renter_id,
        title: "Early return declined",
        message: msg,
        type: "error",
        link: "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: er.renter_id,
        title: "Early return declined",
        message: msg,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `early-return-rejected:${er.id}`,
      });
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "booking_early_return_rejected",
        entity_type: "booking_early_return",
        entity_id: er.id,
        details: { booking_id: er.booking_id, reason: decisionNote },
      });

      return jsonResponse({ success: true, earlyReturnId: er.id, state: "rejected" });
    }

    if (payload.action === "cancel") {
      if (er.renter_id !== user.id) {
        return jsonResponse(
          { error: "Only the renter can cancel an early-return request" },
          403,
        );
      }
      if (er.status !== "pending") {
        return jsonResponse(
          { error: "Only a pending early-return request can be cancelled." },
          409,
        );
      }
      const { data: changed, error: updateError } = await supabase
        .from("booking_early_returns")
        .update({ status: "cancelled" })
        .eq("id", er.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!changed) {
        return jsonResponse(
          { error: "This request changed state before it could be cancelled." },
          409,
        );
      }

      await supabase.from("notifications").insert({
        user_id: er.owner_id,
        title: "Early return withdrawn",
        message: "The renter withdrew their early-return request.",
        type: "info",
        link: "/lister-bookings",
      });
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "booking_early_return_cancelled",
        entity_type: "booking_early_return",
        entity_id: er.id,
        details: { booking_id: er.booking_id },
      });

      return jsonResponse({ success: true, earlyReturnId: er.id, state: "cancelled" });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Early-return action failed unexpectedly",
      },
      500,
    );
  }
}
