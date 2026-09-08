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

const isAuthorizedCronRequest = (req: Request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error("CRON_SECRET must be configured before platform-setting expiry can run");
  }

  const authorization = req.headers.get("Authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  return bearerToken === cronSecret || req.headers.get("x-cron-secret") === cronSecret;
};

/**
 * A platform-setting change proposal (CHAPTER 45) expires 7 days after it was
 * proposed if the super-admin vote never reached the 2/3 threshold either
 * way. public._resolve_platform_setting_change already flips a past-deadline
 * "pending" row to "expired" - it was just never called except reactively
 * from propose/vote. This runs it for every still-pending request so a
 * stale, nobody's-voting-anymore proposal doesn't block new ones forever
 * (only one may be pending at a time).
 *
 * Since CHAPTER 69 it also promotes scheduled changes. A change approved with
 * a start date does not apply when the vote passes - it waits at status
 * 'scheduled' so a booking already sitting in its pickup window is not moved
 * under its own feet. This run applies the ones whose date has arrived.
 */
export default async function handler(req: Request) {
  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    if (!isAuthorizedCronRequest(req)) {
      return jsonResponse({ error: "Unauthorized platform-setting expiry run" }, 401);
    }

    const supabase = getSupabaseAdmin();

    const { data: pendingRequests, error: pendingError } = await supabase
      .from("platform_setting_change_requests")
      .select("id")
      .eq("status", "pending")
      .limit(10); // platform_setting_change_one_pending allows at most one anyway

    if (pendingError) throw pendingError;

    let expired = 0;
    for (const request of pendingRequests ?? []) {
      const { data: outcome, error: resolveError } = await supabase.rpc(
        "_resolve_platform_setting_change",
        { p_request_id: request.id },
      );
      if (resolveError) throw resolveError;
      if (outcome === "expired") expired += 1;
    }

    // A change approved with a start date sits at status 'scheduled' until
    // that date arrives (CHAPTER 69). This run promotes any that are due.
    // Riding this existing daily cron rather than adding an endpoint means
    // there is no new scheduler entry to register; a late run applies the
    // change late, which for a date-based change is harmless.
    const { data: promotedCount, error: promoteError } = await supabase.rpc(
      "promote_scheduled_platform_setting_changes",
    );
    if (promoteError) throw promoteError;

    return jsonResponse({
      success: true,
      checked: pendingRequests?.length ?? 0,
      expired,
      promoted: Number(promotedCount ?? 0),
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected platform-setting expiry error",
      },
      500,
    );
  }
}
