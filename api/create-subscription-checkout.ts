import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type SubscriptionPlanDefinition = {
  id: "pro" | "premium";
  label: string;
  amountPhp: number;
  additionalSlots: number;
};

type SubscriptionCheckoutPayload = {
  planId?: string;
};

const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlanDefinition> = {
  pro: {
    id: "pro",
    label: "Pro",
    amountPhp: 199,
    additionalSlots: 5,
  },
  premium: {
    id: "premium",
    label: "Premium",
    amountPhp: 299,
    additionalSlots: 10,
  },
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

    const payload = (await req.json()) as SubscriptionCheckoutPayload;
    if (!payload.planId) {
      return jsonResponse({ error: "Plan ID is required" }, 400);
    }

    const plan = SUBSCRIPTION_PLANS[payload.planId];
    if (!plan) {
      return jsonResponse({ error: "Unsupported subscription plan" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const referenceNumber = `subscription:${user.id}:${plan.id}`;
    const amountInCentavos = plan.amountPhp * 100;
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
              description: `${plan.label} plan activation for SafeDrive`,
              line_items: [
                {
                  currency: "PHP",
                  amount: amountInCentavos,
                  name: `${plan.label} Subscription`,
                  quantity: 1,
                },
              ],
              payment_method_types: ["card", "paymaya", "gcash", "grab_pay"],
              success_url: `${new URL(req.url).origin}/payment/success?subscription=1&plan=${plan.id}`,
              cancel_url: `${new URL(req.url).origin}/subscriptions`,
              reference_number: referenceNumber,
            },
          },
        }),
      },
    );

    const paymongoData = await paymongoRes.json();

    if (!paymongoRes.ok) {
      console.error("PayMongo subscription checkout error:", paymongoData);
      return jsonResponse(
        {
          error: "Failed to create subscription checkout session",
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
        { error: "PayMongo returned an incomplete subscription checkout response." },
        502,
      );
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "subscription_checkout_created",
      entity_type: "subscription_plan",
      entity_id: checkoutId,
      details: {
        plan_id: plan.id,
        amount_php: plan.amountPhp,
        reference_number: referenceNumber,
        test_mode: true,
      },
    });

    return jsonResponse({
      checkoutUrl,
      checkoutId,
      planId: plan.id,
      amount: plan.amountPhp,
      state: "checkout_created",
      mode: "test",
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Create subscription checkout error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
