import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type BookingRecord = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  total_price: number;
  downpayment_amount: number;
  payment_deadline: string | null;
  agreement_version_id: string | null;
  cars: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: {
        name: string;
      };
    };
  } | null;
};

type CheckoutRequestPayload = {
  bookingId?: string;
  paymentMode?: "downpayment" | "full";
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin environment variables");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

const getCheckoutDescription = (
  booking: BookingRecord,
  paymentMode: "downpayment" | "full",
) => {
  const vehicleName = booking.cars
    ? `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`
    : `Booking ${booking.id}`;

  return paymentMode === "full"
    ? `Full payment for ${vehicleName}`
    : `Downpayment for ${vehicleName}`;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const secretKey = process.env.PAYMONGO_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Missing PAYMONGO_SECRET_KEY");
    }

    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const payload = (await req.json()) as CheckoutRequestPayload;
    if (!payload.bookingId) {
      return jsonResponse({ error: "Booking ID is required" }, 400);
    }
    const paymentMode = payload.paymentMode === "full" ? "full" : "downpayment";

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        `
        id,
        renter_id,
        owner_id,
        status,
        total_price,
        downpayment_amount,
        payment_deadline,
        agreement_version_id,
        cars (
          plate_number,
          car_models (
            name,
            car_brands (name)
          )
        )
      `,
      )
      .eq("id", payload.bookingId)
      .single();

    if (bookingError || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    const bookingRecord = booking as unknown as BookingRecord;

    if (bookingRecord.renter_id !== user.id) {
      return jsonResponse({ error: "You are not allowed to pay for this booking" }, 403);
    }

    // Second driver's-licence checkpoint: block payment if the renter's licence
    // expired between the request and now. Separate query so a pre-CHAPTER-29
    // deploy degrades to no check. No captured payment yet, so the renter can
    // cancel for a full refund and renew.
    {
      const { data: lic } = await supabase
        .from("profiles")
        .select("license_expiry")
        .eq("id", user.id)
        .maybeSingle();
      const licExpiry = (lic as { license_expiry: string | null } | null)
        ?.license_expiry;
      if (licExpiry) {
        const end = new Date(`${licExpiry}T23:59:59`);
        if (!Number.isNaN(end.getTime()) && end.getTime() < Date.now()) {
          return jsonResponse(
            {
              error:
                "Your driver's licence has expired. Renew it (Account & Identity) before paying, or cancel this booking for a full refund.",
            },
            403,
          );
        }
      }
    }

    // Block payment while the renter has an unresolved non-return case.
    // Separate query so a pre-CHAPTER-31 deploy degrades to no check.
    {
      const { data: openIncident } = await supabase
        .from("bookings")
        .select("id")
        .eq("renter_id", user.id)
        .eq("dispute_status", "open")
        .limit(1)
        .maybeSingle();
      if (openIncident) {
        return jsonResponse(
          {
            error:
              "You have an open case for a vehicle that was not returned on time. Resolve it with SafeDrive support before paying for another booking.",
          },
          403,
        );
      }
    }

    if (!bookingRecord.agreement_version_id) {
      return jsonResponse({ error: "This booking has no approved rental-agreement snapshot" }, 409);
    }
    const { data: acceptance, error: acceptanceError } = await supabase
      .from("booking_agreement_acceptances")
      .select("id")
      .eq("booking_id", bookingRecord.id)
      .eq("renter_id", user.id)
      .eq("agreement_version_id", bookingRecord.agreement_version_id)
      .maybeSingle();
    if (acceptanceError) throw acceptanceError;
    if (!acceptance) {
      return jsonResponse({ error: "Accept the exact vehicle rental-agreement version before payment" }, 409);
    }

    if (
      bookingRecord.payment_deadline &&
      new Date(bookingRecord.payment_deadline).getTime() <= Date.now()
    ) {
      const { error: expiryError } = await supabase
        .from("bookings")
        .update({ status: "cancelled", payment_deadline: null })
        .eq("id", bookingRecord.id)
        .in("status", ["confirmed", "awaiting_payment"])
        .lte("payment_deadline", new Date().toISOString());

      if (expiryError) throw expiryError;

      return jsonResponse(
        {
          error:
            "The 24-hour reservation payment deadline has passed. This booking was cancelled and the vehicle is available again.",
        },
        409,
      );
    }

    if (
      bookingRecord.status !== "confirmed" &&
      bookingRecord.status !== "awaiting_payment"
    ) {
      return jsonResponse(
        {
          error:
            "This booking is not currently accepting a downpayment checkout session.",
        },
        409,
      );
    }

    if (
      !Number.isFinite(
        Number(
          paymentMode === "full"
            ? bookingRecord.total_price
            : bookingRecord.downpayment_amount,
        ),
      ) ||
      Number(
        paymentMode === "full"
          ? bookingRecord.total_price
          : bookingRecord.downpayment_amount,
      ) <= 0
    ) {
      return jsonResponse(
        {
          error:
            paymentMode === "full"
              ? "This booking has an invalid full-payment amount."
              : "This booking has an invalid downpayment amount.",
        },
        422,
      );
    }

    const selectedAmount =
      paymentMode === "full"
        ? Number(bookingRecord.total_price)
        : Number(bookingRecord.downpayment_amount);

    if (selectedAmount > 100000) {
      return jsonResponse(
        {
          error:
            paymentMode === "full"
              ? "This full payment exceeds PayMongo's PHP 100,000 hosted checkout limit."
              : "This downpayment exceeds PayMongo's PHP 100,000 hosted checkout limit.",
        },
        422,
      );
    }

    const amountInCentavos = Math.round(selectedAmount * 100);
    const authToken = btoa(`${secretKey}:`);

    const paymongoRes = await fetch(
      "https://api.paymongo.com/v1/checkout_sessions",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${authToken}`,
        },
        body: JSON.stringify({
          data: {
            attributes: {
              send_email_receipt: true,
              show_description: true,
              show_line_items: true,
              description: getCheckoutDescription(bookingRecord, paymentMode),
              line_items: [
                {
                  currency: "PHP",
                  amount: amountInCentavos,
                  name:
                    paymentMode === "full"
                      ? "Full Rental Payment"
                      : "Rental Downpayment",
                  quantity: 1,
                },
              ],
              payment_method_types: ["card", "paymaya", "gcash", "grab_pay"],
              success_url: `${new URL(req.url).origin}/payment/success?booking_id=${bookingRecord.id}&payment=${paymentMode}`,
              cancel_url: `${new URL(req.url).origin}/my-bookings`,
              reference_number:
                paymentMode === "full"
                  ? `booking-full:${bookingRecord.id}`
                  : bookingRecord.id,
            },
          },
        }),
      },
    );

    const paymongoData = await paymongoRes.json();

    if (!paymongoRes.ok) {
      console.error("PayMongo Error:", paymongoData);
      return jsonResponse(
        {
          error: "Failed to create PayMongo session",
          details: paymongoData,
        },
        502,
      );
    }

    const checkoutUrl = paymongoData?.data?.attributes?.checkout_url as
      | string
      | undefined;
    const checkoutId = paymongoData?.data?.id as string | undefined;

    if (!checkoutUrl || !checkoutId) {
      return jsonResponse(
        { error: "PayMongo returned an incomplete checkout response." },
        502,
      );
    }

    const { data: checkoutStateSaved, error: updateError } = await supabase
      .from("bookings")
      .update({
        paymongo_checkout_id: checkoutId,
        status: "awaiting_payment",
      })
      .eq("id", bookingRecord.id)
      .eq("renter_id", user.id)
      .in("status", ["confirmed", "awaiting_payment"])
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("Failed to store checkout session", updateError);
      return jsonResponse(
        { error: "Failed to save checkout session state." },
        500,
      );
    }

    if (!checkoutStateSaved) {
      return jsonResponse(
        {
          error:
            "This booking changed state before checkout could be saved. Please refresh your bookings and try again.",
        },
        409,
      );
    }

    return jsonResponse({
      checkoutUrl,
      checkoutId,
      bookingId: bookingRecord.id,
      amount: selectedAmount,
      paymentMode,
      state: "checkout_created",
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Create checkout error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
