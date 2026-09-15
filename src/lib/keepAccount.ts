// CHAPTER 96: keeping an account that is scheduled for deletion.
//
// The choice is made at the password step (LoginPage) and carried out only
// after the security code - which may be finished in the same tab (code typed
// in) or in another one (the link in the code email, AuthConfirmPage).
// localStorage is shared by both. The entry is tied to the email address and
// expires, so a choice left behind can never keep an account later on its own.
const KEY = "keep_account_on_sign_in";
const LIFETIME_MS = 30 * 60 * 1000;

const normalize = (email: string) => email.trim().toLowerCase();

export const rememberKeepAccount = (email: string) => {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ email: normalize(email), until: Date.now() + LIFETIME_MS }),
    );
  } catch {
    // Storage unavailable: the holder is asked again at the next sign-in.
  }
};

export const forgetKeepAccount = () => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
};

export const wantsToKeepAccount = (email: string | null | undefined) => {
  if (!email) return false;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as { email?: unknown; until?: unknown };
    return (
      stored.email === normalize(email) &&
      typeof stored.until === "number" &&
      stored.until > Date.now()
    );
  } catch {
    return false;
  }
};

// Cancels the deletion for the signed-in holder. Already not scheduled (kept on
// another device, say) is the outcome wanted, so it is not an error.
export const keepScheduledAccount = async (accessToken: string) => {
  const response = await fetch("/api/account-deletion", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: "cancel" }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok && !/not scheduled for deletion/i.test(body.error ?? "")) {
    throw new Error(body.error || "Your account could not be kept.");
  }
};
