import { createSupabaseAdmin } from "./lib/payoutAutomation";
import { postSimpleBalancedJournal } from "./lib/ledger";
import { sendPayoutReceiptEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type ManualPayoutPayload = {
  bookingId?: string;
  paymentMethod?: string;
  referenceNumber?: string;
  note?: string | null;
};

type BookingForManualPayout = {
  id: string;
  status: string;
  owner_completed: boolean;
  renter_completed: boolean;
  base_price: number;
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
  payments: Array<{
    id: string;
    payment_type: string;
    status: string;
    transaction_id: string | null;
  }>;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

const getVehicleLabel = (booking: BookingForManualPayout) =>
  `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`;

const normalizePaymentMethod = (value: string | undefined | null) => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "gcash") return "GCash";
  if (normalized === "maya") return "Maya";
  return null;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const payload = (await req.json().catch(() => ({}))) as ManualPayoutPayload;
    const bookingId = payload.bookingId?.trim();
    const referenceNumber = payload.referenceNumber?.trim();
    const paymentMethod = normalizePaymentMethod(payload.paymentMethod);
    const note = payload.note?.trim() || null;

    if (!bookingId || !paymentMethod || !referenceNumber) {
      return jsonResponse(
        {
          error:
            "Booking, payout method, and payout reference number are required.",
        },
        400,
      );
    }

    const supabase = createSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: requesterProfile, error: requesterError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (requesterError || requesterProfile?.role !== "super_admin") {
      return jsonResponse(
        { error: "Only a super admin can mark manual payouts as paid." },
        403,
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        `
        id,
        status,
        owner_completed,
        renter_completed,
        base_price,
        commission,
        cars(plate_number, car_models(name, car_brands(name))),
        owner:profiles!bookings_owner_id_fkey(id, full_name, email, payout_method, payout_account_name, payout_account_number),
        payments(id, payment_type, status, transaction_id)
      `,
      )
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      return jsonResponse({ error: "Booking not found." }, 404);
    }

    const payoutBooking = booking as unknown as BookingForManualPayout;
    if (
      payoutBooking.status !== "completed" ||
      !payoutBooking.owner_completed ||
      !payoutBooking.renter_completed
    ) {
      return jsonResponse(
        { error: "Manual payout is only allowed after both sides complete the booking." },
        409,
      );
    }

    const { data: securityDeposit, error: securityDepositError } = await supabase
      .from("security_deposits")
      .select("id, status")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (securityDepositError) throw securityDepositError;
    if (securityDeposit && !["released", "partially_released", "claimed"].includes(securityDeposit.status)) {
      return jsonResponse(
        { error: "Complete the security-deposit review and release before marking a payout paid." },
        409,
      );
    }

    const existingCompleted = payoutBooking.payments.find(
      (payment) => payment.payment_type === "payout" && payment.status === "completed",
    );
    if (existingCompleted) {
      return jsonResponse({ error: "This booking already has a completed payout." }, 409);
    }

    const existingProviderPending = payoutBooking.payments.find(
      (payment) =>
        payment.payment_type === "payout" &&
        payment.status === "pending" &&
        payment.transaction_id,
    );
    if (existingProviderPending) {
      return jsonResponse(
        {
          error:
            "A provider payout is already pending. Wait for PayMongo confirmation before marking this manually paid.",
        },
        409,
      );
    }

    const { count: blockingTicketCount } = await supabase
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId)
      .in("status", ["open", "in_progress"]);

    if ((blockingTicketCount ?? 0) > 0) {
      return jsonResponse(
        { error: "Resolve the open booking support case before releasing payout." },
        409,
      );
    }

    const savedMethod = normalizePaymentMethod(payoutBooking.owner.payout_method);
    if (!savedMethod || savedMethod !== paymentMethod) {
      return jsonResponse(
        {
          error:
            "The selected payout method must match the lister's saved GCash or Maya payout method.",
        },
        422,
      );
    }

    if (
      !payoutBooking.owner.payout_account_name ||
      !payoutBooking.owner.payout_account_number
    ) {
      return jsonResponse(
        { error: "Lister payout account name and number are incomplete." },
        422,
      );
    }

    let payoutAmount = Number(payoutBooking.base_price);
    if (securityDeposit) {
      const { data: approvedClaims, error: approvedClaimError } = await supabase
        .from("security_deposit_claims")
        .select("approved_amount_centavos")
        .eq("security_deposit_id", securityDeposit.id)
        .in("status", ["approved", "partially_approved"]);
      if (approvedClaimError) throw approvedClaimError;
      payoutAmount += (approvedClaims ?? []).reduce(
        (sum, claim) => sum + Number(claim.approved_amount_centavos || 0),
        0,
      ) / 100;
    }
    if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      return jsonResponse({ error: "Computed payout amount is invalid." }, 422);
    }

    const notes = [
      `Manual payout confirmed by super admin via ${paymentMethod}.`,
      note,
    ]
      .filter(Boolean)
      .join(" ");

    const { count: activePayoutCount, error: activePayoutError } = await supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", payoutBooking.id)
      .eq("payment_type", "payout")
      .in("status", ["pending", "completed"]);

    if (activePayoutError) throw activePayoutError;

    if ((activePayoutCount ?? 0) > 0) {
      return jsonResponse(
        {
          error:
            "This booking already has an active payout. Refresh the payout queue before trying again.",
        },
        409,
      );
    }

    const { data: payoutPayment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        booking_id: payoutBooking.id,
        amount: payoutAmount,
        payment_type: "payout",
        status: "completed",
        payment_method: paymentMethod,
        transaction_id: referenceNumber,
        notes,
      })
      .select("id")
      .single();

    if (paymentError?.code === "23505") {
      return jsonResponse(
        {
          error:
            "This booking already has an active payout. Refresh the payout queue before trying again.",
        },
        409,
      );
    }

    if (paymentError || !payoutPayment) {
      throw paymentError ?? new Error("Failed to record manual payout.");
    }

    await supabase.from("notifications").insert({
      user_id: payoutBooking.owner.id,
      title: "Payout Released",
      message: `Your SafeDrive payout for ${getVehicleLabel(payoutBooking)} was marked released through ${paymentMethod}. Reference: ${referenceNumber}.`,
      type: "success",
      link: "/lister-bookings",
    });
    await sendPayoutReceiptEmail(supabase, {
      bookingId: payoutBooking.id,
      amount: payoutAmount,
      payoutId: payoutPayment.id,
      payoutMethod: paymentMethod,
      transactionId: referenceNumber,
      baseOrigin: new URL(req.url).origin,
    });

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "payout_marked_manual",
      entity_type: "booking",
      entity_id: payoutBooking.id,
      details: {
        amount: payoutAmount,
        payment_id: payoutPayment.id,
        payout_method: paymentMethod,
        reference_number: referenceNumber,
        lister_id: payoutBooking.owner.id,
        mode: "manual",
      },
    });

    await postSimpleBalancedJournal(supabase, {
      bookingId: payoutBooking.id,
      eventKey: `manual-payout:${referenceNumber}`,
      eventType: "lister_payout_completed",
      providerReference: referenceNumber,
      actorId: user.id,
      debitAccount: "2010",
      creditAccount: "1020",
      amountCentavos: Math.round(payoutAmount * 100),
      partyUserId: payoutBooking.owner.id,
      memo: `Manual lister payout through ${paymentMethod}`,
    });

    return jsonResponse({
      success: true,
      state: "completed",
      bookingId: payoutBooking.id,
      paymentId: payoutPayment.id,
      transactionId: referenceNumber,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected manual payout error",
      },
      500,
    );
  }
}
