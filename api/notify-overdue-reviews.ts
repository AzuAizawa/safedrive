import { createSupabaseAdmin } from "../server/payoutAutomation";

export const config = {
  runtime: "edge",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * Hourly job (CHAPTER 113): an identity or vehicle review still pending past
 * its target hours is announced once - to the person waiting, so they know
 * they are still in the queue and need not resubmit, and to every admin.
 * Nothing is rejected automatically; the notifications are written inside
 * notify_overdue_reviews().
 *
 * Called by .github/workflows/scheduled-workers.yml with
 * `Authorization: Bearer <CRON_SECRET>`.
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
    const { data, error } = await supabase.rpc("notify_overdue_reviews");
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { identity_notices: number; vehicle_notices: number }
      | null;
    return jsonResponse({
      success: true,
      identity: row?.identity_notices ?? 0,
      vehicle: row?.vehicle_notices ?? 0,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Overdue review run failed",
      },
      500,
    );
  }
}
