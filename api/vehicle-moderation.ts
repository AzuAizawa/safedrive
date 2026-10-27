import { requirePermission } from "../server/adminAuth.js";
import { sendUserNotificationEmail } from "../server/email.js";
import {
  cancelBookingForVehicleExit,
  NOT_STARTED_BOOKING_SELECT,
  NOT_STARTED_BOOKING_STATUSES,
  type CancellableBooking,
} from "../server/vehicleBookingCancellation.js";
import type { ServiceRoleSupabaseClient } from "../server/supabaseTypes.js";

export const config = { runtime: "edge" };

/**
 * CHAPTER 131 - a car can be disabled, and cleared to rent again
 * (vehicles.review).
 *
 * POST { action: "disable", carId, type: "clearance" | "other", reason, reportId? }
 *      The car is disabled first, so nothing new can be booked; then every
 *      booking that has not started is cancelled and refunded in full, as a
 *      removal does. A trip under way runs to its end; the database cancels
 *      its open extension.
 * POST { action: "enable", carId }
 *      A car disabled for another reason comes back (one waiting for a
 *      clearance comes back only by approving the clearance).
 * POST { action: "review_clearance", clearanceId, approve, reason? }
 *      Approve: the car comes back. Reject: the lister is told why.
 *
 * The database writes the lister's in-app notice; it is emailed from here in
 * the same words. A failed email never undoes the decision.
 */
type Payload = {
  action?: string;
  carId?: string;
  type?: string;
  reason?: string;
  reportId?: string | null;
  clearanceId?: string;
  approve?: boolean;
};

type Notice = { owner_id: string; title: string; message: string; status?: string };

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const emailLister = (supabase: ServiceRoleSupabaseClient, notice: Notice, baseOrigin: string, eventKey: string) =>
  sendUserNotificationEmail(supabase, {
    userId: notice.owner_id,
    title: notice.title,
    message: notice.message,
    link: "/my-vehicles",
    baseOrigin,
    eventKey,
  });

export default async function handler(req: Request) {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const auth = await requirePermission(req, "vehicles.review");
    if (!auth.ok) return respond({ error: auth.error }, auth.status);
    const { supabase, userId: adminId } = auth;
    const payload = (await req.json().catch(() => ({}))) as Payload;
    const baseOrigin = new URL(req.url).origin;
    const stamp = Date.now();

    if (payload.action === "disable") {
      const carId = payload.carId?.trim();
      const reason = payload.reason?.trim() ?? "";
      if (!carId) return respond({ error: "Vehicle is required" }, 400);

      const { data, error } = await supabase.rpc("disable_vehicle_for", {
        p_admin: adminId,
        p_car_id: carId,
        p_type: payload.type,
        p_reason: reason,
        p_report_id: payload.reportId || null,
      });
      if (error) return respond({ error: error.message }, 409);
      const notice = data as Notice;

      // Disabled first: from here no new booking can land on the car.
      const { data: bookings, error: bookingsError } = await supabase
        .from("bookings")
        .select(NOT_STARTED_BOOKING_SELECT)
        .eq("car_id", carId)
        .in("status", NOT_STARTED_BOOKING_STATUSES);
      let cancelled = 0;
      let cancelError: string | null = bookingsError?.message ?? null;
      for (const booking of (bookings ?? []) as unknown as CancellableBooking[]) {
        try {
          if (await cancelBookingForVehicleExit(supabase, booking, carId, adminId, reason, baseOrigin, "disabled")) {
            cancelled += 1;
          }
        } catch (bookingError) {
          // The car stays disabled; one booking that could not be settled here
          // is reported to the admin rather than leaving the rest untouched.
          cancelError = bookingError instanceof Error ? bookingError.message : "A booking could not be cancelled";
        }
      }

      const email = await emailLister(supabase, notice, baseOrigin, `vehicle-disabled:${carId}:${stamp}`);
      return respond({ state: "disabled", cancelledBookings: cancelled, cancelError, emailState: email.state });
    }

    if (payload.action === "enable") {
      const carId = payload.carId?.trim();
      if (!carId) return respond({ error: "Vehicle is required" }, 400);
      const { data, error } = await supabase.rpc("enable_vehicle_for", { p_admin: adminId, p_car_id: carId });
      if (error) return respond({ error: error.message }, 409);
      const notice = data as Notice;
      const email = await emailLister(supabase, notice, baseOrigin, `vehicle-enabled:${carId}:${stamp}`);
      return respond({ state: notice.status ?? "enabled", emailState: email.state });
    }

    if (payload.action === "review_clearance") {
      const clearanceId = payload.clearanceId?.trim();
      if (!clearanceId || typeof payload.approve !== "boolean") {
        return respond({ error: "Clearance and decision are required" }, 400);
      }
      const { data, error } = await supabase.rpc("review_vehicle_clearance_for", {
        p_admin: adminId,
        p_clearance_id: clearanceId,
        p_approve: payload.approve,
        p_reason: payload.reason?.trim() || null,
      });
      if (error) return respond({ error: error.message }, 409);
      const notice = data as Notice;
      const email = await emailLister(
        supabase,
        notice,
        baseOrigin,
        `vehicle-clearance-${payload.approve ? "approved" : "rejected"}:${clearanceId}`,
      );
      return respond({ state: notice.status ?? "reviewed", emailState: email.state });
    }

    return respond({ error: "Unknown action" }, 400);
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Vehicle moderation failed" }, 500);
  }
}
