import { createClient } from "@supabase/supabase-js";
import { processAutomaticRefundForBooking } from "./lib/refundAutomation.js";
import { sendUserNotificationEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type IncidentAction = "renter_no_car" | "renter_no_show" | "report_non_return";

type IncidentPayload = {
  bookingId?: string;
  action?: IncidentAction;
  note?: string | null;
};

type PaymentRow = {
  payment_type: string;
  status: string;
  amount: number | string;
};

type BookingRow = {
  id: string;
  car_id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  dispute_status: string;
  start_date: string;
  end_date: string;
  pickup_time: string | null;
  dropoff_time: string | null;
  renter_arrived_at: string | null;
  lister_arrived_at: string | null;
  renter_completed: boolean;
  owner_completed: boolean;
  payments: PaymentRow[];
  cars: {
    plate_number: string;
    car_models: { name: string; car_brands: { name: string } };
  } | null;
};

const GRACE_MINUTES = 30;
const REFUNDABLE = ["downpayment", "balance"];

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin environment variables");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

const label = (b: BookingRow) =>
  b.cars
    ? `${b.cars.car_models.car_brands.name} ${b.cars.car_models.name} (${b.cars.plate_number})`
    : `Booking ${b.id}`;

// Manila-local wall time -> epoch ms (edge runtime is UTC).
const manilaMs = (date: string, time: string | null, fallback: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || fallback).split(":").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0) - 8 * 60 * 60 * 1000;
};

const capturedTotal = (b: BookingRow) =>
  b.payments
    .filter(
      (p) =>
        REFUNDABLE.includes(p.payment_type) &&
        p.status === "completed" &&
        Number(p.amount) > 0,
    )
    .reduce((sum, p) => sum + Number(p.amount), 0);

const openIncidentTicket = async (
  supabase: ReturnType<typeof getSupabaseAdmin>,
  b: BookingRow,
  userId: string,
  subject: string,
  body: string,
) => {
  const { data: existing } = await supabase
    .from("support_tickets")
    .select("id")
    .eq("booking_id", b.id)
    .eq("tag", "booking_incident")
    .in("status", ["open", "in_progress"])
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: ticket } = await supabase
    .from("support_tickets")
    .insert({
      user_id: userId,
      subject: subject.slice(0, 160),
      tag: "booking_incident",
      booking_id: b.id,
      status: "open",
    })
    .select("id")
    .single();
  const ticketId = (ticket?.id as string | undefined) ?? null;
  if (ticketId) {
    await supabase.from("ticket_messages").insert({
      ticket_id: ticketId,
      sender_id: userId,
      message: body.slice(0, 2000),
    });
  }
  return ticketId;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

    const payload = (await req.json()) as IncidentPayload;
    if (!payload.action || !payload.bookingId) {
      return jsonResponse({ error: "Action and bookingId are required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }
    const baseOrigin = new URL(req.url).origin;

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        `
        id, car_id, renter_id, owner_id, status, dispute_status,
        start_date, end_date, pickup_time, dropoff_time,
        renter_arrived_at, lister_arrived_at, renter_completed, owner_completed,
        payments ( payment_type, status, amount ),
        cars ( plate_number, car_models ( name, car_brands ( name ) ) )
      `,
      )
      .eq("id", payload.bookingId)
      .single();
    if (bookingError || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }
    const b = booking as unknown as BookingRow;
    const isRenter = b.renter_id === user.id;
    const isOwner = b.owner_id === user.id;
    if (!isRenter && !isOwner) {
      return jsonResponse({ error: "You are not part of this booking" }, 403);
    }
    const note = payload.note?.trim() || null;

    // --------------------------------------------------------- renter_no_car
    if (payload.action === "renter_no_car") {
      if (!isRenter) {
        return jsonResponse({ error: "Only the renter can report this" }, 403);
      }
      if (b.status !== "fully_paid") {
        return jsonResponse(
          { error: "This booking is not at the pickup stage." },
          409,
        );
      }
      if (!b.renter_arrived_at || b.lister_arrived_at) {
        return jsonResponse(
          { error: "Record your own arrival check-in first." },
          409,
        );
      }
      const pickupMs = manilaMs(b.start_date, b.pickup_time, "09:00");
      if (pickupMs === null || Date.now() < pickupMs + GRACE_MINUTES * 60_000) {
        return jsonResponse(
          { error: "Wait until the pickup grace window has passed." },
          409,
        );
      }

      // Cascade: is the delay caused by another renter overstaying THIS car?
      const todayIso = new Date().toISOString().slice(0, 10);
      const { data: overstays } = await supabase
        .from("bookings")
        .select("id, renter_id, end_date")
        .eq("car_id", b.car_id)
        .eq("status", "active")
        .lt("end_date", todayIso)
        .neq("id", b.id);
      const overstay = (overstays ?? [])[0] as
        | { id: string; renter_id: string; end_date: string }
        | undefined;

      // Cancel this booking + full automatic refund to the innocent renter.
      const { data: cancelChanged, error: cancelError } = await supabase
        .from("bookings")
        .update({ status: "cancelled", payment_deadline: null })
        .eq("id", b.id)
        .eq("status", "fully_paid")
        .select("id")
        .maybeSingle();
      if (cancelError) throw cancelError;
      if (!cancelChanged) {
        return jsonResponse(
          { error: "This booking changed state before it could be cancelled." },
          409,
        );
      }

      const hadPayment = capturedTotal(b) > 0;
      if (hadPayment) {
        await processAutomaticRefundForBooking({
          supabase,
          bookingId: b.id,
          initiatedByUserId: user.id,
          reason: "others",
          note: `Renter reported no vehicle available at pickup${overstay ? " (previous renter overstayed)" : " (lister did not deliver)"}. Full refund.`,
          allowedPaymentTypes: REFUNDABLE,
          baseOrigin,
        });
      }

      await supabase.from("booking_cancellations").upsert(
        {
          booking_id: b.id,
          cancelled_by_role: "lister",
          cancelled_by_id: user.id,
          lister_id: b.owner_id,
          renter_id: b.renter_id,
          car_id: b.car_id,
          reason: overstay
            ? "previous_renter_overstay"
            : "lister_no_show",
          was_late: true,
          had_captured_payment: hadPayment,
          strike_waived: Boolean(overstay),
        },
        { onConflict: "booking_id" },
      );

      if (overstay) {
        await supabase
          .from("bookings")
          .update({ dispute_status: "open" })
          .eq("id", overstay.id)
          .eq("status", "active");
        await supabase.from("notifications").insert({
          user_id: overstay.renter_id,
          title: "Vehicle overdue",
          message: `Your rental of ${label(b)} is past its return date and another renter could not pick it up. Return it immediately and file your return report.`,
          type: "error",
          link: "/my-bookings",
        });
      }

      await openIncidentTicket(
        supabase,
        b,
        user.id,
        `No vehicle at pickup: ${label(b)}`,
        overstay
          ? `The renter checked in at pickup but the vehicle was still out with a previous renter whose trip ended on ${overstay.end_date}. This booking was cancelled and fully refunded; the overdue trip (${overstay.id}) is flagged. ${note ?? ""}`.trim()
          : `The renter checked in at pickup, waited past the ${GRACE_MINUTES}-minute grace window, and the lister did not appear with the vehicle. This booking was cancelled and fully refunded. ${note ?? ""}`.trim(),
      );

      await supabase.from("notifications").insert([
        {
          user_id: b.renter_id,
          title: "Booking cancelled — full refund",
          message: `${label(b)} wasn't available at pickup. Your full refund is being processed and your record is not affected. Browse other cars to rebook.`,
          type: "info",
          link: "/browse",
        },
        {
          user_id: b.owner_id,
          title: overstay ? "Renter couldn't pick up — previous renter overdue" : "You missed a handover",
          message: overstay
            ? `${label(b)} could not be handed over because the previous renter has not returned it. We've flagged that trip.`
            : `The renter reported that ${label(b)} was not available at pickup. Their booking was cancelled and fully refunded. This affects your completion rate.`,
          type: "error",
          link: "/lister-bookings",
        },
      ]);
      await sendUserNotificationEmail(supabase, {
        userId: b.owner_id,
        title: "Handover issue reported",
        message: overstay
          ? `${label(b)} could not be handed over — the previous renter is overdue.`
          : `The renter reported no vehicle at pickup for ${label(b)}. Booking cancelled and refunded.`,
        link: "/lister-bookings",
        baseOrigin,
        eventKey: `no-car:${b.id}`,
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "renter_reported_no_car",
        entity_type: "booking",
        entity_id: b.id,
        details: {
          attribution: overstay ? "previous_renter_overstay" : "lister_no_show",
          overstay_booking_id: overstay?.id ?? null,
          note,
        },
      });

      return jsonResponse({ success: true, state: "cancelled_refunded" });
    }

    // -------------------------------------------------------- renter_no_show
    if (payload.action === "renter_no_show") {
      if (!isOwner) {
        return jsonResponse({ error: "Only the lister can report this" }, 403);
      }
      if (b.status !== "fully_paid") {
        return jsonResponse(
          { error: "This booking is not at the pickup stage." },
          409,
        );
      }
      if (!b.lister_arrived_at || b.renter_arrived_at) {
        return jsonResponse(
          { error: "Record your own arrival check-in first." },
          409,
        );
      }
      const pickupMs = manilaMs(b.start_date, b.pickup_time, "09:00");
      if (pickupMs === null || Date.now() < pickupMs + GRACE_MINUTES * 60_000) {
        return jsonResponse(
          { error: "Wait until the pickup grace window has passed." },
          409,
        );
      }

      const { data: cancelChanged, error: cancelError } = await supabase
        .from("bookings")
        .update({ status: "cancelled", payment_deadline: null })
        .eq("id", b.id)
        .eq("status", "fully_paid")
        .select("id")
        .maybeSingle();
      if (cancelError) throw cancelError;
      if (!cancelChanged) {
        return jsonResponse(
          { error: "This booking changed state before it could be cancelled." },
          409,
        );
      }

      const captured = capturedTotal(b);
      const renterShare = Math.round(captured * 0.5 * 100) / 100;
      let refundPaymentId: string | null = null;
      if (captured > 0) {
        const { data: refundRow } = await supabase
          .from("payments")
          .insert({
            booking_id: b.id,
            amount: -Math.abs(renterShare),
            payment_type: "refund",
            status: "pending",
            payment_method: "manual_review",
            transaction_id: null,
            notes: `Renter no-show at pickup. Policy: renter keeps 50% forfeit — refund PHP ${renterShare.toLocaleString()} of PHP ${captured.toLocaleString()} captured; the rest is lister compensation. Admin confirms the return method.`,
          })
          .select("id")
          .single();
        refundPaymentId = (refundRow?.id as string | undefined) ?? null;

        const { data: superAdmins } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "super_admin")
          .is("deleted_at", null);
        if (superAdmins?.length) {
          await supabase.from("notifications").insert(
            superAdmins.map((admin) => ({
              user_id: admin.id,
              title: "Renter no-show refund to review",
              message: `A renter no-showed. Confirm the 50% refund (PHP ${renterShare.toLocaleString()}) in Financial Reviews.`,
              type: "warning",
              link: "/admin/financial-reviews?view=refunds",
            })),
          );
        }
      }

      await supabase.from("booking_cancellations").upsert(
        {
          booking_id: b.id,
          cancelled_by_role: "renter",
          cancelled_by_id: user.id,
          lister_id: b.owner_id,
          renter_id: b.renter_id,
          car_id: b.car_id,
          reason: "renter_no_show",
          was_late: true,
          had_captured_payment: captured > 0,
          strike_waived: false,
        },
        { onConflict: "booking_id" },
      );

      await openIncidentTicket(
        supabase,
        b,
        user.id,
        `Renter no-show at pickup: ${label(b)}`,
        `The lister checked in at pickup and the renter did not appear within the ${GRACE_MINUTES}-minute grace window. Booking cancelled. ${
          captured > 0
            ? `PHP ${captured.toLocaleString()} was captured; policy releases a 50% refund (PHP ${renterShare.toLocaleString()}) to the renter after admin confirms the return method.`
            : "No captured payment to refund."
        } ${note ?? ""}`.trim(),
      );

      await supabase.from("notifications").insert([
        {
          user_id: b.renter_id,
          title: "Booking cancelled — you did not show up",
          message:
            captured > 0
              ? `You did not appear for ${label(b)} at pickup. Per the no-show policy you keep a 50% forfeit; SafeDrive support will release your ${renterShare.toLocaleString()} refund. This affects your completion rate.`
              : `You did not appear for ${label(b)} at pickup. This affects your completion rate.`,
          type: "error",
          link: "/my-bookings",
        },
        {
          user_id: b.owner_id,
          title: "Renter no-show recorded",
          message: `The renter did not appear for ${label(b)}. The booking was cancelled and your record is not affected.`,
          type: "info",
          link: "/lister-bookings",
        },
      ]);

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "lister_reported_renter_no_show",
        entity_type: "booking",
        entity_id: b.id,
        details: {
          captured,
          renter_refund_share: renterShare,
          refund_payment_id: refundPaymentId,
          note,
        },
      });

      return jsonResponse({ success: true, state: "cancelled_partial_refund" });
    }

    // ------------------------------------------------------ report_non_return
    if (payload.action === "report_non_return") {
      if (!isOwner) {
        return jsonResponse({ error: "Only the lister can report this" }, 403);
      }
      if (b.status !== "active") {
        return jsonResponse(
          { error: "Only an active trip can be reported as not returned." },
          409,
        );
      }
      if (b.renter_completed || b.owner_completed) {
        return jsonResponse(
          { error: "This trip is already being completed." },
          409,
        );
      }
      const returnMs = manilaMs(b.end_date, b.dropoff_time, "18:00");
      if (returnMs === null || Date.now() < returnMs + GRACE_MINUTES * 60_000) {
        return jsonResponse(
          { error: "The return time has not passed yet." },
          409,
        );
      }
      if (b.dispute_status === "open") {
        return jsonResponse(
          { error: "This booking is already flagged." },
          409,
        );
      }

      const { error: flagError } = await supabase
        .from("bookings")
        .update({ dispute_status: "open" })
        .eq("id", b.id)
        .eq("status", "active");
      if (flagError) throw flagError;

      // The notify_support_ticket_created trigger already alerts every admin
      // (link /admin/support) when this ticket is inserted.
      await openIncidentTicket(
        supabase,
        b,
        user.id,
        `Vehicle not returned: ${label(b)}`,
        `The lister reports that ${label(b)} was not returned by its scheduled return (${b.end_date}${
          b.dropoff_time ? ` ${b.dropoff_time}` : ""
        }) and the ${GRACE_MINUTES}-minute grace window has passed. The booking is flagged (dispute_status=open) so the car can be taken offline; the security deposit and any refund stay on hold pending admin review. ${note ?? ""}`.trim(),
      );

      await supabase.from("notifications").insert({
        user_id: b.renter_id,
        title: "Vehicle overdue — return it now",
        message: `${label(b)} is past its return time. Return it immediately and file your return report, or SafeDrive support will escalate. The security deposit and any refund are on hold.`,
        type: "error",
        link: "/my-bookings",
      });
      await sendUserNotificationEmail(supabase, {
        userId: b.renter_id,
        title: "Vehicle overdue",
        message: `${label(b)} is past its return time. Return it immediately.`,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `non-return:${b.id}`,
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "lister_reported_non_return",
        entity_type: "booking",
        entity_id: b.id,
        details: { end_date: b.end_date, note },
      });

      return jsonResponse({ success: true, state: "flagged" });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Incident action failed unexpectedly",
      },
      500,
    );
  }
}
