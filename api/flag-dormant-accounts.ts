import { createSupabaseAdmin } from "../server/payoutAutomation";
import { sendUserNotificationEmail } from "../server/email.js";

export const config = {
  runtime: "edge",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * Daily job (CHAPTERS 58 and 121): an account nobody has signed in to for
 * dormant_account_days is scheduled for deletion the way Delete Account
 * schedules one - hidden, deleted after the grace period unless its owner
 * signs in and keeps it, then anonymized by api/process-account-deletions.ts.
 * public.flag_dormant_accounts() schedules each one, writes the in-app notice
 * and returns the accounts; each owner is emailed the same notice from here.
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
    const { data, error } = await supabase.rpc("flag_dormant_accounts");
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    const scheduled = (data ?? []) as Array<{
      user_id: string;
      request_id: string;
      scheduled_for: string;
      idle_days: number;
    }>;
    const baseOrigin = new URL(req.url).origin;
    let emailFailures = 0;
    for (const account of scheduled) {
      const when = new Date(account.scheduled_for).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      });
      const result = await sendUserNotificationEmail(supabase, {
        userId: account.user_id,
        title: "Your account is scheduled for deletion",
        message: `You have not signed in to SafeDrive for ${account.idle_days} days, so your account will be deleted on ${when} (Manila). Until then it is hidden. Sign in and choose to keep your account before then if you still want it. After that date your personal details are erased; bookings and payments you took part in are kept without your name.`,
        link: "/verify",
        baseOrigin,
        eventKey: `dormant-deletion:${account.request_id}`,
      });
      if (result.state !== "sent") emailFailures += 1;
    }
    return jsonResponse({ success: true, scheduled: scheduled.length, emailFailures });
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
