// Trip dates carried from Browse Cars to a car's page, as
// ?pickup=2026-10-25&return=2026-10-27 (return optional), so a renter who
// filtered by date does not have to pick the same dates again.
//
// A link can be old, typed by hand, or shared, so what comes back in is checked
// against the same windows the booking calendar enforces; anything outside
// them is dropped rather than half-applied.
import { differenceInCalendarDays, format, startOfDay } from "date-fns";

export type TripDates = { from: Date; to?: Date };

export const formatDateOnly = (date: Date) => format(date, "yyyy-MM-dd");

const parseDateOnly = (value: string | null): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // new Date(2026, 1, 30) quietly becomes March 2; refuse it instead.
  return formatDateOnly(date) === value ? date : null;
};

export const tripDatesQuery = (trip: { from?: Date; to?: Date } | undefined) => {
  if (!trip?.from) return "";
  const params = new URLSearchParams({ pickup: formatDateOnly(trip.from) });
  if (trip.to) params.set("return", formatDateOnly(trip.to));
  return `?${params.toString()}`;
};

export const parseTripDatesQuery = (
  search: string,
  now: Date,
  limits: { maxAdvanceDays: number; maxTripDays: number },
): TripDates | undefined => {
  const params = new URLSearchParams(search);
  const from = parseDateOnly(params.get("pickup"));
  if (!from) return undefined;

  // The earliest pickup is tomorrow (api/create-booking.ts).
  const daysAhead = differenceInCalendarDays(from, startOfDay(now));
  if (daysAhead < 1 || daysAhead > limits.maxAdvanceDays) return undefined;

  const to = parseDateOnly(params.get("return"));
  if (!to) return { from };
  const tripDays = differenceInCalendarDays(to, from);
  return tripDays >= 1 && tripDays <= limits.maxTripDays ? { from, to } : { from };
};
