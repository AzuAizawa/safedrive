import { supabase } from "@/lib/supabase";
import { createPrivateStorageUrl } from "@/lib/privateStorage";

export const ticketTags = [
  { value: "general", label: "General Help" },
  { value: "inquiry", label: "Car Inquiry" },
  { value: "verification", label: "Verification" },
  { value: "booking", label: "Booking Help" },
  { value: "booking_report", label: "Report Booking" },
  { value: "no_show", label: "No-Show Report" },
  { value: "location_violation", label: "Location / Place Violation" },
  { value: "vehicle", label: "Vehicle Issue" },
  { value: "payment", label: "Payment" },
] as const;

export const ticketAttachmentBucket = "support-attachments";
const legacyTicketAttachmentBucket = "vehicle-documents";
export const ticketAttachmentAccept = ".png,.jpg,.jpeg,.webp,.pdf";

export const isTicketAttachmentImage = (mimeType?: string | null) =>
  Boolean(mimeType && mimeType.startsWith("image/"));

export const getTicketAttachmentUrl = async (storagePath?: string | null) => {
  if (!storagePath) return null;

  const privateUrl = await createPrivateStorageUrl(ticketAttachmentBucket, storagePath);
  if (privateUrl) return privateUrl;

  // Attachments created before the private bucket migration remain readable
  // from their original bucket. New uploads never use this fallback.
  return createPrivateStorageUrl(legacyTicketAttachmentBucket, storagePath);
};

export const adminTicketFilterTags = [
  { value: "all", label: "All Purposes" },
  ...ticketTags,
];

export const parseTicketTags = (value?: string | null) =>
  (value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

export const serializeTicketTags = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).join(",");

// Set on tickets by api/open-booking-conversation.ts, not offered as a
// self-selectable option in the "New Ticket" tag picker (only the server
// creates one, always alongside participant_user_id) - kept out of
// ticketTags for that reason, but still needs a readable label here.
const nonSelectableTagLabels: Record<string, string> = {
  booking_conversation: "Booking Conversation",
};

export const getTicketTagLabel = (value: string) =>
  ticketTags.find((tag) => tag.value === value)?.label ??
  nonSelectableTagLabels[value] ??
  value;

export const getTicketTagLabels = (value?: string | null) => {
  const parsed = parseTicketTags(value);
  if (parsed.length === 0) return ["General Help"];
  return parsed.map(getTicketTagLabel);
};

export const ticketMatchesTagFilter = (
  value: string | null | undefined,
  filter: string,
) => {
  if (filter === "all") return true;
  return parseTicketTags(value).includes(filter);
};

/**
 * A ticket with a `participant_user_id` is a renter <-> lister conversation
 * (opened from an active booking's "Message Lister" / "Message Renter", via
 * api/open-booking-conversation.ts), not a SafeDrive support request. The
 * two share the `support_tickets` table but are presented separately - a
 * support request is answered by SafeDrive; a conversation is between the
 * two members and SafeDrive only monitors it. A conversation ticket created
 * before this chapter (the retired pre-booking "Ask the lister") has no
 * `booking_id` and is still a conversation ticket here, just never archived.
 */
export const isConversationTicket = (ticket: {
  participant_user_id?: string | null;
}) => Boolean(ticket.participant_user_id);

export type TicketSenderKind =
  | "you"
  | "support"
  | "renter"
  | "lister"
  | "customer";

/**
 * Work out who actually sent a ticket message so the thread never mislabels a
 * lister's reply as "SafeDrive Support" (or vice versa).
 *
 * `senderRole` is the sender's `profiles.role` ('user' | 'admin' |
 * 'super_admin'); pass it from a lookup of the message senders.
 */
export function resolveTicketSender(params: {
  ticket: { user_id: string; participant_user_id?: string | null };
  senderId: string;
  currentUserId?: string | null;
  senderRole?: string | null;
  senderName?: string | null;
}): { label: string; kind: TicketSenderKind } {
  const { ticket, senderId, currentUserId, senderRole, senderName } = params;
  const name = senderName?.trim() || null;

  if (currentUserId && senderId === currentUserId) {
    return { label: "You", kind: "you" };
  }
  if (senderRole === "admin" || senderRole === "super_admin") {
    return { label: "SafeDrive Support", kind: "support" };
  }
  if (ticket.participant_user_id) {
    if (senderId === ticket.user_id) {
      return { label: name ? `${name} (Renter)` : "Renter", kind: "renter" };
    }
    if (senderId === ticket.participant_user_id) {
      return { label: name ? `${name} (Lister)` : "Lister", kind: "lister" };
    }
  }
  return { label: name ?? "Customer", kind: "customer" };
}

type SupportDraftOptions = {
  bookingId?: string;
  tag?: string | string[];
  subject?: string;
  body?: string;
};

export const buildSupportDraftPath = ({
  bookingId,
  tag,
  subject,
  body,
}: SupportDraftOptions) => {
  const params = new URLSearchParams();

  if (bookingId) params.set("bookingId", bookingId);
  if (tag) {
    const normalizedTag = Array.isArray(tag) ? tag.join(",") : tag;
    params.set("tag", normalizedTag);
  }
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);

  const query = params.toString();
  return query ? `/support?${query}` : "/support";
};

export const buildNoShowSupportPath = ({
  bookingId,
  vehicleLabel,
  missingParty,
}: {
  bookingId: string;
  vehicleLabel: string;
  missingParty: string;
}) =>
  buildSupportDraftPath({
    bookingId,
    tag: "no_show",
    subject: `No-show report: ${vehicleLabel}`,
    body: [
      "I already recorded my arrival check-in in SafeDrive.",
      "",
      "What happened:",
      "- I arrived at the agreed pickup location.",
      `- The ${missingParty} did not arrive within the 30-minute pickup window.`,
      "",
      "Please review the timestamped arrival record and any submitted evidence for this booking.",
    ].join("\n"),
  });

type NotificationInsert = {
  user_id: string;
  title: string;
  message: string;
  type: string;
  link: string;
};

export const createNotification = async ({
  user_id,
  title,
  message,
  type,
  link,
}: NotificationInsert) => {
  await supabase.from("notifications").insert({
    user_id,
    title,
    message,
    type,
    link,
  });
};

export const notifyAdministrators = async (
  title: string,
  message: string,
  link: string,
) => {
  const { data: admins, error } = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["admin", "super_admin"]);

  if (error || !admins?.length) return;

  await Promise.all(
    admins.map((admin) =>
      createNotification({
        user_id: admin.id,
        title,
        message,
        type: "support",
        link,
      }),
    ),
  );
};
