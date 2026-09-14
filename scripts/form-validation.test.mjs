// Required fields are reported all at once, in red, in form order.
//
// The vehicle listing form stopped at the first problem - one browser bubble
// or one toast per click - and skipped Brand and Model entirely. The inquiry
// form kept Submit disabled without saying why. These pin the rules the forms
// now show together.
import assert from "node:assert/strict";
import test from "node:test";

import {
  LISTING_FIELD_LABELS,
  validateListingEdit,
  validateNewListing,
} from "../src/lib/vehicleValidation.ts";
import { validateInquiryForm } from "../src/lib/inquiries.ts";

const TODAY = "2030-06-15";

const complete = {
  brandId: "brand-1",
  modelId: "model-1",
  transmission: "automatic",
  plateNumber: "ABC 1234",
  plateTaken: false,
  mileage: "",
  pricePerDay: "1900",
  earlyReturnResponseHours: "24",
  region: "Metro Manila",
  city: "Quezon City",
  specificLocation: "SM North entrance",
  carImageCount: 3,
  hasOr: true,
  registrationExpiry: "2031-01-01",
  hasCr: true,
  hasCtpl: true,
  ctplExpiry: "2031-01-01",
  hasComprehensive: false,
  comprehensiveExpiry: "",
  rentalUseConfirmed: true,
  hasDti: true,
  dtiExpiry: "2031-01-01",
  hasMayorsPermit: true,
  mayorsPermitExpiry: "2031-01-01",
  hasBir: true,
  hasRentalAgreement: true,
  today: TODAY,
};

const fieldsOf = (errors) => errors.map((error) => error.field);

test("a complete listing has nothing to fix", () => {
  assert.deepEqual(validateNewListing(complete), []);
});

test("an empty listing names every required field at once, top to bottom", () => {
  const empty = {
    ...complete,
    brandId: null,
    modelId: null,
    transmission: "",
    plateNumber: "",
    pricePerDay: "",
    earlyReturnResponseHours: "",
    region: "",
    city: "",
    specificLocation: "",
    carImageCount: 0,
    hasOr: false,
    registrationExpiry: "",
    hasCr: false,
    hasCtpl: false,
    ctplExpiry: "",
    rentalUseConfirmed: false,
    hasDti: false,
    dtiExpiry: "",
    hasMayorsPermit: false,
    mayorsPermitExpiry: "",
    hasBir: false,
    hasRentalAgreement: false,
  };
  const fields = fieldsOf(validateNewListing(empty));
  assert.deepEqual(fields, [
    "brand",
    "model",
    "transmission",
    "plate_number",
    "price_per_day",
    "early_return_response_window_hours",
    "location",
    "city",
    "specific_location",
    "car_images",
    "or_file",
    "registration_expiry",
    "cr_file",
    "ctpl_file",
    "ctpl_expiry",
    "insurer_rental_use_confirmed",
    "dti_file",
    "dti_expiry",
    "mayors_permit_file",
    "mayors_permit_expiry",
    "bir_file",
    "rental_agreement",
  ]);
  // Listed in the same order the labels (and the form) are.
  const labelOrder = Object.keys(LISTING_FIELD_LABELS);
  assert.deepEqual(fields, [...fields].sort((a, b) => labelOrder.indexOf(a) - labelOrder.indexOf(b)));
});

test("brand and model are never skipped", () => {
  assert.deepEqual(
    validateNewListing({ ...complete, brandId: null, modelId: null }).map((e) => [e.field, e.message]),
    [["brand", "Select the brand."], ["model", "Select a brand first, then the model."]],
  );
  assert.deepEqual(
    validateNewListing({ ...complete, modelId: null }).map((e) => [e.field, e.message]),
    [["model", "Select the model."]],
  );
});

test("a well-formed plate that is already registered is still a problem", () => {
  assert.deepEqual(fieldsOf(validateNewListing({ ...complete, plateTaken: true })), ["plate_number"]);
  assert.match(validateNewListing({ ...complete, plateNumber: "AB12345" })[0].message, /3 letters/);
});

test("documents must still be valid, and an optional policy must be whole", () => {
  assert.match(
    validateNewListing({ ...complete, registrationExpiry: "2030-06-14" })[0].message,
    /has passed/,
  );
  assert.deepEqual(fieldsOf(validateNewListing({ ...complete, registrationExpiry: TODAY })), [], "today still counts");
  assert.deepEqual(
    fieldsOf(validateNewListing({ ...complete, hasComprehensive: true })),
    ["comprehensive_insurance_expiry"],
  );
  assert.deepEqual(
    fieldsOf(validateNewListing({ ...complete, comprehensiveExpiry: "2031-01-01" })),
    ["comprehensive_insurance_file"],
  );
  assert.deepEqual(
    fieldsOf(validateNewListing({ ...complete, hasComprehensive: true, comprehensiveExpiry: "2020-01-01" })),
    ["comprehensive_insurance_expiry"],
  );
  assert.deepEqual(fieldsOf(validateNewListing({ ...complete, dtiExpiry: "2020-01-01" })), ["dti_expiry"]);
});

test("photos, response hours and mileage stay inside their limits", () => {
  assert.deepEqual(fieldsOf(validateNewListing({ ...complete, carImageCount: 6 })), ["car_images"]);
  for (const hours of ["0", "25", "3.5", "abc"]) {
    assert.deepEqual(
      fieldsOf(validateNewListing({ ...complete, earlyReturnResponseHours: hours })),
      ["early_return_response_window_hours"],
      hours,
    );
  }
  assert.deepEqual(fieldsOf(validateNewListing({ ...complete, mileage: "-5" })), ["mileage"]);
  assert.deepEqual(fieldsOf(validateNewListing({ ...complete, mileage: "0" })), []);
});

test("an edit names every problem at once, and an empty price is an error, not a silent stop", () => {
  const edit = {
    pricePerDay: "",
    earlyReturnResponseHours: "",
    rentalUseConfirmed: false,
    transmission: "",
    transmissionEditable: true,
  };
  assert.deepEqual(fieldsOf(validateListingEdit(edit)), [
    "price_per_day",
    "early_return_response_window_hours",
    "insurer_rental_use_confirmed",
    "transmission",
  ]);
  assert.deepEqual(
    fieldsOf(validateListingEdit({ ...edit, pricePerDay: "900", earlyReturnResponseHours: "12", rentalUseConfirmed: true, transmissionEditable: false })),
    [],
    "a live listing's transmission is locked, so it is not asked for",
  );
});

test("an inquiry says what is missing instead of disabling Submit", () => {
  assert.deepEqual(
    validateInquiryForm({ name: "", email: "nope", topics: [""], message: "short" }).map((e) => e.field),
    ["name", "email", "topic", "message"],
  );
  assert.equal(
    validateInquiryForm({ name: "Ana", email: "ana@example.com", topics: [""], message: "How do I list a car?" })[0].message,
    "Select an inquiry topic first.",
  );
  assert.deepEqual(
    validateInquiryForm({ name: "Ana", email: "ana@example.com", topics: ["Other"], message: "How do I list a car?" }),
    [],
  );
});
