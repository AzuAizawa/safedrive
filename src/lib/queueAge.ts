export type QueueKind =
  | "guest"
  | "support"
  | "profile"
  | "vehicle"
  | "refund"
  | "payout"
  | "security";

export type QueueSeverity = "normal" | "warning" | "overdue" | "critical";

const HOUR_MS = 60 * 60 * 1000;

const thresholds: Record<QueueKind, [number, number, number]> = {
  guest: [12, 24, 48],
  support: [12, 24, 48],
  profile: [24, 48, 72],
  vehicle: [24, 48, 72],
  refund: [2, 4, 24],
  payout: [2, 4, 24],
  security: [0, 0, 0],
};

export function formatElapsed(from: string | Date, now = Date.now()) {
  const startedAt = from instanceof Date ? from.getTime() : new Date(from).getTime();
  if (!Number.isFinite(startedAt)) return "Unknown wait time";

  const totalMinutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function getQueueSeverity(
  createdAt: string,
  kind: QueueKind,
  now = Date.now(),
): QueueSeverity {
  if (kind === "security") return "critical";
  const elapsedHours = Math.max(0, now - new Date(createdAt).getTime()) / HOUR_MS;
  const [warningAt, overdueAt, criticalAt] = thresholds[kind];
  if (elapsedHours >= criticalAt) return "critical";
  if (elapsedHours >= overdueAt) return "overdue";
  if (elapsedHours >= warningAt) return "warning";
  return "normal";
}

export function getQueueTiming(createdAt: string, kind: QueueKind, now = Date.now()) {
  const severity = getQueueSeverity(createdAt, kind, now);
  return {
    severity,
    label: `Waiting ${formatElapsed(createdAt, now)}`,
  };
}

export const queueSeverityClasses: Record<QueueSeverity, string> = {
  normal: "border-border bg-muted/30 text-muted-foreground",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  overdue: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  critical: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};
