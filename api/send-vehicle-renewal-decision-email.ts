import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "../server/email.js";

export const config = { runtime: "edge" };

// Structural twin of api/send-vehicle-decision-email.ts, for the renewal
// (compliance-document resubmission) flow instead of the initial listing
// review - AdminVehicleRenewalsPage.tsx's three admin actions (flag a car
// for renewal, reject a resubmission, approve a resubmission) previously
// only ever wrote an in-app notification, unlike every other admin-decision
// flow in this codebase (licence resubmission, KYC verification, listing
// approval), which already pairs notification + email.
type RenewalDecision = "flagged" | "rejected" | "approved";
type Payload = {
  carId?: string;
  decision?: RenewalDecision;
  renewalId?: string;
  // Only used for "flagged" - the admin's just-typed reason has nowhere
  // else to be looked up from (unlike reject/approve, which read back
  // car_renewals.admin_notes once the row itself has been saved).
  reason?: string;
};

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
    const decision = payload.decision;
    if (!carId || !decision || !["flagged", "rejected", "approved"].includes(decision)) {
      return respond({ error: "Vehicle and renewal decision are required" }, 400);
    }

    const [{ data: actorProfile }, { data: car, error: carError }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", actor.id).maybeSingle(),
      supabase
        .from("cars")
        .select("id, owner_id, status, plate_number, car_models(name, car_brands(name))")
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

    const typedCar = car as unknown as {
      id: string;
      owner_id: string;
      status: string;
      plate_number: string;
      car_models: { name: string; car_brands: { name: string } } | null;
    };
    const vehicle = typedCar.car_models
      ? `${typedCar.car_models.car_brands.name} ${typedCar.car_models.name} (${typedCar.plate_number})`
      : `vehicle ${typedCar.plate_number}`;

    let recipientId: string;
    let title: string;
    let message: string;
    let link: string;

    if (decision === "flagged") {
      const reason = payload.reason?.trim();
      if (!reason || reason.length < 5) {
        return respond({ error: "A reason is required to email this decision" }, 400);
      }
      if (typedCar.status !== "renewal_required") {
        return respond({ error: "Vehicle status changed; refresh before sending email" }, 409);
      }
      recipientId = typedCar.owner_id;
      title = "Vehicle renewal required";
      message = `${vehicle} needs updated compliance documents before it can stay listed. Reason: ${reason}`;
      link = "/car-renewals";
    } else {
      const renewalId = payload.renewalId?.trim();
      if (!renewalId) return respond({ error: "renewalId is required for this decision" }, 400);
      const { data: renewal, error: renewalError } = await supabase
        .from("car_renewals")
        .select("id, lister_id, status, admin_notes")
        .eq("id", renewalId)
        .single();
      if (renewalError || !renewal) return respond({ error: "Renewal submission not found" }, 404);
      if (renewal.status !== decision) {
        return respond({ error: "Renewal status changed; refresh before sending email" }, 409);
      }
      recipientId = renewal.lister_id;
      link = decision === "approved" ? "/my-vehicles" : "/car-renewals";
      if (decision === "approved") {
        title = "Renewal approved";
        message = `${vehicle} is cleared and can be listed again.`;
      } else {
        title = "Renewal needs changes";
        message = `Your renewal for ${vehicle} was returned: ${renewal.admin_notes || "See the admin's note in your renewal history."}`;
      }
    }

    const result = await sendUserNotificationEmail(supabase, {
      userId: recipientId,
      title,
      message,
      link,
      baseOrigin: new URL(req.url).origin,
      eventKey: `vehicle-renewal-decision:${carId}:${payload.renewalId ?? "flag"}:${decision}`,
    });

    await supabase.from("audit_log").insert({
      user_id: actor.id,
      action: "vehicle_renewal_decision_email_attempted",
      entity_type: "car",
      entity_id: carId,
      details: { decision, renewal_id: payload.renewalId ?? null, delivery_state: result.state },
    });
    return respond({ success: result.state === "sent", deliveryState: result.state });
  } catch (error) {
    console.error("Vehicle renewal decision email failed", error);
    return respond({ error: "Unable to send vehicle renewal decision email" }, 500);
  }
}
