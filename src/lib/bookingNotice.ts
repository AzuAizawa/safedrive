// Minimum notice before a trip's pickup (CHAPTER 93) - the browser copy of
// server/bookingNotice.ts, which guards api/create-booking.ts. The rule is
// explained there. Kept import-free and identical below this header so
// scripts/booking-notice.test.mjs can pin both copies to the same answers;
// change them together.

export const DEFAULT_MIN_BOOKING_NOTICE_HOURS = 12;
export const MIN_BOOKING_NOTICE_HOURS_MIN = 1;
export const MIN_BOOKING_NOTICE_HOURS_MAX = 168;

const HOUR_MS = 3_600_000;

// An unreadable setting falls back to the default, never to 0 hours.
export const normalizeBookingNoticeHours = (value: unknown) => {
  if (value === null || value === undefined || value === "") return DEFAULT_MIN_BOOKING_NOTICE_HOURS;
  const parsed = Number(value);
  return Number.isFinite(parsed) &&
    parsed >= MIN_BOOKING_NOTICE_HOURS_MIN &&
    parsed <= MIN_BOOKING_NOTICE_HOURS_MAX
    ? Math.round(parsed)
    : DEFAULT_MIN_BOOKING_NOTICE_HOURS;
};

// A Manila calendar date ("2026-09-15") and Manila clock time ("11:30") as a
// real instant.
export const getManilaPickupMs = (dateIso: string, time: string) => {
  const [year, month, day] = (dateIso || "").split("-").map((part) => Number(part));
  const [hour, minute] = (time || "").split(":").map((part) => Number(part));
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return Date.UTC(year, month - 1, day, hour, minute) - 8 * HOUR_MS;
};

export const getEarliestPickupMs = (nowMs: number, noticeHours: number) =>
  nowMs + noticeHours * HOUR_MS;

export const meetsBookingNotice = (pickupMs: number, nowMs: number, noticeHours: number) =>
  pickupMs >= getEarliestPickupMs(nowMs, noticeHours);

// The pickup times on a Manila date that still meet the notice.
export const filterPickupTimesByNotice = <T extends { value: string }>(
  options: readonly T[],
  dateIso: string,
  nowMs: number,
  noticeHours: number,
): T[] =>
  options.filter((option) => {
    const pickupMs = getManilaPickupMs(dateIso, option.value);
    return pickupMs !== null && meetsBookingNotice(pickupMs, nowMs, noticeHours);
  });

// "Sep 15, 11:30 AM", in Manila time wherever the code runs.
export const formatManilaDateTime = (ms: number) =>
  new Date(ms).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
