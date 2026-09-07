type Portal = "user" | "admin";

type PendingAuthState = {
  email: string;
  step: "otp";
  codeMethod: "email" | "authenticator";
  authFactorId?: string;
  authChallengeId?: string;
  otpSentAt?: number;
  otpExpiresAt?: number;
};

const USER_AUTH_PENDING_KEY = "user_auth_pending";
const ADMIN_AUTH_PENDING_KEY = "admin_auth_pending";

// Deliberately localStorage, not sessionStorage. The Supabase session this
// flag is meant to gate (signInWithPassword() already writes a full,
// usable session the instant the password is correct - the 2FA step is
// enforced entirely by this app's own client-side check, not by Supabase
// withholding the session) lives in localStorage, which is shared across
// every tab/window/installed-PWA instance on the same origin.
// sessionStorage is scoped to a single tab - a login left sitting at "enter
// your code" in one tab, then opened in a second tab or a separately
// launched PWA icon, would see the valid session with no memory that 2FA
// was never finished, and sign straight in. UserRoute.tsx/AdminRoute.tsx's
// isUserAuthPending()/isAdminAuthPending() checks need this flag visible
// from any such context to force the sign-out they already correctly do.
const canUseLocalStorage = () => typeof window !== "undefined";

const getKey = (portal: Portal) =>
  portal === "admin" ? ADMIN_AUTH_PENDING_KEY : USER_AUTH_PENDING_KEY;

const writePendingState = (portal: Portal, value: PendingAuthState | null) => {
  if (!canUseLocalStorage()) return;

  const key = getKey(portal);
  if (!value) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
};

const readPendingState = (portal: Portal): PendingAuthState | null => {
  if (!canUseLocalStorage()) return null;

  const rawValue = window.localStorage.getItem(getKey(portal));
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as Partial<PendingAuthState>;
    if (
      parsed &&
      parsed.step === "otp" &&
      typeof parsed.email === "string" &&
      (parsed.codeMethod === "email" || parsed.codeMethod === "authenticator")
    ) {
      return {
        email: parsed.email,
        step: "otp",
        codeMethod: parsed.codeMethod,
        authFactorId: parsed.authFactorId,
        authChallengeId: parsed.authChallengeId,
        otpSentAt:
          typeof parsed.otpSentAt === "number" ? parsed.otpSentAt : undefined,
        otpExpiresAt:
          typeof parsed.otpExpiresAt === "number"
            ? parsed.otpExpiresAt
            : undefined,
      };
    }
  } catch {
    window.localStorage.removeItem(getKey(portal));
  }

  return null;
};

export const setUserAuthPendingState = (value: PendingAuthState) =>
  writePendingState("user", value);

export const getUserAuthPendingState = () => readPendingState("user");

export const setAdminAuthPendingState = (value: PendingAuthState) =>
  writePendingState("admin", value);

export const getAdminAuthPendingState = () => readPendingState("admin");

export const markUserAuthPending = () => {
  const current = getUserAuthPendingState();
  writePendingState("user", current ?? {
    email: "",
    step: "otp",
    codeMethod: "email",
  });
};

export const clearUserAuthPending = () => {
  writePendingState("user", null);
};

export const isUserAuthPending = () => Boolean(readPendingState("user"));

export const markAdminAuthPending = () => {
  const current = getAdminAuthPendingState();
  writePendingState("admin", current ?? {
    email: "",
    step: "otp",
    codeMethod: "email",
  });
};

export const clearAdminAuthPending = () => {
  writePendingState("admin", null);
};

export const isAdminAuthPending = () => Boolean(readPendingState("admin"));

export const clearAllAuthPending = () => {
  clearUserAuthPending();
  clearAdminAuthPending();
};
