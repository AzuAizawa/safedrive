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
