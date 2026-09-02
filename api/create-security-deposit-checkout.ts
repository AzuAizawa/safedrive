import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "edge" };

const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async function handler(req: Request) {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const paymongoKey = process.env.PAYMONGO_SECRET_KEY;
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !serviceKey || !paymongoKey) throw new Error("Deposit checkout is not configured");
    if (!token) return respond({ error: "Unauthorized" }, 401);
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return respond({ error: "Unauthorized" }, 401);
    const { bookingId } = (await req.json()) as { bookingId?: string };
    if (!bookingId) return respond({ error: "Booking ID is required" }, 400);

    const { data: deposit, error } = await supabase.from("security_deposits").select("id, booking_id, renter_id, amount_centavos, status, provider_checkout_id").eq("booking_id", bookingId).single();
    if (error || !deposit) return respond({ error: "Security deposit record not found" }, 404);
    if (deposit.renter_id !== user.id) return respond({ error: "Only the renter can pay this security deposit" }, 403);
    if (deposit.status === "paid") return respond({ error: "Security deposit is already paid" }, 409);
    if (!["required", "awaiting_payment"].includes(deposit.status)) return respond({ error: "Security deposit is not currently payable" }, 409);

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("status, renter_id")
      .eq("id", bookingId)
      .single();
    if (bookingError || !booking) return respond({ error: "Booking not found" }, 404);
    if (booking.renter_id !== user.id || booking.status !== "fully_paid") {
      return respond(
        { error: "The rental must be fully paid before the refundable deposit can be collected" },
        409,
      );
    }

    if (deposit.status === "awaiting_payment" && deposit.provider_checkout_id) {
      const existingResponse = await fetch(
        `https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(deposit.provider_checkout_id)}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${btoa(`${paymongoKey}:`)}`,
          },
        },
      );
      const existingData = await existingResponse.json().catch(() => null);
      if (existingResponse.ok) {
        const existingUrl = existingData?.data?.attributes?.checkout_url as string | undefined;
        if (existingUrl) {
          return respond({
            checkoutUrl: existingUrl,
            checkoutId: deposit.provider_checkout_id,
            amountCentavos: deposit.amount_centavos,
            resumed: true,
          });
        }
        return respond(
          { error: "The existing deposit checkout is awaiting PayMongo confirmation" },
          409,
        );
      }
      if (existingResponse.status !== 404) {
        return respond(
          { error: "The existing deposit checkout could not be verified; try again later" },
          502,
        );
      }
    }

    const providerResponse = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${btoa(`${paymongoKey}:`)}`, "Idempotency-Key": `safedrive-security-deposit-${deposit.id}` },
      body: JSON.stringify({ data: { attributes: {
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        description: `Refundable SafeDrive security deposit for booking ${bookingId}`,
        line_items: [{ currency: "PHP", amount: deposit.amount_centavos, name: "Refundable Security Deposit", quantity: 1 }],
        payment_method_types: ["card", "paymaya", "gcash", "grab_pay"],
        success_url: `${new URL(req.url).origin}/payment/success?booking_id=${bookingId}&payment=security_deposit`,
        cancel_url: `${new URL(req.url).origin}/my-bookings`,
        reference_number: `security-deposit:${bookingId}`,
      } } }),
    });
    const providerData = await providerResponse.json();
    if (!providerResponse.ok) return respond({ error: "PayMongo did not create the deposit checkout", details: providerData }, 502);
    const checkoutId = providerData?.data?.id as string | undefined;
    const checkoutUrl = providerData?.data?.attributes?.checkout_url as string | undefined;
    if (!checkoutId || !checkoutUrl) return respond({ error: "PayMongo returned an incomplete checkout" }, 502);

    const { error: updateError } = await supabase.from("security_deposits").update({ status: "awaiting_payment", provider_checkout_id: checkoutId }).eq("id", deposit.id).in("status", ["required", "awaiting_payment"]);
    if (updateError) throw updateError;
    await supabase.from("audit_log").insert({ user_id: user.id, action: "security_deposit_checkout_created", entity_type: "security_deposit", entity_id: deposit.id, details: { booking_id: bookingId, amount_centavos: deposit.amount_centavos, checkout_id: checkoutId } });
    return respond({ checkoutUrl, checkoutId, amountCentavos: deposit.amount_centavos });
  } catch (error) {
    console.error("Security deposit checkout failed", error);
    return respond({ error: error instanceof Error ? error.message : "Security deposit checkout failed" }, 500);
  }
}
