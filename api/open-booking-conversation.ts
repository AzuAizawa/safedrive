import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type OpenConversationPayload = {
  bookingId?: string;
};

type ConversationBooking = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  start_date: string;
  end_date: string;
  cars: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: { name: string };
    } | null;
  } | null;
};

// A booking's messaging thread is only ever open while the trip is actually
// happening - the same range the "Message Lister" / "Message Renter" button
// is shown in. "completed" is also accepted here (not just fully_paid/active)
// so a click made right before the booking flips to completed still opens
// the thread instead of racing into a 403.
const OPENABLE_STATUSES = ["fully_paid", "active", "completed"];

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

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

    const payload = (await req.json()) as OpenConversationPayload;
    const bookingId = payload.bookingId?.trim();
    if (!bookingId) {
      return jsonResponse({ error: "Booking is required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized request" }, 401);

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        "id, renter_id, owner_id, status, start_date, end_date, cars(plate_number, car_models(name, car_brands(name)))",
      )
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) return jsonResponse({ error: "Booking not found" }, 404);

    const conversationBooking = booking as unknown as ConversationBooking;
    const isRenter = conversationBooking.renter_id === user.id;
    const isOwner = conversationBooking.owner_id === user.id;
    if (!isRenter && !isOwner) {
      return jsonResponse({ error: "You are not part of this booking" }, 403);
    }
    if (!OPENABLE_STATUSES.includes(conversationBooking.status)) {
      return jsonResponse(
        { error: "Messaging opens once the booking is paid and stays open until it is completed" },
        409,
      );
    }

    // One conversation thread per booking, reused by both members regardless
    // of who opens it first. participant_user_id set is what distinguishes it
    // from an unrelated "Report Booking" support ticket that happens to carry
    // the same booking_id.
    const { data: existingTicket, error: existingError } = await supabase
      .from("support_tickets")
      .select("id")
      .eq("booking_id", bookingId)
      .not("participant_user_id", "is", null)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existingTicket) {
      return jsonResponse({ success: true, ticketId: existingTicket.id });
    }

    const vehicleName = conversationBooking.cars?.car_models
      ? `${conversationBooking.cars.car_models.car_brands.name} ${conversationBooking.cars.car_models.name}`
      : "Vehicle";
    const vehicleLabel = conversationBooking.cars
      ? `${vehicleName} (${conversationBooking.cars.plate_number})`
      : vehicleName;

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        user_id: conversationBooking.renter_id,
        participant_user_id: conversationBooking.owner_id,
        booking_id: bookingId,
        subject: `Booking conversation: ${vehicleLabel} (${conversationBooking.start_date} to ${conversationBooking.end_date})`,
        tag: "booking_conversation",
        status: "open",
      })
      .select("id")
      .single();

    if (ticketError || !ticket) {
      throw ticketError ?? new Error("Failed to open booking conversation");
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "booking_conversation_opened",
      entity_type: "booking",
      entity_id: bookingId,
      details: { vehicle: vehicleLabel },
    });

    return jsonResponse({ success: true, ticketId: ticket.id });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Unexpected booking conversation error",
      },
      500,
    );
  }
}
