import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type ExtensionRecord = {
  id: string;
  booking_id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  total_additional_amount: number;
  paymongo_checkout_id: string | null;
  payment_deadline: string | null;
  booking: {
    id: string;
    cars: {
      plate_number: string;
      car_models: {
        name: string;
        car_brands: {
          name: string;
        };
      };
    } | null;
  } | null;
};

type CheckoutRequestPayload = {
  extensionId?: string;
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

const getCheckoutDescription = (extension: ExtensionRecord) => {
  const vehicleName = extension.booking?.cars
    ? `${extension.booking.cars.car_models.car_brands.name} ${extension.booking.cars.car_models.name} (${extension.booking.cars.plate_number})`
    : `Booking ${extension.booking_id}`;

  return `Extension payment for ${vehicleName}`;
};

const isPastDeadline = (deadline: string | null) => {
  if (!deadline) return false;
  const deadlineMs = new Date(deadline).getTime();
  return !Number.isNaN(deadlineMs) && deadlineMs <= Date.now();
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
    if (!payload.extensionId) {
      return jsonResponse({ error: "Extension ID is required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: extension, error: extensionError } = await supabase
      .from("booking_extensions")
      .select(
        `
        id,
        booking_id,
        renter_id,
        owner_id,
        status,
        total_additional_amount,
        paymongo_checkout_id,
        payment_deadline,
        booking:bookings (
          id,
          cars (
            plate_number,
            car_models (
              name,
              car_brands (name)
            )
          )
        )
      `,
      )
      .eq("id", payload.extensionId)
      .single();

    if (extensionError || !extension) {
      return jsonResponse({ error: "Extension request not found" }, 404);
    }

    const extensionRecord = extension as unknown as ExtensionRecord;
    if (extensionRecord.renter_id !== user.id) {
      return jsonResponse({ error: "You are not allowed to pay for this extension" }, 403);
    }

    if (
      extensionRecord.status === "approved" &&
      isPastDeadline(extensionRecord.payment_deadline)
    ) {
      await supabase
        .from("booking_extensions")
        .update({ status: "expired" })
        .eq("id", extensionRecord.id)
        .eq("status", "approved");

      await supabase.from("notifications").insert([
        {
          user_id: extensionRecord.renter_id,
          title: "Extension Payment Window Expired",
          message:
            "Your approved extension was not paid before the deadline and is no longer payable.",
          type: "warning",
          link: "/my-bookings",
        },
        {
          user_id: extensionRecord.owner_id,
          title: "Extension Expired",
          message:
            "The renter did not pay the approved extension before the deadline.",
          type: "warning",
          link: "/lister-bookings",
        },
      ]);

      await supabase.from("audit_log").insert({
        user_id: extensionRecord.renter_id,
        action: "booking_extension_expired",
        entity_type: "booking_extension",
        entity_id: extensionRecord.id,
        details: {
          booking_id: extensionRecord.booking_id,
          payment_deadline: extensionRecord.payment_deadline,
          reason: "Extension checkout requested after payment deadline",
        },
      });

      return jsonResponse(
        {
          error:
            "This extension payment window already expired. Submit a new request if you still need more time.",
        },
        409,
      );
    }

    if (extensionRecord.status !== "approved") {
      return jsonResponse(
        { error: "This extension is not currently accepting payment." },
        409,
      );
    }

    if (
      !Number.isFinite(Number(extensionRecord.total_additional_amount)) ||
      Number(extensionRecord.total_additional_amount) <= 0
    ) {
      return jsonResponse({ error: "This extension has an invalid payable amount." }, 422);
    }

    if (Number(extensionRecord.total_additional_amount) > 100000) {
      return jsonResponse(
        {
          error:
            "This extension amount exceeds PayMongo's PHP 100,000 hosted checkout limit.",
        },
        422,
      );
    }

    const amountInCentavos = Math.round(
      Number(extensionRecord.total_additional_amount) * 100,
    );
    const authToken = btoa(`${secretKey}:`);
    const referenceNumber = `booking-extension:${extensionRecord.id}`;

    const paymongoRes = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
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
            description: getCheckoutDescription(extensionRecord),
            line_items: [
              {
                currency: "PHP",
                amount: amountInCentavos,
                name: "Booking Extension",
                quantity: 1,
              },
            ],
            payment_method_types: ["card", "paymaya", "gcash", "grab_pay"],
            success_url: `${new URL(req.url).origin}/payment/success?booking_id=${extensionRecord.booking_id}&payment=extension&extension_id=${extensionRecord.id}`,
            cancel_url: `${new URL(req.url).origin}/my-bookings`,
            reference_number: referenceNumber,
          },
        },
      }),
    });

    const paymongoData = await paymongoRes.json();
    if (!paymongoRes.ok) {
      console.error("PayMongo extension checkout error:", paymongoData);
      return jsonResponse(
        { error: "Failed to create PayMongo extension checkout session", details: paymongoData },
        502,
      );
    }

    const checkoutUrl = paymongoData?.data?.attributes?.checkout_url as string | undefined;
    const checkoutId = paymongoData?.data?.id as string | undefined;

    if (!checkoutUrl || !checkoutId) {
      return jsonResponse(
        { error: "PayMongo returned an incomplete extension checkout response." },
        502,
      );
    }

    const { data: checkoutStateSaved, error: updateError } = await supabase
      .from("booking_extensions")
      .update({ paymongo_checkout_id: checkoutId })
      .eq("id", extensionRecord.id)
      .eq("renter_id", user.id)
      .eq("status", "approved")
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("Failed to store extension checkout session", updateError);
      return jsonResponse({ error: "Failed to save extension checkout state." }, 500);
    }

    if (!checkoutStateSaved) {
      return jsonResponse(
        {
          error:
            "This extension changed state before checkout could be saved. Please refresh your bookings and try again.",
        },
        409,
      );
    }

    return jsonResponse({
      checkoutUrl,
      checkoutId,
      extensionId: extensionRecord.id,
      bookingId: extensionRecord.booking_id,
      amount: extensionRecord.total_additional_amount,
      state: "extension_checkout_created",
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Create extension checkout error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
