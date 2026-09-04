// Driver's licence validity + Philippine transmission restriction (AT / AT-MT).
// The gate is deliberately conservative: it only blocks on EXPLICIT values, so
// an unreviewed renter or an un-tagged car is nudged in the UI but never hard
// blocked. Server enforcement lives in api/create-booking.ts and mirrors this.

export type LicenseTransmission = "automatic_only" | "manual_and_automatic";
export type CarTransmission = "automatic" | "manual";

export const LICENSE_TRANSMISSION_LABEL: Record<LicenseTransmission, string> = {
  automatic_only: "Automatic only",
  manual_and_automatic: "Manual & Automatic",
};

export const CAR_TRANSMISSION_LABEL: Record<CarTransmission, string> = {
  automatic: "Automatic",
  manual: "Manual",
};

export const carTransmissionLabel = (value: string | null | undefined) =>
  value === "automatic" || value === "manual"
    ? CAR_TRANSMISSION_LABEL[value]
    : "Not specified";

/**
 * Can a renter with this licence restriction book a car with this transmission?
 * Only an explicit automatic-only licence against an explicit manual car is a
 * block; everything else (including unset values) is allowed.
 */
export const renterMayBookTransmission = (
  licenseTransmission: string | null | undefined,
  carTransmission: string | null | undefined,
) => !(licenseTransmission === "automatic_only" && carTransmission === "manual");

export type LicenseExpiryState = "unknown" | "valid" | "expiring" | "expired";

export const licenseExpiryState = (
  expiry: string | null | undefined,
): LicenseExpiryState => {
  if (!expiry) return "unknown";
  const end = new Date(`${expiry}T23:59:59`);
  if (Number.isNaN(end.getTime())) return "unknown";
  const daysLeft = Math.floor((end.getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "expiring";
  return "valid";
};

/** A short human phrase for the licence expiry, e.g. "Valid to May 10, 2028". */
export const licenseExpiryLabel = (expiry: string | null | undefined) => {
  if (!expiry) return "Not reviewed yet";
  const end = new Date(`${expiry}T00:00:00`);
  if (Number.isNaN(end.getTime())) return expiry;
  const nice = end.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const state = licenseExpiryState(expiry);
  if (state === "expired") return `Expired ${nice}`;
  if (state === "expiring") return `Expires ${nice}`;
  return `Valid to ${nice}`;
};

/** Only an explicit past expiry blocks a booking. Null = grandfathered. */
export const isLicenseExpired = (expiry: string | null | undefined) =>
  licenseExpiryState(expiry) === "expired";
