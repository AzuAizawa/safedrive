import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const environmentPath = resolve(process.cwd(), ".env");
if (!existsSync(environmentPath)) {
  throw new Error(".env was not found");
}

for (const rawLine of readFileSync(environmentPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const name = line.slice(0, separator).trim();
  let value = line.slice(separator + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  if (!process.env[name]) process.env[name] = value;
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const paymongoKey = process.env.PAYMONGO_SECRET_KEY || "";

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("SafeDrive Supabase environment variables are incomplete");
}
if (!paymongoKey.startsWith("sk_test_")) {
  throw new Error(
    "Disposable journey refused to run because PAYMONGO_SECRET_KEY is not a test key",
  );
}

const [{ default: createBooking }, { default: bookingAction }, { default: createCheckout }] =
  await Promise.all([
    import("../api/create-booking.ts"),
    import("../api/booking-action.ts"),
    import("../api/create-checkout.ts"),
  ]);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const runId = crypto.randomUUID();
const shortId = runId.replaceAll("-", "").slice(0, 10);
const startedAt = new Date().toISOString();
const password = `Sd!${crypto.randomBytes(24).toString("base64url")}`;
const renterEmail = `safedrive-e2e-renter-${shortId}@example.com`;
const listerEmail = `safedrive-e2e-lister-${shortId}@example.com`;
const plateNumber = `E2E${shortId.slice(0, 7).toUpperCase()}`;
const createdUserIds = [];
let renterId = null;
let listerId = null;
let carId = null;
let agreementVersionId = null;
let bookingId = null;
let checkoutId = null;
let cleanupFailure = null;

const checks = [];
const record = (label) => {
  checks.push(label);
  console.log(`[OK] ${label}`);
};

const request = (url, token, payload) =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

const readJson = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
};

const expectResponse = async (response, expectedStatus, label) => {
  const body = await readJson(response);
  assert.equal(
    response.status,
    expectedStatus,
    `${label}: expected HTTP ${expectedStatus}, received ${response.status}: ${JSON.stringify(body)}`,
  );
  record(`${label} (HTTP ${expectedStatus})`);
  return body;
};

const getAccessToken = async (email) => {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw error || new Error(`No access token returned for ${email}`);
  }
  return data.session.access_token;
};

const addDays = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const removeMatching = async (query, label) => {
  const { error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
};

const cleanup = async () => {
  try {
    if (bookingId) {
      const { data: journalRows, error: journalLookupError } = await admin
        .from("ledger_journals")
        .select("id")
        .eq("booking_id", bookingId);
      if (journalLookupError) throw journalLookupError;
      if (journalRows?.length) {
        throw new Error(
          "Cleanup safety stop: the disposable booking unexpectedly created an append-only ledger journal",
        );
      }

      await removeMatching(
        admin.from("payments").delete().eq("booking_id", bookingId),
        "remove payments",
      );
      await removeMatching(
        admin.from("booking_agreement_acceptances").delete().eq("booking_id", bookingId),
        "remove agreement acceptance",
      );
      await removeMatching(
        admin.from("bookings").delete().eq("id", bookingId),
        "remove booking",
      );
    }

    if (carId) {
      await removeMatching(
        admin.from("car_agreement_versions").delete().eq("car_id", carId),
        "remove agreement version",
      );
      await removeMatching(
        admin.from("cars").delete().eq("id", carId),
        "remove test car",
      );
    }

    const entityIds = [bookingId, carId, agreementVersionId].filter(Boolean);
    if (entityIds.length) {
      await removeMatching(
        admin.from("audit_log").delete().in("entity_id", entityIds),
        "remove entity audit records",
      );
    }
    if (createdUserIds.length) {
      await removeMatching(
        admin.from("audit_log").delete().in("user_id", createdUserIds),
        "remove test-user audit records",
      );
      await removeMatching(
        admin.from("notifications").delete().in("user_id", createdUserIds),
        "remove test-user notifications",
      );
    }

    await removeMatching(
      admin
        .from("notifications")
        .delete()
        .gte("created_at", startedAt)
        .ilike("message", `%${plateNumber}%`),
      "remove administrator test notifications",
    );

    for (const userId of createdUserIds.reverse()) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new Error(`remove temporary auth user: ${error.message}`);
    }
  } catch (error) {
    cleanupFailure = error;
  }
};

console.log("SafeDrive disposable live booking journey");
console.log("Mode: Supabase live project + PayMongo test checkout; no payment or transfer\n");

try {
  const { data: model, error: modelError } = await admin
    .from("car_models")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (modelError || !model) throw modelError || new Error("No car model is available");

  for (const [email, fullName, isLister] of [
    [renterEmail, "SafeDrive E2E Renter", false],
    [listerEmail, "SafeDrive E2E Lister", true],
  ]) {
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, automated_test: true },
    });
    if (authError || !authData.user) throw authError || new Error("Auth user was not created");
    createdUserIds.push(authData.user.id);
    if (isLister) listerId = authData.user.id;
    else renterId = authData.user.id;

    const { error: profileError } = await admin.from("profiles").upsert({
      id: authData.user.id,
      email,
      full_name: fullName,
      role: "user",
      is_lister: isLister,
      verified_status: "verified",
      ...(isLister
        ? {
            payout_method: "GCash",
            payout_account_name: "SafeDrive Sandbox Lister",
            payout_account_number: "09170000000",
          }
        : {}),
    });
    if (profileError) throw profileError;
  }
  record("temporary verified renter and lister accounts created");

  const { data: car, error: carError } = await admin
    .from("cars")
    .insert({
      owner_id: listerId,
      model_id: model.id,
      plate_number: plateNumber,
      mileage: 1000,
      price_per_day: 700,
      location: "SafeDrive automated test location",
      fuel_category: "Gasoline",
      status: "approved",
      registration_expiry: "2027-12-31",
      ctpl_expiry: "2027-12-31",
      comprehensive_insurance_expiry: "2027-12-31",
      insurer_rental_use_confirmed: true,
      insurance_verification_status: "verified",
    })
    .select("id")
    .single();
  if (carError || !car) throw carError || new Error("Test car was not created");
  carId = car.id;

  const { data: agreement, error: agreementError } = await admin
    .from("car_agreement_versions")
    .insert({
      car_id: carId,
      version_number: 1,
      storage_path: `automated-e2e/${carId}/rental-agreement.pdf`,
      content_sha256: crypto.createHash("sha256").update(runId).digest("hex"),
      status: "approved",
      uploaded_by: listerId,
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (agreementError || !agreement) {
    throw agreementError || new Error("Test agreement was not created");
  }
  agreementVersionId = agreement.id;
  record("approved test vehicle and versioned lister agreement prepared");

  const [renterToken, listerToken] = await Promise.all([
    getAccessToken(renterEmail),
    getAccessToken(listerEmail),
  ]);
  record("both temporary accounts authenticated through Supabase Auth");

  const bookingPayload = {
    carId,
    startDate: addDays(5),
    endDate: addDays(7),
    pickupTime: "09:00",
    dropoffTime: "17:00",
    agreementAccepted: true,
    agreementVersionId,
  };
  const created = await expectResponse(
    await createBooking(
      request("http://127.0.0.1:4173/api/create-booking", renterToken, bookingPayload),
    ),
    200,
    "renter creates an agreement-backed booking",
  );
  bookingId = created.bookingId;
  assert.ok(bookingId, "create-booking did not return a booking ID");

  const { data: acceptance } = await admin
    .from("booking_agreement_acceptances")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("renter_id", renterId)
    .maybeSingle();
  assert.ok(acceptance, "Renter agreement acceptance was not recorded");
  record("renter agreement acceptance persisted");

  await expectResponse(
    await bookingAction(
      request("http://127.0.0.1:4173/api/booking-action", renterToken, {
        bookingId,
        action: "accept",
      }),
    ),
    403,
    "renter is blocked from accepting the lister's request",
  );

  await expectResponse(
    await createBooking(
      request("http://127.0.0.1:4173/api/create-booking", renterToken, bookingPayload),
    ),
    409,
    "overlapping booking is rejected",
  );

  await expectResponse(
    await bookingAction(
      request("http://127.0.0.1:4173/api/booking-action", listerToken, {
        bookingId,
        action: "accept",
      }),
    ),
    200,
    "lister accepts the pending booking",
  );

  await expectResponse(
    await bookingAction(
      request("http://127.0.0.1:4173/api/booking-action", listerToken, {
        bookingId,
        action: "accept",
      }),
    ),
    409,
    "duplicate lister acceptance is rejected",
  );

  const checkout = await expectResponse(
    await createCheckout(
      request("http://127.0.0.1:4173/api/create-checkout", renterToken, {
        bookingId,
        paymentMode: "full",
      }),
    ),
    200,
    "PayMongo creates a test-mode full-payment checkout",
  );
  checkoutId = checkout.checkoutId;
  assert.match(checkoutId || "", /^cs_/, "PayMongo checkout ID is invalid");
  assert.match(
    checkout.checkoutUrl || "",
    /^https:\/\//,
    "PayMongo checkout URL is invalid",
  );

  const { data: storedBooking, error: storedBookingError } = await admin
    .from("bookings")
    .select("status, paymongo_checkout_id, payment_deadline")
    .eq("id", bookingId)
    .single();
  if (storedBookingError) throw storedBookingError;
  assert.equal(storedBooking.status, "awaiting_payment");
  assert.equal(storedBooking.paymongo_checkout_id, checkoutId);
  assert.ok(storedBooking.payment_deadline);
  record("checkout state and payment deadline persisted in SafeDrive");

  const [{ count: auditCount }, { count: notificationCount }] = await Promise.all([
    admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", bookingId),
    admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .in("user_id", [renterId, listerId]),
  ]);
  assert.ok((auditCount || 0) >= 2, "Expected booking audit evidence was not created");
  assert.ok(
    (notificationCount || 0) >= 2,
    "Expected participant notifications were not created",
  );
  record("booking audit trail and participant notifications were generated");
} finally {
  await cleanup();
}

if (cleanupFailure) throw cleanupFailure;

const { data: leftoverProfiles, error: leftoverError } = await admin
  .from("profiles")
  .select("id")
  .in("email", [renterEmail, listerEmail]);
if (leftoverError) throw leftoverError;
assert.equal(leftoverProfiles?.length || 0, 0, "Temporary profiles remain after cleanup");
record("temporary Supabase rows and auth accounts removed");

console.log(`\nSummary: ${checks.length} live journey checks passed.`);
console.log(
  `PayMongo test checkout ${checkoutId || "not-created"} contains no payment and moved no money.`,
);
