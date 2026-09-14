import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";
import { sendUserNotificationEmail } from "./email.js";

// CHAPTER 88 - an approved extension holds the days it adds until it is paid
// or its payment deadline passes; a pending request holds nothing. The database
// enforces it (guard_booking_against_extension_holds, guard_extension_approval,
// guard_blackout_against_extension_holds). These helpers apply the same rules
// before each write so every API can say plainly why it refused, and keep them
// in one place for api/create-booking.ts, api/booking-action.ts (accept),
// api/booking-extension-action.ts (request, approve) and
// api/create-booking-extension-checkout.ts.
//
// The browser needs a few of the same rules and cannot import server code;
// src/lib/bookingExtensions.ts mirrors them, and scripts/extension-holds.test.mjs
// pins the two copies together.

/** Booking statuses that hold a car's dates - ACTIVE_BOOKING_STATUSES in api/create-booking.ts. */
export const DATE_HOLDING_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "awaiting_payment",
  "downpayment_paid",
  "fully_paid",
  "active",
];

/** api/webhooks/paymongo.ts applies an extension only to a booking in one of these. */
const EXTENDABLE_BOOKING_STATUSES = ["fully_paid", "active"];

/** An inclusive yyyy-MM-dd range. ISO dates compare correctly as strings. */
export type DateWindow = { start: string; end: string };

export const windowsOverlap = (a: DateWindow, b: DateWindow) =>
  a.start <= b.end && a.end >= b.start;

export const nextDateOnly = (dateOnly: string) => {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

/** The days an extension adds: the day after the current return through the requested one. */
export const extensionAddedDays = (extension: {
  current_end_date: string;
  requested_end_date: string;
}): DateWindow => ({
  start: nextDateOnly(extension.current_end_date),
  end: extension.requested_end_date,
});

export const isHoldingExtension = (
  extension: { status: string; payment_deadline: string | null },
  bookingStatus: string,
  now = Date.now(),
) =>
  extension.status === "approved" &&
  (!extension.payment_deadline || new Date(extension.payment_deadline).getTime() > now) &&
  EXTENDABLE_BOOKING_STATUSES.includes(bookingStatus);

type ExtensionWithBooking = {
  id: string;
  booking_id: string;
  renter_id: string;
  owner_id: string;
  current_end_date: string;
  requested_end_date: string;
  status: string;
  payment_deadline: string | null;
  booking: {
    id: string;
    car_id: string;
    renter_id: string;
    status: string;
    cars: {
      plate_number: string;
      car_models: { name: string; car_brands: { name: string } | null } | null;
    } | null;
  } | null;
};

const EXTENSION_WITH_BOOKING = `
  id, booking_id, renter_id, owner_id, current_end_date, requested_end_date,
  status, payment_deadline,
  booking:bookings!inner (
    id, car_id, renter_id, status,
    cars ( plate_number, car_models ( name, car_brands ( name ) ) )
  )
`;

export type ExtensionHold = {
  extensionId: string;
  bookingId: string;
  carId: string;
  renterId: string;
  days: DateWindow;
};

export const loadExtensionHolds = async (
  supabase: ServiceRoleSupabaseClient,
  now = new Date(),
): Promise<ExtensionHold[]> => {
  // Approved-and-unpaid only lives for its 24-hour payment window, so this set
  // stays small without narrowing it further.
  const { data, error } = await supabase
    .from("booking_extensions")
    .select(EXTENSION_WITH_BOOKING)
    .eq("status", "approved")
    .or(`payment_deadline.is.null,payment_deadline.gt."${now.toISOString()}"`);
  if (error) throw error;

  return ((data ?? []) as unknown as ExtensionWithBooking[]).flatMap((row) =>
    row.booking && isHoldingExtension(row, row.booking.status, now.getTime())
      ? [
          {
            extensionId: row.id,
            bookingId: row.booking_id,
            carId: row.booking.car_id,
            renterId: row.booking.renter_id,
            days: extensionAddedDays(row),
          },
        ]
      : [],
  );
};

/** Whether an approved extension holds any of these days - on this car, and for this renter. */
export const findHoldConflict = async (
  supabase: ServiceRoleSupabaseClient,
  input: { carId: string; renterId: string; window: DateWindow; excludeBookingId?: string },
) => {
  const holds = (await loadExtensionHolds(supabase)).filter(
    (hold) => hold.bookingId !== input.excludeBookingId && windowsOverlap(hold.days, input.window),
  );
  return {
    car: holds.some((hold) => hold.carId === input.carId),
    renter: holds.some((hold) => hold.renterId === input.renterId),
  };
};

export type ExtensionCollision = "booking" | "blackout" | "extension" | null;

/**
 * What stands in the way of an extension's days - checked when it is requested,
 * approved, and paid for: another booking on the car or of the renter (one trip
 * at a time), an owner blackout on the car, or another approved extension.
 */
export const findExtensionCollision = async (
  supabase: ServiceRoleSupabaseClient,
  input: { bookingId: string; carId: string; renterId: string; window: DateWindow },
): Promise<ExtensionCollision> => {
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, start_date, end_date")
    .in("status", DATE_HOLDING_BOOKING_STATUSES)
    .neq("id", input.bookingId)
    // Narrowed to the only rows that can collide - this car, or this renter.
    // Unnarrowed, the query pulled every active booking on the platform, and
    // past PostgREST's row cap real collisions were silently missed. Both ids
    // are server-derived from the booking row, never client input.
    .or(`car_id.eq.${input.carId},renter_id.eq.${input.renterId}`);
  if (error) throw error;
  if (
    ((bookings ?? []) as { start_date: string; end_date: string }[]).some((other) =>
      windowsOverlap({ start: other.start_date, end: other.end_date }, input.window),
    )
  ) {
    return "booking";
  }

  const { data: blackouts, error: blackoutError } = await supabase
    .from("vehicle_unavailability")
    .select("id")
    .eq("car_id", input.carId)
    .lte("start_date", input.window.end)
    .gte("end_date", input.window.start)
    .limit(1);
  if (blackoutError) throw blackoutError;
  if ((blackouts ?? []).length > 0) return "blackout";

  const held = await findHoldConflict(supabase, { ...input, excludeBookingId: input.bookingId });
  return held.car || held.renter ? "extension" : null;
};

const CLOSED_NOTE = "Closed automatically: those days now belong to another booking.";

const vehicleLabel = (booking: ExtensionWithBooking["booking"]) => {
  const car = booking?.cars;
  if (!car) return "this booking";
  const brand = car.car_models?.car_brands?.name ?? "";
  const model = car.car_models?.name ?? "";
  return `${`${brand} ${model}`.trim()} (${car.plate_number})`;
};

/**
 * When a lister accepts a booking, pending extension requests that needed the
 * same days can never be approved - on the same car, or of the same renter
 * (one trip at a time). They are closed now, and both sides are told the real
 * reason, instead of waiting out a response deadline that blames the lister.
 * Returns the ids closed.
 */
export const closePendingExtensionsTakenBy = async (
  supabase: ServiceRoleSupabaseClient,
  booking: { id: string; car_id: string; renter_id: string; start_date: string; end_date: string },
  baseOrigin: string,
): Promise<string[]> => {
  // Pending requests live at most 24 hours, so this set stays small.
  const { data, error } = await supabase
    .from("booking_extensions")
    .select(EXTENSION_WITH_BOOKING)
    .eq("status", "pending")
    .neq("booking_id", booking.id);
  if (error) throw error;

  const accepted: DateWindow = { start: booking.start_date, end: booking.end_date };
  const taken = ((data ?? []) as unknown as ExtensionWithBooking[]).filter(
    (row) =>
      row.booking &&
      (row.booking.car_id === booking.car_id || row.booking.renter_id === booking.renter_id) &&
      windowsOverlap(extensionAddedDays(row), accepted),
  );

  const closed: string[] = [];
  for (const row of taken) {
    const { data: claimed, error: claimError } = await supabase
      .from("booking_extensions")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        owner_decision_note: CLOSED_NOTE,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;
    closed.push(row.id);

    const sameCar = row.booking?.car_id === booking.car_id;
    const vehicle = vehicleLabel(row.booking);
    const title = "Extension request closed";
    const renterMessage = sameCar
      ? `Your extension request for ${vehicle} (return ${row.requested_end_date}) can't go ahead: another booking was accepted for those days. Your current return date (${row.current_end_date}) stands.`
      : `Your extension request for ${vehicle} (return ${row.requested_end_date}) can't go ahead: you have another booking on those days, and you can only be on one trip at a time. Your current return date (${row.current_end_date}) stands.`;
    const ownerMessage = sameCar
      ? `The renter's extension request for ${vehicle} was closed because you accepted another booking for those days. Their current return date (${row.current_end_date}) stands.`
      : `The renter's extension request for ${vehicle} was closed: they now have another booking on those days. Their current return date (${row.current_end_date}) stands.`;

    await supabase.from("notifications").insert([
      { user_id: row.renter_id, title, message: renterMessage, type: "warning", link: "/my-bookings" },
      { user_id: row.owner_id, title, message: ownerMessage, type: "info", link: "/lister-bookings" },
    ]);
    await sendUserNotificationEmail(supabase, {
      userId: row.renter_id,
      title,
      message: renterMessage,
      link: "/my-bookings",
      baseOrigin,
      eventKey: `extension-closed-renter:${row.id}`,
    });
    await sendUserNotificationEmail(supabase, {
      userId: row.owner_id,
      title,
      message: ownerMessage,
      link: "/lister-bookings",
      baseOrigin,
      eventKey: `extension-closed-owner:${row.id}`,
    });
    await supabase.from("audit_log").insert({
      user_id: null,
      action: "booking_extension_closed_by_booking",
      entity_type: "booking_extension",
      entity_id: row.id,
      details: {
        automated: true,
        extension_booking_id: row.booking_id,
        accepted_booking_id: booking.id,
        reason: sameCar ? "car_dates_taken" : "renter_trip_overlap",
      },
    });
  }
  return closed;
};
