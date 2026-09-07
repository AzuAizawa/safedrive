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
 * Daily job (Chapter 58): auto-files a 'deletion' data_retention_requests
 * row for any regular-user account whose last login (profiles.
 * active_session_started_at, falling back to created_at) predates the
 * admin-configured dormant_account_days threshold. Skips anyone with an
 * open request already, or a booking in progress. This only FILES the
 * request into the existing human-reviewed pipeline
 * (AdminRetentionRequestsPage.tsx) - a super admin still has to approve it
 * and click through to public.anonymize_user(), which never touches
 * bookings/payments/ledger data. All the real logic lives in the
 * public.flag_dormant_accounts() SQL function (same pattern as
 * notify_expiring_licenses(), called by api/flag-expiring-licenses.ts).
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
    const { data, error } = await supabase.rpc("flag_dormant_accounts");
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    return jsonResponse({ success: true, flagged: Number(data ?? 0) });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Dormant-account flagging run failed",
      },
      500,
    );
  }
}
