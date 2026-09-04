import { getBookingReturnDeadline, NO_SHOW_GRACE_WINDOW_MINUTES } from "@/lib/bookingLifecycle";

export type IncidentAction =
  | "renter_no_car"
  | "renter_no_show"
  | "report_non_return";

// Structured reason for report_non_return (CHAPTER 37), kept in sync with
// NON_RETURN_REASONS in api/booking-incident-action.ts and the check
// constraint on bookings.dispute_reason. Not used by the other two actions.
export type NonReturnReason =
  | "renter_unreachable"
  | "stolen_or_missing"
  | "accident_or_breakdown"
  | "other";

export const NON_RETURN_REASON_OPTIONS: Array<{ value: NonReturnReason; label: string }> = [
  { value: "renter_unreachable", label: "Renter is not responding / unreachable" },
  { value: "stolen_or_missing", label: "Vehicle reported stolen or missing" },
  { value: "accident_or_breakdown", label: "Accident or breakdown preventing return" },
  { value: "other", label: "Other" },
];

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
  body: {
    bookingId: string;
    action: IncidentAction;
    note?: string | null;
    reason?: NonReturnReason | null;
  },
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
