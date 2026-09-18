// What the admin Insights sections say, worked out from records SafeDrive
// already keeps. No tracking and no new collection: cancellations, refunds and
// the work queues are counted where they already sit.
//
// Kept free of the Supabase client so the counting is proved on its own in
// scripts/process-logic.test.mjs.

import { classifyManualRefund, MANUAL_REFUND_KINDS } from "./refundDecision";

export type CountedSlice = { key: string; label: string; count: number };

/** Highest count first, then alphabetically so equal counts do not jump around. */
const rank = (slices: CountedSlice[]) =>
  [...slices].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

const humanize = (value: string) =>
  value.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());

export type CancellationRow = {
  cancelled_by_role: string;
  reason: string | null;
  was_late?: boolean | null;
};

const ROLE_LABELS: Record<string, string> = {
  renter: "Cancelled by the renter",
  lister: "Cancelled by the lister",
  both: "Counted against both sides",
};

/**
 * Who cancels, and why. The question behind it is whether cancellations come
 * from one side - a lister who accepts and then backs out costs a renter their
 * trip, and that is a moderation problem, not a statistic.
 */
export const summarizeCancellations = (rows: CancellationRow[]) => {
  const roles = new Map<string, number>();
  const reasons = new Map<string, number>();
  let late = 0;

  for (const row of rows) {
    const role = String(row.cancelled_by_role || "unknown");
    roles.set(role, (roles.get(role) ?? 0) + 1);
    const reason = (row.reason || "not given").trim() || "not given";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    if (row.was_late) late += 1;
  }

  return {
    total: rows.length,
    late,
    byRole: rank(
      Array.from(roles, ([key, count]) => ({ key, label: ROLE_LABELS[key] ?? humanize(key), count })),
    ),
    byReason: rank(
      Array.from(reasons, ([key, count]) => ({ key, label: humanize(key), count })),
    ),
  };
};

export type RefundRow = {
  notes: string | null;
  payment_method: string | null;
};

const PROVIDER_SLICE = { key: "provider_refund", label: "Automatic PayMongo refund" };
const LISTER_CANCELLED_SLICE = {
  key: "lister_cancelled",
  label: "Lister cancelled the booking",
};
// A refund released before the release note kept its original context behind it
// (api/mark-manual-refund.ts). Saying so is honest; filing it under "Manual
// review" would suggest a judgement call nobody can check any more.
const UNRECORDED_SLICE = { key: "reason_not_recorded", label: "Released, reason not recorded" };

/**
 * What refunds were actually for, using the same classification the Refund
 * Review dialog shows a super admin (server/refundDecision.ts). A month of
 * "Claim: no car at pickup" is a lister problem; a month of "Cancellation fee"
 * is policy working as written.
 */
export const summarizeRefundKinds = (rows: RefundRow[]) => {
  const kinds = new Map<string, { label: string; count: number }>();

  for (const row of rows) {
    const method = row.payment_method?.toLowerCase() ?? "";
    const text = (row.notes ?? "").toLowerCase();
    // A provider refund carries no review note to classify, so it is its own
    // slice rather than being mislabelled as a failed automatic refund.
    const slice =
      method === "paymongo"
        ? PROVIDER_SLICE
        : // An automatic refund for a booking the lister called off: the note
          // names the cause even though no review was needed.
          text.includes("lister cancelled")
          ? LISTER_CANCELLED_SLICE
          : (() => {
              const kind = classifyManualRefund(row.notes);
              // "other" here means the note carries no recognisable cause -
              // for a released refund that is a lost reason, not a judgement.
              if (kind === "other") {
                return text.includes("released by super admin") ||
                  text.includes("settled by super admin")
                  ? UNRECORDED_SLICE
                  : { key: kind, label: MANUAL_REFUND_KINDS[kind].label };
              }
              return { key: kind, label: MANUAL_REFUND_KINDS[kind].label };
            })();

    const current = kinds.get(slice.key);
    if (current) current.count += 1;
    else kinds.set(slice.key, { label: slice.label, count: 1 });
  }

  return {
    total: rows.length,
    slices: rank(Array.from(kinds, ([key, value]) => ({ key, label: value.label, count: value.count }))),
  };
};

export type QueueItemLike = { kind: string; createdAt: string };

export type QueueHealthRow = {
  key: string;
  label: string;
  count: number;
  oldestCreatedAt: string;
};

const QUEUE_LABELS: Record<string, string> = {
  profile: "Profiles to verify",
  vehicle: "Vehicles to approve",
  support: "Support needing a reply",
  guest: "User inquiries",
  refund: "Refunds to review",
  payout: "Payouts to release",
  security: "Privacy and reconciliation",
};

/**
 * How long work is actually waiting, per queue, oldest first. A count alone
 * hides the shape of the problem: five items waiting an hour is a busy day,
 * one waiting nine days is a person who was forgotten.
 */
export const summarizeQueueHealth = (items: QueueItemLike[]): QueueHealthRow[] => {
  const queues = new Map<string, { count: number; oldestCreatedAt: string }>();

  for (const item of items) {
    const stamp = new Date(item.createdAt).getTime();
    if (Number.isNaN(stamp)) continue;
    const current = queues.get(item.kind);
    if (!current) {
      queues.set(item.kind, { count: 1, oldestCreatedAt: item.createdAt });
      continue;
    }
    current.count += 1;
    if (stamp < new Date(current.oldestCreatedAt).getTime()) {
      current.oldestCreatedAt = item.createdAt;
    }
  }

  return Array.from(queues, ([key, value]) => ({
    key,
    label: QUEUE_LABELS[key] ?? humanize(key),
    count: value.count,
    oldestCreatedAt: value.oldestCreatedAt,
  })).sort(
    (left, right) =>
      new Date(left.oldestCreatedAt).getTime() - new Date(right.oldestCreatedAt).getTime(),
  );
};
