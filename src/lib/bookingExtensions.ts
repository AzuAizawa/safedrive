export type BookingExtensionDisplayLike = {
  status: string;
  payment_deadline: string | null;
  paid_at?: string | null;
};

export const getExtensionDisplayStatus = (
  extension: BookingExtensionDisplayLike,
  now = new Date(),
) => {
  if (
    extension.status === "approved" &&
    !extension.paid_at &&
    extension.payment_deadline
  ) {
    const deadlineMs = new Date(extension.payment_deadline).getTime();
    if (!Number.isNaN(deadlineMs) && deadlineMs <= now.getTime()) {
      return "expired";
    }
  }

  return extension.status;
};

export const getExtensionStatusLabel = (status: string) =>
  (
    {
      pending: "Awaiting decision",
      approved: "Approved - waiting for payment",
      paid: "Paid and applied",
      rejected: "Rejected",
      cancelled: "Cancelled",
      expired: "Expired - payment window closed",
    } as Record<string, string>
  )[status] || status;

export const getExtensionTone = (status: string) => {
  if (status === "approved") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
  if (status === "paid") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "rejected") {
    return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (status === "expired") {
    return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (status === "cancelled") {
    return "border-muted bg-muted/40 text-muted-foreground";
  }
  return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
};
