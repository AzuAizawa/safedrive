/**
 * Opens (or reuses) the one messaging thread tied to a booking - shown as
 * "Message Lister" on the renter dashboard and "Message Renter" on the
 * lister dashboard. Reuses support_tickets/ticket_messages under the hood
 * (see api/open-booking-conversation.ts); the caller navigates to
 * /support?ticketId=<id> with the returned id to open it.
 */
export const openBookingConversation = async (
  accessToken: string | undefined,
  bookingId: string,
): Promise<string> => {
  const res = await fetch("/api/open-booking-conversation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken ?? ""}`,
    },
    body: JSON.stringify({ bookingId }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    ticketId?: string;
  };
  if (!res.ok || !data.ticketId) {
    throw new Error(data.error || "Could not open the conversation");
  }
  return data.ticketId;
};
