import { createSupabaseAdmin } from "../server/payoutAutomation";
import { processAutomaticRefundForBooking } from "../server/refundAutomation";

export const config = {
  runtime: "edge",
};

type ProcessRefundPayload = {
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
      .select("role")
      .eq("id", user.id)
      .single();

    if (requesterError || !requesterProfile || requesterProfile.role !== "super_admin") {
      return jsonResponse(
        { error: "Only a super admin can process refunds manually" },
        403,
      );
    }

    const payload = (await req.json().catch(() => ({}))) as ProcessRefundPayload;

    if (payload.bookingId) {
      // The batch path below only ever picks up cancelled bookings, but this
      // single-booking path used to pass any id straight through - and
      // processAutomaticRefundForBooking checks no booking status of its
      // own. A mistyped id, or a retry aimed at the wrong row, could refund
      // a booking that is mid-trip or already completed, leaving the
      // lister's payout unfunded. Same guard as the batch query.
      const { data: refundBooking, error: refundBookingError } = await supabase
        .from("bookings")
        .select("id, status")
        .eq("id", payload.bookingId)
        .maybeSingle();
      if (refundBookingError) throw refundBookingError;
      if (!refundBooking) {
        return jsonResponse({ error: "Booking not found" }, 404);
      }
      if (refundBooking.status !== "cancelled") {
        return jsonResponse(
          {
            error: `Only a cancelled booking can be refunded here (this one is "${refundBooking.status}").`,
          },
          409,
        );
      }

      const result = await processAutomaticRefundForBooking({
        supabase,
        bookingId: payload.bookingId,
        initiatedByUserId: user.id,
        reason: "others",
        note: "Manual refund attempt triggered from the admin refund queue.",
        allowedPaymentTypes: ["downpayment", "balance", "extension"],
        baseOrigin: new URL(req.url).origin,
      });

      return jsonResponse({
        success: true,
        mode: "single",
        result,
      });
    }

    const { data: bookings, error: bookingsError } = await supabase
      .from("bookings")
      .select("id")
      .eq("status", "cancelled")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (bookingsError) throw bookingsError;

    const results = [];
    for (const booking of bookings ?? []) {
      results.push(
        await processAutomaticRefundForBooking({
          supabase,
          bookingId: booking.id,
          initiatedByUserId: user.id,
          reason: "others",
          note: "Batch refund retry triggered from the admin refund queue.",
          allowedPaymentTypes: ["downpayment", "balance", "extension"],
          baseOrigin: new URL(req.url).origin,
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
            : "Unexpected refund processing error",
      },
      500,
    );
  }
}
