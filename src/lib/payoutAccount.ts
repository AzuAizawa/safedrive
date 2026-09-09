// Where a lister can be paid, and what a valid account number looks like for
// each destination.
//
// The account number is not decoration: server/payoutAutomation.ts hands it
// straight to PayMongo as the disbursement target. Until this module existed
// the only rule was "digits, at most 16" (in the form and in the
// profiles_payout_account_number_check constraint, which allowed {0,16}), so a
// lister could save "00" and the payout would be sent to "00".
//
// server/payoutAccount.ts carries the same rules for the payout path, which
// cannot import from src/. scripts/process-logic.test.mjs loads both and
// asserts they agree, so the two copies cannot drift apart silently.

export type PayoutMethod = "GCash" | "Maya" | "BPI";

export type PayoutMethodRule = {
  value: PayoutMethod;
  label: string;
  /** Inclusive digit count. min === max means an exact length. */
  minLength: number;
  maxLength: number;
  /** Required leading digits, if the destination has a fixed prefix. */
  prefix?: string;
  /** Shown under the field so the lister knows the shape before typing. */
  hint: string;
};

export const PAYOUT_METHOD_RULES: PayoutMethodRule[] = [
  // A Philippine mobile wallet number is a mobile number: 09 plus nine digits,
  // never longer, never shorter.
  { value: "GCash", label: "GCash", minLength: 11, maxLength: 11, prefix: "09", hint: "11 digits starting with 09" },
  { value: "Maya", label: "Maya", minLength: 11, maxLength: 11, prefix: "09", hint: "11 digits starting with 09" },
  // Bank account numbers have no single national length; 10-16 covers the
  // formats in use.
  { value: "BPI", label: "BPI", minLength: 10, maxLength: 16, hint: "10 to 16 digits" },
];

/** The widest maxLength, used to cap the input before a method is known. */
export const PAYOUT_ACCOUNT_NUMBER_MAX_LENGTH = PAYOUT_METHOD_RULES.reduce(
  (widest, rule) => Math.max(widest, rule.maxLength),
  0,
);

export const getPayoutMethodRule = (method?: string | null): PayoutMethodRule | null =>
  PAYOUT_METHOD_RULES.find((rule) => rule.value === method) ?? null;

export const isSupportedPayoutMethod = (method?: string | null): method is PayoutMethod =>
  getPayoutMethodRule(method) !== null;

/** Digits only, capped to what the chosen destination can hold. */
export const sanitizePayoutAccountNumber = (value: string, method?: string | null) => {
  const rule = getPayoutMethodRule(method);
  return value
    .replace(/[^\d]/g, "")
    .slice(0, rule?.maxLength ?? PAYOUT_ACCOUNT_NUMBER_MAX_LENGTH);
};

/** Null when the number is usable as a payout target, otherwise why not. */
export const getPayoutAccountNumberError = (
  method: string | null | undefined,
  value: string | null | undefined,
): string | null => {
  const rule = getPayoutMethodRule(method);
  if (!rule) return "Choose a payout destination first.";

  const digits = (value ?? "").trim();
  if (!digits) return "Account number is required.";
  if (!/^\d+$/.test(digits)) return "Use digits only, with no spaces or dashes.";
  if (rule.prefix && !digits.startsWith(rule.prefix)) {
    return `A ${rule.label} number starts with ${rule.prefix}.`;
  }
  if (rule.minLength === rule.maxLength) {
    if (digits.length !== rule.minLength) {
      return `A ${rule.label} number is exactly ${rule.minLength} digits.`;
    }
    return null;
  }
  if (digits.length < rule.minLength || digits.length > rule.maxLength) {
    return `A ${rule.label} account number is ${rule.minLength} to ${rule.maxLength} digits.`;
  }
  return null;
};

export const isValidPayoutAccountNumber = (
  method: string | null | undefined,
  value: string | null | undefined,
) => getPayoutAccountNumberError(method, value) === null;
