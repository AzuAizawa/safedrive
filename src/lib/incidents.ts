import { getBookingReturnDeadline, NO_SHOW_GRACE_WINDOW_MINUTES } from "@/lib/bookingLifecycle";

export type IncidentAction =
  | "renter_no_car"
  | "renter_no_show"
  | "report_non_return";

type NonReturnBooking = {
  status: string;
  end_date: string;
  dropoff_time: string | null;
  renter_completed?: boolean | null;
  owner_completed?: boolean | null;
  dispute_status?: string | null;
};

/**
 * True when an active trip is past its agreed return time plus the grace
 * window, nobody has started completion, and it is not already flagged.
 * Mirrors the server guard in api/booking-incident-action.ts.
 */
export const canReportNonReturn = (
  booking: NonReturnBooking,
  now = new Date(),
) => {
  if (booking.status !== "active") return false;
  if (booking.renter_completed || booking.owner_completed) return false;
  if ((booking.dispute_status ?? "none") !== "none") return false;
  const deadline = getBookingReturnDeadline(booking.end_date, booking.dropoff_time);
  return (
    now.getTime() >=
    deadline.getTime() + NO_SHOW_GRACE_WINDOW_MINUTES * 60 * 1000
  );
};

export const runIncidentAction = async (
  accessToken: string | undefined,
  body: { bookingId: string; action: IncidentAction; note?: string | null },
) => {
  const res = await fetch("/api/booking-incident-action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    state?: string;
  };
  if (!res.ok) throw new Error(data.error || "Incident report failed");
  return data;
};
