import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
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
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: currentSubscription, error: currentError } = await supabase
      .from("subscriptions")
      .select("id, plan_type")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentError) {
      throw currentError;
    }

    if (!currentSubscription) {
      return jsonResponse({ error: "No active subscription to cancel" }, 404);
    }

    const endDate = new Date().toISOString().slice(0, 10);

    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        status: "cancelled",
        end_date: endDate,
      })
      .eq("id", currentSubscription.id)
      .eq("user_id", user.id)
      .eq("status", "active");

    if (updateError) {
      throw updateError;
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "subscription_cancelled",
      entity_type: "subscription_plan",
      entity_id: currentSubscription.id,
      details: {
        previous_plan: currentSubscription.plan_type,
        cancelled_on: endDate,
      },
    });

    return jsonResponse({
      success: true,
      cancelledPlan: currentSubscription.plan_type,
      state: "cancelled",
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Cancel subscription error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
