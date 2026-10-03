import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "../server/email.js";

export const config = { runtime: "edge" };

// CHAPTER 118. When an admin sends a vehicle document back, review_vehicle_documents
// writes the in-app notice; this emails the owner the same words, read from
// vehicle_document_correction_message so the two cannot drift apart.
type Payload = { documentId?: string };

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
    const documentId = payload.documentId?.trim();
    if (!documentId) return respond({ error: "Document is required" }, 400);

    const [{ data: actorProfile }, { data: document, error: documentError }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", actor.id).maybeSingle(),
      supabase
        .from("car_documents")
        .select("id, car_id, document_type, compliance_status, review_reason, reviewed_at, cars(owner_id, plate_number, status)")
        .eq("id", documentId)
        .single(),
    ]);
    if (!actorProfile || !["admin", "super_admin"].includes(actorProfile.role)) {
      return respond({ error: "Administrator access required" }, 403);
    }
    // The same permission the database demands for the review itself.
    const { data: allowed } = await supabase.rpc("admin_can_for", {
      p_uid: actor.id,
      p_key: "vehicles.review",
    });
    if (allowed !== true) return respond({ error: "Missing permission: vehicles.review" }, 403);
    if (documentError || !document) return respond({ error: "Document not found" }, 404);

    const typed = document as unknown as {
      id: string;
      car_id: string;
      document_type: string;
      compliance_status: string;
      review_reason: string | null;
      reviewed_at: string | null;
      cars: { owner_id: string; plate_number: string | null; status: string } | null;
    };

    // Only email what the document's current state actually says happened.
    if (!["rejected", "revoked"].includes(typed.compliance_status) || !typed.cars) {
      return respond({ error: "Document is not waiting for a correction; refresh before sending email" }, 409);
    }

    // A car still in review is corrected from My Vehicles; an approved or live
    // one from Document Renewal & Updates. The words and link come from the
    // same functions the in-app notice used.
    const inReview = ["pending", "rejected"].includes(typed.cars.status);
    const [{ data: message, error: messageError }, { data: link }] = await Promise.all([
      supabase.rpc("vehicle_document_correction_message", {
        p_document_type: typed.document_type,
        p_plate: typed.cars.plate_number ?? "",
        p_reason: typed.review_reason ?? "",
        p_in_review: inReview,
      }),
      supabase.rpc("vehicle_document_fix_link", { p_car_id: typed.car_id, p_status: typed.cars.status }),
    ]);
    if (messageError || typeof message !== "string") {
      return respond({ error: "Correction message could not be prepared" }, 500);
    }

    // Email exactly the notice the review wrote. A document in a renewal still
    // under review gets no notice of its own (the renewal's summary covers
    // it), and then no email either.
    const { data: notice } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", typed.cars.owner_id)
      .eq("title", "A vehicle document needs correction")
      .eq("message", message)
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();
    if (!notice) return respond({ success: true, deliveryState: "not_needed" });

    const result = await sendUserNotificationEmail(supabase, {
      userId: typed.cars.owner_id,
      title: "A vehicle document needs correction",
      message,
      link: typeof link === "string" ? link : inReview ? "/my-vehicles" : "/car-renewals",
      baseOrigin: new URL(req.url).origin,
      // A document can be sent back once; a replacement is a new document.
      eventKey: `document-correction:${typed.id}:${typed.reviewed_at ?? ""}`,
    });

    await supabase.from("audit_log").insert({
      user_id: actor.id,
      action: "document_correction_email_attempted",
      entity_type: "car_document",
      entity_id: typed.id,
      details: { delivery_state: result.state },
    });
    return respond({ success: result.state === "sent", deliveryState: result.state });
  } catch (error) {
    console.error("Document correction email failed", error);
    return respond({ error: "Unable to send document correction email" }, 500);
  }
}
