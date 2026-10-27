import { createClient } from "@supabase/supabase-js";
import {
  MAX_REPORT_PHOTOS,
  REPORT_MESSAGE_MAX,
  REPORT_MESSAGE_MIN,
  reportWindowProblem,
} from "../server/vehicleReports.js";

export const config = { runtime: "edge" };

/**
 * CHAPTER 131 - "Report an issue" with the car.
 *
 * POST { bookingId, message, photos: [{ storagePath, provenance? }] }
 *
 * The renter reports at the handover (from the lister's hand-over until the
 * trip is over); the lister at the return (from their return check-in until
 * they confirm receipt). One report per side per booking: a written
 * description and 1-4 live photos, both required once a report is filed.
 *
 * A report never holds anything up - not the receipt, not the completion,
 * not the payout - and it is deliberately not a support ticket, because an
 * open booking case holds the lister's payout. Staff read it in Vehicle
 * Reports; the other side is told in the app.
 */
type Payload = {
  bookingId?: string;
  message?: string;
  photos?: Array<{ storagePath?: string; provenance?: unknown }>;
};

const PROVENANCE_STATUS_VALUES = new Set(["unknown", "credential_present", "credential_missing", "credential_invalid"]);

// Only known, validated fields off a client-supplied provenance object.
const sanitizeProvenance = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if (typeof value.provenance_status === "string" && PROVENANCE_STATUS_VALUES.has(value.provenance_status)) {
    result.provenance_status = value.provenance_status;
  }
  if (typeof value.provenance_source === "string") result.provenance_source = value.provenance_source.slice(0, 500);
  if (typeof value.provenance_summary === "string") result.provenance_summary = value.provenance_summary.slice(0, 2000);
  return result;
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

type ReportBooking = {
  id: string;
  car_id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  owner_completed: boolean | null;
  lister_handover_confirmed_at: string | null;
  lister_return_arrived_at: string | null;
  cars: { plate_number: string; car_models: { name: string; car_brands: { name: string } } | null } | null;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !key) throw new Error("Vehicle report service is not configured");
    if (!token) return respond({ error: "Unauthorized" }, 401);
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return respond({ error: "Unauthorized" }, 401);

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const message = String(payload.message ?? "").trim();
    if (!payload.bookingId) return respond({ error: "Booking is required" }, 400);
    if (message.length < REPORT_MESSAGE_MIN) return respond({ error: `Describe the issue in at least ${REPORT_MESSAGE_MIN} characters` }, 400);
    if (message.length > REPORT_MESSAGE_MAX) return respond({ error: "Keep the description under 2,000 characters" }, 400);

    const { data: bookingRow, error: bookingError } = await supabase
      .from("bookings")
      .select("id, car_id, renter_id, owner_id, status, owner_completed, lister_handover_confirmed_at, lister_return_arrived_at, cars(plate_number, car_models(name, car_brands(name)))")
      .eq("id", payload.bookingId)
      .single();
    if (bookingError || !bookingRow) return respond({ error: "Booking not found" }, 404);
    const booking = bookingRow as unknown as ReportBooking;
    const role = booking.renter_id === user.id ? "renter" : booking.owner_id === user.id ? "lister" : null;
    if (!role) return respond({ error: "Only booking participants can report an issue" }, 403);
    const phase = role === "renter" ? "pickup" : "return";
    const windowProblem = reportWindowProblem(booking, role);
    if (windowProblem) return respond({ error: windowProblem }, 409);

    const photos = (payload.photos ?? []).filter(
      (photo): photo is { storagePath: string; provenance?: unknown } => typeof photo?.storagePath === "string",
    );
    if (photos.length < 1 || photos.length > MAX_REPORT_PHOTOS) {
      return respond({ error: `Add 1 to ${MAX_REPORT_PHOTOS} live photos of the issue` }, 400);
    }
    if (new Set(photos.map((photo) => photo.storagePath)).size !== photos.length) {
      return respond({ error: "Each photo can be attached once" }, 400);
    }
    if (photos.some((photo) => !photo.storagePath.startsWith(`${booking.id}/${user.id}/`) || !/\.jpe?g$/i.test(photo.storagePath))) {
      return respond({ error: "Invalid evidence path" }, 400);
    }
    const evidenceExists = await Promise.all(photos.map(async (photo) => {
      const lastSlash = photo.storagePath.lastIndexOf("/");
      const folder = photo.storagePath.slice(0, lastSlash);
      const fileName = photo.storagePath.slice(lastSlash + 1);
      const { data, error } = await supabase.storage
        .from("trip-condition-evidence")
        .list(folder, { limit: 100, search: fileName });
      return !error && (data ?? []).some((object) => object.name === fileName);
    }));
    if (evidenceExists.some((exists) => !exists)) {
      return respond({ error: "One or more uploaded photos could not be verified" }, 400);
    }

    const { data: report, error: reportError } = await supabase
      .from("vehicle_reports")
      .insert({
        booking_id: booking.id,
        car_id: booking.car_id,
        reporter_id: user.id,
        reporter_role: role,
        phase,
        message,
      })
      .select("id, created_at")
      .single();
    if (reportError?.code === "23505") return respond({ error: "You already reported an issue for this booking" }, 409);
    if (reportError || !report) throw reportError || new Error("Report was not saved");

    const { error: photoError } = await supabase.from("vehicle_report_photos").insert(
      photos.map((photo) => ({
        report_id: report.id,
        storage_path: photo.storagePath,
        ...sanitizeProvenance(photo.provenance),
      })),
    );
    if (photoError) {
      await supabase.from("vehicle_reports").delete().eq("id", report.id);
      throw photoError;
    }

    const plate = booking.cars?.plate_number ?? "the vehicle";
    const vehicle = booking.cars?.car_models
      ? `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${plate})`
      : plate;
    const otherSide = role === "renter" ? booking.owner_id : booking.renter_id;
    // Never let a notice fail an already-saved report.
    try {
      await supabase.from("notifications").insert({
        user_id: otherSide,
        title: role === "renter" ? "The renter reported an issue with your car" : "The lister reported an issue with the car",
        message: `${role === "renter" ? "At the handover" : "At the return"} of ${vehicle}: "${message.slice(0, 300)}${message.length > 300 ? "..." : ""}" SafeDrive Support will review it.`,
        type: "vehicle",
        link: role === "renter" ? "/lister-bookings" : "/my-bookings",
      });
      await supabase.rpc("notify_vehicle_reviewers", {
        p_title: "New vehicle report",
        p_message: `${plate}: the ${role} reported an issue ${role === "renter" ? "at the handover" : "at the return"}.`,
        p_link: `/admin/vehicle-reports?report=${report.id}`,
      });
    } catch (noticeError) {
      console.error("Vehicle report notice failed", noticeError);
    }
    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "vehicle_report_submitted",
      entity_type: "vehicle_report",
      entity_id: report.id,
      details: { booking_id: booking.id, car_id: booking.car_id, reporter_role: role, phase, photos: photos.length },
    });

    return respond({ success: true, reportId: report.id, createdAt: report.created_at }, 201);
  } catch (error) {
    console.error("Vehicle report failed", error);
    return respond({ error: "The report could not be saved" }, 500);
  }
}
