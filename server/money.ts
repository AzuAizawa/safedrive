// How every peso amount is shown: "₱1,200.00" - the peso sign, thousands
// separators, and always two decimals. server/money.ts is the same file for
// emails and API messages; scripts/money-format.test.mjs keeps the two equal.
// Kept import-free so both copies stay byte-identical.
//
// CSV exports do not use this: a spreadsheet needs a bare number ("1200.00")
// it can still add up.

const toAmount = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  // Rounded to centavos first, so -0.004 shows as ₱0.00, never "-₱0.00".
  const rounded = Math.round(parsed * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

export const formatPeso = (value: number | string | null | undefined): string => {
  const amount = toAmount(value);
  const digits = Math.abs(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "-" : ""}₱${digits}`;
};

/** Ledger and earnings figures are stored in centavos. */
export const formatPesoFromCentavos = (centavos: number | string | null | undefined): string =>
  formatPeso(Number(centavos ?? 0) / 100);
