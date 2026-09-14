// Search across a person's own bookings - the renter's My Bookings and the
// lister's Lister Bookings. It runs over rows the page has already loaded, so
// it can only ever find what that person can already see.
//
// Every word typed must appear somewhere (so "vios juan" finds Juan's Vios
// booking), in any order. Deliberately not searched: the other party's email
// and phone.
import { format } from "date-fns";
import { getBookingReference } from "./bookingReference";

export type BookingSearchFields = {
  id: string;
  startDate: string;
  endDate: string;
  carBrand?: string | null;
  carModel?: string | null;
  plateNumber?: string | null;
  location?: string | null;
  /** The renter's name on the lister's page, the lister's name on the renter's. */
  counterpartName?: string | null;
};

const dateText = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // "Sep 20 2026 September" - the short form the booking cards show, plus the
  // full month name for anyone who types it out.
  return `${format(date, "MMM d yyyy")} ${format(date, "MMMM")}`;
};

export const buildBookingSearchText = (booking: BookingSearchFields): string => {
  const plate = booking.plateNumber ?? "";
  return [
    booking.carBrand,
    booking.carModel,
    plate,
    // "nny3609" finds "NNY 3609".
    plate.replace(/\s+/g, ""),
    getBookingReference(booking.id),
    booking.location,
    booking.counterpartName,
    dateText(booking.startDate),
    dateText(booking.endDate),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

export const matchesBookingSearch = (
  booking: BookingSearchFields,
  query: string,
): boolean => {
  const words = query.toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const text = buildBookingSearchText(booking);
  const textWords = new Set(text.split(/[\s-]+/));
  return words.every((word) =>
    // A one- or two-digit number is a day of the month, so it must be a whole
    // word: otherwise "sep 20" would match every September booking through
    // the year "2026". Longer input (plates, years, references) may be partial.
    /^\d{1,2}$/.test(word) ? textWords.has(word) : text.includes(word),
  );
};
