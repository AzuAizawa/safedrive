import { supabase } from "@/lib/supabase";

export type SupportReplyQueueItem = {
  id: string;
  subject: string;
  tag: string | null;
  created_at: string;
  waiting_since: string;
};

type OpenTicket = {
  id: string;
  subject: string;
  tag: string | null;
  created_at: string;
};

type TicketMessage = {
  ticket_id: string;
  sender_id: string;
  created_at: string;
};

export async function loadSupportTicketsNeedingAdminReply(): Promise<SupportReplyQueueItem[]> {
  const { data: tickets, error: ticketError } = await supabase
    .from("support_tickets")
    .select("id, subject, tag, created_at")
    .in("status", ["open", "in_progress"])
    .is("participant_user_id", null)
    .order("created_at", { ascending: true });
  if (ticketError) throw ticketError;
  if (!tickets?.length) return [];

  const ticketIds = tickets.map((ticket) => ticket.id);
  const { data: messages, error: messageError } = await supabase
    .from("ticket_messages")
    .select("ticket_id, sender_id, created_at")
    .in("ticket_id", ticketIds)
    .order("created_at", { ascending: true });
  if (messageError) throw messageError;

  const senderIds = [...new Set((messages ?? []).map((message) => message.sender_id))];
  const { data: senders, error: senderError } = senderIds.length
    ? await supabase.from("profiles").select("id, role").in("id", senderIds)
    : { data: [], error: null };
  if (senderError) throw senderError;

  const adminIds = new Set(
    (senders ?? [])
      .filter((profile) => ["admin", "super_admin"].includes(profile.role))
      .map((profile) => profile.id),
  );
  const messagesByTicket = new Map<string, TicketMessage[]>();
  for (const message of (messages ?? []) as TicketMessage[]) {
    const group = messagesByTicket.get(message.ticket_id) ?? [];
    group.push(message);
    messagesByTicket.set(message.ticket_id, group);
  }

  return (tickets as OpenTicket[]).flatMap((ticket) => {
    const ticketMessages = messagesByTicket.get(ticket.id) ?? [];
    const latestMessage = ticketMessages.at(-1);
    if (latestMessage && adminIds.has(latestMessage.sender_id)) return [];
    return [{ ...ticket, waiting_since: latestMessage?.created_at ?? ticket.created_at }];
  });
}
