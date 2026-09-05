import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MessageCircleQuestion,
  MessageSquarePlus,
  Send,
  X,
} from "lucide-react";
import { useLocation } from "react-router";
import { format } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { GUEST_INQUIRY_TOPICS } from "@/lib/guestInquiryTopics";
import type { GuestInquiry, GuestInquiryMessage } from "@/types/database";

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  topic: "",
  message: "",
  company: "",
};

const CLOSED_STATUSES = ["resolved", "closed"];

type WidgetView = "list" | "thread" | "form";

/**
 * The one floating inquiry entry point site-wide. It used to be a
 * write-only "submit and forget" form, with a separate /inquiries page (under
 * the profile menu) the only place to see the reply. That duplicated the
 * data (both read the same guest_inquiries table) and the reply was easy to
 * lose track of. Now the widget itself is the full surface: a signed-in
 * visitor who opens it sees their past inquiries first (with a reply-pending
 * badge), can open any thread to read and follow up, or start a new one -
 * /inquiries no longer exists.
 */
export default function InquiryWidget() {
  const { pathname } = useLocation();
  const { user, profile, session } = useAuth();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<WidgetView>("form");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [inquiries, setInquiries] = useState<GuestInquiry[]>([]);
  const [inquiriesLoading, setInquiriesLoading] = useState(false);
  const [openInquiryId, setOpenInquiryId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GuestInquiryMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState("");
  const [sendingFollowUp, setSendingFollowUp] = useState(false);

  const hidden = pathname.startsWith("/admin") || pathname === "/contact";

  const fetchInquiries = useCallback(async (): Promise<GuestInquiry[]> => {
    if (!user?.id) {
      setInquiries([]);
      return [];
    }
    setInquiriesLoading(true);
    const { data, error } = await supabase
      .from("guest_inquiries")
      .select("*")
      .eq("submitted_by_user_id", user.id)
      .order("updated_at", { ascending: false });
    const list = !error ? ((data ?? []) as GuestInquiry[]) : [];
    setInquiries(list);
    setInquiriesLoading(false);
    return list;
  }, [user?.id]);

  // Keep the reply-pending badge on the closed button accurate even before
  // the widget is ever opened this session.
  useEffect(() => {
    void fetchInquiries();
  }, [fetchInquiries]);

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({
      ...current,
      name: current.name || profile?.full_name || "",
      email: current.email || profile?.email || user?.email || "",
      phone: current.phone || profile?.phone || "",
    }));
  }, [open, profile?.email, profile?.full_name, profile?.phone, user?.email]);

  // Decide what the widget opens to: someone with prior inquiries lands on
  // their list first, not a blank form they have to click past every time.
  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    if (!user?.id) {
      setView("form");
      return;
    }
    let cancelled = false;
    void (async () => {
      const list = await fetchInquiries();
      if (!cancelled) setView(list.length > 0 ? "list" : "form");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const fetchMessages = useCallback(async (inquiryId: string) => {
    setMessagesLoading(true);
    const { data, error } = await supabase
      .from("guest_inquiry_messages")
      .select("*")
      .eq("inquiry_id", inquiryId)
      .order("created_at", { ascending: true });
    if (!error) setMessages((data ?? []) as GuestInquiryMessage[]);
    setMessagesLoading(false);
  }, []);

  useEffect(() => {
    if (view !== "thread" || !openInquiryId) {
      setMessages([]);
      return;
    }
    void fetchMessages(openInquiryId);
    const channel = supabase
      .channel(`inquiry-widget-thread-${openInquiryId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "guest_inquiry_messages",
          filter: `inquiry_id=eq.${openInquiryId}`,
        },
        () => void fetchMessages(openInquiryId),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [view, openInquiryId, fetchMessages]);

  if (hidden) return null;

  const update = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const close = () => {
    setOpen(false);
    setSubmitted(false);
  };

  const openThread = (inquiryId: string) => {
    setOpenInquiryId(inquiryId);
    setFollowUpDraft("");
    setView("thread");
  };

  const backToList = () => {
    setOpenInquiryId(null);
    setView(inquiries.length > 0 ? "list" : "form");
  };

  const openInquiry = inquiries.find((item) => item.id === openInquiryId) ?? null;
  const isThreadClosed = openInquiry ? CLOSED_STATUSES.includes(openInquiry.status) : false;
  const pendingReplyCount = inquiries.filter((item) => item.status === "in_progress").length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/create-guest-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          topics: [form.topic],
          message: form.message,
          company: form.company,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        linked?: boolean;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to submit inquiry");
      setForm((current) => ({ ...emptyForm, name: current.name, email: current.email, phone: current.phone }));
      toast.success("Inquiry submitted", {
        description: "SafeDrive received your inquiry and will reply through email.",
      });
      if (payload.linked && payload.id) {
        await fetchInquiries();
        openThread(payload.id);
      } else {
        setSubmitted(true);
      }
    } catch (error) {
      toast.error("Inquiry was not submitted", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const sendFollowUp = async () => {
    if (!openInquiryId || !followUpDraft.trim() || !session?.access_token || sendingFollowUp) return;
    setSendingFollowUp(true);
    try {
      const res = await fetch("/api/inquiry-followup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ inquiryId: openInquiryId, message: followUpDraft.trim() }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "Follow-up was not sent");
      setFollowUpDraft("");
      await fetchMessages(openInquiryId);
      await fetchInquiries();
    } catch (error) {
      toast.error("Follow-up failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSendingFollowUp(false);
    }
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[80] bg-black/45 sm:bg-transparent" onMouseDown={close}>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="absolute inset-x-3 bottom-20 flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl outline-none sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[390px]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 p-5 pb-0">
              <div className="min-w-0">
                {view === "thread" ? (
                  <button
                    type="button"
                    onClick={backToList}
                    className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to my inquiries
                  </button>
                ) : null}
                <h2 id={titleId} className="truncate text-lg font-bold">
                  {view === "list"
                    ? "My inquiries"
                    : view === "thread"
                      ? openInquiry?.subject || openInquiry?.topics?.[0] || "Inquiry"
                      : "Send an inquiry"}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {view === "list"
                    ? "Questions you asked SafeDrive and the replies."
                    : view === "thread"
                      ? "Follow up here - SafeDrive replies to this same thread."
                      : "This goes to the admin inquiry queue - separate from support tickets and booking conversations."}
                </p>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label="Close inquiry form" onClick={close}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 pt-4">
              {view === "list" ? (
                inquiriesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {inquiries.map((inquiry) => (
                      <button
                        key={inquiry.id}
                        type="button"
                        onClick={() => openThread(inquiry.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border bg-background/60 p-3 text-left hover:bg-muted/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {inquiry.subject || inquiry.topics?.[0] || "Inquiry"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Asked {format(new Date(inquiry.created_at), "MMM d, yyyy")}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            CLOSED_STATUSES.includes(inquiry.status)
                              ? "bg-green-500/10 text-green-700 dark:text-green-300"
                              : inquiry.status === "in_progress"
                                ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          {CLOSED_STATUSES.includes(inquiry.status)
                            ? "Resolved"
                            : inquiry.status === "in_progress"
                              ? "Replied"
                              : "Waiting"}
                        </span>
                      </button>
                    ))}

                    <Button
                      type="button"
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => setView("form")}
                    >
                      <MessageSquarePlus className="h-4 w-4" /> Ask a new question
                    </Button>
                  </div>
                )
              ) : view === "thread" ? (
                <div className="flex h-full flex-col">
                  {messagesLoading ? (
                    <div className="flex flex-1 items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  ) : (
                    <div className="flex-1 space-y-3">
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

                  {isThreadClosed ? (
                    <p className="mt-4 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-300">
                      <CheckCircle2 className="h-4 w-4" /> This inquiry is resolved. Ask a new question to start again.
                    </p>
                  ) : (
                    <div className="mt-4 flex items-end gap-2">
                      <textarea
                        className="min-h-11 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                        rows={2}
                        maxLength={3000}
                        value={followUpDraft}
                        onChange={(event) => setFollowUpDraft(event.target.value)}
                        placeholder="Add a follow-up..."
                      />
                      <Button
                        className="gap-1"
                        onClick={() => void sendFollowUp()}
                        disabled={sendingFollowUp || !followUpDraft.trim()}
                      >
                        {sendingFollowUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Send
                      </Button>
                    </div>
                  )}
                </div>
              ) : submitted ? (
                <div className="py-8 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                  <p className="mt-3 font-semibold">Inquiry received</p>
                  <p className="mt-1 text-sm text-muted-foreground">We will reply through the email you provided.</p>
                  <Button type="button" variant="outline" className="mt-5" onClick={() => setSubmitted(false)}>
                    Send another inquiry
                  </Button>
                </div>
              ) : (
                <form className="space-y-4" onSubmit={submit}>
                  {inquiries.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setView("list")}
                      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Back to my inquiries
                    </button>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1.5">
                      <Label htmlFor="inquiry-name">Name</Label>
                      <Input id="inquiry-name" maxLength={120} required value={form.name} onChange={(event) => update("name", event.target.value)} />
                    </label>
                    <label className="space-y-1.5">
                      <Label htmlFor="inquiry-phone">Phone <span className="text-muted-foreground">(optional)</span></Label>
                      <Input id="inquiry-phone" inputMode="tel" maxLength={40} value={form.phone} onChange={(event) => update("phone", event.target.value)} />
                    </label>
                  </div>
                  <label className="block space-y-1.5">
                    <Label htmlFor="inquiry-email">Email</Label>
                    <Input id="inquiry-email" type="email" maxLength={320} required value={form.email} onChange={(event) => update("email", event.target.value)} />
                  </label>
                  <label className="block space-y-1.5">
                    <Label htmlFor="inquiry-topic">Inquiry topic</Label>
                    <select
                      id="inquiry-topic"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      required
                      value={form.topic}
                      onChange={(event) => update("topic", event.target.value)}
                    >
                      <option value="">Choose a topic</option>
                      {GUEST_INQUIRY_TOPICS.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
                    </select>
                  </label>
                  <label className="hidden" aria-hidden="true">
                    Company
                    <input tabIndex={-1} autoComplete="off" value={form.company} onChange={(event) => update("company", event.target.value)} />
                  </label>
                  <label className="block space-y-1.5">
                    <Label htmlFor="inquiry-message">Question or concern</Label>
                    <textarea
                      id="inquiry-message"
                      className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      minLength={10}
                      maxLength={3000}
                      required
                      value={form.message}
                      onChange={(event) => update("message", event.target.value)}
                      placeholder="How can SafeDrive help?"
                    />
                  </label>
                  <Button type="submit" className="w-full gap-2" disabled={submitting || !form.topic || form.message.trim().length < 10}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Submit inquiry
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      <Button
        type="button"
        className="fixed bottom-5 right-5 z-[81] h-12 gap-2 rounded-full px-4 shadow-xl sm:bottom-6 sm:right-6"
        aria-label={open ? "Close inquiry form" : "Open inquiry form"}
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        {open ? (
          <X className="h-5 w-5" />
        ) : (
          <span className="relative">
            <MessageCircleQuestion className="h-5 w-5" />
            {pendingReplyCount > 0 && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
            )}
          </span>
        )}
        <span>Inquiry</span>
      </Button>
    </>
  );
}
