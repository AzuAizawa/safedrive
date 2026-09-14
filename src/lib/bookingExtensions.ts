export type BookingExtensionDisplayLike = {
  status: string;
  payment_deadline: string | null;
  paid_at?: string | null;
};

export const getExtensionDisplayStatus = (
  extension: BookingExtensionDisplayLike,
  now = new Date(),
) => {
  if (
    extension.status === "approved" &&
    !extension.paid_at &&
    extension.payment_deadline
  ) {
    const deadlineMs = new Date(extension.payment_deadline).getTime();
    if (!Number.isNaN(deadlineMs) && deadlineMs <= now.getTime()) {
      return "expired";
    }
  }

  return extension.status;
};

// CHAPTER 88 - an approved extension holds the days it adds until it is paid
// or its payment deadline passes; a pending request holds nothing. The server
// applies the same rules in server/extensionHolds.ts (api code cannot import
// src/); scripts/extension-holds.test.mjs pins the two copies together.

const nextDateOnly = (dateOnly: string) => {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

/** The days an extension adds: the day after the current return through the requested one. */
export const extensionAddedDays = (extension: {
  current_end_date: string;
  requested_end_date: string;
}) => ({
  start: nextDateOnly(extension.current_end_date),
  end: extension.requested_end_date,
});

export const isExtensionHoldingDates = (
  extension: { status: string; payment_deadline: string | null },
  bookingStatus: string,
  now = Date.now(),
) =>
  extension.status === "approved" &&
  (!extension.payment_deadline || new Date(extension.payment_deadline).getTime() > now) &&
  ["fully_paid", "active"].includes(bookingStatus);

type BookingDatesLike = {
  id: string;
  car_id: string;
  renter_id: string;
  start_date: string;
  end_date: string;
};

/**
 * Pending extension requests that accepting `booking` would close: requests on
 * the lister's other bookings that need some of the same days on the same car,
 * or belong to the same renter. Mirrors closePendingExtensionsTakenBy.
 */
export const findPendingExtensionsTakenBy = <
  B extends BookingDatesLike,
  E extends { booking_id: string; status: string; current_end_date: string; requested_end_date: string },
>(
  booking: B,
  bookings: B[],
  extensions: E[],
) =>
  extensions.flatMap((extension) => {
    if (extension.status !== "pending") return [];
    const parent = bookings.find((candidate) => candidate.id === extension.booking_id);
    if (!parent || parent.id === booking.id) return [];
    if (parent.car_id !== booking.car_id && parent.renter_id !== booking.renter_id) return [];
    const days = extensionAddedDays(extension);
    return days.start <= booking.end_date && days.end >= booking.start_date
      ? [{ extension, booking: parent }]
      : [];
  });

export const getExtensionStatusLabel = (status: string) =>
  (
    {
      pending: "Awaiting decision",
      approved: "Approved - waiting for payment",
      paid: "Paid and applied",
      rejected: "Rejected",
      cancelled: "Cancelled",
      expired: "Expired - payment window closed",
    } as Record<string, string>
  )[status] || status;

export const getExtensionTone = (status: string) => {
  if (status === "approved") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
  if (status === "paid") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "rejected") {
    return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (status === "expired") {
    return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (status === "cancelled") {
    return "border-muted bg-muted/40 text-muted-foreground";
  }
  return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
};
