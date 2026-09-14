import { useCallback, useEffect, useId, useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { isInquiryClosed } from "@/lib/inquiries";
import { supabase } from "@/lib/supabase";
import type { GuestInquiry, GuestInquiryMessage } from "@/types/database";

type InquiryThreadProps = {
  inquiry: GuestInquiry;
  /** Called after a follow-up is sent, so the caller can refresh the inquiry's status. */
  onFollowUpSent?: () => void | Promise<void>;
  className?: string;
};

// One inquiry's conversation with SafeDrive: its messages, live, and a
// follow-up box while it is open. The Inquiry widget and Support & Chats both
// show this, so the two can never tell a different story.
export default function InquiryThread({ inquiry, onFollowUpSent, className = "" }: InquiryThreadProps) {
  const { session } = useAuth();
  const channelSuffix = useId();
  const [messages, setMessages] = useState<GuestInquiryMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const closed = isInquiryClosed(inquiry);

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from("guest_inquiry_messages")
      .select("*")
      .eq("inquiry_id", inquiry.id)
      .order("created_at", { ascending: true });
    if (!error) setMessages((data ?? []) as GuestInquiryMessage[]);
    setLoading(false);
  }, [inquiry.id]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setDraft("");
    void fetchMessages();
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
  }, [inquiry.id, channelSuffix, fetchMessages]);

  const sendFollowUp = async () => {
    if (!draft.trim() || !session?.access_token || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/inquiry-followup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ inquiryId: inquiry.id, message: draft.trim() }),
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
