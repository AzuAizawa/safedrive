/**
 * Shared, enforced-in-JS validation for the vehicle listing form.
 *
 * The form previously relied only on the `<input pattern>` / `min` attributes,
 * so the checks fired as a native browser bubble on submit and could be masked
 * by another invalid field - a bad plate or an under-minimum price slipped
 * through to admin review. These helpers run in the submit handlers and drive
 * inline error text, independent of native constraint validation.
 */

/**
 * Philippine four-wheel plate: 3 letters, an optional single space or hyphen,
 * then 3 or 4 digits (e.g. `ABC 1234`, `ABC-1234`, `ABC1234`, and older
 * `ABC 123`). Rejects 5+ digit input like `ABC12345`.
 */
export const PLATE_NUMBER_PATTERN = "^[A-Z]{3}[ -]?[0-9]{3,4}$";
export const PLATE_NUMBER_HINT =
  "Philippine plate format: 3 letters then 3 or 4 digits (e.g. ABC 1234 or ABC-1234).";

const plateRegex = new RegExp(PLATE_NUMBER_PATTERN);

export const normalizePlateNumber = (value: string) =>
  value.trim().toUpperCase().replace(/[^A-Z0-9 -]/g, "");

/** Returns an error string, or `null` when the plate number is acceptable. */
export const validatePlateNumber = (value: string): string | null => {
  const normalized = normalizePlateNumber(value);
  if (!normalized) return "Plate number is required.";
  if (!plateRegex.test(normalized)) return PLATE_NUMBER_HINT;
  return null;
};

export const LISTING_PRICE_MIN = 500;
export const LISTING_PRICE_MAX = 100000;

/** Returns an error string, or `null` when the daily price is acceptable. */
export const validateListingPrice = (value: string | number): string | null => {
  if (value === "" || value === null || value === undefined) {
    return "Price per day is required.";
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Enter a valid number.";
  if (amount < LISTING_PRICE_MIN) {
    return `Daily price must be at least PHP ${LISTING_PRICE_MIN.toLocaleString()}.`;
  }
  if (amount > LISTING_PRICE_MAX) {
    return `Daily price cannot exceed PHP ${LISTING_PRICE_MAX.toLocaleString()}.`;
  }
  return null;
};
