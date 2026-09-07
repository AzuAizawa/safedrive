import { supabase } from "@/lib/supabase";
import { isUserAuthPending, isAdminAuthPending } from "@/lib/authPending";

// Enforces "only the most recently completed login stays active" across
// devices/browsers for the same account (CHAPTER 57). Two parts:
//
//   1. finalizeSingleSession() - called once a login is FULLY complete
//      (password + whichever 2FA step applies), on both portals. Mints a
//      fresh per-login token, saves it to this device's localStorage, writes
//      it to profiles.active_session_token (the "who's currently allowed"
//      marker), then calls supabase.auth.signOut({scope: "others"}) - a
//      native Supabase Auth feature that immediately revokes the refresh
//      token of every OTHER session for this same account at the server
//      level. That revoke is the actual security boundary; nothing else in
//      this file provides security on its own - active_session_token is
//      writable by the owning user like any other profile column, so it
//      only ever makes the good-faith case (a device that's about to be
//      told it's logged out anyway) notice sooner.
//
//   2. startSingleSessionGuard() - runs on every signed-in tab (mirrors the
//      admin_permissions poll+realtime pattern in AuthContext.tsx). Detects
//      "someone else logged in after me" by comparing this device's saved
//      token against the live profiles row, and calls back so the caller
//      can force a local sign-out with a clear message. Three triggers,
//      fastest wins: a realtime push, the tab regaining focus/visibility
//      (covers "I put the phone down and come back to it later"), and a
//      45s poll as the guaranteed backstop.
const ACTIVE_SESSION_TOKEN_KEY = "sd_active_session_token";
const GUARD_POLL_MS = 45_000;

export async function finalizeSingleSession(
  userId: string | null | undefined,
) {
  if (!userId) return;
  try {
    const token =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { error } = await supabase
      .from("profiles")
      .update({
        active_session_token: token,
        active_session_started_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (error) throw error;

    window.localStorage.setItem(ACTIVE_SESSION_TOKEN_KEY, token);

    // Revokes every OTHER session's refresh token for this account right
    // now, at the Supabase Auth level - this device keeps its own session
    // ("others" scope never touches the caller's current session).
    await supabase.auth.signOut({ scope: "others" });
  } catch (error) {
    // Never block a successful login on this - worst case, an older
    // session simply isn't kicked out this time.
    console.warn("Could not finalize single-session enforcement:", error);
  }
}

// Called from every path that ends this device's own session. Without
// this, the token written at the last successful login stays in
// localStorage forever - and on the NEXT login attempt, before
// finalizeSingleSession() has replaced it, the guard would compare that
// stale value against whichever device currently holds the account and
// wrongly conclude this tab had been superseded, force-signing out a
// login that was still mid-2FA. Clearing it means a returning device
// starts with no token at all, which the guard already treats as
// "nothing to compare, don't act" (see check() below).
export function clearLocalSessionToken() {
  try {
    window.localStorage.removeItem(ACTIVE_SESSION_TOKEN_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked site data) -
    // never let that break a sign-out.
  }
}

export function startSingleSessionGuard(
  userId: string,
  onSuperseded: () => void,
): () => void {
  let cancelled = false;
  let checking = false;

  const check = async () => {
    if (cancelled || checking) return;
    // A password-only sign-in already establishes a Supabase session (and
    // fires this guard, since AuthContext keys it off session?.user) before
    // the 2FA step this app requires has actually completed -
    // finalizeSingleSession() only runs once that finishes, so this tab's
    // OWN token is still whatever an earlier, separate login left behind.
    // Comparing that stale token while a challenge is still pending would
    // wrongly look "superseded" and sign the tab out mid-code-entry -
    // reported bug: admin login failed at the authenticator step with
    // "invalid claim: missing sub claim" because this guard force-signed
    // the in-progress session out from under it. Skip entirely until the
    // pending marker (src/lib/authPending.ts, cleared right after a
    // successful verify) is gone.
    if (isUserAuthPending() || isAdminAuthPending()) return;
    checking = true;
    try {
      const localToken = window.localStorage.getItem(
        ACTIVE_SESSION_TOKEN_KEY,
      );
      // Nothing to compare against yet on this device - never force a
      // sign-out on a null-vs-null (or null-vs-anything) non-comparison.
      if (!localToken) return;

      const { data } = await supabase
        .from("profiles")
        .select("active_session_token")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;

      const remoteToken = data?.active_session_token ?? null;
      if (remoteToken && remoteToken !== localToken) {
        onSuperseded();
      }
    } catch (error) {
      console.warn("Single-session guard check failed:", error);
    } finally {
      checking = false;
    }
  };

  void check();
  const pollId = window.setInterval(() => void check(), GUARD_POLL_MS);

  const onVisible = () => {
    if (document.visibilityState === "visible") void check();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);

  const channel = supabase
    .channel(`single-session-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${userId}`,
      },
      () => void check(),
    )
    .subscribe();

  return () => {
    cancelled = true;
    window.clearInterval(pollId);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    void supabase.removeChannel(channel);
  };
}
