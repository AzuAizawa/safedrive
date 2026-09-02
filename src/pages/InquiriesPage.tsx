import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { format } from "date-fns";
import { CheckCircle2, Loader2, MessageSquarePlus, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { GuestInquiry, GuestInquiryMessage } from "@/types/database";

const CLOSED = ["resolved", "closed"];

export default function InquiriesPage() {
  const { user, session } = useAuth();
  const [inquiries, setInquiries] = useState<GuestInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GuestInquiryMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const fetchInquiries = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("guest_inquiries")
      .select("*")
      .eq("submitted_by_user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) toast.error("Inquiries could not be loaded", { description: error.message });
    else setInquiries((data ?? []) as GuestInquiry[]);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void fetchInquiries();
  }, [fetchInquiries]);

  const fetchMessages = useCallback(async (inquiryId: string) => {
    setMessagesLoading(true);
    const { data, error } = await supabase
      .from("guest_inquiry_messages")
      .select("*")
      .eq("inquiry_id", inquiryId)
      .order("created_at", { ascending: true });
    if (error) toast.error("Thread could not be loaded", { description: error.message });
    else setMessages((data ?? []) as GuestInquiryMessage[]);
    setMessagesLoading(false);
  }, []);

  useEffect(() => {
    if (!openId) {
      setMessages([]);
      return;
    }
    void fetchMessages(openId);
    const channel = supabase
      .channel(`inquiry-thread-${openId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "guest_inquiry_messages", filter: `inquiry_id=eq.${openId}` },
        () => void fetchMessages(openId),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [openId, fetchMessages]);

  const openInquiry = useMemo(
    () => inquiries.find((item) => item.id === openId) ?? null,
    [inquiries, openId],
  );
  const isClosed = openInquiry ? CLOSED.includes(openInquiry.status) : false;

  const sendFollowUp = async () => {
    if (!openId || !draft.trim() || !session?.access_token || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/inquiry-followup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ inquiryId: openId, message: draft.trim() }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "Follow-up was not sent");
      setDraft("");
      await fetchMessages(openId);
      await fetchInquiries();
    } catch (error) {
      toast.error("Follow-up failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Inquiries</h1>
          <p className="mt-1 text-muted-foreground">
            Questions you asked SafeDrive and the replies. Something needs fixing?{" "}
            <Link to="/support" className="underline">Open a Support Ticket</Link> instead.
          </p>
        </div>
        <Link to="/contact" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
          <MessageSquarePlus className="h-4 w-4" /> Ask a question
        </Link>
      </div>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : inquiries.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          You have not asked SafeDrive any questions yet.
        </div>
      ) : (
        <div className="space-y-3">
          {inquiries.map((inquiry) => {
            const open = openId === inquiry.id;
            return (
              <div key={inquiry.id} className="rounded-xl border bg-card">
                <button
                  className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  onClick={() => setOpenId(open ? null : inquiry.id)}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{inquiry.subject || inquiry.topics?.[0] || "Inquiry"}</p>
                    <p className="text-xs text-muted-foreground">
                      Asked {format(new Date(inquiry.created_at), "MMM d, yyyy")}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      CLOSED.includes(inquiry.status)
                        ? "bg-green-500/10 text-green-700 dark:text-green-300"
                        : inquiry.status === "in_progress"
                          ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {CLOSED.includes(inquiry.status)
                      ? "Resolved"
                      : inquiry.status === "in_progress"
                        ? "SafeDrive replied"
                        : "Waiting for SafeDrive"}
                  </span>
                </button>

                {open && (
                  <div className="border-t border-border/60 p-4">
                    {messagesLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {messages.map((message) => {
                          const mine = message.sender_role === "inquirer";
                          return (
                            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                              <div
                                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                                  mine
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-foreground"
                                }`}
                              >
                                <p className="whitespace-pre-wrap">{message.message}</p>
                                <p className={`mt-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
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

                    {isClosed ? (
                      <p className="mt-4 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-300">
                        <CheckCircle2 className="h-4 w-4" /> This inquiry is resolved. Ask a new question to start again.
                      </p>
                    ) : (
                      <div className="mt-4 flex items-end gap-2">
                        <textarea
                          className="min-h-11 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                          rows={2}
                          maxLength={3000}
                          value={openId === inquiry.id ? draft : ""}
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
