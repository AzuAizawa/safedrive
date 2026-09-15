import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "../server/email.js";

export const config = { runtime: "edge" };

// "removed" and "restored" are CHAPTER 95's admin_remove_car/admin_restore_car.
// The in-app notification is written by those functions; this sends the email.
type VehicleDecision = "approved" | "rejected" | "pending" | "removed" | "restored";
type Payload = { carId?: string; status?: VehicleDecision };

const DECISIONS: VehicleDecision[] = ["approved", "rejected", "pending", "removed", "restored"];

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
    if (!carId || !DECISIONS.includes(payload.status as VehicleDecision)) {
      return respond({ error: "Vehicle and review decision are required" }, 400);
    }
    const status = payload.status as VehicleDecision;
    const isRemoval = status === "removed" || status === "restored";

    const [{ data: actorProfile }, { data: car, error: carError }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", actor.id).maybeSingle(),
      supabase
        .from("cars")
        .select("id, owner_id, status, rejection_reason, deleted_at, deletion_reason, updated_at, plate_number, car_models(name, car_brands(name))")
        .eq("id", carId)
        .single(),
    ]);
    if (!actorProfile || !["admin", "super_admin"].includes(actorProfile.role)) {
      return respond({ error: "Administrator access required" }, 403);
    }
    // The same permission the database demands for the decision itself.
    const permission = isRemoval ? "vehicles.delete" : "vehicles.review";
    const { data: allowed } = await supabase.rpc("admin_can_for", {
      p_uid: actor.id,
      p_key: permission,
    });
    if (allowed !== true) {
      return respond({ error: `Missing permission: ${permission}` }, 403);
    }
    if (carError || !car) return respond({ error: "Vehicle not found" }, 404);

    const typedCar = car as unknown as {
      id: string;
      owner_id: string;
      status: string;
      rejection_reason: string | null;
      deleted_at: string | null;
      deletion_reason: string | null;
      updated_at: string;
      plate_number: string;
      car_models: { name: string; car_brands: { name: string } } | null;
    };

    // Only email what the car's current state actually says happened.
    const stateMatches =
      status === "removed"
        ? Boolean(typedCar.deleted_at)
        : status === "restored"
          ? !typedCar.deleted_at
          : !typedCar.deleted_at && typedCar.status === status;
    if (!stateMatches) {
      return respond({ error: "Vehicle status changed; refresh before sending email" }, 409);
    }

    const vehicle = typedCar.car_models
      ? `${typedCar.car_models.car_brands.name} ${typedCar.car_models.name} (${typedCar.plate_number})`
      : `vehicle ${typedCar.plate_number}`;
    const decision =
      status === "approved"
        ? { title: "Vehicle Approved", message: `Your ${vehicle} has been approved and is now listed on SafeDrive.`, link: "/my-vehicles" }
        : status === "rejected"
          ? { title: "Vehicle Review Needs Attention", message: `Your ${vehicle} was not approved. Reason: ${typedCar.rejection_reason || "Please review your vehicle information and documents, then submit again."}`, link: "/my-vehicles" }
          : status === "pending"
            ? { title: "Vehicle Returned to Review", message: `Your ${vehicle} was moved back to pending review. Reason: ${typedCar.rejection_reason || "An administrator needs updated information or documents."}`, link: "/my-vehicles" }
            : status === "removed"
              ? { title: "Vehicle Listing Removed", message: `SafeDrive removed your ${vehicle} from your listings. Reason: ${(typedCar.deletion_reason || "Not recorded").replace(/\.+$/, "")}. Past bookings of this car keep their records. If you believe this is a mistake, open a support case.`, link: "/support" }
              : { title: "Vehicle Listing Restored", message: `SafeDrive restored your ${vehicle}. ${typedCar.status === "pending" ? "It is back on your listings and under review; it can be booked again once an admin approves it." : "It is back on your listings."}`, link: "/my-vehicles" };

    // A car can be removed and restored more than once; each of those is its
    // own email, so the key carries the moment it happened.
    const eventKey =
      status === "removed"
        ? `vehicle-decision:${typedCar.id}:removed:${typedCar.deleted_at}`
        : status === "restored"
          ? `vehicle-decision:${typedCar.id}:restored:${typedCar.updated_at}`
          : `vehicle-decision:${typedCar.id}:${status}`;

    const result = await sendUserNotificationEmail(supabase, {
      userId: typedCar.owner_id,
      title: decision.title,
      message: decision.message,
      link: decision.link,
      baseOrigin: new URL(req.url).origin,
      eventKey,
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
