import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type CarInquiryPayload = {
  carId?: string;
  message?: string;
};

type InquiryCar = {
  id: string;
  owner_id: string;
  plate_number: string;
  location: string | null;
  car_models: {
    name: string;
    car_brands: { name: string };
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

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

    const payload = (await req.json()) as CarInquiryPayload;
    const carId = payload.carId?.trim();
    const message = payload.message?.trim();
    if (!carId || !message) {
      return jsonResponse({ error: "Vehicle and inquiry message are required" }, 400);
    }
    if (message.length > 3000) {
      return jsonResponse({ error: "Inquiry message must be 3,000 characters or fewer" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized request" }, 401);

    const { data: car, error: carError } = await supabase
      .from("cars")
      .select(
        "id, owner_id, plate_number, location, car_models(name, car_brands(name))",
      )
      .eq("id", carId)
      .in("status", ["approved", "active"])
      .single();

    if (carError || !car) return jsonResponse({ error: "Vehicle not found" }, 404);

    const inquiryCar = car as unknown as InquiryCar;
    if (inquiryCar.owner_id === user.id) {
      return jsonResponse({ error: "You cannot inquire about your own listing" }, 403);
    }

    const vehicleName = inquiryCar.car_models
      ? `${inquiryCar.car_models.car_brands.name} ${inquiryCar.car_models.name}`
      : "Vehicle";
    const vehicleLabel = `${vehicleName} (${inquiryCar.plate_number})`;

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        user_id: user.id,
        participant_user_id: inquiryCar.owner_id,
        subject: `Car inquiry: ${vehicleLabel}`,
        tag: "inquiry,vehicle",
        status: "open",
      })
      .select("id")
      .single();

    if (ticketError || !ticket) {
      throw ticketError ?? new Error("Failed to open inquiry thread");
    }

    const ticketMessage = [
      `Vehicle: ${vehicleLabel}`,
      inquiryCar.location ? `Pickup/dropoff: ${inquiryCar.location}` : null,
      "",
      message,
    ]
      .filter((line) => line !== null)
      .join("\n");

    const { error: messageError } = await supabase.from("ticket_messages").insert({
      ticket_id: ticket.id,
      sender_id: user.id,
      message: ticketMessage,
    });
    if (messageError) throw messageError;

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "car_inquiry_sent",
      entity_type: "car",
      entity_id: inquiryCar.id,
      details: { lister_id: inquiryCar.owner_id, vehicle: vehicleLabel },
    });

    return jsonResponse({ success: true, ticketId: ticket.id });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Unexpected car inquiry error",
      },
      500,
    );
  }
}
