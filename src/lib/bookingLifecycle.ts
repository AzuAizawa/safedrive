import { supabase } from "@/lib/supabase";

type ReminderBooking = {
  id: string;
  status: string;
  end_date: string;
  dropoff_time: string | null;
  renter_return_arrived_at: string | null;
  lister_return_arrived_at: string | null;
  label: string;
};

// An approved early-return request's date+time - the only fields the
// deadline math below needs. Matches the shape of a row from
// booking_early_returns (see src/lib/earlyReturns.ts).
export type EarlyReturnDeadlineInput = {
  status: string;
  requested_end_date: string;
  requested_end_time: string;
};

type NoShowBooking = {
  status: string;
  start_date: string;
  pickup_time: string | null;
  renter_arrived_at: string | null;
  lister_arrived_at: string | null;
};

type ReturnNoShowBooking = {
  status: string;
  end_date: string;
  dropoff_time: string | null;
  renter_return_arrived_at: string | null;
  lister_return_arrived_at: string | null;
};

type ReturnReminderState = {
  kind: "due_soon" | "overdue";
  deadline: Date;
  title: string;
  body: string;
  footnote: string;
  tone: string;
};

// Dates and times are Manila wall-clock everywhere in this system, and the
// server builds these instants as Date.UTC(...) - 8h (api/booking-action.ts,
// api/expire-booking-deadlines.ts). These two used `new Date(y, m, d, h, ...)`,
// which resolves in the BROWSER's timezone - so on a device not set to
// UTC+8, the return gates computed here drifted from the server by the
// device's offset, while pickup gates in MyBookingsPage/ListerBookingsPage
// (which already used the Date.UTC form) stayed correct. Within one screen,
// pickup was Manila-anchored and return was device-anchored: the return
// check-in button could appear while the API still answered 409, or stay
// hidden when the API would have accepted it.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const manilaInstant = (
  dateOnly: string,
  time: string | null,
  fallbackTime: string,
) => {
  const [year, month, day] = (dateOnly || "").split("-").map(Number);
  const [hour, minute] = (time || fallbackTime).split(":").map(Number);
  const [fallbackHour] = fallbackTime.split(":").map(Number);

  return new Date(
    Date.UTC(
      year,
      (month || 1) - 1,
      day || 1,
      hour ?? fallbackHour,
      minute || 0,
      0,
      0,
    ) - MANILA_OFFSET_MS,
  );
};

export const getBookingReturnDeadline = (
  endDate: string,
  dropoffTime: string | null,
) => manilaInstant(endDate, dropoffTime, "18:00");

export const getBookingPickupTime = (
  startDate: string,
  pickupTime: string | null,
) => manilaInstant(startDate, pickupTime, "09:00");

// Approving an early return never rewrites bookings.end_date/dropoff_time -
// those columns permanently mean "the ORIGINAL agreed return date+time" (see
// api/booking-early-return-action.ts). The approved early date+time lives
// only on its own booking_early_returns row. That split needs two different
// deadline concepts, not one - a single "falls back after a miss" value
// cannot also gate the arrival button, or the button would flicker shut
// right when the missed party needs it most (early 6 AM missed by 6:30 AM ->
// if the button's own open time were recomputed from the now-fallen-back
// 10 AM deadline minus a 3h lead, it would vanish from 6:30-7:00 AM).
//
// Concept A - "operative deadline" (can fall back): drives the reminder/
// overdue-label banner, no-show-*report* eligibility, and "return by"
// display text.
export const getOperativeReturnDeadline = (
  booking: {
    end_date: string;
    dropoff_time: string | null;
    renter_return_arrived_at: string | null;
    lister_return_arrived_at: string | null;
  },
  approvedEarlyReturn: EarlyReturnDeadlineInput | null | undefined,
  now = new Date(),
): { deadline: Date; source: "early" | "original" } => {
  const original = getBookingReturnDeadline(booking.end_date, booking.dropoff_time);
  if (!approvedEarlyReturn || approvedEarlyReturn.status !== "approved") {
    return { deadline: original, source: "original" };
  }
  const early = getBookingReturnDeadline(
    approvedEarlyReturn.requested_end_date,
    approvedEarlyReturn.requested_end_time,
  );
  const anyArrived = Boolean(
    booking.renter_return_arrived_at || booking.lister_return_arrived_at,
  );
  const missed =
    !anyArrived &&
    now.getTime() >= early.getTime() + NO_SHOW_GRACE_WINDOW_MINUTES * 60 * 1000;
  return missed ? { deadline: original, source: "original" } : { deadline: early, source: "early" };
};

// Concept B - "check-in eligible from" (never re-closes): once an early
// return is approved this always opens against the (earlier) early instant,
// permanently - it must never re-close, even after a missed-early-return
// fallback (above) makes the ORIGINAL instant operative again for labeling
// purposes. Drives only the "I Have Arrived" button's lead-time gate.
export const getReturnCheckinEligibleDeadline = (
  booking: { end_date: string; dropoff_time: string | null },
  approvedEarlyReturn: EarlyReturnDeadlineInput | null | undefined,
): Date =>
  approvedEarlyReturn?.status === "approved"
    ? getBookingReturnDeadline(approvedEarlyReturn.requested_end_date, approvedEarlyReturn.requested_end_time)
    : getBookingReturnDeadline(booking.end_date, booking.dropoff_time);

// Display-only helper (distinct from both concepts above, but derived from
// concept A with no duplicated logic): which raw date/time strings to show
// a user as "the return date," given the same fallback rule.
export const getEffectiveReturnDateTime = (
  booking: Parameters<typeof getOperativeReturnDeadline>[0],
  approvedEarlyReturn: EarlyReturnDeadlineInput | null | undefined,
  now = new Date(),
): { date: string; time: string | null; source: "early" | "original" } => {
  const { source } = getOperativeReturnDeadline(booking, approvedEarlyReturn, now);
  if (source === "early" && approvedEarlyReturn) {
    return { date: approvedEarlyReturn.requested_end_date, time: approvedEarlyReturn.requested_end_time, source };
  }
  return { date: booking.end_date, time: booking.dropoff_time, source };
};

// Independent of NO_SHOW_GRACE_WINDOW_MINUTES (30, below) - that constant
// gates no-show-*report* eligibility; this one only delays the cosmetic
// "overdue" label on the reminder banner (getReturnReminderState).
export const RETURN_OVERDUE_LABEL_GRACE_MINUTES = 180;

export const NO_SHOW_GRACE_WINDOW_MINUTES = 30;

export const getNoShowWindowState = (
  booking: NoShowBooking,
  actor: "renter" | "owner",
  now = new Date(),
) => {
  if (!["fully_paid", "active"].includes(booking.status)) return null;

  const actorArrived =
    actor === "renter" ? booking.renter_arrived_at : booking.lister_arrived_at;
  const counterpartyArrived =
    actor === "renter" ? booking.lister_arrived_at : booking.renter_arrived_at;

  if (!actorArrived || counterpartyArrived) return null;

  const pickupAt = getBookingPickupTime(booking.start_date, booking.pickup_time);
  const reportReadyAt = new Date(
    pickupAt.getTime() + NO_SHOW_GRACE_WINDOW_MINUTES * 60 * 1000,
  );
  const msRemaining = reportReadyAt.getTime() - now.getTime();

  return {
    pickupAt,
    reportReadyAt,
    canReport: msRemaining <= 0,
    minutesRemaining: Math.max(0, Math.ceil(msRemaining / 60000)),
  };
};

// Mirrors getNoShowWindowState above, but for the return/drop-off leg -
// kept as its own function rather than parameterizing the pickup one, to
// keep the pickup path (used elsewhere) untouched.
export const getReturnNoShowWindowState = (
  booking: ReturnNoShowBooking,
  actor: "renter" | "owner",
  approvedEarlyReturn?: EarlyReturnDeadlineInput | null,
  now = new Date(),
) => {
  if (booking.status !== "active") return null;

  const actorArrived =
    actor === "renter"
      ? booking.renter_return_arrived_at
      : booking.lister_return_arrived_at;
  const counterpartyArrived =
    actor === "renter"
      ? booking.lister_return_arrived_at
      : booking.renter_return_arrived_at;

  if (!actorArrived || counterpartyArrived) return null;

  const dropoffAt = getOperativeReturnDeadline(booking, approvedEarlyReturn, now).deadline;
  const reportReadyAt = new Date(
    dropoffAt.getTime() + NO_SHOW_GRACE_WINDOW_MINUTES * 60 * 1000,
  );
  const msRemaining = reportReadyAt.getTime() - now.getTime();

  return {
    dropoffAt,
    reportReadyAt,
    canReport: msRemaining <= 0,
    minutesRemaining: Math.max(0, Math.ceil(msRemaining / 60000)),
  };
};

export const getReturnReminderState = (
  booking: Pick<
    ReminderBooking,
    "status" | "end_date" | "dropoff_time" | "renter_return_arrived_at" | "lister_return_arrived_at"
  >,
  approvedEarlyReturn?: EarlyReturnDeadlineInput | null,
  now = new Date(),
): ReturnReminderState | null => {
  if (!["fully_paid", "active"].includes(booking.status)) return null;

  const deadline = getOperativeReturnDeadline(booking, approvedEarlyReturn, now).deadline;
  const diffMs = deadline.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes > 24 * 60) return null;

  if (diffMinutes >= 0) {
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    const timeLabel =
      hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
    return {
      kind: "due_soon",
      deadline,
      title: "Return due soon",
      body: "This booking is close to its agreed return time. Plan the handoff and keep the required check-in or completion evidence ready.",
      footnote: `Return deadline: ${deadline.toLocaleString()} • ${timeLabel}`,
      tone: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  const overdueMinutes = Math.abs(diffMinutes);

  // Past the deadline, but still inside the grace period before the
  // "overdue" label shows - stays a due_soon-toned message noting the
  // countdown to that label instead.
  if (overdueMinutes <= RETURN_OVERDUE_LABEL_GRACE_MINUTES) {
    const graceMinutesLeft = RETURN_OVERDUE_LABEL_GRACE_MINUTES - overdueMinutes;
    return {
      kind: "due_soon",
      deadline,
      title: "Return due soon",
      body: "The agreed return time has just passed. Finish the handoff soon.",
      footnote: `Return deadline: ${deadline.toLocaleString()} • overdue label in ${graceMinutesLeft}m`,
      tone: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  const overdueHours = Math.floor(overdueMinutes / 60);
  const overdueRemainder = overdueMinutes % 60;
  const overdueLabel =
    overdueHours > 0
      ? `${overdueHours}h ${overdueRemainder}m overdue`
      : `${overdueRemainder}m overdue`;

  return {
    kind: "overdue",
    deadline,
    title: "Return overdue",
    body: "The agreed return time has passed. Coordinate immediately and document the handoff or issue through the platform.",
    footnote: `Scheduled return: ${deadline.toLocaleString()} • ${overdueLabel}`,
    tone: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
  };
};

export const ensureReturnReminderNotifications = async (
  userId: string,
  bookings: ReminderBooking[],
  linkBase: string,
) => {
  const candidates = bookings
    .map((booking) => ({
      booking,
      reminder: getReturnReminderState(booking),
    }))
    .filter(
      (
        item,
      ): item is {
        booking: ReminderBooking;
        reminder: ReturnReminderState;
      } => Boolean(item.reminder),
    );

  if (candidates.length === 0) return;

  const links = candidates.map(
    ({ booking, reminder }) =>
      `${linkBase}?bookingId=${booking.id}&notice=${reminder.kind}`,
  );

  const { data: existing } = await supabase
    .from("notifications")
    .select("link")
    .eq("user_id", userId)
    .in("link", links);

  const existingLinks = new Set((existing ?? []).map((row) => row.link));

  const inserts = candidates
    .filter(
      ({ booking, reminder }) =>
        !existingLinks.has(`${linkBase}?bookingId=${booking.id}&notice=${reminder.kind}`),
    )
    .map(({ booking, reminder }) => ({
      user_id: userId,
      title: reminder.title,
      message: `${booking.label}: ${reminder.body}`,
      type: reminder.kind === "overdue" ? "error" : "warning",
      link: `${linkBase}?bookingId=${booking.id}&notice=${reminder.kind}`,
    }));

  if (inserts.length > 0) {
    await supabase.from("notifications").insert(inserts);
  }
};
