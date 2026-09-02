import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type DeadlineBooking = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: "pending" | "confirmed" | "awaiting_payment";
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
        : "The reservation payment deadline passed before PayMongo confirmed payment, so the booking was cancelled.",
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
      .select("id, renter_id, owner_id, status")
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

    for (const booking of (unpaidBookings ?? []) as DeadlineBooking[]) {
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

      await notifyParticipants(supabase, booking, "payment_expired");
      paymentExpired += 1;
    }

    return jsonResponse({
      success: true,
      ownerResponseExpired,
      paymentExpired,
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
