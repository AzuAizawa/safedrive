// Dormant-account measurement for the admin Users tab (Chapter 58).
// Deliberately its own small helper rather than reusing src/lib/queueAge.ts
// - that one is hour-scale (12/24/48h thresholds) for operational queues;
// this is months/years-scale account inactivity, a different shape
// entirely.

export type DormancySeverity = "normal" | "approaching" | "dormant";

export interface DormancyProfile {
  active_session_started_at: string | null;
  created_at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// "Last active" is the most recent fully-completed login
// (active_session_started_at, Chapter 57), falling back to created_at for
// an account that has never logged in since that column existed.
export const daysSinceActive = (
  profile: DormancyProfile,
  now: number = Date.now(),
): number => {
  const lastActive = profile.active_session_started_at ?? profile.created_at;
  const lastActiveMs = new Date(lastActive).getTime();
  if (!Number.isFinite(lastActiveMs)) return 0;
  return Math.max(0, Math.floor((now - lastActiveMs) / DAY_MS));
};

export const formatDormancy = (days: number): string => {
  if (days < 1) return "Active today";
  if (days < 30) return `Active ${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `Inactive for ${months} month${months === 1 ? "" : "s"}`;
  }

  const years = Math.floor(months / 12);
  const remainderMonths = months % 12;
  const yearPart = `${years} year${years === 1 ? "" : "s"}`;
  return remainderMonths > 0
    ? `Inactive for ${yearPart} ${remainderMonths} month${remainderMonths === 1 ? "" : "s"}`
    : `Inactive for ${yearPart}`;
};

// "approaching" starts at 75% of the configured threshold so an admin has
// advance warning before the daily flagging job would file a request.
export const getDormancySeverity = (
  days: number,
  thresholdDays: number,
): DormancySeverity => {
  if (thresholdDays <= 0) return "normal";
  const ratio = days / thresholdDays;
  if (ratio >= 1) return "dormant";
  if (ratio >= 0.75) return "approaching";
  return "normal";
};

export const dormancySeverityClasses: Record<DormancySeverity, string> = {
  normal: "border-border bg-muted/30 text-muted-foreground",
  approaching:
    "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  dormant: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};
