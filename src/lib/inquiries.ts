// How an inquiry looks to the person who asked it - in the Inquiry widget and
// in Support & Chats alike.

export const INQUIRY_CLOSED_STATUSES = ["resolved", "closed"];

export const isInquiryClosed = (inquiry: { status: string }) =>
  INQUIRY_CLOSED_STATUSES.includes(inquiry.status);

/** Waiting on SafeDrive, answered by SafeDrive, or done. */
export const getInquiryStatusLabel = (status: string) =>
  INQUIRY_CLOSED_STATUSES.includes(status)
    ? "Resolved"
    : status === "in_progress"
      ? "Replied"
      : "Waiting";

export const getInquiryStatusClasses = (status: string) =>
  INQUIRY_CLOSED_STATUSES.includes(status)
    ? "bg-green-500/10 text-green-700 dark:text-green-300"
    : status === "in_progress"
      ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
      : "bg-amber-500/10 text-amber-700 dark:text-amber-300";
