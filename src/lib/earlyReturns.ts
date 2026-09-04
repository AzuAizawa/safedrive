import type { Database } from "@/types/database";

export type EarlyReturnRow =
  Database["public"]["Tables"]["booking_early_returns"]["Row"];

export type EarlyReturnAction = "request" | "approve" | "reject" | "cancel";

export const earlyReturnStatusLabel = (status: string) => {
  switch (status) {
    case "pending":
      return "Waiting for the lister's decision";
    case "approved":
      return "Approved — the return date was moved earlier";
    case "rejected":
      return "Declined — the original return date stands";
    case "cancelled":
      return "Withdrawn by the renter";
    case "expired":
      return "Expired without a decision";
    default:
      return status;
  }
};

export const earlyReturnTone = (status: string) => {
  switch (status) {
    case "approved":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "rejected":
    case "expired":
      return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300";
    case "cancelled":
      return "border-border/60 bg-muted/20 text-muted-foreground";
    default:
      return "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
};

/** The most recent early-return row for a booking, or undefined. */
export const latestEarlyReturn = (rows: EarlyReturnRow[] | undefined) =>
  rows && rows.length > 0
    ? [...rows].sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      )[0]
    : undefined;

export const runEarlyReturnAction = async (
  accessToken: string | undefined,
  body: Record<string, unknown>,
) => {
  const res = await fetch("/api/booking-early-return-action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Early-return action failed");
  return data;
};
