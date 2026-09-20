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

export const EARLY_RETURN_RESPONSE_HOURS_MIN = 1;
export const EARLY_RETURN_RESPONSE_HOURS_MAX = 24;

/**
 * The listing form's checked fields, in the order they appear on the form, so
 * every problem is reported at once and top to bottom. The form used to stop
 * at the first: the browser's bubble named one field per click, the handler
 * then raised one toast per click, and Brand and Model - custom dropdowns the
 * browser does not check - were skipped with no message at all.
 */
export const LISTING_FIELD_LABELS = {
  brand: "Brand",
  model: "Model",
  transmission: "Transmission",
  plate_number: "Plate number",
  mileage: "Mileage",
  price_per_day: "Price per day",
  early_return_response_window_hours: "Early-return response limit",
  location: "Pickup/Dropoff region",
  city: "City/Municipality",
  specific_location: "Pick-up location/landmark",
  car_images: "Car images",
  or_file: "Official Receipt (OR)",
  registration_expiry: "Registration expiry",
  cr_file: "Certificate of Registration (CR)",
  ctpl_file: "CTPL insurance",
  ctpl_expiry: "CTPL expiry",
  comprehensive_insurance_file: "Comprehensive insurance",
  comprehensive_insurance_expiry: "Comprehensive insurance expiry",
  insurer_rental_use_confirmed: "Rental-use disclosure",
  dti_file: "DTI registration",
  dti_expiry: "DTI expiry",
  mayors_permit_file: "Business/Mayor's Permit",
  mayors_permit_expiry: "Permit expiry",
  bir_file: "BIR certificate",
  rental_agreement: "Rental agreement",
} as const;

export type ListingField = keyof typeof LISTING_FIELD_LABELS;
export type ListingFieldError = { field: ListingField; message: string };

const responseHoursError = (value: string) => {
  const hours = Number(value);
  return value.trim() === "" ||
    !Number.isInteger(hours) ||
    hours < EARLY_RETURN_RESPONSE_HOURS_MIN ||
    hours > EARLY_RETURN_RESPONSE_HOURS_MAX
    ? `Enter a whole number of hours from ${EARLY_RETURN_RESPONSE_HOURS_MIN} to ${EARLY_RETURN_RESPONSE_HOURS_MAX}.`
    : null;
};

// Dates are yyyy-MM-dd, so they compare as strings.
const expiryError = (value: string, today: string, document: string) =>
  !value
    ? `Enter the expiry date shown on the ${document}.`
    : value < today
      ? `That date has passed - the ${document} must still be valid.`
      : null;

export type NewListingInput = {
  brandId: string | null;
  modelId: string | null;
  transmission: string;
  plateNumber: string;
  plateTaken: boolean;
  mileage: string;
  pricePerDay: string;
  earlyReturnResponseHours: string;
  region: string;
  city: string;
  specificLocation: string;
  carImageCount: number;
  hasOr: boolean;
  registrationExpiry: string;
  hasCr: boolean;
  hasCtpl: boolean;
  ctplExpiry: string;
  hasComprehensive: boolean;
  comprehensiveExpiry: string;
  rentalUseConfirmed: boolean;
  hasDti: boolean;
  dtiExpiry: string;
  hasMayorsPermit: boolean;
  mayorsPermitExpiry: string;
  hasBir: boolean;
  hasRentalAgreement: boolean;
  /** yyyy-MM-dd */
  today: string;
};

/** Every problem with a new listing, in form order. Empty means it can be submitted. */
export const validateNewListing = (input: NewListingInput): ListingFieldError[] => {
  const errors: ListingFieldError[] = [];
  const check = (field: ListingField, message: string | null) => {
    if (message) errors.push({ field, message });
  };

  check("brand", input.brandId ? null : "Select the brand.");
  check(
    "model",
    input.modelId ? null : input.brandId ? "Select the model." : "Select a brand first, then the model.",
  );
  check(
    "transmission",
    ["automatic", "manual"].includes(input.transmission) ? null : "Select Automatic or Manual.",
  );
  check(
    "plate_number",
    validatePlateNumber(input.plateNumber) ??
      (input.plateTaken ? "This plate number is already registered in SafeDrive." : null),
  );
  check(
    "mileage",
    input.mileage.trim() !== "" && !(Number(input.mileage) >= 0)
      ? "Enter a mileage of 0 or more, or leave it blank."
      : null,
  );
  check("price_per_day", validateListingPrice(input.pricePerDay));
  check("early_return_response_window_hours", responseHoursError(input.earlyReturnResponseHours));
  check("location", input.region ? null : "Select the pickup/dropoff region.");
  check(
    "city",
    input.city.trim()
      ? null
      : input.region
        ? "Select the city or municipality, or type it under Other."
        : "Select a region first, then the city.",
  );
  check("specific_location", input.specificLocation.trim() ? null : "Enter where the renter picks the car up.");
  check(
    "car_images",
    input.carImageCount < 1
      ? "Add at least 1 photo of the car."
      : input.carImageCount > 5
        ? "Add no more than 5 photos."
        : null,
  );
  check("or_file", input.hasOr ? null : "Upload the Official Receipt (OR).");
  check("registration_expiry", expiryError(input.registrationExpiry, input.today, "OR"));
  check("cr_file", input.hasCr ? null : "Upload the Certificate of Registration (CR).");
  check("ctpl_file", input.hasCtpl ? null : "Upload the CTPL insurance.");
  check("ctpl_expiry", expiryError(input.ctplExpiry, input.today, "CTPL"));
  // Required since CHAPTER 103. CTPL is the statutory minimum for road use and
  // covers none of what a rental risks - the vehicle, the renter, or damage to
  // property - so a vehicle offered for rent needs cover that reaches them.
  // Told here rather than at review, so nobody uploads seven documents before
  // learning the eighth was never going to be optional.
  check(
    "comprehensive_insurance_file",
    input.hasComprehensive
      ? null
      : "Upload comprehensive insurance. CTPL alone does not cover a rented vehicle.",
  );
  check("comprehensive_insurance_expiry", expiryError(input.comprehensiveExpiry, input.today, "comprehensive insurance"));
  check(
    "insurer_rental_use_confirmed",
    input.rentalUseConfirmed ? null : "Confirm you disclosed rental use to your insurer.",
  );
  check("dti_file", input.hasDti ? null : "Upload the DTI business name registration.");
  check("dti_expiry", expiryError(input.dtiExpiry, input.today, "DTI registration"));
  check("mayors_permit_file", input.hasMayorsPermit ? null : "Upload the Business/Mayor's Permit.");
  check("mayors_permit_expiry", expiryError(input.mayorsPermitExpiry, input.today, "permit"));
  check("bir_file", input.hasBir ? null : "Upload the BIR Certificate of Registration.");
  check("rental_agreement", input.hasRentalAgreement ? null : "Upload the rental agreement (PDF).");
  return errors;
};

/** Every problem with a listing edit, in form order. Empty means it can be saved. */
export const validateListingEdit = (input: {
  pricePerDay: string;
  earlyReturnResponseHours: string;
  rentalUseConfirmed: boolean;
  transmission: string;
  /** Only while the listing is under review or was sent back. */
  transmissionEditable: boolean;
}): ListingFieldError[] => {
  const errors: ListingFieldError[] = [];
  const check = (field: ListingField, message: string | null) => {
    if (message) errors.push({ field, message });
  };
  check("price_per_day", validateListingPrice(input.pricePerDay));
  check("early_return_response_window_hours", responseHoursError(input.earlyReturnResponseHours));
  check(
    "insurer_rental_use_confirmed",
    input.rentalUseConfirmed ? null : "Confirm the rental use was disclosed to your insurer before saving.",
  );
  if (input.transmissionEditable) {
    check(
      "transmission",
      ["automatic", "manual"].includes(input.transmission) ? null : "Select Automatic or Manual.",
    );
  }
  return errors;
};
