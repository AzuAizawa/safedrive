// Shared 30-minute time-of-day picklist, extracted from CarDetailPage.tsx
// (originally added there to replace a native <input type="time"> - a
// reported renter saw its collapsed display as if a time were already
// fixed, a known cross-browser pitfall of that input type). Now also used
// by the early-return request form and its lister-side approval display,
// so it lives here rather than being duplicated a third time.
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours24 = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? "00" : "30";
  const value = `${hours24.toString().padStart(2, "0")}:${minutes}`;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  const label = `${hours12}:${minutes} ${period}`;
  return { value, label };
});

export const formatTimeLabel = (value: string | null | undefined) =>
  TIME_OPTIONS.find((option) => option.value === value)?.label ?? "";

// The list above is chosen through src/components/TimePicker.tsx as three
// columns - hour, minute, AM/PM - instead of one 48-row list, where 5:00 PM was
// a 34-row scroll. The rules for those columns live here so they can be tested
// without a browser.
export type TimeParts = { hour: number; minute: string; period: "AM" | "PM" };

export const TIME_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
export const TIME_MINUTES = ["00", "30"] as const;
export const TIME_PERIODS = ["AM", "PM"] as const;

export const splitTimeValue = (value: string | null | undefined): TimeParts | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hours24 = Number(match[1]);
  if (hours24 > 23) return null;
  return {
    hour: hours24 % 12 || 12,
    minute: match[2],
    period: hours24 >= 12 ? "PM" : "AM",
  };
};

type TimeOption = { value: string };

const toParts = (allowed: readonly TimeOption[]) =>
  allowed.flatMap((option) => {
    const parts = splitTimeValue(option.value);
    return parts ? [{ ...parts, value: option.value }] : [];
  });

/**
 * The allowed time a click lands on. The part clicked always wins; the rest of
 * the current time is kept where an allowed time still has it - changing the
 * hour keeps AM/PM first, changing minute or AM/PM keeps the hour first - and
 * otherwise the earliest allowed time is used. Never returns a time outside
 * `allowed`; null when nothing there has the clicked part.
 */
export const pickTimeValue = (
  allowed: readonly TimeOption[],
  current: string | null | undefined,
  change: Partial<TimeParts>,
): string | null => {
  const wanted: Partial<TimeParts> = { ...splitTimeValue(current), ...change };
  const changed = (Object.keys(change) as (keyof TimeParts)[]).filter(
    (key) => change[key] !== undefined,
  );
  const keep: (keyof TimeParts)[] =
    change.hour !== undefined
      ? ["period", "minute"]
      : ["hour", change.minute !== undefined ? "period" : "minute"];

  const candidates = toParts(allowed);
  for (const keys of [[...changed, ...keep], [...changed, keep[0]], changed]) {
    const hit = candidates.find((candidate) =>
      keys.every((key) => wanted[key] === undefined || candidate[key] === wanted[key]),
    );
    if (hit) return hit.value;
  }
  return null;
};

/**
 * Whether a column entry can be clicked. Any hour that exists in `allowed` can;
 * a minute or AM/PM only if it exists for the hour already chosen.
 */
export const isTimePartAvailable = (
  allowed: readonly TimeOption[],
  current: string | null | undefined,
  part: Partial<TimeParts>,
): boolean => {
  const now = splitTimeValue(current);
  return toParts(allowed).some(
    (candidate) =>
      (part.hour === undefined || candidate.hour === part.hour) &&
      (part.minute === undefined || candidate.minute === part.minute) &&
      (part.period === undefined || candidate.period === part.period) &&
      (part.hour !== undefined || !now || candidate.hour === now.hour),
  );
};
