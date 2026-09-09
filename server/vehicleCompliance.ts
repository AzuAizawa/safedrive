import type { SupabaseClient } from "@supabase/supabase-js";

export type VehicleCompliance = { eligible: boolean; valid_until: string | null; reasons: string[] };

/** Database is authoritative; an unavailable migration must fail closed. */
export async function getVehicleCompliance(
  db: SupabaseClient, carId: string, startAt?: string, endAt?: string,
): Promise<VehicleCompliance> {
  const { data, error } = await db.rpc("vehicle_compliance_summary", {
    p_car_id: carId, p_start: startAt ?? new Date().toISOString(),
    p_end: endAt ?? startAt ?? new Date().toISOString(),
  });
  if (error) throw new Error(`Vehicle document verification unavailable: ${error.message}`);
  if (!data || typeof data.eligible !== "boolean") throw new Error("Invalid vehicle document verification response");
  return data as VehicleCompliance;
}

export function rentalInstant(date: string, time: string | null | undefined, fallback: string): string {
  return new Date(`${date}T${time || fallback}+08:00`).toISOString();
}

export async function bookingCompliance(db: SupabaseClient, bookingId: string, endDate?: string) {
  const { data: b, error } = await db.from("bookings")
    .select("car_id,start_date,end_date,pickup_time,dropoff_time").eq("id", bookingId).single();
  if (error || !b) throw new Error("Booking not found for document verification");
  return getVehicleCompliance(db, b.car_id,
    rentalInstant(b.start_date, b.pickup_time, "09:00"),
    rentalInstant(endDate ?? b.end_date, b.dropoff_time, "09:00"));
}

/**
 * guard_booking_document_coverage() enforces itself by raising, not by
 * returning no rows, so a blocked write arrives here as a bare Postgres error
 * and used to surface as a 500 that named nothing - while both parties were
 * standing at the meetup point wondering why the app refused. Map the two
 * raises onto something worth showing. Returns null for anything else, which
 * the caller should keep throwing.
 */
export function vehicleGuardMessage(error: unknown): string | null {
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown } | null)?.message ?? "");
  if (message.includes("VEHICLE_DOCUMENTS_REQUIRED")) {
    return "This vehicle's approved documents no longer cover the rental period. The documents have to be renewed and approved before the car can change hands.";
  }
  if (message.includes("Vehicle is not available for booking")) {
    return "This listing is back in admin review, so this step cannot be recorded yet.";
  }
  return null;
}

export const complianceBlockedResponse = () => new Response(JSON.stringify({
  error: "This vehicle's approved documents do not cover the rental period. Renewal must be approved before proceeding.",
  code: "VEHICLE_DOCUMENTS_REQUIRED",
}), { status: 409, headers: { "Content-Type": "application/json" } });
