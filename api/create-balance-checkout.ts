import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type BookingRecord = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  balance_amount: number;
  paymongo_balance_checkout_id: string | null;
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

const getCheckoutDescription = (booking: BookingRecord) => {
  const vehicleName = booking.cars
    ? `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`
    : `Booking ${booking.id}`;

  return `Remaining balance for ${vehicleName}`;
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
        balance_amount,
        paymongo_balance_checkout_id,
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
      return jsonResponse(
        { error: "You are not allowed to pay the balance for this booking" },
        403,
      );
    }

    // Second driver's-licence checkpoint (see api/create-checkout.ts).
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
                "Your driver's licence has expired. Renew it (Account & Identity) before paying the balance, or cancel this booking for a full refund.",
            },
            403,
          );
        }
      }
    }

    // Block while the renter has an unresolved non-return case (see
    // api/create-checkout.ts). Separate query for graceful degradation.
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
              "You have an open case for a vehicle that was not returned on time. Resolve it with SafeDrive support before paying the balance.",
          },
          403,
        );
      }
    }

    if (bookingRecord.status !== "downpayment_paid") {
      return jsonResponse(
        {
          error:
            "This booking is not currently accepting a remaining balance checkout session.",
        },
        409,
      );
    }

    if (
      !Number.isFinite(Number(bookingRecord.balance_amount)) ||
      Number(bookingRecord.balance_amount) <= 0
    ) {
      return jsonResponse(
        { error: "This booking has an invalid balance amount." },
        422,
      );
    }

    if (Number(bookingRecord.balance_amount) > 100000) {
      return jsonResponse(
        {
          error:
            "This remaining balance exceeds PayMongo's PHP 100,000 hosted checkout limit.",
        },
        422,
      );
    }

    const amountInCentavos = Math.round(Number(bookingRecord.balance_amount) * 100);
    const authToken = btoa(`${secretKey}:`);
    const referenceNumber = `booking-balance:${bookingRecord.id}`;

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
              description: getCheckoutDescription(bookingRecord),
              line_items: [
                {
                  currency: "PHP",
                  amount: amountInCentavos,
                  name: "Rental Balance",
                  quantity: 1,
                },
              ],
              payment_method_types: ["card", "paymaya", "gcash", "grab_pay"],
              success_url: `${new URL(req.url).origin}/payment/success?booking_id=${bookingRecord.id}&payment=balance`,
              cancel_url: `${new URL(req.url).origin}/my-bookings`,
              reference_number: referenceNumber,
            },
          },
        }),
      },
    );

    const paymongoData = await paymongoRes.json();

    if (!paymongoRes.ok) {
      console.error("PayMongo Balance Error:", paymongoData);
      return jsonResponse(
        {
          error: "Failed to create PayMongo balance session",
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
        paymongo_balance_checkout_id: checkoutId,
      })
      .eq("id", bookingRecord.id)
      .eq("renter_id", user.id)
      .eq("status", "downpayment_paid")
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("Failed to store balance checkout session", updateError);
      return jsonResponse(
        { error: "Failed to save balance checkout session state." },
        500,
      );
    }

    if (!checkoutStateSaved) {
      return jsonResponse(
        {
          error:
            "This booking changed state before balance checkout could be saved. Please refresh your bookings and try again.",
        },
        409,
      );
    }

    return jsonResponse({
      checkoutUrl,
      checkoutId,
      bookingId: bookingRecord.id,
      amount: bookingRecord.balance_amount,
      state: "balance_checkout_created",
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Create balance checkout error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
