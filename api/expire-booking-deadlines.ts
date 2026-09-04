import { createClient } from "@supabase/supabase-js";
import { runBookingCompletionSideEffects } from "./lib/bookingCompletion.js";

export const config = {
  runtime: "edge",
};

const DEFAULT_LISTER_COMPLETION_TIMEOUT_HOURS = 18;

type DeadlineBooking = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: "pending" | "confirmed" | "awaiting_payment";
};

type UnpaidBooking = DeadlineBooking & { car_id: string };

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

const isAuthorizedCronRequest = (req: Request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error("CRON_SECRET must be configured before deadline expiry can run");
  }

  const authorization = req.headers.get("Authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  return bearerToken === cronSecret || req.headers.get("x-cron-secret") === cronSecret;
};

const notifyParticipants = async (
  supabase: ReturnType<typeof getSupabaseAdmin>,
  booking: DeadlineBooking,
  state: "owner_response_expired" | "payment_expired",
) => {
  const isOwnerResponseExpiry = state === "owner_response_expired";
  const notifications = [
    {
      user_id: booking.renter_id,
      title: isOwnerResponseExpiry ? "Booking Request Expired" : "Booking Payment Expired",
      message: isOwnerResponseExpiry
        ? "The lister did not respond before the 24-hour review window closed, so your request was released."
        : "The reservation payment deadline passed before PayMongo confirmed payment, so the booking was cancelled. This affects your completion rate.",
      type: "warning",
      link: "/my-bookings",
    },
    {
      user_id: booking.owner_id,
      title: isOwnerResponseExpiry ? "Booking Request Released" : "Booking Payment Expired",
      message: isOwnerResponseExpiry
        ? "A pending booking request was released because the 24-hour response window passed."
        : "A renter did not complete reservation payment before the deadline, so the booking was cancelled.",
      type: "warning",
      link: "/lister-bookings",
    },
  ];

  await supabase.from("notifications").insert(notifications);
  await supabase.from("audit_log").insert({
    user_id: null,
    action: state,
    entity_type: "booking",
    entity_id: booking.id,
    details: { previous_status: booking.status, automated: true },
  });
};

export default async function handler(req: Request) {
  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    if (!isAuthorizedCronRequest(req)) {
      return jsonResponse({ error: "Unauthorized deadline expiry run" }, 401);
    }

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data: unansweredBookings, error: unansweredError } = await supabase
      .from("bookings")
      .select("id, renter_id, owner_id, status")
      .eq("status", "pending")
      .not("owner_response_deadline", "is", null)
      .lte("owner_response_deadline", now)
      .limit(200);

    if (unansweredError) throw unansweredError;

    const { data: unpaidBookings, error: unpaidError } = await supabase
      .from("bookings")
      .select("id, renter_id, owner_id, car_id, status")
      .in("status", ["confirmed", "awaiting_payment"])
      .not("payment_deadline", "is", null)
      .lte("payment_deadline", now)
      .limit(200);

    if (unpaidError) throw unpaidError;

    let ownerResponseExpired = 0;
    let paymentExpired = 0;

    for (const booking of (unansweredBookings ?? []) as DeadlineBooking[]) {
      const { data: updated, error } = await supabase
        .from("bookings")
        .update({ status: "rejected", owner_response_deadline: null })
        .eq("id", booking.id)
        .eq("status", "pending")
        .lte("owner_response_deadline", now)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!updated) continue;

      await notifyParticipants(supabase, booking, "owner_response_expired");
      ownerResponseExpired += 1;
    }

    for (const booking of (unpaidBookings ?? []) as UnpaidBooking[]) {
      const { data: updated, error } = await supabase
        .from("bookings")
        .update({ status: "cancelled", payment_deadline: null })
        .eq("id", booking.id)
        .in("status", ["confirmed", "awaiting_payment"])
        .lte("payment_deadline", now)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!updated) continue;

      // The renter never completed the reservation payment (nothing was
      // captured), so there is no refund to run - but it ties up the car the
      // same way a late cancellation does, so it counts the same way against
      // their reliability record. Never fails the run: a missing/pre-CHAPTER-27
      // table must not block the actual booking cancellation above.
      try {
        await supabase.from("booking_cancellations").upsert(
          {
            booking_id: booking.id,
            cancelled_by_role: "renter",
            cancelled_by_id: booking.renter_id,
            lister_id: booking.owner_id,
            renter_id: booking.renter_id,
            car_id: booking.car_id,
            reason: "Payment deadline passed with no reservation payment captured.",
            was_late: true,
            had_captured_payment: false,
          },
          { onConflict: "booking_id" },
        );
      } catch {
        // Non-fatal - see comment above.
      }

      await notifyParticipants(supabase, booking, "payment_expired");
      paymentExpired += 1;
    }

    // --- Auto-complete when the renter finished but the lister never confirmed.
    const { data: settingsRow } = await supabase
      .from("platform_settings")
      .select("lister_completion_timeout_hours")
      .eq("id", "default")
      .maybeSingle();
    const timeoutHours = (() => {
      const parsed = Number(settingsRow?.lister_completion_timeout_hours);
      return Number.isFinite(parsed) && parsed >= 1 && parsed <= 72
        ? Math.round(parsed)
        : DEFAULT_LISTER_COMPLETION_TIMEOUT_HOURS;
    })();
    const timeoutCutoff = new Date(
      Date.now() - timeoutHours * 60 * 60 * 1000,
    ).toISOString();

    const { data: staleCompletions, error: staleError } = await supabase
      .from("bookings")
      .select("id, owner_id, renter_id, commission, renter_completed_at")
      .in("status", ["fully_paid", "active"])
      .eq("renter_completed", true)
      .eq("owner_completed", false)
      .not("renter_completed_at", "is", null)
      .lte("renter_completed_at", timeoutCutoff)
      .limit(100);
    if (staleError) throw staleError;

    let listerCompletionAuto = 0;
    for (const booking of staleCompletions ?? []) {
      const { data: updated, error } = await supabase
        .from("bookings")
        .update({
          owner_completed: true,
          owner_completed_at: new Date().toISOString(),
          status: "completed",
        })
        .eq("id", booking.id)
        .in("status", ["fully_paid", "active"])
        .eq("renter_completed", true)
        .eq("owner_completed", false)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!updated) continue;

      await supabase.from("audit_log").insert({
        user_id: null,
        action: "owner_completion_auto_after_timeout",
        entity_type: "booking",
        entity_id: booking.id,
        details: { timeout_hours: timeoutHours, automated: true },
      });
      await supabase.from("notifications").insert([
        {
          user_id: booking.owner_id,
          title: "Trip Auto-Completed",
          message: `The renter finished this trip and it was auto-completed after ${timeoutHours} hours without your confirmation.`,
          type: "warning",
          link: "/lister-bookings",
        },
        {
          user_id: booking.renter_id,
          title: "Trip Completed",
          message: "Your trip was completed automatically because the lister did not confirm in time.",
          type: "info",
          link: "/my-bookings",
        },
      ]);
      await runBookingCompletionSideEffects(
        supabase,
        {
          id: booking.id,
          owner_id: booking.owner_id,
          renter_id: booking.renter_id,
          commission: booking.commission,
        },
        { initiatedByUserId: null, baseOrigin: new URL(req.url).origin },
      );
      listerCompletionAuto += 1;
    }

    return jsonResponse({
      success: true,
      ownerResponseExpired,
      paymentExpired,
      listerCompletionAuto,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected booking deadline expiry error",
      },
      500,
    );
  }
}
