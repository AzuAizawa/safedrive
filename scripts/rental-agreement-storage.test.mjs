import assert from "node:assert/strict";
import test from "node:test";

import { resolveRentalAgreementStorageLocation } from "../api/lib/rentalAgreementStorage.ts";

const supabaseUrl = "https://project-ref.supabase.co";
const carId = "691a2745-d4d4-4726-ba6b-e77c1d0ee45a";
const ownerId = "406833e2-d946-4f62-bfcd-8ed67e976fef";

test("resolves a current private agreement path", () => {
  assert.deepEqual(
    resolveRentalAgreementStorageLocation(
      `${ownerId}/${carId}/rental_agreement_123`,
      carId,
      supabaseUrl,
    ),
    {
      bucket: "vehicle-private-documents",
      path: `${ownerId}/${carId}/rental_agreement_123`,
      legacy: false,
    },
  );
});

test("resolves a legacy Supabase public agreement URL to its storage object", () => {
  const path = `${ownerId}/${carId}/rental_agreement`;
  assert.deepEqual(
    resolveRentalAgreementStorageLocation(
      `${supabaseUrl}/storage/v1/object/public/vehicle-documents/${path}`,
      carId,
      supabaseUrl,
    ),
    { bucket: "vehicle-documents", path, legacy: true },
  );
});

test("rejects paths belonging to another car", () => {
  assert.equal(
    resolveRentalAgreementStorageLocation(
      `${ownerId}/different-car/rental_agreement`,
      carId,
      supabaseUrl,
    ),
    null,
  );
});

test("rejects external URLs and traversal paths", () => {
  assert.equal(
    resolveRentalAgreementStorageLocation(
      `https://example.com/storage/v1/object/public/vehicle-documents/${ownerId}/${carId}/rental_agreement`,
      carId,
      supabaseUrl,
    ),
    null,
  );
  assert.equal(
    resolveRentalAgreementStorageLocation(
      `${ownerId}/${carId}/../another-file`,
      carId,
      supabaseUrl,
    ),
    null,
  );
});
