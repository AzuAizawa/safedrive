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

const canUseSessionStorage = () => typeof window !== "undefined";

const getKey = (portal: Portal) =>
  portal === "admin" ? ADMIN_AUTH_PENDING_KEY : USER_AUTH_PENDING_KEY;

const writePendingState = (portal: Portal, value: PendingAuthState | null) => {
  if (!canUseSessionStorage()) return;

  const key = getKey(portal);
  if (!value) {
    window.sessionStorage.removeItem(key);
    return;
  }

  window.sessionStorage.setItem(key, JSON.stringify(value));
};

const readPendingState = (portal: Portal): PendingAuthState | null => {
  if (!canUseSessionStorage()) return null;

  const rawValue = window.sessionStorage.getItem(getKey(portal));
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
    window.sessionStorage.removeItem(getKey(portal));
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
