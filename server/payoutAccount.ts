// Server-side copy of the payout account rules in src/lib/payoutAccount.ts.
//
// The form is not the last line of defence here. profiles.payout_account_number
// is written by a direct client update, and rows saved before these rules
// existed are still in the table - so the payout path has to check the number
// again before handing it to PayMongo, or a lister who saved "00" gets a
// disbursement addressed to "00".
//
// api/ and server/ cannot import from src/ (tsconfig.api.json includes only
// those two trees), hence the duplication. scripts/process-logic.test.mjs loads
// both modules and asserts they return the same verdict for the same input, so
// the copies cannot drift apart unnoticed. Change one, change the other.

export type PayoutMethod = "GCash" | "Maya" | "BPI";

export type PayoutMethodRule = {
  value: PayoutMethod;
  label: string;
  minLength: number;
  maxLength: number;
  prefix?: string;
  hint: string;
};

export const PAYOUT_METHOD_RULES: PayoutMethodRule[] = [
  { value: "GCash", label: "GCash", minLength: 11, maxLength: 11, prefix: "09", hint: "11 digits starting with 09" },
  { value: "Maya", label: "Maya", minLength: 11, maxLength: 11, prefix: "09", hint: "11 digits starting with 09" },
  { value: "BPI", label: "BPI", minLength: 10, maxLength: 16, hint: "10 to 16 digits" },
];

export const PAYOUT_ACCOUNT_NUMBER_MAX_LENGTH = PAYOUT_METHOD_RULES.reduce(
  (widest, rule) => Math.max(widest, rule.maxLength),
  0,
);

export const getPayoutMethodRule = (method?: string | null): PayoutMethodRule | null =>
  PAYOUT_METHOD_RULES.find((rule) => rule.value === method) ?? null;

export const isSupportedPayoutMethod = (method?: string | null): method is PayoutMethod =>
  getPayoutMethodRule(method) !== null;

export const sanitizePayoutAccountNumber = (value: string, method?: string | null) => {
  const rule = getPayoutMethodRule(method);
  return value
    .replace(/[^\d]/g, "")
    .slice(0, rule?.maxLength ?? PAYOUT_ACCOUNT_NUMBER_MAX_LENGTH);
};

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
