import { createSupabaseAdmin } from "./lib/payoutAutomation";

export const config = {
  runtime: "edge",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * Daily job: notify any verified renter whose driver's licence expires within
 * 30 days (or has already expired). `notify_expiring_licenses()` dedupes with
 * profiles.license_expiry_notified_at so a user is nudged at most weekly. The
 * renter then submits an updated licence from Account & Identity and an admin
 * sets the new expiry / transmission in User Management.
 *
 * Point the same scheduler that runs the other cron endpoints at this URL
 * (~once a day) with `Authorization: Bearer <CRON_SECRET>`.
 */
export default async function handler(req: Request) {
  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return jsonResponse(
      { error: "CRON_SECRET must be configured before this job can run" },
      500,
    );
  }
  const bearer = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (bearer !== cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.rpc("notify_expiring_licenses");
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    return jsonResponse({ success: true, notified: Number(data ?? 0) });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Licence notify run failed",
      },
      500,
    );
  }
}
