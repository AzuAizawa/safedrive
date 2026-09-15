import { createClient } from "@supabase/supabase-js";
import { sendAccountNoticeEmail } from "../server/email.js";
import { closeDeletedAccountLogin } from "../server/accountClosure.js";

export const config = { runtime: "edge" };

// CHAPTER 96. The database functions do the work and the checking; this
// handler authenticates the caller, passes their id, and does what a database
// function cannot: send the email and end or close the sign-in.
type Payload = {
  action?: "schedule" | "cancel" | "admin_delete";
  reason?: string;
  userId?: string;
  requestId?: string;
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const bearer = (req: Request) => {
  const header = req.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
};

const manilaDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "long",
    timeStyle: "short",
  });

// A Postgres exception raised on purpose is the message to show; anything else
// is logged and replaced with a general one.
const databaseMessage = (error: { message?: string } | null, fallback: string) =>
  error?.message?.trim() ? error.message : fallback;

export default async function handler(req: Request) {
  if (!["GET", "POST"].includes(req.method)) return respond({ error: "Method not allowed" }, 405);

  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = bearer(req);
    if (!url || !key) return respond({ error: "Missing Supabase server configuration" }, 503);
    if (!token) return respond({ error: "Missing authorization token" }, 401);

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return respond({ error: "Unauthorized request" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, suspended_at, deleted_at, deletion_scheduled_for")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.deleted_at) return respond({ error: "Account unavailable" }, 403);

    const baseOrigin = new URL(req.url).origin;

    if (req.method === "GET") {
      const [{ data: blockers, error: blockersError }, { data: settings }] = await Promise.all([
        supabase.rpc("account_deletion_blockers", { p_user_id: user.id }),
        supabase
          .from("platform_settings")
          .select("account_deletion_grace_days")
          .eq("id", "default")
          .maybeSingle(),
      ]);
      if (blockersError) throw blockersError;
      return respond({
        graceDays: Number(settings?.account_deletion_grace_days ?? 30),
        scheduledFor: profile.deletion_scheduled_for,
        blockers: (blockers as string[] | null) ?? [],
        suspended: Boolean(profile.suspended_at),
        canSelfDelete: profile.role === "user",
      });
    }

    const payload = (await req.json().catch(() => ({}))) as Payload;

    if (payload.action === "schedule") {
      const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 1000) : "";
      const { data, error } = await supabase.rpc("schedule_account_deletion", {
        p_user_id: user.id,
        p_reason: reason || null,
      });
      if (error) {
        return respond({ error: databaseMessage(error, "Your account could not be scheduled for deletion.") }, 409);
      }
      const scheduled = data as { scheduled_for: string; grace_days: number };
      const when = manilaDateTime(scheduled.scheduled_for);

      const email = await sendAccountNoticeEmail({
        to: profile.email,
        name: profile.full_name,
        title: `Your account will be deleted on ${when}`,
        message: `You asked SafeDrive to delete your account. It is scheduled for deletion on ${when} (Manila time). Until then it is hidden: any listings you have are off SafeDrive, and you cannot book or be booked. To keep your account, sign in before that date and choose "Keep my account". If you did not ask for this, sign in now, keep your account and change your password.`,
        actionLabel: "Sign in to keep my account",
        path: "/login",
        baseOrigin,
        eventKey: `deletion-scheduled:${user.id}:${scheduled.scheduled_for}`,
      });

      // Every device is signed out: the account is hidden now, and coming back
      // is a deliberate sign-in with the security code.
      const { error: signOutError } = await supabase.auth.admin.signOut(token, "global");
      if (signOutError) console.warn("Signing out after scheduling deletion failed", signOutError.message);

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "account_deletion_notice_attempted",
        entity_type: "profile",
        entity_id: user.id,
        details: { notice: "scheduled", delivery_state: email.state },
      });

      return respond({
        success: true,
        scheduledFor: scheduled.scheduled_for,
        graceDays: scheduled.grace_days,
        noticeEmail: email.state,
      });
    }

    if (payload.action === "cancel") {
      const { error } = await supabase.rpc("cancel_account_deletion", { p_user_id: user.id });
      if (error) {
        return respond({ error: databaseMessage(error, "The deletion could not be cancelled.") }, 409);
      }
      const email = await sendAccountNoticeEmail({
        to: profile.email,
        name: profile.full_name,
        title: "Your account will not be deleted",
        message:
          "You signed in and kept your SafeDrive account, so its scheduled deletion was cancelled. Any listings you have are visible again. If this was not you, change your password now.",
        actionLabel: "Open SafeDrive",
        path: "/browse",
        baseOrigin,
        eventKey: `deletion-cancelled:${user.id}:${profile.deletion_scheduled_for ?? "none"}`,
      });
      return respond({ success: true, noticeEmail: email.state });
    }

    if (payload.action === "admin_delete") {
      if (profile.role !== "super_admin") {
        return respond({ error: "Only a super admin can delete another account" }, 403);
      }
      const targetId = String(payload.userId ?? "").trim();
      const reason = String(payload.reason ?? "").trim();
      const requestId = String(payload.requestId ?? "").trim() || null;
      if (!targetId) return respond({ error: "Choose the account to delete" }, 400);
      if (reason.length < 10 || reason.length > 1000) {
        return respond({ error: "Give a reason of 10 to 1,000 characters; the person is sent it" }, 400);
      }

      const { data: target } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, deleted_at, deletion_request_id")
        .eq("id", targetId)
        .maybeSingle();
      if (!target) return respond({ error: "Account not found" }, 404);
      if (target.deleted_at) return respond({ error: "This account is already deleted" }, 409);

      // Read before anonymize_user erases it: the notice still has to reach them.
      const noticeTo = target.email as string;
      const noticeName = (target.full_name as string | null) ?? null;
      const selfServiceRequestId = (target.deletion_request_id as string | null) ?? null;

      const { data: report, error } = await supabase.rpc("anonymize_user", {
        p_user_id: targetId,
        p_request_id: requestId,
      });
      if (error) {
        return respond({ error: databaseMessage(error, "The account could not be deleted.") }, 409);
      }

      // The member had already scheduled their own deletion, and an admin
      // carried it out early: close that request too, or it would wait in
      // Privacy Requests forever for a run that no longer has anything to do.
      if (selfServiceRequestId && selfServiceRequestId !== requestId) {
        const now = new Date().toISOString();
        await supabase
          .from("data_retention_requests")
          .update({
            status: "executed",
            completed_at: now,
            legal_hold_reason: null,
            decision_reason: `Self-service deletion carried out early by a super admin. Reason: ${reason}`,
            updated_at: now,
          })
          .eq("id", selfServiceRequestId)
          .in("status", ["submitted", "identity_check", "under_review", "approved", "legal_hold"]);
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "admin_account_deleted_with_notice",
        entity_type: "profile",
        entity_id: targetId,
        details: { reason, request_id: requestId, self_service_request_id: selfServiceRequestId },
      });

      const email = await sendAccountNoticeEmail({
        to: noticeTo,
        name: noticeName,
        title: "Your SafeDrive account was deleted",
        message: `SafeDrive deleted your account. Reason: ${reason.replace(/\.+$/, "")}. Your personal details and identity documents were erased and your login was closed. Bookings and payments you took part in are kept without your identity, as the Privacy Policy describes. If you believe this is a mistake, contact SafeDrive through the website.`,
        actionLabel: "Visit SafeDrive",
        path: "/",
        baseOrigin,
        eventKey: `account-deleted-by-admin:${targetId}`,
      });

      const loginClosed = await closeDeletedAccountLogin(supabase, targetId);

      return respond({ success: true, report, noticeEmail: email.state, loginClosed });
    }

    return respond({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("Account deletion request failed", error);
    return respond({ error: "Account deletion request failed" }, 500);
  }
}
