import { createSupabaseAdmin } from "../server/payoutAutomation.js";
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
 * CHAPTER 120 - a deleted car is erased; what it earned stays on record.
 *
 * POST { action: "delete", carId }   the owner deletes their own car.
 * POST { action: "remove", carId, reasonCode, note }
 *                                     SafeDrive removes a car (vehicles.delete):
 *                                     bookings that have not started are
 *                                     cancelled and refunded in full first; a
 *                                     trip under way defers the erasure.
 * GET  (CRON_SECRET, every 15 min)    erases cars whose deferred removal can now
 *                                     finish, and deletes queued files.
 *
 * The database writes every in-app notice; each one is emailed from here in
 * the same words. Stored files go through the Storage API, not SQL.
 */
type Payload = { action?: string; carId?: string; reasonCode?: string; note?: string };

type Notice = { owner_id: string; title: string; message: string };

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const bearer = (req: Request) => {
  const header = req.headers.get("Authorization");
  return header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
};

/** Delete every queued file of an erased car, then take it off the queue. */
async function purgeQueuedFiles(supabase: ServiceRoleSupabaseClient) {
  const { data } = await supabase.from("vehicle_file_purge_queue").select("bucket, path").limit(500);
  const byBucket = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<{ bucket: string; path: string }>) {
    byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row.path]);
  }
  let purged = 0;
  for (const [bucket, paths] of byBucket) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      console.warn(`Vehicle files in ${bucket} were not deleted:`, error.message);
      continue;
    }
    await supabase.from("vehicle_file_purge_queue").delete().eq("bucket", bucket).in("path", paths);
    purged += paths.length;
  }
  return purged;
}

const emailNotice = (supabase: ServiceRoleSupabaseClient, notice: Notice, baseOrigin: string, eventKey: string) =>
  sendUserNotificationEmail(supabase, {
    userId: notice.owner_id,
    title: notice.title,
    message: notice.message,
    link: "/my-vehicles",
    baseOrigin,
    eventKey,
  });

async function runScheduledWork(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return respond({ error: "CRON_SECRET must be configured before this job can run" }, 500);
  const token = bearer(req);
  if (token !== cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return respond({ error: "Unauthorized" }, 401);
  }
  const supabase = createSupabaseAdmin() as ServiceRoleSupabaseClient;
  const { data, error } = await supabase.rpc("finish_scheduled_vehicle_removals");
  if (error) return respond({ error: error.message }, 500);
  const baseOrigin = new URL(req.url).origin;
  const finished = (data ?? []) as Array<Notice & { car_id: string }>;
  for (const notice of finished) {
    await emailNotice(supabase, notice, baseOrigin, `vehicle-removed:${notice.car_id}`);
  }
  const purged = await purgeQueuedFiles(supabase);
  return respond({ removed: finished.length, filesDeleted: purged });
}

export default async function handler(req: Request) {
  if (req.method === "GET") return runScheduledWork(req);
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;
    const carId = payload.carId?.trim();
    if (!carId) return respond({ error: "Vehicle is required" }, 400);
    const baseOrigin = new URL(req.url).origin;

    if (payload.action === "delete") {
      const token = bearer(req);
      if (!token) return respond({ error: "Missing authorization token" }, 401);
      const supabase = createSupabaseAdmin() as ServiceRoleSupabaseClient;
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !user) return respond({ error: "Unauthorized request" }, 401);

      const { data, error } = await supabase.rpc("delete_my_vehicle_for", { p_owner: user.id, p_car_id: carId });
      if (error) return respond({ error: error.message }, 409);
      const notice = data as Notice;
      const email = await emailNotice(supabase, notice, baseOrigin, `vehicle-deleted:${carId}`);
      await purgeQueuedFiles(supabase);
      return respond({ state: "deleted", emailState: email.state });
    }

    if (payload.action === "remove") {
      const auth = await requirePermission(req, "vehicles.delete");
      if (!auth.ok) return respond({ error: auth.error }, auth.status);
      const { supabase, userId: adminId } = auth;
      const note = payload.note?.trim() ?? "";

      const { data: bookings, error: bookingsError } = await supabase
        .from("bookings")
        .select(NOT_STARTED_BOOKING_SELECT)
        .eq("car_id", carId)
        .in("status", NOT_STARTED_BOOKING_STATUSES);
      if (bookingsError) return respond({ error: bookingsError.message }, 500);

      // Validate the reason before touching any booking: the same rules
      // remove_vehicle_for enforces, so nothing is cancelled for a removal
      // that would then be refused.
      if (!["invalid_documents", "policy_violation", "owner_request", "other"].includes(payload.reasonCode ?? "")) {
        return respond({ error: "Choose a reason for removing this vehicle" }, 400);
      }
      if (note.length < 10) {
        return respond({ error: "Give a note of at least 10 characters so the lister knows why" }, 400);
      }

      let cancelled = 0;
      for (const booking of (bookings ?? []) as unknown as CancellableBooking[]) {
        if (await cancelBookingForVehicleExit(supabase, booking, carId, adminId, note, baseOrigin, "removed")) cancelled += 1;
      }

      const { data, error } = await supabase.rpc("remove_vehicle_for", {
        p_admin: adminId,
        p_car_id: carId,
        p_reason_code: payload.reasonCode,
        p_note: note,
      });
      if (error) return respond({ error: error.message, cancelledBookings: cancelled }, 409);
      const result = data as Notice & { state: "removed" | "scheduled" };
      const email = await emailNotice(
        supabase,
        result,
        baseOrigin,
        `vehicle-${result.state}:${carId}`,
      );
      if (result.state === "removed") await purgeQueuedFiles(supabase);
      return respond({ state: result.state, cancelledBookings: cancelled, emailState: email.state });
    }

    return respond({ error: "Unknown action" }, 400);
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Vehicle removal failed" }, 500);
  }
}
