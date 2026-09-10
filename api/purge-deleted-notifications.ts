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
 * Daily job (CHAPTER 83): permanently removes notifications their recipient
 * deleted more than the retention window ago.
 *
 * Deleting a notification in the app only writes `notifications.deleted_at` -
 * it disappears from the list and waits on the "Recently deleted" shelf, where
 * the person who deleted it can put it back. This job is the second half: once
 * the window has passed, the row is gone for good.
 *
 * All of the logic - including the window itself, which is read from
 * retention_policy_rules ('deleted_notification') rather than hard-coded - lives
 * in public.purge_deleted_notifications(), the same pattern as
 * flag_dormant_accounts() and notify_expiring_licenses(). That function is
 * executable by the service role only: there is no DELETE policy on
 * notifications, so no browser session can destroy one.
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
    const { data, error } = await supabase.rpc("purge_deleted_notifications");
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    return jsonResponse({ success: true, purged: Number(data ?? 0) });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Deleted-notification purge run failed",
      },
      500,
    );
  }
}
