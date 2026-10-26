// Support ticket statuses (CHAPTER 130). Kept import-free: src/lib/ticketStatus.ts
// is the same file, and scripts/ticket-status.test.mjs keeps the two equal.

export const TICKET_STATUSES = ["open", "in_progress", "waiting_for_user", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * A case that is still open. waiting_for_user is parked on the member but not
 * settled, so it still blocks a payout, still holds an account deletion, and
 * is still the ticket a new incident or refund note is added to.
 */
export const ACTIVE_TICKET_STATUSES = ["open", "in_progress", "waiting_for_user"] as const;

/**
 * The cases that hold a lister's payout (R2). An ordinary question a member
 * links to a booking does not: it cannot stop the lister being paid.
 */
export const PAYOUT_BLOCKING_TICKET_TAGS = ["booking_incident", "manual_refund"] as const;

/** Cases the system opens; only staff reopen them (R1). */
export const STAFF_ONLY_REOPEN_TAGS = PAYOUT_BLOCKING_TICKET_TAGS;

export const isActiveTicketStatus = (status: string | null | undefined) =>
  (ACTIVE_TICKET_STATUSES as readonly string[]).includes(status ?? "");

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  waiting_for_user: "Waiting for You",
  resolved: "Resolved",
  closed: "Closed",
};

/** What staff call the same status: from their side it is waiting on the user. */
export const ADMIN_TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  ...TICKET_STATUS_LABELS,
  waiting_for_user: "Waiting for User",
};

export const ticketStatusLabel = (status: string | null | undefined, audience: "member" | "admin" = "member") => {
  const labels = audience === "admin" ? ADMIN_TICKET_STATUS_LABELS : TICKET_STATUS_LABELS;
  return labels[status as TicketStatus] ?? "Open";
};

export const ticketStatusClasses = (status: string | null | undefined) => {
  switch (status) {
    case "in_progress":
      return "bg-blue-500/10 text-blue-500";
    case "waiting_for_user":
      return "bg-purple-500/10 text-purple-500";
    case "resolved":
      return "bg-green-500/10 text-green-500";
    case "closed":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-amber-500/10 text-amber-500";
  }
};

const DAY_MS = 86_400_000;

/**
 * Whether the member may reopen this ticket now: a ticket they raised, that
 * SafeDrive resolved within the last reopenDays. The database decides again
 * (reopen_support_ticket); this only decides whether to show the button.
 */
export const canMemberReopenTicket = (
  ticket: { status: string; resolved_at?: string | null; tag?: string | null; participant_user_id?: string | null },
  reopenDays: number,
  now: number = Date.now(),
) => {
  if (ticket.status !== "resolved" || ticket.participant_user_id || !ticket.resolved_at) return false;
  const tags = (ticket.tag ?? "").split(",").map((tag) => tag.trim());
  if (tags.some((tag) => (STAFF_ONLY_REOPEN_TAGS as readonly string[]).includes(tag))) return false;
  const resolvedAt = new Date(ticket.resolved_at).getTime();
  return Number.isFinite(resolvedAt) && now - resolvedAt <= reopenDays * DAY_MS;
};

/** Whole days left to reopen, for "You can reopen this for 3 more days". */
export const reopenDaysLeft = (resolvedAt: string | null | undefined, reopenDays: number, now: number = Date.now()) => {
  if (!resolvedAt) return 0;
  const left = new Date(resolvedAt).getTime() + reopenDays * DAY_MS - now;
  return left > 0 ? Math.ceil(left / DAY_MS) : 0;
};
