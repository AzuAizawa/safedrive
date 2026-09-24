import { useCallback, useEffect, useId, useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { isInquiryClosed } from "@/lib/inquiries";
import { supabase } from "@/lib/supabase";
import { fetchGuestInquiries, type GuestInquirySummary } from "@/lib/guestInquiryStore";
import type { GuestInquiry } from "@/types/database";

type ThreadMessage = GuestInquirySummary["messages"][number];

// How often a visitor without an account re-checks for a reply. They have no
// session, so the live channel (RLS by account) cannot reach them.
const GUEST_POLL_MS = 20_000;

type InquiryThreadProps = {
  inquiry: Pick<GuestInquiry, "id" | "status">;
  /** Set for an inquiry this browser sent without an account (CHAPTER 107). */
  guestToken?: string | null;
  /** Called after a follow-up is sent, so the caller can refresh the inquiry's status. */
  onFollowUpSent?: () => void | Promise<void>;
  className?: string;
};

// One inquiry's conversation with SafeDrive: its messages, live, and a
// follow-up box while it is open. The Inquiry widget and Support & Chats both
// show this, so the two can never tell a different story.
export default function InquiryThread({ inquiry, guestToken = null, onFollowUpSent, className = "" }: InquiryThreadProps) {
  const { session } = useAuth();
  const channelSuffix = useId();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const closed = isInquiryClosed(inquiry);

  const fetchMessages = useCallback(async () => {
    if (guestToken) {
      const [thread] = await fetchGuestInquiries([{ id: inquiry.id, token: guestToken }]);
      if (thread) setMessages(thread.messages);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("guest_inquiry_messages")
      .select("*")
      .eq("inquiry_id", inquiry.id)
      .order("created_at", { ascending: true });
    if (!error) setMessages((data ?? []) as ThreadMessage[]);
    setLoading(false);
  }, [inquiry.id, guestToken]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setDraft("");
    void fetchMessages();
    if (guestToken) {
      const timer = window.setInterval(() => void fetchMessages(), GUEST_POLL_MS);
      return () => window.clearInterval(timer);
    }
    const channel = supabase
      .channel(`inquiry-thread-${inquiry.id}-${channelSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "guest_inquiry_messages",
          filter: `inquiry_id=eq.${inquiry.id}`,
        },
        () => void fetchMessages(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [inquiry.id, channelSuffix, fetchMessages, guestToken]);

  const sendFollowUp = async () => {
    if (!draft.trim() || (!session?.access_token && !guestToken) || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/inquiry-followup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(guestToken ? {} : { Authorization: `Bearer ${session!.access_token}` }),
        },
        body: JSON.stringify({ inquiryId: inquiry.id, message: draft.trim(), ...(guestToken ? { guestToken } : {}) }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "Follow-up was not sent");
      setDraft("");
      await fetchMessages();
      await onFollowUpSent?.();
    } catch (error) {
      toast.error("Follow-up failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`flex flex-col ${className}`}>
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {messages.map((message) => {
            const mine = message.sender_role === "inquirer";
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.message}</p>
                  <p
                    className={`mt-1 text-[10px] ${
                      mine ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {mine ? "You" : "SafeDrive"} · {format(new Date(message.created_at), "MMM d, h:mm a")}
                  </p>
                </div>
              </div>
            );
          })}
          {messages.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No messages in this thread yet.
            </p>
          )}
        </div>
      )}

      {closed ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4" /> This inquiry is resolved. Ask a new question to start again.
        </p>
      ) : (
        <div className="mt-4 flex items-end gap-2">
          <textarea
            className="min-h-11 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={2}
            maxLength={3000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a follow-up..."
          />
          <Button
            className="gap-1"
            onClick={() => void sendFollowUp()}
            disabled={sending || !draft.trim()}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
