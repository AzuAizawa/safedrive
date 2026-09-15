import { createSupabaseAdmin } from "../server/payoutAutomation";
import { sendAccountNoticeEmail } from "../server/email.js";
import { closeDeletedAccountLogin } from "../server/accountClosure.js";

export const config = {
  runtime: "edge",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Logins still to close in one run. A run that hits the cap leaves the rest
// for the next day's run.
const LOGIN_CLOSURE_BATCH = 200;

/**
 * Daily job (CHAPTER 96).
 *
 * 1. public.run_due_account_deletions() anonymizes every account whose
 *    self-service deletion date has passed - or, if a booking, refund, payout
 *    or booking support case opened in the meantime, puts it on legal hold and
 *    tells super admins (retried every day).
 * 2. Each deleted person is emailed at the address they had, which the
 *    function returns because it is erased from the profile.
 * 3. Every deleted account whose login is not yet closed is closed - this one's
 *    and any deleted by an admin or through a privacy request - so the old
 *    password no longer signs in and the email is free for a new account.
 *
 * Scheduled by .github/workflows/scheduled-workers.yml with
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
    const baseOrigin = new URL(req.url).origin;

    const { data, error } = await supabase.rpc("run_due_account_deletions");
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    const rows = (data ?? []) as Array<{
      account_id: string;
      outcome: "deleted" | "waiting" | "cleared";
      notice_email: string | null;
      notice_name: string | null;
      detail: string | null;
    }>;

    let noticesSent = 0;
    for (const row of rows) {
      if (row.outcome !== "deleted" || !row.notice_email) continue;
      const result = await sendAccountNoticeEmail({
        to: row.notice_email,
        name: row.notice_name,
        title: "Your SafeDrive account was deleted",
        message:
          "The date you chose for deleting your account has passed, so SafeDrive erased your personal details and identity documents and closed your login. Bookings and payments you took part in are kept without your identity, as the Privacy Policy describes. You can create a new account with the same email address at any time.",
        actionLabel: "Visit SafeDrive",
        path: "/",
        baseOrigin,
        eventKey: `account-deleted:${row.account_id}`,
      });
      if (result.state === "sent") noticesSent += 1;
    }

    const { data: unclosed, error: unclosedError } = await supabase
      .from("profiles")
      .select("id")
      .not("deleted_at", "is", null)
      .is("login_closed_at", null)
      .limit(LOGIN_CLOSURE_BATCH);
    if (unclosedError) {
      return jsonResponse({ error: unclosedError.message }, 500);
    }

    let loginsClosed = 0;
    let loginsFailed = 0;
    for (const account of (unclosed ?? []) as Array<{ id: string }>) {
      if (await closeDeletedAccountLogin(supabase, account.id)) loginsClosed += 1;
      else loginsFailed += 1;
    }

    return jsonResponse({
      success: true,
      deleted: rows.filter((row) => row.outcome === "deleted").length,
      waiting: rows.filter((row) => row.outcome === "waiting").length,
      cleared: rows.filter((row) => row.outcome === "cleared").length,
      noticesSent,
      loginsClosed,
      loginsFailed,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Account deletion run failed",
      },
      500,
    );
  }
}
