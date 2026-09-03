import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "./lib/email.js";

export const config = { runtime: "edge" };

type VehicleDecision = "approved" | "rejected" | "pending";
type Payload = { carId?: string; status?: VehicleDecision };

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const bearer = (req: Request) => {
  const header = req.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    const token = bearer(req);
    if (!url || !key) return respond({ error: "Missing Supabase server configuration" }, 503);
    if (!token) return respond({ error: "Missing authorization token" }, 401);

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user: actor }, error: actorError } = await supabase.auth.getUser(token);
    if (actorError || !actor) return respond({ error: "Unauthorized request" }, 401);

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const carId = payload.carId?.trim();
    if (!carId || !["approved", "rejected", "pending"].includes(payload.status || "")) {
      return respond({ error: "Vehicle and review decision are required" }, 400);
    }
    const status = payload.status as VehicleDecision;

    const [{ data: actorProfile }, { data: car, error: carError }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", actor.id).maybeSingle(),
      supabase
        .from("cars")
        .select("id, owner_id, status, rejection_reason, plate_number, car_models(name, car_brands(name))")
        .eq("id", carId)
        .single(),
    ]);
    if (!actorProfile || !["admin", "super_admin"].includes(actorProfile.role)) {
      return respond({ error: "Administrator access required" }, 403);
    }
    const { data: canReview } = await supabase.rpc("admin_can_for", {
      p_uid: actor.id,
      p_key: "vehicles.review",
    });
    if (canReview !== true) {
      return respond({ error: "Missing permission: vehicles.review" }, 403);
    }
    if (carError || !car) return respond({ error: "Vehicle not found" }, 404);
    if (car.status !== status) {
      return respond({ error: "Vehicle review status changed; refresh before sending email" }, 409);
    }

    const typedCar = car as unknown as {
      id: string;
      owner_id: string;
      rejection_reason: string | null;
      plate_number: string;
      car_models: { name: string; car_brands: { name: string } } | null;
    };
    const vehicle = typedCar.car_models
      ? `${typedCar.car_models.car_brands.name} ${typedCar.car_models.name} (${typedCar.plate_number})`
      : `vehicle ${typedCar.plate_number}`;
    const decision = status === "approved"
      ? { title: "Vehicle Approved", message: `Your ${vehicle} has been approved and is now listed on SafeDrive.` }
      : status === "rejected"
        ? { title: "Vehicle Review Needs Attention", message: `Your ${vehicle} was not approved. Reason: ${typedCar.rejection_reason || "Please review your vehicle information and documents, then submit again."}` }
        : { title: "Vehicle Returned to Review", message: `Your ${vehicle} was moved back to pending review. Reason: ${typedCar.rejection_reason || "An administrator needs updated information or documents."}` };
    const result = await sendUserNotificationEmail(supabase, {
      userId: typedCar.owner_id,
      title: decision.title,
      message: decision.message,
      link: "/my-vehicles",
      baseOrigin: new URL(req.url).origin,
      eventKey: `vehicle-decision:${typedCar.id}:${status}`,
    });

    await supabase.from("audit_log").insert({
      user_id: actor.id,
      action: "vehicle_decision_email_attempted",
      entity_type: "car",
      entity_id: typedCar.id,
      details: { decision: status, delivery_state: result.state },
    });
    return respond({ success: result.state === "sent", deliveryState: result.state });
  } catch (error) {
    console.error("Vehicle decision email failed", error);
    return respond({ error: "Unable to send vehicle decision email" }, 500);
  }
}
