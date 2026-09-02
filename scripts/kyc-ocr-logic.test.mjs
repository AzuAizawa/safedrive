import assert from "node:assert/strict";
import test from "node:test";

import { buildKycFieldChecks } from "../src/lib/kycOcr.ts";

const readableDocument = {
  type: "license_front",
  status: "read",
  confidence: 91,
  textLength: 60,
};

test("KYC OCR finds matching submitted name and license number", () => {
  const checks = buildKycFieldChecks(
    "Republic of the Philippines\nKurt Clarenz Samson\nN13-23-131141",
    { fullName: "Kurt Clarenz Samson", driverLicense: "N13-23-131141" },
    [readableDocument],
  );

  assert.deepEqual(
    checks.map((check) => check.status),
    ["match", "match"],
  );
});

test("KYC OCR flags text that does not contain the submitted fields for manual comparison", () => {
  const checks = buildKycFieldChecks(
    "Republic of the Philippines\nTest document\nABCD 1234",
    { fullName: "Kurt Clarenz Samson", driverLicense: "N13-23-131141" },
    [readableDocument],
  );

  assert.deepEqual(
    checks.map((check) => check.status),
    ["not_found", "not_found"],
  );
});

test("KYC OCR reports unreadable when no document text could be recovered", () => {
  const checks = buildKycFieldChecks(
    "",
    { fullName: "Kurt Clarenz Samson", driverLicense: "N13-23-131141" },
    [{ ...readableDocument, status: "failed", confidence: null, textLength: 0 }],
  );

  assert.deepEqual(
    checks.map((check) => check.status),
    ["unreadable", "unreadable"],
  );
});
