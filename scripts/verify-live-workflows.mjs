import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const environmentPath = resolve(process.cwd(), ".env");
if (!existsSync(environmentPath)) {
  console.error("[FAIL] .env was not found.");
  process.exit(1);
}

const environment = new Map();
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
  environment.set(name, value);
}

const supabaseUrl = environment.get("VITE_SUPABASE_URL") || "";
const serviceRoleKey = environment.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !serviceRoleKey) {
  console.error("[FAIL] VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const failures = [];
const warnings = [];
const observations = [];

const fail = (label, count) => {
  if (count > 0) failures.push({ label, count });
};
const warn = (label, count) => {
  if (count > 0) warnings.push({ label, count });
};
const sameMoney = (left, right) =>
  Math.abs(Number(left || 0) - Number(right || 0)) <= 0.02;

async function readAll(table, columns) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function readGuestInquiries() {
  return readAll("guest_inquiries", "*");
}

async function readAllAuthUsers() {
  const users = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`auth.users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < perPage) return users;
  }
}

try {
  const [
    authUsers,
    profiles,
    cars,
    agreements,
    bookings,
    acceptances,
    payments,
    notifications,
    guestInquiries,
    deposits,
    claims,
    journals,
    entries,
    settings,
    reconciliationItems,
  ] = await Promise.all([
    readAllAuthUsers(),
    readAll("profiles", "id,email,role,is_lister,verified_status,deleted_at"),
    readAll("cars", "id,owner_id,status,price_per_day,security_deposit_amount,registration_expiry,ctpl_expiry,insurer_rental_use_confirmed,created_at"),
    readAll("car_agreement_versions", "id,car_id,status"),
    readAll("bookings", "id,car_id,renter_id,owner_id,start_date,end_date,total_days,base_price,commission,payment_processing_fee,total_price,downpayment_amount,balance_amount,status,renter_completed,owner_completed,agreement_version_id,created_at"),
    readAll("booking_agreement_acceptances", "booking_id,agreement_version_id,renter_id"),
    readAll("payments", "id,booking_id,amount,payment_type,status,transaction_id,created_at"),
    readAll("notifications", "id,user_id,title,message,type,read,link,created_at"),
    readGuestInquiries(),
    readAll("security_deposits", "id,booking_id,renter_id,owner_id,amount_centavos,status,provider_payment_id,provider_refund_id,claim_deadline,paid_at,released_at"),
    readAll("security_deposit_claims", "id,security_deposit_id,requested_by,amount_centavos,status,approved_amount_centavos,reviewed_by,reviewed_at"),
    readAll("ledger_journals", "id,booking_id,event_key,status,effective_at"),
    readAll("ledger_entries", "journal_id,debit_centavos,credit_centavos"),
    readAll("platform_settings", "id,ledger_activated_at"),
    readAll("reconciliation_items", "id,issue_type,severity,status"),
  ]);

  const authIds = new Set(authUsers.map((user) => user.id));
  const activeProfiles = profiles.filter((profile) => !profile.deleted_at);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const carById = new Map(cars.map((car) => [car.id, car]));
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const agreementById = new Map(agreements.map((agreement) => [agreement.id, agreement]));
  const depositById = new Map(deposits.map((deposit) => [deposit.id, deposit]));
  const acceptanceByBooking = new Map(acceptances.map((item) => [item.booking_id, item]));
  const journalByEventKey = new Map(journals.map((journal) => [journal.event_key, journal]));
  const validRoles = new Set(["user", "admin", "super_admin"]);
  const ledgerActivatedAt = settings.find((setting) => setting.id === "default")?.ledger_activated_at;
  const workflowCutoverMs = ledgerActivatedAt ? Date.parse(ledgerActivatedAt) : Number.NaN;
  const isPostCutover = (createdAt) =>
    Number.isFinite(workflowCutoverMs) && Date.parse(createdAt) >= workflowCutoverMs;

  const guestInquiryColumns = new Set(
    guestInquiries.flatMap((item) => Object.keys(item)),
  );
  for (const column of ["topics", "resolved_at", "request_fingerprint"]) {
    fail(
      `guest_inquiries.${column} database upgrade is missing`,
      guestInquiryColumns.has(column) ? 0 : 1,
    );
  }

  fail("authenticated users missing a public profile", authUsers.filter((user) => !profileById.has(user.id)).length);
  fail("active profiles missing a matching auth user", activeProfiles.filter((profile) => !authIds.has(profile.id)).length);
  fail("profiles with an unsupported role", profiles.filter((profile) => !validRoles.has(profile.role)).length);
  fail("profiles with an unsupported verification state", profiles.filter((profile) => !["unverified", "pending", "verified", "rejected", "inactive"].includes(profile.verified_status)).length);

  const approvedAgreementByCar = new Map(
    agreements.filter((agreement) => agreement.status === "approved").map((agreement) => [agreement.car_id, agreement]),
  );
  fail("cars whose owner profile is missing", cars.filter((car) => !profileById.has(car.owner_id)).length);
  fail("cars outside the permitted price range", cars.filter((car) => Number(car.price_per_day) < 500 || Number(car.price_per_day) > 100000).length);
  fail("cars with an invalid security deposit amount", cars.filter((car) => Number(car.security_deposit_amount) < 0 || Number(car.security_deposit_amount) > 100000).length);
  fail("approved/active cars without an approved rental agreement", cars.filter((car) => ["approved", "active"].includes(car.status) && !approvedAgreementByCar.has(car.id)).length);
  fail("post-upgrade approved/active cars without rental-use insurer confirmation", cars.filter((car) => ["approved", "active"].includes(car.status) && !car.insurer_rental_use_confirmed && isPostCutover(car.created_at)).length);
  warn("legacy approved/active cars requiring insurance re-review", cars.filter((car) => ["approved", "active"].includes(car.status) && !car.insurer_rental_use_confirmed && !isPostCutover(car.created_at)).length);

  let invalidBookingParties = 0;
  let invalidBookingDates = 0;
  let invalidBookingMoney = 0;
  let legacyInvalidBookingMoney = 0;
  let invalidAgreementAcceptance = 0;
  let postCutoverMissingAgreement = 0;
  let legacyMissingAgreement = 0;
  let completedWithoutBothConfirmations = 0;
  for (const booking of bookings) {
    const car = carById.get(booking.car_id);
    if (!car || booking.renter_id === booking.owner_id || car.owner_id !== booking.owner_id || !profileById.has(booking.renter_id) || !profileById.has(booking.owner_id)) {
      invalidBookingParties += 1;
    }
    const startMs = Date.parse(`${booking.start_date}T00:00:00Z`);
    const endMs = Date.parse(`${booking.end_date}T00:00:00Z`);
    const expectedDays = Math.round((endMs - startMs) / 86400000);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || expectedDays !== Number(booking.total_days)) {
      invalidBookingDates += 1;
    }
    const expectedTotal = Number(booking.base_price) + Number(booking.commission) + Number(booking.payment_processing_fee || 0);
    if (!sameMoney(expectedTotal, booking.total_price) || !sameMoney(Number(booking.downpayment_amount) + Number(booking.balance_amount), booking.total_price)) {
      if (isPostCutover(booking.created_at)) invalidBookingMoney += 1;
      else legacyInvalidBookingMoney += 1;
    }
    if (booking.agreement_version_id) {
      const agreement = agreementById.get(booking.agreement_version_id);
      const acceptance = acceptanceByBooking.get(booking.id);
      if (!agreement || agreement.car_id !== booking.car_id || !acceptance || acceptance.agreement_version_id !== booking.agreement_version_id || acceptance.renter_id !== booking.renter_id) {
        invalidAgreementAcceptance += 1;
      }
    } else if (isPostCutover(booking.created_at)) postCutoverMissingAgreement += 1;
    else legacyMissingAgreement += 1;
    if (booking.status === "completed" && (!booking.renter_completed || !booking.owner_completed)) completedWithoutBothConfirmations += 1;
  }
  fail("bookings with invalid renter/lister/car relationships", invalidBookingParties);
  fail("bookings with invalid dates or rental-day totals", invalidBookingDates);
  fail("bookings whose displayed financial totals do not add up", invalidBookingMoney);
  warn("legacy bookings using the pre-upgrade financial formula", legacyInvalidBookingMoney);
  fail("versioned bookings with missing or mismatched agreement acceptance", invalidAgreementAcceptance);
  fail("post-upgrade bookings without a versioned rental agreement", postCutoverMissingAgreement);
  fail("completed bookings missing either renter or lister completion", completedWithoutBothConfirmations);
  warn("legacy bookings without a versioned rental agreement", legacyMissingAgreement);

  const completedCustomerPayments = payments.filter((payment) => payment.status === "completed" && ["downpayment", "balance", "extension", "security_deposit"].includes(payment.payment_type));
  fail("completed customer payments without a provider transaction ID", completedCustomerPayments.filter((payment) => !payment.transaction_id).length);
  fail("payouts linked to a missing booking", payments.filter((payment) => payment.payment_type === "payout" && !bookingById.has(payment.booking_id)).length);
  fail("completed payouts for a booking that is not fully completed by both parties", payments.filter((payment) => {
    if (payment.payment_type !== "payout" || payment.status !== "completed") return false;
    const booking = bookingById.get(payment.booking_id);
    return !booking || booking.status !== "completed" || !booking.renter_completed || !booking.owner_completed;
  }).length);

  if (ledgerActivatedAt) {
    const activationMs = Date.parse(ledgerActivatedAt);
    fail("post-activation completed customer payments missing a ledger journal", completedCustomerPayments.filter((payment) => Date.parse(payment.created_at) >= activationMs && !journalByEventKey.has(`payment:${payment.payment_type}:${payment.transaction_id}`)).length);
  } else {
    warnings.push({ label: "ledger activation timestamp is not configured", count: 1 });
  }

  const ledgerTotals = new Map();
  for (const entry of entries) {
    const totals = ledgerTotals.get(entry.journal_id) || { debit: 0, credit: 0 };
    totals.debit += Number(entry.debit_centavos || 0);
    totals.credit += Number(entry.credit_centavos || 0);
    ledgerTotals.set(entry.journal_id, totals);
  }
  fail("ledger journals that are empty or unbalanced", journals.filter((journal) => {
    const totals = ledgerTotals.get(journal.id) || { debit: 0, credit: 0 };
    return totals.debit <= 0 || totals.debit !== totals.credit;
  }).length);

  fail("notifications addressed to a missing profile", notifications.filter((item) => !profileById.has(item.user_id)).length);
  fail("notifications with a blank title or message", notifications.filter((item) => !item.title?.trim() || !item.message?.trim()).length);
  fail("notifications with an unsafe or invalid internal link", notifications.filter((item) => item.link && (!item.link.startsWith("/") || item.link.startsWith("//"))).length);

  const resolvedAtAvailable = guestInquiryColumns.has("resolved_at");
  fail("resolved guest inquiries missing reply evidence", guestInquiries.filter((item) => item.status === "resolved" && (!item.admin_reply?.trim() || !item.replied_at || (resolvedAtAvailable && !item.resolved_at))).length);
  fail("guest inquiries missing privacy fingerprint", guestInquiries.filter((item) => !item.request_fingerprint?.trim()).length);
  if (guestInquiries.some((item) => Object.hasOwn(item, "topics"))) {
    fail("guest inquiries missing a selected topic", guestInquiries.filter((item) => !Array.isArray(item.topics) || item.topics.length === 0).length);
  }

  fail("security deposits linked to a missing booking or wrong parties", deposits.filter((deposit) => {
    const booking = bookingById.get(deposit.booking_id);
    return !booking || booking.renter_id !== deposit.renter_id || booking.owner_id !== deposit.owner_id;
  }).length);
  fail("security-deposit claims linked to a missing deposit", claims.filter((claim) => !depositById.has(claim.security_deposit_id)).length);
  fail("approved deposit deductions greater than the deposit", claims.filter((claim) => {
    if (!["approved", "partially_approved"].includes(claim.status)) return false;
    const deposit = depositById.get(claim.security_deposit_id);
    return !deposit || Number(claim.approved_amount_centavos || 0) < 0 || Number(claim.approved_amount_centavos || 0) > Number(deposit.amount_centavos);
  }).length);

  const adminCount = activeProfiles.filter((profile) => ["admin", "super_admin"].includes(profile.role)).length;
  const superAdminCount = activeProfiles.filter((profile) => profile.role === "super_admin").length;
  fail("no active admin account exists", adminCount === 0 ? 1 : 0);
  fail("no active super-admin account exists", superAdminCount === 0 ? 1 : 0);

  observations.push(
    ["auth users", authUsers.length],
    ["profiles", profiles.length],
    ["cars", cars.length],
    ["bookings", bookings.length],
    ["payments", payments.length],
    ["notifications", notifications.length],
    ["guest inquiries", guestInquiries.length],
    ["security deposits", deposits.length],
    ["ledger journals", journals.length],
    ["open reconciliation issues", reconciliationItems.filter((item) => ["open", "investigating"].includes(item.status)).length],
    ["open guest inquiries", guestInquiries.filter((item) => ["open", "in_progress"].includes(item.status)).length],
  );

  console.log("SafeDrive live workflow integrity check (read-only; no row values are printed)\n");
  for (const [label, count] of observations) console.log(`[INFO] ${label}: ${count}`);
  console.log("");
  if (failures.length === 0) console.log("[OK] No broken workflow invariants were found.");
  for (const item of failures) console.log(`[FAIL] ${item.label}: ${item.count}`);
  for (const item of warnings) console.log(`[WARN] ${item.label}: ${item.count}`);
  console.log(`\nSummary: ${failures.length} failure type(s), ${warnings.length} warning type(s).`);
  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
