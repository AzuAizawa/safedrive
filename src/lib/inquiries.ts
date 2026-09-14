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

export type InquiryField = "name" | "email" | "topic" | "message";

export const INQUIRY_MESSAGE_MIN_LENGTH = 10;

/**
 * Every problem with an inquiry before it is sent, in form order - shown in
 * red on each field at once, instead of a Submit button that stayed disabled
 * without saying why.
 */
export const validateInquiryForm = (input: {
  name: string;
  email: string;
  topics: string[];
  message: string;
}): { field: InquiryField; message: string }[] => {
  const errors: { field: InquiryField; message: string }[] = [];
  if (input.name.trim().length < 2) errors.push({ field: "name", message: "Enter your name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.push({ field: "email", message: "Enter a valid email address." });
  }
  if (input.topics.filter(Boolean).length === 0) {
    errors.push({ field: "topic", message: "Select an inquiry topic first." });
  }
  if (input.message.trim().length < INQUIRY_MESSAGE_MIN_LENGTH) {
    errors.push({
      field: "message",
      message: `Write your question - at least ${INQUIRY_MESSAGE_MIN_LENGTH} characters.`,
    });
  }
  return errors;
};

export const getInquiryStatusClasses = (status: string) =>
  INQUIRY_CLOSED_STATUSES.includes(status)
    ? "bg-green-500/10 text-green-700 dark:text-green-300"
    : status === "in_progress"
      ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
      : "bg-amber-500/10 text-amber-700 dark:text-amber-300";
