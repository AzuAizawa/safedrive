import { createClient } from "@supabase/supabase-js";
import { postSimpleBalancedJournal } from "./ledger.js";
import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";
import { sendPayoutReceiptEmail } from "./email.js";

type PaymentRecord = {
  id: string;
  payment_type: string;
  status: string;
  amount: number;
  transaction_id: string | null;
  payment_method: string | null;
  notes: string | null;
};

type BookingForPayout = {
  id: string;
  status: string;
  owner_completed: boolean;
  renter_completed: boolean;
  base_price: number;
  total_price: number;
  commission: number;
  cars: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: { name: string };
    };
  };
  owner: {
    id: string;
    full_name: string | null;
    email: string;
    payout_method: string | null;
    payout_account_name: string | null;
    payout_account_number: string | null;
  };
  payments: PaymentRecord[];
};

type InstitutionMatch = {
  bic: string;
  institutionName: string;
  provider: "instapay" | "pesonet";
};

type PayMongoAccount = {
  number: string;
  name: string;
  bic: string;
};

type PayMongoInstitutionRecord = Record<string, unknown> & {
  id?: string;
  attributes?: Record<string, unknown>;
};

type PayMongoTransferDetails = {
  batchTransferId: string | null;
  transferId: string | null;
  status: string;
  referenceNumber: string | null;
  providerError: string | null;
};

type PayoutOutcome =
  | { state: "skipped"; bookingId: string; reason: string }
  | { state: "pending"; bookingId: string; paymentId: string; transactionId: string | null; reason?: string }
  | { state: "completed"; bookingId: string; paymentId: string; transactionId: string | null }
  | { state: "failed"; bookingId: string; paymentId: string; transactionId: string | null; reason: string };

type PayoutContext = {
  supabase: ServiceRoleSupabaseClient;
  bookingId: string;
  initiatedByUserId?: string | null;
  baseOrigin: string;
};

class ActivePayoutExistsError extends Error {
  constructor() {
    super("An active payout was created by another request. Refresh before retrying.");
    this.name = "ActivePayoutExistsError";
  }
}

const PAYOUT_CALLBACK_PATH = "/api/webhooks/paymongo-payouts";

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

const getVehicleLabel = (booking: BookingForPayout) =>
  `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`;

const getAuthToken = (secretKey: string) =>
  `Basic ${btoa(`${secretKey}:`)}`;

const safeString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

// Mask everything but the last 4 characters so notifications never expose a
// full payout account number.
const maskPayoutAccount = (value: string | null | undefined) => {
  const trimmed = (value ?? "").replace(/\s+/g, "");
  if (!trimmed) return null;
  if (trimmed.length <= 4) return trimmed;
  return `${"*".repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
};

const describePayoutDestination = (owner: BookingForPayout["owner"]) => {
  const masked = maskPayoutAccount(owner.payout_account_number);
  if (!masked || !owner.payout_method) return null;
  const name = owner.payout_account_name?.trim();
  return `${name ? `${name} - ` : ""}${owner.payout_method} ${masked}`;
};

const getPayMongoSettings = () => ({
  secretKey: process.env.PAYMONGO_SECRET_KEY,
  walletId: process.env.PAYMONGO_PAYOUT_WALLET_ID,
  allowSandboxCompletion:
    process.env.PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION === "true",
});

const isPayMongoTestKey = (secretKey: string | undefined) =>
  Boolean(secretKey?.startsWith("sk_test_"));

const parseJsonResponse = (rawBody: string) => {
  if (!rawBody.trim()) return {};

  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { raw: rawBody };
  }
};

const normalizeTransferStatus = (status: string) =>
  status.trim().toLowerCase();

const isCompletedTransferStatus = (status: string) =>
  ["succeeded", "completed"].includes(normalizeTransferStatus(status));

const isFailedTransferStatus = (status: string) =>
  ["failed", "cancelled", "canceled"].includes(normalizeTransferStatus(status));

const fetchReceivingInstitutions = async (
  secretKey: string,
  provider: "instapay" | "pesonet",
) => {
  // PayMongo's current guides reference both the Transfers V2 route and the
  // legacy Wallet route. Prefer V2, but retain the documented compatibility
  // fallback while merchants are being migrated between products.
  const endpoints = [
    `https://api.paymongo.com/v2/transfers/receiving_institutions?provider=${provider}`,
    `https://api.paymongo.com/v1/wallets/receiving_institutions?provider=${provider}`,
  ];
  let lastFailure = "No receiving-institutions response";

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: getAuthToken(secretKey),
      },
    });
    const body = parseJsonResponse(await res.text()) as {
      data?: PayMongoInstitutionRecord[];
      errors?: unknown;
      raw?: string;
    };

    if (res.ok && Array.isArray(body.data)) return body;

    lastFailure = `${res.status} ${JSON.stringify(body)}`;
    if (![404, 405].includes(res.status)) break;
  }

  throw new Error(`Failed to load receiving institutions: ${lastFailure}`);
};

const matchInstitution = async (
  payoutMethod: string,
  secretKey: string,
): Promise<InstitutionMatch | null> => {
  const normalized = payoutMethod.trim().toLowerCase();
  if (!["gcash", "maya"].includes(normalized)) {
    return null;
  }

  const institutions = await fetchReceivingInstitutions(secretKey, "instapay");
  const matcher =
    normalized === "gcash"
      ? /gcash/i
      : /\bmaya\b|paymaya/i;

  const entry = (institutions.data ?? []).find((item) => {
    const attributes = item.attributes ?? item;
    const haystacks = [
      attributes.bank_name,
      attributes.institution_name,
      attributes.name,
      attributes.provider_code,
      attributes.bank_code,
      attributes.bic,
      item.id,
    ]
      .filter(Boolean)
      .join(" ");
    return matcher.test(haystacks);
  });

  if (!entry) return null;

  const attributes = entry.attributes ?? entry;
  const bic = safeString(attributes.provider_code) || safeString(attributes.bic) || safeString(attributes.bank_code) || safeString(entry.id);
  if (!bic) return null;

  return {
    bic,
    institutionName:
      safeString(attributes.bank_name) ||
      safeString(attributes.institution_name) ||
      safeString(attributes.name) ||
      payoutMethod,
    provider: "instapay",
  };
};

const fetchWalletSourceAccount = async ({
  secretKey,
  walletId,
}: {
  secretKey: string;
  walletId: string;
}): Promise<PayMongoAccount> => {
  const getWallets = async (endpoint: string) => {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: getAuthToken(secretKey),
      },
    });
    const body = parseJsonResponse(await res.text()) as {
      data?: PayMongoInstitutionRecord | PayMongoInstitutionRecord[];
      errors?: unknown;
      raw?: string;
    };
    return { res, body };
  };

  const encodedWalletId = encodeURIComponent(walletId);
  let walletResponse = await getWallets(
    `https://api.paymongo.com/v2/wallets/${encodedWalletId}?fields=account`,
  );
  if (walletResponse.res.status === 404) {
    walletResponse = await getWallets(
      "https://api.paymongo.com/v2/wallets?status=activated&fields=account",
    );
  }

  if (!walletResponse.res.ok) {
    throw new Error(
      `Failed to load PayMongo payout wallet: ${JSON.stringify(walletResponse.body)}`,
    );
  }

  const wallets = Array.isArray(walletResponse.body.data)
    ? walletResponse.body.data
    : walletResponse.body.data
      ? [walletResponse.body.data]
      : [];
  const wallet = wallets.find((item) => {
    const attributes = item.attributes ?? {};
    const sourceAccount =
      (item.source_account as Record<string, unknown> | undefined) ??
      (item.account as Record<string, unknown> | undefined) ??
      (attributes.source_account as Record<string, unknown> | undefined) ??
      (attributes.account as Record<string, unknown> | undefined) ??
      attributes;
    const accountNumber = safeString(sourceAccount.account_number) || safeString(sourceAccount.number);
    return (
      item.id === walletId ||
      safeString(sourceAccount.id) === walletId ||
      accountNumber === walletId
    );
  });

  if (!wallet) {
    throw new Error(
      "Configured PayMongo payout wallet was not found. Check PAYMONGO_PAYOUT_WALLET_ID against the wallet list in PayMongo.",
    );
  }

  const attributes = wallet.attributes ?? {};
  const sourceAccount =
    (wallet.source_account as Record<string, unknown> | undefined) ??
    (wallet.account as Record<string, unknown> | undefined) ??
    (attributes.source_account as Record<string, unknown> | undefined) ??
    (attributes.account as Record<string, unknown> | undefined) ??
    attributes;
  const number = safeString(sourceAccount.account_number) || safeString(sourceAccount.number);
  const name = safeString(sourceAccount.account_name) || safeString(sourceAccount.name);
  const bic = safeString(sourceAccount.bic);

  if (!number || !name || !bic) {
    throw new Error(
      "Configured PayMongo payout wallet is missing its source account number, account name, or BIC. SafeDrive will not guess provider banking identifiers.",
    );
  }

  return { number, name, bic };
};

const createPendingPayoutRecord = async (
  supabase: ServiceRoleSupabaseClient,
  booking: BookingForPayout,
  statusNote: string,
) => {
  const { data, error } = await supabase
    .from("payments")
    .insert({
      booking_id: booking.id,
      amount: Number(booking.base_price),
      payment_type: "payout",
      status: "pending",
      payment_method: booking.owner.payout_method || "Unspecified",
      notes: statusNote,
    })
    .select("*")
    .single();

  if (error?.code === "23505") {
    throw new ActivePayoutExistsError();
  }

  if (error || !data) {
    throw error ?? new Error("Failed to create payout record");
  }

  return data as PaymentRecord;
};

const insertPayoutAudit = async (
  supabase: ServiceRoleSupabaseClient,
  initiatedByUserId: string | null | undefined,
  action: string,
  booking: BookingForPayout,
  details: Record<string, unknown>,
) => {
  await supabase.from("audit_log").insert({
    user_id: initiatedByUserId ?? null,
    action,
    entity_type: "booking",
    entity_id: booking.id,
    details,
  });
};

const createListerNotification = async (
  supabase: ServiceRoleSupabaseClient,
  userId: string,
  title: string,
  message: string,
  type: "success" | "info" | "error" = "info",
) => {
  await supabase.from("notifications").insert({
    user_id: userId,
    title,
    message,
    type,
    link: "/lister-bookings",
  });
};

const notifyAdmins = async (
  supabase: ServiceRoleSupabaseClient,
  title: string,
  message: string,
) => {
  const { data: admins } = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["admin", "super_admin"]);

  if (!admins?.length) return;

  await supabase.from("notifications").insert(
    admins.map((admin) => ({
      user_id: admin.id,
      title,
      message,
      type: "info",
      link: "/admin/payouts",
    })),
  );
};

const updatePayoutRecord = async (
  supabase: ServiceRoleSupabaseClient,
  paymentId: string,
  updates: {
    status?: string;
    transaction_id?: string | null;
    payment_method?: string | null;
    notes?: string | null;
  },
) => {
  const { error } = await supabase
    .from("payments")
    .update(updates)
    .eq("id", paymentId);

  if (error) throw error;
};

const buildPayoutReferenceNumber = (paymentId: string) =>
  `SD-${paymentId}`;

const buildBatchTransferPayload = ({
  institution,
  booking,
  baseOrigin,
  sourceAccount,
  paymentId,
}: {
  institution: InstitutionMatch;
  booking: BookingForPayout;
  baseOrigin: string;
  sourceAccount: PayMongoAccount;
  paymentId: string;
}) => ({
  transfers: [
    {
      amount: Math.round(Number(booking.base_price) * 100),
      currency: "PHP",
      provider: institution.provider,
      description: `SafeDrive payout for ${getVehicleLabel(booking)}`,
      purpose: "Disbursement",
      reference_number: buildPayoutReferenceNumber(paymentId),
      callback_url: `${baseOrigin}${PAYOUT_CALLBACK_PATH}`,
      source_account: sourceAccount,
      destination_account: {
        number: booking.owner.payout_account_number,
        name: booking.owner.payout_account_name,
        bic: institution.bic,
      },
      metadata: {
        booking_id: booking.id,
        lister_id: booking.owner.id,
        payout_method: booking.owner.payout_method,
      },
    },
  ],
});

const getTransferAttribute = (
  transfer: Record<string, unknown> | null,
  key: string,
) => {
  const directValue = safeString(transfer?.[key]);
  if (directValue) return directValue;

  const attributes = transfer?.attributes;
  return attributes && typeof attributes === "object"
    ? safeString((attributes as Record<string, unknown>)[key])
    : null;
};

const extractTransferDetails = (
  body: Record<string, unknown>,
): PayMongoTransferDetails => {
  const data = body.data && typeof body.data === "object"
    ? (body.data as Record<string, unknown>)
    : {};
  const dataAttributes = data.attributes && typeof data.attributes === "object"
    ? (data.attributes as Record<string, unknown>)
    : {};
  const transfersSource =
    dataAttributes.transfers ??
    data.transfers ??
    body.transfers;
  const transfers = Array.isArray(transfersSource) ? transfersSource : [];
  const firstTransfer = transfers[0] && typeof transfers[0] === "object"
    ? (transfers[0] as Record<string, unknown>)
    : null;

  const status =
    getTransferAttribute(firstTransfer, "status") ??
    safeString(dataAttributes.status) ??
    "pending";
  const referenceNumber =
    getTransferAttribute(firstTransfer, "reference_number") ??
    getTransferAttribute(firstTransfer, "provider_reference_number") ??
    safeString(dataAttributes.reference_number);
  const providerError =
    getTransferAttribute(firstTransfer, "failure_message") ??
    getTransferAttribute(firstTransfer, "failure_code") ??
    getTransferAttribute(firstTransfer, "provider_error") ??
    getTransferAttribute(firstTransfer, "provider_error_code");

  return {
    batchTransferId: safeString(data.id),
    transferId: safeString(firstTransfer?.id) ?? safeString(data.id),
    status,
    referenceNumber,
    providerError,
  };
};

const createBatchTransfer = async ({
  secretKey,
  walletId,
  institution,
  booking,
  baseOrigin,
  paymentId,
}: {
  secretKey: string;
  walletId: string;
  institution: InstitutionMatch;
  booking: BookingForPayout;
  baseOrigin: string;
  paymentId: string;
}): Promise<PayMongoTransferDetails> => {
  const sourceAccount = await fetchWalletSourceAccount({ secretKey, walletId });
  const res = await fetch("https://api.paymongo.com/v2/batch_transfers", {
    method: "POST",
    headers: {
      ...jsonHeaders,
      Authorization: getAuthToken(secretKey),
      "Idempotency-Key": `safedrive-payout-${paymentId}`,
    },
    body: JSON.stringify(
      buildBatchTransferPayload({
        institution,
        booking,
        baseOrigin,
        sourceAccount,
        paymentId,
      }),
    ),
  });

  const body = parseJsonResponse(await res.text());

  if (!res.ok) {
    const details = JSON.stringify(body);
    throw new Error(`PayMongo batch transfer failed: ${details}`);
  }

  return extractTransferDetails(body);
};

export const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin environment variables");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

export const processAutomaticPayoutForBooking = async ({
  supabase,
  bookingId,
  initiatedByUserId,
  baseOrigin,
}: PayoutContext): Promise<PayoutOutcome> => {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      `
      id,
      status,
      owner_completed,
      renter_completed,
      base_price,
      total_price,
      commission,
      cars(plate_number, car_models(name, car_brands(name))),
      owner:profiles!bookings_owner_id_fkey(id, full_name, email, payout_method, payout_account_name, payout_account_number),
      payments(*)
    `,
    )
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    throw bookingError ?? new Error("Booking not found for payout processing");
  }

  const payoutBooking = booking as unknown as BookingForPayout;
  let payoutAmount = Number(payoutBooking.base_price);

  if (payoutBooking.status !== "completed" || !payoutBooking.owner_completed || !payoutBooking.renter_completed) {
    return { state: "skipped", bookingId, reason: "Booking is not fully completed yet." };
  }

  const { data: securityDeposit, error: securityDepositError } = await supabase
    .from("security_deposits")
    .select("id, status, claim_deadline")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (securityDepositError) {
    throw securityDepositError;
  }
  if (securityDeposit && !["released", "partially_released", "claimed"].includes(securityDeposit.status)) {
    return {
      state: "skipped",
      bookingId,
      reason: "The refundable security-deposit review must finish before payout.",
    };
  }
  if (securityDeposit) {
    const { data: approvedClaims, error: approvedClaimError } = await supabase
      .from("security_deposit_claims")
      .select("approved_amount_centavos")
      .eq("security_deposit_id", securityDeposit.id)
      .in("status", ["approved", "partially_approved"]);
    if (approvedClaimError) throw approvedClaimError;
    const approvedDeductionPesos = (approvedClaims ?? []).reduce(
      (sum, claim) => sum + Number(claim.approved_amount_centavos || 0),
      0,
    ) / 100;
    payoutAmount += approvedDeductionPesos;
    payoutBooking.base_price = payoutAmount;
  }

  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
    return {
      state: "skipped",
      bookingId,
      reason: "Computed payout amount is not valid for this booking.",
    };
  }

  const existingCompleted = payoutBooking.payments.find(
    (payment) => payment.payment_type === "payout" && payment.status === "completed",
  );
  if (existingCompleted) {
    return {
      state: "skipped",
      bookingId,
      reason: "Payout already completed for this booking.",
    };
  }

  const existingPending = payoutBooking.payments.find(
    (payment) => payment.payment_type === "payout" && payment.status === "pending",
  );

  if (existingPending?.transaction_id) {
    return {
      state: "skipped",
      bookingId,
      reason: "A payout transfer is already pending PayMongo confirmation for this booking.",
    };
  }

  const { count: blockingTicketCount } = await supabase
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", bookingId)
    .in("status", ["open", "in_progress"]);

  if ((blockingTicketCount ?? 0) > 0) {
    return {
      state: "skipped",
      bookingId,
      reason: "Open booking support case found. Payout is blocked until the issue is resolved.",
    };
  }

  if (
    !payoutBooking.owner.payout_method ||
    !payoutBooking.owner.payout_account_name ||
    !payoutBooking.owner.payout_account_number
  ) {
    return {
      state: "skipped",
      bookingId,
      reason: "Lister payout details are incomplete.",
    };
  }

  const { secretKey, walletId, allowSandboxCompletion } = getPayMongoSettings();
  if (allowSandboxCompletion) {
    // Demo / thesis payout: the "Auto Payout" button records the lister's
    // earnings (base_price, net of SafeDrive commission), posts the ledger
    // journal, and sends the receipt e-mail + notification WITHOUT calling
    // PayMongo or moving real money. Gated on an opt-in env flag and a test
    // key - a live PayMongo key auto-disables this path.
    if (secretKey && !isPayMongoTestKey(secretKey)) {
      return {
        state: "skipped",
        bookingId,
        reason:
          "Demo payout completion refuses non-test PayMongo keys. No payout was recorded or sent.",
      };
    }

    let sandboxPayout = existingPending;
    if (!sandboxPayout) {
      try {
        sandboxPayout = await createPendingPayoutRecord(
          supabase,
          payoutBooking,
          "Demo payout queued. No PayMongo wallet transfer was requested.",
        );
      } catch (error) {
        if (error instanceof ActivePayoutExistsError) {
          return {
            state: "skipped",
            bookingId,
            reason: error.message,
          };
        }
        throw error;
      }
    }

    const sandboxTransactionId = `sandbox_payout_${bookingId.slice(0, 8)}_${Date.now()}`;

    await updatePayoutRecord(supabase, sandboxPayout.id, {
      status: "completed",
      transaction_id: sandboxTransactionId,
      payment_method: payoutBooking.owner.payout_method,
      notes:
        "Demo payout completed. Lister earnings (base price, net of commission) recorded without a real PayMongo transfer.",
    });
    const sandboxDestination = describePayoutDestination(payoutBooking.owner);
    await createListerNotification(
      supabase,
      payoutBooking.owner.id,
      "Payout Recorded (demo mode)",
      `Your SafeDrive payout of PHP ${Number(payoutBooking.base_price).toLocaleString()} for ${getVehicleLabel(payoutBooking)} was recorded${sandboxDestination ? ` for ${sandboxDestination}` : ""}. This build runs in demo payout mode, so no real PayMongo transfer was sent.`,
      "success",
    );
    await sendPayoutReceiptEmail(supabase, {
      bookingId: payoutBooking.id,
      amount: Number(payoutBooking.base_price),
      payoutId: sandboxPayout.id,
      payoutMethod: payoutBooking.owner.payout_method,
      transactionId: sandboxTransactionId,
      baseOrigin,
    });
    await insertPayoutAudit(supabase, initiatedByUserId, "payout_sandbox_completed", payoutBooking, {
      amount: Number(payoutBooking.base_price),
      payment_id: sandboxPayout.id,
      transfer_status: "sandbox_completed",
      transfer_id: sandboxTransactionId,
      payout_method: payoutBooking.owner.payout_method,
      released_by: initiatedByUserId ? "admin" : "automatic",
      mode: "sandbox",
    });
    await notifyAdmins(
      supabase,
      "Lister Payout Released (demo)",
      `PHP ${Number(payoutBooking.base_price).toLocaleString()} ${initiatedByUserId ? "was released by an admin" : "auto-released on completion"} for ${getVehicleLabel(payoutBooking)}${sandboxDestination ? ` to ${sandboxDestination}` : ""}.`,
    );
    // Keep the double-entry ledger complete even in demo mode so financial
    // reports and reconciliation stay balanced. The event key matches the
    // `payout:<transaction_id>` shape the reconciliation job expects.
    await postSimpleBalancedJournal(supabase, {
      bookingId,
      eventKey: `payout:${sandboxTransactionId}`,
      eventType: "lister_payout_completed",
      providerReference: sandboxTransactionId,
      actorId: initiatedByUserId,
      debitAccount: "2010",
      creditAccount: "1010",
      amountCentavos: Math.round(Number(payoutBooking.base_price) * 100),
      partyUserId: payoutBooking.owner.id,
      memo: "Lister payout recorded (demo mode)",
    });

    return {
      state: "completed",
      bookingId,
      paymentId: sandboxPayout.id,
      transactionId: sandboxTransactionId,
    };
  }

  if (!secretKey) {
    return {
      state: "skipped",
      bookingId,
      reason:
        "PayMongo Money Movement is not configured, so no payout was sent. Set PAYMONGO_SECRET_KEY and PAYMONGO_PAYOUT_WALLET_ID for live disbursement, or enable PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION with a test key for demo mode.",
    };
  }

  if (!walletId) {
    return {
      state: "skipped",
      bookingId,
      reason:
        "PayMongo secret is configured, but PAYMONGO_PAYOUT_WALLET_ID is missing. Payout was not marked paid.",
    };
  }

  const payoutMethod = payoutBooking.owner.payout_method.trim();
  let institution: InstitutionMatch | null = null;

  if (["Business Bank Account", "PayMongo Wallet"].includes(payoutMethod)) {
    return {
      state: "skipped",
      bookingId,
      reason: `${payoutMethod} is no longer a supported payout destination. Update the lister payout method to GCash or Maya.`,
    };
  }

  institution = await matchInstitution(payoutMethod, secretKey);
  if (!institution) {
    return {
      state: "skipped",
      bookingId,
      reason: `PayMongo institution mapping is not ready for ${payoutMethod}.`,
    };
  }

  let paymentRecord = existingPending;
  if (!paymentRecord) {
    try {
      paymentRecord = await createPendingPayoutRecord(
        supabase,
        payoutBooking,
        `Auto payout queued for ${payoutBooking.owner.full_name || payoutBooking.owner.email} via ${payoutMethod}.`,
      );
    } catch (error) {
      if (error instanceof ActivePayoutExistsError) {
        return {
          state: "skipped",
          bookingId,
          reason: error.message,
        };
      }
      throw error;
    }
  }

  try {
    const transfer = await createBatchTransfer({
      secretKey,
      walletId,
      institution,
      booking: payoutBooking,
      baseOrigin,
      paymentId: paymentRecord.id,
    });

    const walletTransactionId = transfer.transferId;
    const transferStatus = transfer.status;
    const providerError = transfer.providerError;
    const referenceNumber = transfer.referenceNumber;

    const note = [
      `Auto payout via PayMongo Money Movement ${institution.provider} to ${institution.institutionName}.`,
      referenceNumber ? `Reference: ${referenceNumber}` : null,
      providerError ? `Provider note: ${providerError}` : null,
      transfer.batchTransferId ? `Batch: ${transfer.batchTransferId}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    if (isCompletedTransferStatus(transferStatus)) {
      await updatePayoutRecord(supabase, paymentRecord.id, {
        status: "completed",
        transaction_id: walletTransactionId,
        notes: note,
      });
      const releasedDestination = describePayoutDestination(payoutBooking.owner);
      await createListerNotification(
        supabase,
        payoutBooking.owner.id,
        "Payout Released",
        `Your SafeDrive payout for ${getVehicleLabel(payoutBooking)} was sent through PayMongo${releasedDestination ? ` to ${releasedDestination}` : ""}.`,
        "success",
      );
      await sendPayoutReceiptEmail(supabase, {
        bookingId: payoutBooking.id,
        amount: Number(payoutBooking.base_price),
        payoutId: paymentRecord.id,
        payoutMethod,
        transactionId: walletTransactionId,
        baseOrigin,
      });
      await insertPayoutAudit(supabase, initiatedByUserId, "payout_sent_auto", payoutBooking, {
        amount: Number(payoutBooking.base_price),
        payment_id: paymentRecord.id,
        transfer_status: transferStatus,
        transfer_id: walletTransactionId,
        batch_transfer_id: transfer.batchTransferId,
        reference_number: referenceNumber,
        payout_method: payoutMethod,
        released_by: initiatedByUserId ? "admin" : "automatic",
      });
      await notifyAdmins(
        supabase,
        "Lister Payout Released",
        `PHP ${Number(payoutBooking.base_price).toLocaleString()} ${initiatedByUserId ? "was released by an admin" : "auto-released on completion"} for ${getVehicleLabel(payoutBooking)}${releasedDestination ? ` to ${releasedDestination}` : ""}.`,
      );
      await postSimpleBalancedJournal(supabase, {
        bookingId,
        eventKey: `payout:${walletTransactionId}`,
        eventType: "lister_payout_completed",
        providerReference: walletTransactionId,
        actorId: initiatedByUserId,
        debitAccount: "2010",
        creditAccount: "1010",
        amountCentavos: Math.round(Number(payoutBooking.base_price) * 100),
        partyUserId: payoutBooking.owner.id,
        memo: "Lister payout confirmed",
      });

      return {
        state: "completed",
        bookingId,
        paymentId: paymentRecord.id,
        transactionId: walletTransactionId,
      };
    }

    if (isFailedTransferStatus(transferStatus)) {
      await updatePayoutRecord(supabase, paymentRecord.id, {
        status: "failed",
        transaction_id: walletTransactionId,
        notes: note || "PayMongo transfer failed.",
      });
      await notifyAdmins(
        supabase,
        "Auto payout failed",
        `${getVehicleLabel(payoutBooking)} could not be disbursed automatically. Review the payout queue.`,
      );
      await insertPayoutAudit(supabase, initiatedByUserId, "payout_auto_failed", payoutBooking, {
        amount: Number(payoutBooking.base_price),
        payment_id: paymentRecord.id,
        transfer_status: transferStatus,
        transfer_id: walletTransactionId,
        batch_transfer_id: transfer.batchTransferId,
        reference_number: referenceNumber,
        payout_method: payoutMethod,
        provider_error: providerError,
      });

      return {
        state: "failed",
        bookingId,
        paymentId: paymentRecord.id,
        transactionId: walletTransactionId,
        reason: providerError || "PayMongo transfer failed.",
      };
    }

    await updatePayoutRecord(supabase, paymentRecord.id, {
      status: "pending",
      transaction_id: walletTransactionId,
      notes: note || "Payout transfer is still pending at PayMongo.",
    });
    await createListerNotification(
      supabase,
      payoutBooking.owner.id,
      "Payout In Progress",
      `Your SafeDrive payout for ${getVehicleLabel(payoutBooking)} has been initiated and is waiting for PayMongo confirmation.`,
      "info",
    );
    await insertPayoutAudit(supabase, initiatedByUserId, "payout_auto_pending", payoutBooking, {
      amount: Number(payoutBooking.base_price),
      payment_id: paymentRecord.id,
      transfer_status: transferStatus,
      transfer_id: walletTransactionId,
      batch_transfer_id: transfer.batchTransferId,
      reference_number: referenceNumber,
      payout_method: payoutMethod,
    });

    return {
      state: "pending",
      bookingId,
      paymentId: paymentRecord.id,
      transactionId: walletTransactionId,
      reason: "PayMongo accepted the transfer and is still finalizing it.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown PayMongo payout error";
    await updatePayoutRecord(supabase, paymentRecord.id, {
      status: "failed",
      notes: message,
    });
    await notifyAdmins(
      supabase,
      "Auto payout failed",
      `${getVehicleLabel(payoutBooking)} could not be disbursed automatically. Review the payout queue.`,
    );
    await insertPayoutAudit(supabase, initiatedByUserId, "payout_auto_failed", payoutBooking, {
      amount: Number(payoutBooking.base_price),
      payment_id: paymentRecord.id,
      payout_method: payoutMethod,
      error: message,
    });
    return {
      state: "failed",
      bookingId,
      paymentId: paymentRecord.id,
      transactionId: null,
      reason: message,
    };
  }
};
