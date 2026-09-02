import {
  createSupabaseAdmin,
  processAutomaticPayoutForBooking,
} from "./lib/payoutAutomation";

export const config = {
  runtime: "edge",
};

type ProcessPayoutPayload = {
  bookingId?: string;
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

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
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
      .select("role, email")
      .eq("id", user.id)
      .single();

    if (requesterError || !requesterProfile) {
      return jsonResponse({ error: "Requester profile not found" }, 403);
    }

    if (requesterProfile.role !== "super_admin") {
      return jsonResponse(
        { error: "Only a super admin can process payout automation manually" },
        403,
      );
    }

    const payload = (await req.json().catch(() => ({}))) as ProcessPayoutPayload;
    const baseOrigin = new URL(req.url).origin;

    if (payload.bookingId) {
      const result = await processAutomaticPayoutForBooking({
        supabase,
        bookingId: payload.bookingId,
        initiatedByUserId: user.id,
        baseOrigin,
      });

      return jsonResponse({
        success: true,
        mode: "single",
        result,
      });
    }

    // Each booking triggers sequential PayMongo + DB calls. Keep the batch small
    // enough to finish inside the edge runtime wall-clock limit; a follow-up
    // invocation (or the caller re-running) drains the rest.
    const { data: bookings, error: bookingsError } = await supabase
      .from("bookings")
      .select("id")
      .eq("status", "completed")
      .eq("owner_completed", true)
      .eq("renter_completed", true)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (bookingsError) throw bookingsError;

    const results = [];
    for (const booking of bookings ?? []) {
      results.push(
        await processAutomaticPayoutForBooking({
          supabase,
          bookingId: booking.id,
          initiatedByUserId: user.id,
          baseOrigin,
        }),
      );
    }

    return jsonResponse({
      success: true,
      mode: "batch",
      processed: results.length,
      results,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected payout processing error",
      },
      500,
    );
  }
}
