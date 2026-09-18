// The period the Earnings & Insights page is showing.
//
// One range drives the whole page - the three totals, the monthly chart and the
// CSV export - so the figures can never describe different spans of time. The
// range is a Manila calendar range, because that is how the books are kept.
//
// Kept free of the Supabase client so the date arithmetic is proved on its own
// in scripts/process-logic.test.mjs.

export type EarningsPeriod = "month" | "year" | "all" | "custom";

export type PeriodRange = { from: string; to: string };

/** Today as a Manila calendar day, `YYYY-MM-DD`. */
export const manilaToday = (now: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);

/** The Manila calendar month a timestamp falls in, `YYYY-MM`. */
export const manilaMonthOf = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return manilaToday(parsed).slice(0, 7);
};

// The earliest date the page will ask for. SafeDrive has no records before this,
// and an open-ended range still needs two ends so every path is the same shape.
const EPOCH = "2000-01-01";

/**
 * The range a named period covers, ending today.
 *
 * "This year" is the default when the page opens: month-to-date is nearly empty
 * on the first of a month and reads as broken, while all-time keeps growing and
 * stops answering "how are we doing now". Year-to-date always has something in
 * it, fits the twelve bars of the chart, and matches the annual cycle the books
 * are filed on.
 */
export const periodRange = (
  period: EarningsPeriod,
  custom: PeriodRange,
  now: Date = new Date(),
): PeriodRange => {
  const today = manilaToday(now);
  if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (period === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (period === "all") return { from: EPOCH, to: today };
  // A half-filled custom range would silently widen to everything, so the
  // missing end falls back to the same bounds the named periods use.
  return { from: custom.from || EPOCH, to: custom.to || today };
};

export const PERIOD_LABELS: Record<EarningsPeriod, string> = {
  month: "This month",
  year: "This year",
  all: "All time",
  custom: "Custom range",
};

/** What the totals are counting, said in words under the figures. */
export const describeRange = (period: EarningsPeriod, range: PeriodRange) => {
  if (period === "all") return "All time, every record on file";
  if (period === "month") return `This month so far (${range.from} to ${range.to})`;
  if (period === "year") return `This year so far (${range.from} to ${range.to})`;
  return `${range.from} to ${range.to}`;
};

/**
 * Whether a timestamp falls inside the range, compared as Manila calendar days
 * so a booking at 8am Manila on the last day of the range is not pushed out by
 * the browser's own zone.
 */
export const isWithinRange = (value: string | null | undefined, range: PeriodRange) => {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const day = manilaToday(parsed);
  return day >= range.from && day <= range.to;
};

/**
 * A date-only column (`start_date`, `paid_at` written as a date) is already a
 * calendar day, so it is compared as text rather than re-interpreted as an
 * instant in the browser's zone.
 */
export const isDayWithinRange = (value: string | null | undefined, range: PeriodRange) => {
  if (!value) return false;
  const day = value.slice(0, 10);
  return day >= range.from && day <= range.to;
};
