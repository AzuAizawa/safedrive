import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type EarlyReturnAction = "request" | "approve" | "reject" | "cancel";

type EarlyReturnPayload = {
  bookingId?: string;
  earlyReturnId?: string;
  action?: EarlyReturnAction;
  requestedEndDate?: string;
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
  base_price: number | string;
  renter_completed: boolean;
  owner_completed: boolean;
  cars: {
    plate_number: string;
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
  requested_end_date: string;
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

const parseDateOnly = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const todayDateOnly = () => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
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
      if (!payload.bookingId || !payload.requestedEndDate) {
        return jsonResponse(
          { error: "Booking and requested end date are required" },
          400,
        );
      }

      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(
          `
          id, car_id, renter_id, owner_id, status, start_date, end_date,
          base_price, renter_completed, owner_completed,
          cars ( plate_number, car_models ( name, car_brands ( name ) ) )
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
      if (!["fully_paid", "active"].includes(b.status)) {
        return jsonResponse(
          { error: "Only a paid or active booking can be shortened." },
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
      const curEnd = parseDateOnly(b.end_date);
      const start = parseDateOnly(b.start_date);
      if (!reqEnd || !curEnd || !start) {
        return jsonResponse({ error: "Invalid dates on this booking." }, 422);
      }
      if (reqEnd.getTime() >= curEnd.getTime()) {
        return jsonResponse(
          { error: "The new return date must be earlier than the current one." },
          422,
        );
      }
      if (reqEnd.getTime() <= start.getTime()) {
        return jsonResponse(
          { error: "The new return date must be after the pickup date." },
          422,
        );
      }
      if (reqEnd.getTime() < todayDateOnly().getTime()) {
        return jsonResponse(
          { error: "The new return date cannot be in the past." },
          422,
        );
      }

      const { data: existingEarly } = await supabase
        .from("booking_early_returns")
        .select("id")
        .eq("booking_id", b.id)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      if (existingEarly) {
        return jsonResponse(
          { error: "An early-return request is already pending." },
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

      const { data: row, error: insertError } = await supabase
        .from("booking_early_returns")
        .insert({
          booking_id: b.id,
          renter_id: b.renter_id,
          owner_id: b.owner_id,
          current_end_date: b.end_date,
          requested_end_date: payload.requestedEndDate,
          reason: payload.reason?.trim() || null,
          status: "pending",
        })
        .select("*")
        .single();
      if (insertError || !row) {
        throw insertError ?? new Error("Failed to create early-return request");
      }

      const msg = `The renter asked to return ${getVehicleLabel(b)} early, on ${payload.requestedEndDate} instead of ${b.end_date}.`;
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

      const goodwill = Math.max(0, Number(payload.goodwillRefundAmount ?? 0) || 0);
      const decisionNote = payload.ownerDecisionNote?.trim() || null;

      // Move the booking date first so a failure here leaves the request still
      // pending (retryable) rather than "approved" with the old date.
      const { error: bookingUpdateError } = await supabase
        .from("bookings")
        .update({ end_date: er.requested_end_date })
        .eq("id", er.booking_id);
      if (bookingUpdateError) throw bookingUpdateError;

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
            notes: `Lister-approved goodwill refund for an early return (new end ${er.requested_end_date}). Admin confirms the return method during refund review.`,
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
          ? `Your early return was approved. The new return date is ${er.requested_end_date} and the lister approved a PHP ${goodwill.toLocaleString()} goodwill refund, which SafeDrive support will release.`
          : `Your early return was approved. The new return date is ${er.requested_end_date}. There is no refund for the unused days.`;
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
          new_end_date: er.requested_end_date,
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
