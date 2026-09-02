type Portal = "user" | "admin";

type AuthLockoutState = {
  failedAttempts: number;
  lastFailedAt: number;
  lockedUntil: number;
};

const RESET_AFTER_MS = 24 * 60 * 60 * 1000;
const ATTEMPTS_PER_BLOCK = 5;
const LOCKOUT_MINUTES_STEP = 5;

const canUseLocalStorage = () => typeof window !== "undefined";

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const getKey = (portal: Portal, email: string) =>
  `auth_lockout:${portal}:${normalizeEmail(email)}`;

const emptyState: AuthLockoutState = {
  failedAttempts: 0,
  lastFailedAt: 0,
  lockedUntil: 0,
};

const readState = (portal: Portal, email: string): AuthLockoutState => {
  if (!canUseLocalStorage() || !normalizeEmail(email)) return emptyState;

  const rawValue = window.localStorage.getItem(getKey(portal, email));
  if (!rawValue) return emptyState;

  try {
    const parsed = JSON.parse(rawValue) as Partial<AuthLockoutState>;
    return {
      failedAttempts:
        typeof parsed.failedAttempts === "number" ? parsed.failedAttempts : 0,
      lastFailedAt:
        typeof parsed.lastFailedAt === "number" ? parsed.lastFailedAt : 0,
      lockedUntil:
        typeof parsed.lockedUntil === "number" ? parsed.lockedUntil : 0,
    };
  } catch {
    return emptyState;
  }
};

const writeState = (portal: Portal, email: string, state: AuthLockoutState) => {
  if (!canUseLocalStorage() || !normalizeEmail(email)) return;
  window.localStorage.setItem(getKey(portal, email), JSON.stringify(state));
};

const normalizeState = (state: AuthLockoutState, now = Date.now()) => {
  if (!state.lastFailedAt) return emptyState;
  if (now - state.lastFailedAt >= RESET_AFTER_MS) return emptyState;
  return state;
};

const getLockoutDurationMinutes = (failedAttempts: number) =>
  Math.floor(failedAttempts / ATTEMPTS_PER_BLOCK) * LOCKOUT_MINUTES_STEP;

export const getAuthLockoutState = (portal: Portal, email: string) => {
  const now = Date.now();
  const currentState = normalizeState(readState(portal, email), now);

  if (currentState.lockedUntil && currentState.lockedUntil <= now) {
    const unlockedState = { ...currentState, lockedUntil: 0 };
    writeState(portal, email, unlockedState);
    return {
      ...unlockedState,
      isLocked: false,
      remainingMs: 0,
      nextLockoutMinutes:
        getLockoutDurationMinutes(unlockedState.failedAttempts + 1) || 0,
    };
  }

  return {
    ...currentState,
    isLocked: currentState.lockedUntil > now,
    remainingMs: Math.max(currentState.lockedUntil - now, 0),
    nextLockoutMinutes:
      getLockoutDurationMinutes(currentState.failedAttempts + 1) || 0,
  };
};

export const registerAuthFailure = (portal: Portal, email: string) => {
  const now = Date.now();
  const currentState = normalizeState(readState(portal, email), now);
  const failedAttempts = currentState.failedAttempts + 1;
  const lockoutMinutes = getLockoutDurationMinutes(failedAttempts);
  const nextState: AuthLockoutState = {
    failedAttempts,
    lastFailedAt: now,
    lockedUntil:
      failedAttempts % ATTEMPTS_PER_BLOCK === 0
        ? now + lockoutMinutes * 60 * 1000
        : currentState.lockedUntil > now
          ? currentState.lockedUntil
          : 0,
  };

  writeState(portal, email, nextState);

  return {
    ...nextState,
    isLocked: nextState.lockedUntil > now,
    remainingMs: Math.max(nextState.lockedUntil - now, 0),
    lockoutMinutes:
      failedAttempts % ATTEMPTS_PER_BLOCK === 0 ? lockoutMinutes : 0,
  };
};

export const clearAuthFailures = (portal: Portal, email: string) => {
  if (!canUseLocalStorage() || !normalizeEmail(email)) return;
  window.localStorage.removeItem(getKey(portal, email));
};

export const formatLockoutRemaining = (remainingMs: number) => {
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
};
