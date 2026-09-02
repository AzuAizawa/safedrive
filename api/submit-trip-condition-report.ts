import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "edge" };

type Payload = {
  bookingId?: string;
  phase?: "pickup" | "return";
  odometerReading?: number | null;
  fuelOrBatteryLevel?: number | null;
  damageNotes?: string;
  evidenceWaived?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracyMeters?: number | null;
  locationConsent?: boolean;
  photos?: Array<{ category?: string; storagePath?: string }>;
};

const requiredCategories = ["front", "back", "odometer", "fuel_or_battery"];
const optionalCategories = ["left", "right", "interior", "damage"];
const allowedCategories = new Set([...requiredCategories, ...optionalCategories]);

// Accept a typed reading only when the user actually entered one.
const optionalReading = (value: unknown, max?: number) => {
  if (value === null || value === undefined || value === "") return { provided: false as const };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || (max !== undefined && parsed > max)) {
    return { provided: true as const, valid: false as const };
  }
  return { provided: true as const, valid: true as const, value: parsed };
};
const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async function handler(req: Request) {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !key) throw new Error("Trip report service is not configured");
    if (!token) return respond({ error: "Unauthorized" }, 401);
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return respond({ error: "Unauthorized" }, 401);

    const payload = (await req.json()) as Payload;
    if (!payload.bookingId || !["pickup", "return"].includes(payload.phase || "")) return respond({ error: "Booking and report phase are required" }, 400);
    const evidenceWaived = Boolean(payload.evidenceWaived);
    const odometerInput = optionalReading(payload.odometerReading);
    const levelInput = optionalReading(payload.fuelOrBatteryLevel, 100);
    if (odometerInput.provided && !odometerInput.valid) return respond({ error: "Odometer reading must be a whole number of 0 or more" }, 400);
    if (levelInput.provided && !levelInput.valid) return respond({ error: "Fuel or battery level must be a whole number from 0 to 100" }, 400);
    const odometer = odometerInput.provided && odometerInput.valid ? odometerInput.value : null;
    const level = levelInput.provided && levelInput.valid ? levelInput.value : null;

    const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, renter_id, owner_id, status").eq("id", payload.bookingId).single();
    if (bookingError || !booking) return respond({ error: "Booking not found" }, 404);
    const reporterRole = booking.renter_id === user.id ? "renter" : booking.owner_id === user.id ? "lister" : null;
    if (!reporterRole) return respond({ error: "Only booking participants can submit this report" }, 403);
    if (payload.phase === "pickup" && !["fully_paid", "active"].includes(booking.status)) {
      return respond({ error: "Pickup evidence is only accepted after full payment and before trip completion" }, 409);
    }
    if (payload.phase === "return" && booking.status !== "active") {
      return respond({ error: "Return evidence is accepted only after both parties complete arrival check-in" }, 409);
    }

    // Photos are required only for the party that owns the evidence at each
    // phase: the lister at pickup ("before" state) and the renter at return
    // ("after" state). The other side's report is optional but encouraged.
    const photosRequiredForRole =
      (payload.phase === "pickup" && reporterRole === "lister") ||
      (payload.phase === "return" && reporterRole === "renter");

    if (payload.phase === "return") {
      const { data: pickupReport, error: pickupReportError } = await supabase
        .from("trip_condition_reports")
        .select("odometer_reading")
        .eq("booking_id", booking.id)
        .eq("reporter_id", user.id)
        .eq("phase", "pickup")
        .maybeSingle();
      if (pickupReportError) throw pickupReportError;
      if (reporterRole === "lister" && !pickupReport) {
        return respond({ error: "Submit your pickup condition report before the return report" }, 409);
      }
      if (
        odometer !== null &&
        pickupReport?.odometer_reading !== null &&
        pickupReport?.odometer_reading !== undefined &&
        odometer < Number(pickupReport.odometer_reading)
      ) {
        return respond({ error: "Return odometer cannot be lower than the pickup reading" }, 400);
      }
    }

    const photos = (payload.photos ?? []).filter((photo): photo is { category: string; storagePath: string } => Boolean(photo.category && photo.storagePath && allowedCategories.has(photo.category)));
    const categories = new Set(photos.map((photo) => photo.category));
    const missingRequired = requiredCategories.filter((category) => !categories.has(category));
    if (missingRequired.length > 0 && photosRequiredForRole && !evidenceWaived) {
      return respond({ error: "Front, back, odometer, and fuel/battery photos are required (or submit with an explicit waiver)." }, 400);
    }
    const waivedThisReport = photosRequiredForRole && missingRequired.length > 0 && evidenceWaived;
    if (photos.some((photo) => !photo.storagePath.startsWith(`${booking.id}/${user.id}/`))) return respond({ error: "Invalid evidence path" }, 400);
    if (payload.locationConsent) {
      const latitude = Number(payload.latitude);
      const longitude = Number(payload.longitude);
      const accuracy = Number(payload.locationAccuracyMeters);
      if (
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isFinite(accuracy) || accuracy < 0
      ) {
        return respond({ error: "Optional location evidence is invalid" }, 400);
      }
    }

    const evidenceExists = await Promise.all(photos.map(async (photo) => {
      const lastSlash = photo.storagePath.lastIndexOf("/");
      const folder = photo.storagePath.slice(0, lastSlash);
      const fileName = photo.storagePath.slice(lastSlash + 1);
      const { data, error } = await supabase.storage
        .from("trip-condition-evidence")
        .list(folder, { limit: 2, search: fileName });
      return !error && (data ?? []).some((object) => object.name === fileName);
    }));
    if (evidenceExists.some((exists) => !exists)) {
      return respond({ error: "One or more uploaded evidence photos could not be verified" }, 400);
    }

    const { data: existing } = await supabase.from("trip_condition_reports").select("id").eq("booking_id", booking.id).eq("reporter_id", user.id).eq("phase", payload.phase).maybeSingle();
    if (existing) return respond({ error: "You already submitted this report" }, 409);

    const { data: report, error: reportError } = await supabase.from("trip_condition_reports").insert({
      booking_id: booking.id,
      reporter_id: user.id,
      reporter_role: reporterRole,
      phase: payload.phase,
      odometer_reading: odometer,
      fuel_or_battery_level: level,
      evidence_waived: waivedThisReport,
      damage_notes: String(payload.damageNotes || "").trim().slice(0, 3000),
      latitude: payload.locationConsent ? payload.latitude ?? null : null,
      longitude: payload.locationConsent ? payload.longitude ?? null : null,
      location_accuracy_meters: payload.locationConsent ? payload.locationAccuracyMeters ?? null : null,
      location_consent: Boolean(payload.locationConsent),
    }).select("id, submitted_at").single();
    if (reportError?.code === "23505") {
      return respond({ error: "You already submitted this report" }, 409);
    }
    if (reportError || !report) throw reportError || new Error("Report was not saved");

    const { error: photoError } = await supabase.from("trip_condition_photos").insert(photos.map((photo) => ({ report_id: report.id, category: photo.category, storage_path: photo.storagePath })));
    if (photoError) {
      await supabase.from("trip_condition_reports").delete().eq("id", report.id);
      throw photoError;
    }
    await supabase.from("audit_log").insert({ user_id: user.id, action: "trip_condition_report_submitted", entity_type: "booking", entity_id: booking.id, details: { report_id: report.id, phase: payload.phase, reporter_role: reporterRole, photo_categories: [...categories], photos_required: photosRequiredForRole, evidence_waived: waivedThisReport, missing_photo_categories: missingRequired, location_supplied: Boolean(payload.locationConsent) } });
    return respond({ success: true, reportId: report.id, submittedAt: report.submitted_at }, 201);
  } catch (error) {
    console.error("Trip condition report failed", error);
    return respond({ error: "Trip condition report could not be saved" }, 500);
  }
}
