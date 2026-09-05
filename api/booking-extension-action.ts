import { addDays } from "date-fns";
import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

// Same ceiling api/create-booking.ts already enforces on a brand-new
// booking's own start-to-end window (both dates must fall within 30 days of
// today) - reused here so a chain of extensions can't turn one booking into
// an unbounded, indefinitely-running rental that the original 30-day design
// never intended. Caps the TOTAL trip length (original days + every
// approved extension), not just this one request's added days.
const MAX_TOTAL_RENTAL_DAYS = 30;

type ExtensionAction = "request" | "approve" | "reject" | "cancel";

type ExtensionActionPayload = {
  bookingId?: string;
  extensionId?: string;
  action?: ExtensionAction;
  requestedEndDate?: string;
  reason?: string | null;
  fuelTopUpAmount?: number | string | null;
  ownerDecisionNote?: string | null;
};

type BookingRecord = {
  id: string;
  car_id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  end_date: string;
  total_days: number;
  base_price: number;
  commission: number;
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

type BookingExtensionRecord = {
  id: string;
  booking_id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  requested_end_date: string;
  extension_days: number;
  requested_total_days: number;
  reason: string;
  fuel_top_up_amount: number;
  extension_amount: number;
  total_additional_amount: number;
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

const diffDays = (fromDate: string, toDate: string) => {
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / 86_400_000);
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

    const payload = (await req.json()) as ExtensionActionPayload;
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

    if (payload.action === "request") {
      if (!payload.bookingId || !payload.requestedEndDate || !payload.reason?.trim()) {
        return jsonResponse(
          { error: "Booking, requested end date, and reason are required" },
          400,
        );
      }

      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(
          `
          id,
          car_id,
          renter_id,
          owner_id,
          status,
          end_date,
          total_days,
          base_price,
          commission,
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
      if (bookingRecord.renter_id !== user.id) {
        return jsonResponse({ error: "Only the renter can request an extension" }, 403);
      }

      if (!["fully_paid", "active"].includes(bookingRecord.status)) {
        return jsonResponse(
          { error: "Settle the full booking balance before requesting an extension." },
          409,
        );
      }

      const extensionDays = diffDays(bookingRecord.end_date, payload.requestedEndDate);
      if (!extensionDays || extensionDays <= 0) {
        return jsonResponse(
          { error: "Requested end date must be after the current booking end date." },
          422,
        );
      }

      const fuelTopUpAmount = Math.max(0, Number(payload.fuelTopUpAmount ?? 0) || 0);
      const dailyRate = Number(bookingRecord.base_price) / Math.max(1, bookingRecord.total_days);
      const dailyCommission =
        Number(bookingRecord.commission) / Math.max(1, bookingRecord.total_days);
      const extensionAmount = Math.round(dailyRate * extensionDays * 100) / 100;
      const extensionCommission = Math.round(dailyCommission * extensionDays * 100) / 100;
      const totalAdditionalAmount =
        Math.round((extensionAmount + extensionCommission + fuelTopUpAmount) * 100) / 100;

      const { data: existingPending } = await supabase
        .from("booking_extensions")
        .select("id")
        .eq("booking_id", bookingRecord.id)
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingPending) {
        return jsonResponse(
          { error: "An extension request is already pending or awaiting payment." },
          409,
        );
      }

      // The extra days must not collide with another active booking: another
      // renter's trip on this same car, or another trip of this renter on any
      // car (one trip at a time - the account holder is the driver).
      const extWindowStart = parseDateOnly(bookingRecord.end_date);
      const extWindowEnd = parseDateOnly(payload.requestedEndDate);
      if (extWindowStart && extWindowEnd) {
        const { data: activeBookings, error: activeBookingError } = await supabase
          .from("bookings")
          .select("id, car_id, renter_id, start_date, end_date")
          .in("status", [
            "pending",
            "confirmed",
            "awaiting_payment",
            "downpayment_paid",
            "fully_paid",
            "active",
          ])
          .neq("id", bookingRecord.id);
        if (activeBookingError) throw activeBookingError;

        const collides = (activeBookings ?? []).some((other) => {
          const otherStart = parseDateOnly(other.start_date);
          const otherEnd = parseDateOnly(other.end_date);
          if (!otherStart || !otherEnd) return false;
          const datesOverlap =
            extWindowStart.getTime() <= otherEnd.getTime() &&
            extWindowEnd.getTime() >= otherStart.getTime();
          if (!datesOverlap) return false;
          return (
            other.car_id === bookingRecord.car_id ||
            other.renter_id === bookingRecord.renter_id
          );
        });

        if (collides) {
          return jsonResponse(
            {
              error:
                "The new return date overlaps another booking - this car is reserved by someone else then, or you already have a trip on those dates.",
            },
            409,
          );
        }
      }

      const requestedTotalDays = bookingRecord.total_days + extensionDays;
      if (requestedTotalDays > MAX_TOTAL_RENTAL_DAYS) {
        return jsonResponse(
          {
            error: `A single continuous rental (including every extension) can't exceed ${MAX_TOTAL_RENTAL_DAYS} days. This trip is already ${bookingRecord.total_days} day${bookingRecord.total_days === 1 ? "" : "s"}, so at most ${Math.max(0, MAX_TOTAL_RENTAL_DAYS - bookingRecord.total_days)} more day${MAX_TOTAL_RENTAL_DAYS - bookingRecord.total_days === 1 ? "" : "s"} can be requested. For a longer stay, complete this trip and book again.`,
          },
          422,
        );
      }

      const { data: extensionRow, error: extensionError } = await supabase
        .from("booking_extensions")
        .insert({
          booking_id: bookingRecord.id,
          renter_id: bookingRecord.renter_id,
          owner_id: bookingRecord.owner_id,
          current_end_date: bookingRecord.end_date,
          requested_end_date: payload.requestedEndDate,
          extension_days: extensionDays,
          requested_total_days: requestedTotalDays,
          reason: payload.reason.trim(),
          fuel_top_up_amount: fuelTopUpAmount,
          extension_amount: extensionAmount,
          total_additional_amount: totalAdditionalAmount,
          status: "pending",
        })
        .select("*")
        .single();

      if (extensionError || !extensionRow) {
        throw extensionError ?? new Error("Failed to create extension request");
      }

      await supabase.from("notifications").insert({
        user_id: bookingRecord.owner_id,
        title: "Extension Request Submitted",
        message: `The renter requested to extend ${getVehicleLabel(bookingRecord)} by ${extensionDays} day${extensionDays === 1 ? "" : "s"}.`,
        type: "info",
        link: "/lister-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: bookingRecord.owner_id,
        title: "Extension Request Submitted",
        message: `The renter requested to extend ${getVehicleLabel(bookingRecord)} by ${extensionDays} day${extensionDays === 1 ? "" : "s"}.`,
        link: "/lister-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `extension-requested:${extensionRow.id}`,
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "booking_extension_requested",
        entity_type: "booking_extension",
        entity_id: extensionRow.id,
        details: {
          booking_id: bookingRecord.id,
          requested_end_date: payload.requestedEndDate,
          extension_days: extensionDays,
          extension_amount: extensionAmount,
          extension_commission: extensionCommission,
          fuel_top_up_amount: fuelTopUpAmount,
          total_additional_amount: totalAdditionalAmount,
        },
      });

      return jsonResponse({
        success: true,
        extension: extensionRow,
        state: "requested",
      });
    }

    if (!payload.extensionId) {
      return jsonResponse({ error: "Extension ID is required for this action" }, 400);
    }

    const { data: extension, error: extensionError } = await supabase
      .from("booking_extensions")
      .select("*")
      .eq("id", payload.extensionId)
      .single();

    if (extensionError || !extension) {
      return jsonResponse({ error: "Extension request not found" }, 404);
    }

    const extensionRecord = extension as BookingExtensionRecord;

    if (payload.action === "approve") {
      if (extensionRecord.owner_id !== user.id) {
        return jsonResponse({ error: "Only the lister can approve this extension" }, 403);
      }
      if (extensionRecord.status !== "pending") {
        return jsonResponse({ error: "Only pending extensions can be approved." }, 409);
      }

      const paymentDeadline = addDays(new Date(), 1).toISOString();
      const decisionNote = payload.ownerDecisionNote?.trim() || null;

      const { data: extensionStateChanged, error: updateError } = await supabase
        .from("booking_extensions")
        .update({
          status: "approved",
          owner_decision_note: decisionNote,
          approved_at: new Date().toISOString(),
          payment_deadline: paymentDeadline,
        })
        .eq("id", extensionRecord.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!extensionStateChanged) {
        return jsonResponse(
          {
            error:
              "This extension request changed state before it could be approved. Please refresh and try again.",
          },
          409,
        );
      }

      await supabase.from("notifications").insert({
        user_id: extensionRecord.renter_id,
        title: "Extension Approved",
        message: `Your extension request was approved. Complete the added payment within 24 hours to finalize the new return date.`,
        type: "success",
        link: "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: extensionRecord.renter_id,
        title: "Extension Approved",
        message: "Your extension request was approved. Complete the added payment within 24 hours to finalize the new return date.",
        link: "/my-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `extension-approved:${extensionRecord.id}`,
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "booking_extension_approved",
        entity_type: "booking_extension",
        entity_id: extensionRecord.id,
        details: {
          booking_id: extensionRecord.booking_id,
          payment_deadline: paymentDeadline,
          note: decisionNote,
        },
      });

      return jsonResponse({
        success: true,
        extensionId: extensionRecord.id,
        state: "approved",
      });
    }

    if (payload.action === "reject") {
      if (extensionRecord.owner_id !== user.id) {
        return jsonResponse({ error: "Only the lister can reject this extension" }, 403);
      }
      if (extensionRecord.status !== "pending") {
        return jsonResponse({ error: "Only pending extensions can be rejected." }, 409);
      }

      const decisionNote = payload.ownerDecisionNote?.trim() || null;
      const { data: extensionStateChanged, error: updateError } = await supabase
        .from("booking_extensions")
        .update({
          status: "rejected",
          owner_decision_note: decisionNote,
          rejected_at: new Date().toISOString(),
        })
        .eq("id", extensionRecord.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!extensionStateChanged) {
        return jsonResponse(
          {
            error:
              "This extension request changed state before it could be rejected. Please refresh and try again.",
          },
          409,
        );
      }

      await supabase.from("notifications").insert({
        user_id: extensionRecord.renter_id,
        title: "Extension Rejected",
        message: decisionNote
          ? `Your extension request was rejected. Reason: ${decisionNote}`
          : "Your extension request was rejected by the lister.",
        type: "error",
        link: "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: extensionRecord.renter_id,
        title: "Extension Rejected",
        message: decisionNote
          ? `Your extension request was rejected. Reason: ${decisionNote}`
          : "Your extension request was rejected by the lister.",
        link: "/my-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `extension-rejected:${extensionRecord.id}`,
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "booking_extension_rejected",
        entity_type: "booking_extension",
        entity_id: extensionRecord.id,
        details: {
          booking_id: extensionRecord.booking_id,
          reason: decisionNote,
        },
      });

      return jsonResponse({
        success: true,
        extensionId: extensionRecord.id,
        state: "rejected",
      });
    }

    if (payload.action === "cancel") {
      if (extensionRecord.renter_id !== user.id) {
        return jsonResponse({ error: "Only the renter can cancel this extension" }, 403);
      }
      if (!["pending", "approved"].includes(extensionRecord.status)) {
        return jsonResponse(
          { error: "Only pending or approved extensions can be cancelled." },
          409,
        );
      }

      const { data: extensionStateChanged, error: updateError } = await supabase
        .from("booking_extensions")
        .update({ status: "cancelled" })
        .eq("id", extensionRecord.id)
        .in("status", ["pending", "approved"])
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!extensionStateChanged) {
        return jsonResponse(
          {
            error:
              "This extension request changed state before it could be cancelled. Please refresh and try again.",
          },
          409,
        );
      }

      await supabase.from("notifications").insert({
        user_id: extensionRecord.owner_id,
        title: "Extension Cancelled",
        message: "The renter cancelled the pending extension request.",
        type: "info",
        link: "/lister-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: extensionRecord.owner_id,
        title: "Extension Cancelled",
        message: "The renter cancelled the pending extension request.",
        link: "/lister-bookings",
        baseOrigin: new URL(req.url).origin,
        eventKey: `extension-cancelled:${extensionRecord.id}`,
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "booking_extension_cancelled",
        entity_type: "booking_extension",
        entity_id: extensionRecord.id,
        details: {
          booking_id: extensionRecord.booking_id,
        },
      });

      return jsonResponse({
        success: true,
        extensionId: extensionRecord.id,
        state: "cancelled",
      });
    }

    return jsonResponse({ error: "Unsupported action" }, 400);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Booking extension action error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
