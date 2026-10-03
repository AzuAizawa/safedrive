import { createSupabaseAdmin } from "../server/payoutAutomation";
import { sendAdminAlertEmail, sendUserNotificationEmail } from "../server/email.js";

export const config = {
  runtime: "edge",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * Hourly job (CHAPTERS 113 and 117): an identity or vehicle review still
 * pending past its target hours is announced once - to the person waiting, so
 * they know they are still in the queue and need not resubmit, and to every
 * admin. Nothing is rejected automatically. notify_overdue_reviews() writes
 * the in-app notices and returns one row per notice; the same notices are
 * emailed from here.
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
    const rows = (data ?? []) as Array<{
      kind: "identity" | "vehicle";
      subject_id: string;
      user_id: string;
      label: string;
      submitted_at: string;
      target_hours: number;
    }>;
    const baseOrigin = new URL(req.url).origin;
    let emailFailures = 0;

    for (const row of rows) {
      const identity = row.kind === "identity";
      // The stamps make each notice once per submission, and the event keys
      // make each email once too, should a run be retried.
      const eventKey = `review-overdue:${row.kind}:${row.subject_id}:${row.submitted_at}`;
      const userResult = await sendUserNotificationEmail(supabase, {
        userId: row.user_id,
        title: identity
          ? "Your verification is taking longer than usual"
          : "Your vehicle review is taking longer than usual",
        message: identity
          ? "Your identity verification is still in the review queue - it has passed our usual review time. You do not need to resubmit; we will notify you as soon as it is decided."
          : `The review of ${row.label} has passed our usual review time. It is still in the queue - you do not need to resubmit; we will notify you as soon as it is decided.`,
        link: identity ? "/verify" : "/my-vehicles",
        baseOrigin,
        eventKey,
      });
      const adminResult = await sendAdminAlertEmail(supabase, {
        subject: identity ? "Identity review past target" : "Vehicle review past target",
        message: `${row.label} has waited more than ${row.target_hours} hours for ${
          identity ? "identity" : "vehicle"
        } review.`,
        link: identity ? "/admin/users" : "/admin/vehicle-approval",
        baseOrigin,
        eventKey,
      });
      // The in-app notices are already written; an email that did not go out
      // is reported here rather than failing the run.
      if (
        userResult.state !== "sent" ||
        (adminResult.state === "sent" && adminResult.delivered < adminResult.recipients)
      ) {
        emailFailures += 1;
      }
    }

    return jsonResponse({
      success: true,
      identity: rows.filter((row) => row.kind === "identity").length,
      vehicle: rows.filter((row) => row.kind === "vehicle").length,
      emailFailures,
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
