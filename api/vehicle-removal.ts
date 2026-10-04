import { createSupabaseAdmin } from "../server/payoutAutomation.js";
import { requirePermission } from "../server/adminAuth.js";
import { sendUserNotificationEmail } from "../server/email.js";
import {
  createManualRefundReview,
  processAutomaticRefundForBooking,
} from "../server/refundAutomation.js";
import { getVehicleLabel } from "../server/cancellationRefundPlan.js";
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

type CancellableBooking = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  start_date: string;
  end_date: string;
  cars: { plate_number: string; car_models: { name: string; car_brands: { name: string } } } | null;
  payments: Array<{ payment_type: string; status: string; amount: number | string }>;
};

const NOT_STARTED = ["pending", "confirmed", "awaiting_payment", "downpayment_paid", "fully_paid"];
const REFUNDABLE = ["downpayment", "balance"];

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

/**
 * Cancel one booking that has not started because SafeDrive removed its car:
 * the renter is refunded everything they paid and both sides are told.
 * Returns false when the booking moved on (e.g. the handover began) - it is
 * then left to finish and the removal waits for it.
 */
async function cancelForRemoval(
  supabase: ServiceRoleSupabaseClient,
  booking: CancellableBooking,
  carId: string,
  adminId: string,
  reason: string,
  baseOrigin: string,
) {
  const { data: claimed, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", payment_deadline: null })
    .eq("id", booking.id)
    .is("lister_handover_confirmed_at", null)
    .in("status", NOT_STARTED)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!claimed) return false;

  const label = getVehicleLabel(booking);
  const paid = booking.payments.some(
    (p) => REFUNDABLE.includes(p.payment_type) && p.status === "completed" && Number(p.amount) > 0,
  );
  let refundState = "none";
  if (paid) {
    const note = `SafeDrive removed this vehicle (${reason}); the renter is refunded in full.`;
    try {
      const outcome = await processAutomaticRefundForBooking({
        supabase,
        bookingId: booking.id,
        initiatedByUserId: adminId,
        reason: "others",
        note,
        allowedPaymentTypes: REFUNDABLE,
        baseOrigin,
      });
      refundState = outcome.state;
      const outcomeReason = "reason" in outcome && outcome.reason ? outcome.reason : note;
      if (outcome.state === "failed" || (outcome.state === "skipped" && !/already pending/i.test(outcomeReason))) {
        await createManualRefundReview(supabase, booking, booking.renter_id, null, outcomeReason);
        refundState = "manual_review";
      }
    } catch (refundError) {
      await createManualRefundReview(
        supabase,
        booking,
        booking.renter_id,
        null,
        refundError instanceof Error ? refundError.message : "Automatic refund failed",
      );
      refundState = "manual_review";
    }
  }

  await supabase.from("booking_cancellations").upsert(
    {
      booking_id: booking.id,
      cancelled_by_role: "lister",
      cancelled_by_id: adminId,
      lister_id: booking.owner_id,
      renter_id: booking.renter_id,
      car_id: carId,
      reason: `SafeDrive removed the vehicle: ${reason}`,
      hours_before_pickup: null,
      was_late: false,
      had_captured_payment: paid,
      strike_waived: true,
    },
    { onConflict: "booking_id" },
  );
  await supabase.from("audit_log").insert({
    user_id: adminId,
    action: "admin_cancelled_booking_for_vehicle_removal",
    entity_type: "booking",
    entity_id: booking.id,
    details: { vehicle: label, reason, refund_state: refundState },
  });

  const dates = `${booking.start_date} to ${booking.end_date}`;
  const renterNotice = {
    title: "Your booking was cancelled",
    message: paid
      ? `SafeDrive removed ${label} from the platform, so your booking for ${dates} was cancelled. Everything you paid is being refunded to you in full. Browse other cars to rebook.`
      : `SafeDrive removed ${label} from the platform, so your booking request for ${dates} was cancelled. Browse other cars to rebook.`,
  };
  const listerNotice = {
    title: "A booking was cancelled",
    message: `Because SafeDrive removed ${label}, its booking for ${dates} was cancelled${paid ? " and the renter is refunded in full" : ""}. This does not count against you as a late cancellation.`,
  };
  await supabase.from("notifications").insert([
    { user_id: booking.renter_id, ...renterNotice, type: "error", link: "/my-bookings" },
    { user_id: booking.owner_id, ...listerNotice, type: "info", link: "/lister-bookings" },
  ]);
  await sendUserNotificationEmail(supabase, {
    userId: booking.renter_id,
    ...renterNotice,
    link: "/my-bookings",
    baseOrigin,
    eventKey: `vehicle-removal-cancel:${booking.id}:renter`,
  });
  await sendUserNotificationEmail(supabase, {
    userId: booking.owner_id,
    ...listerNotice,
    link: "/lister-bookings",
    baseOrigin,
    eventKey: `vehicle-removal-cancel:${booking.id}:lister`,
  });
  return true;
}

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
        .select("id, renter_id, owner_id, status, start_date, end_date, cars(plate_number, car_models(name, car_brands(name))), payments(payment_type, status, amount)")
        .eq("car_id", carId)
        .in("status", NOT_STARTED);
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
        if (await cancelForRemoval(supabase, booking, carId, adminId, note, baseOrigin)) cancelled += 1;
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
