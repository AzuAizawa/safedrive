// "Report an issue" with the car (CHAPTER 131). Kept import-free:
// src/lib/vehicleReports.ts is the same file, and
// scripts/vehicle-moderation.test.mjs keeps the two equal.

export const MAX_REPORT_PHOTOS = 4;
export const REPORT_MESSAGE_MIN = 10;
export const REPORT_MESSAGE_MAX = 2000;

export type ReportWindowBooking = {
  status: string;
  owner_completed?: boolean | null;
  lister_handover_confirmed_at?: string | null;
  lister_return_arrived_at?: string | null;
};

/**
 * Whether this side may report now; why not, if not. The renter reports at
 * the handover - from the moment the lister hands the car over until the trip
 * is over (they may never tap "returned", so that cannot be the end). The
 * lister reports at the return - from their return check-in until they
 * confirm they received the car.
 */
export const reportWindowProblem = (booking: ReportWindowBooking, role: "renter" | "lister"): string | null => {
  if (role === "renter") {
    if (!booking.lister_handover_confirmed_at || !["fully_paid", "active"].includes(booking.status)) {
      return "You can report an issue with the car from the moment the lister hands it over until the trip is over.";
    }
    return null;
  }
  if (booking.status !== "active" || !booking.lister_return_arrived_at || booking.owner_completed) {
    return "You can report an issue with the car after your return check-in, before you confirm you received it.";
  }
  return null;
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  open: "Issue reported · waiting for SafeDrive",
  reviewed: "Issue reported · reviewed by SafeDrive",
  dismissed: "Issue reported · closed by SafeDrive",
};

/** "3 reports" on a car, counting only reports staff found valid. */
export const describeReportCount = (reviewed: number) =>
  reviewed === 1 ? "1 confirmed report" : `${reviewed} confirmed reports`;
