import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Loader2, Mail, MessageSquare, RefreshCw, Send, UserCheck } from "lucide-react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import AdminSectionTabs from "@/components/AdminSectionTabs";
import { useAuth } from "@/contexts/AuthContext";
import { formatElapsed, getQueueTiming, queueSeverityClasses } from "@/lib/queueAge";
import { supabase } from "@/lib/supabase";
import type { GuestInquiry, GuestInquiryMessage } from "@/types/database";

type Filter = "current" | "resolved" | "all";
const CLOSED = ["resolved", "closed"];

export default function AdminGuestInquiriesPage() {
  const { session } = useAuth();
  const [searchParams] = useSearchParams();
  const [inquiries, setInquiries] = useState<GuestInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("current");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [thread, setThread] = useState<GuestInquiryMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [selected, setSelected] = useState<GuestInquiry | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const fetchInquiries = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("guest_inquiries").select("*").order("updated_at", { ascending: false });
    if (error) toast.error("Inquiries could not be loaded", { description: error.message });
    else setInquiries((data ?? []) as GuestInquiry[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchInquiries();
    const clockId = window.setInterval(() => setNow(Date.now()), 60_000);
    const channel = supabase
      .channel("admin-user-inquiries")
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_inquiries" }, () => void fetchInquiries())
      .subscribe();
    return () => {
      window.clearInterval(clockId);
      void supabase.removeChannel(channel);
    };
  }, [fetchInquiries]);

  const fetchThread = useCallback(async (inquiryId: string) => {
    setThreadLoading(true);
    const { data, error } = await supabase
      .from("guest_inquiry_messages")
      .select("*")
      .eq("inquiry_id", inquiryId)
      .order("created_at", { ascending: true });
    if (error) toast.error("Thread could not be loaded", { description: error.message });
    else setThread((data ?? []) as GuestInquiryMessage[]);
    setThreadLoading(false);
  }, []);

  useEffect(() => {
    if (!expandedId) {
      setThread([]);
      return;
    }
    void fetchThread(expandedId);
    const channel = supabase
      .channel(`admin-inquiry-thread-${expandedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "guest_inquiry_messages", filter: `inquiry_id=eq.${expandedId}` },
        () => void fetchThread(expandedId),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [expandedId, fetchThread]);

  useEffect(() => {
    const requestedId = searchParams.get("inquiry");
    if (!requestedId || inquiries.length === 0) return;
    const requested = inquiries.find((item) => item.id === requestedId);
    if (!requested) {
      toast.error("That inquiry could not be found");
      return;
    }
    setFilter(CLOSED.includes(requested.status) ? "resolved" : "current");
    setExpandedId(requestedId);
    window.requestAnimationFrame(() => {
      document.getElementById(`guest-inquiry-${requestedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [inquiries, searchParams]);

  const visible = useMemo(() => {
    if (filter === "current") return inquiries.filter((item) => ["open", "in_progress"].includes(item.status));
    if (filter === "resolved") return inquiries.filter((item) => CLOSED.includes(item.status));
    return inquiries;
  }, [filter, inquiries]);

  // Opening the reply box silently claims the inquiry so the queue shows
  // someone is on it. There is no separate "Start review" step.
  const openReply = (inquiry: GuestInquiry) => {
    setSelected(inquiry);
    setReply("");
    if (inquiry.status !== "open") return;
    const adminId = session?.user.id;
    if (!adminId) return;
    void (async () => {
      const { data: claimed } = await supabase
        .from("guest_inquiries")
        .update({ status: "in_progress", assigned_admin_id: adminId, review_started_at: new Date().toISOString() })
        .eq("id", inquiry.id)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
      if (!claimed) toast.info("Another administrator is already on this inquiry");
      await fetchInquiries();
    })();
  };

  const sendReply = async () => {
    if (!selected || !reply.trim() || !session?.access_token || sending) return;
    setSending(true);
    try {
      const response = await fetch("/api/reply-guest-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ inquiryId: selected.id, reply: reply.trim() }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Reply could not be delivered");
      toast.success("Reply sent by email");
      const inquiryId = selected.id;
      setSelected(null);
      setReply("");
      setExpandedId(inquiryId);
      await Promise.all([fetchInquiries(), fetchThread(inquiryId)]);
    } catch (error) {
      toast.error("Reply failed", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setSending(false);
    }
  };

  const resolveInquiry = async (inquiry: GuestInquiry) => {
    if (!session?.access_token || resolvingId) return;
    setResolvingId(inquiry.id);
    try {
      const response = await fetch("/api/reply-guest-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ inquiryId: inquiry.id, action: "resolve" }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not resolve");
      toast.success("Inquiry marked resolved");
      await fetchInquiries();
    } catch (error) {
      toast.error("Could not resolve", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Inquiries</h1>
          <p className="mt-1 text-muted-foreground">
            Questions from the public contact form. An account holder&apos;s inquiry is a threaded conversation; a
            guest with no account gets a single email reply. Replying no longer closes an inquiry &mdash; use
            &ldquo;Mark resolved&rdquo; when the question is answered.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => void fetchInquiries()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <AdminSectionTabs
        value={filter}
        onChange={setFilter}
        ariaLabel="Inquiry status"
        tabs={[
          { value: "current", label: "Open", count: inquiries.filter((item) => ["open", "in_progress"].includes(item.status)).length },
          { value: "resolved", label: "Resolved", count: inquiries.filter((item) => CLOSED.includes(item.status)).length },
          { value: "all", label: "All", count: inquiries.length },
        ]}
      />

      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">No inquiries in this view.</div>
      ) : (
        <div className="grid gap-4">
          {visible.map((inquiry) => {
            const timing = getQueueTiming(inquiry.created_at, "guest", now);
            const isExpanded = expandedId === inquiry.id;
            const hasAccount = Boolean(inquiry.submitted_by_user_id);
            const closed = CLOSED.includes(inquiry.status);
            return (
              <article
                id={`guest-inquiry-${inquiry.id}`}
                key={inquiry.id}
                className={`rounded-xl border bg-card p-5 ${searchParams.get("inquiry") === inquiry.id ? "border-blue-500 ring-2 ring-blue-500/20" : "border-border/70"}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{inquiry.topics?.[0] || inquiry.subject}</h2>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{inquiry.status.replace("_", " ")}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          hasAccount
                            ? "bg-green-500/10 text-green-700 dark:text-green-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <UserCheck className="h-3 w-3" />
                        {hasAccount ? "Account holder - threaded" : "Guest - email only"}
                      </span>
                    </div>
                    {inquiry.topics?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {inquiry.topics.map((topic) => (
                          <span key={topic} className="rounded-full border border-blue-500/20 bg-blue-500/5 px-2 py-0.5 text-xs text-blue-600 dark:text-blue-400">{topic}</span>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-sm text-muted-foreground">
                      {inquiry.name} · <a className="underline" href={`mailto:${inquiry.email}`}>{inquiry.email}</a>{inquiry.phone ? ` · ${inquiry.phone}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Received {format(new Date(inquiry.created_at), "MMM d, yyyy h:mm a")}</span>
                      {!closed && (
                        <span className={`rounded-full border px-2 py-0.5 font-medium ${queueSeverityClasses[timing.severity]}`}>{timing.label}</span>
                      )}
                      {inquiry.review_started_at && !closed && (
                        <span className="text-muted-foreground">In review for {formatElapsed(inquiry.review_started_at, now)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {["open", "in_progress"].includes(inquiry.status) && (
                      <>
                        <Button size="sm" className="gap-1" onClick={() => openReply(inquiry)}>
                          <Mail className="h-3.5 w-3.5" /> Reply
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => void resolveInquiry(inquiry)}
                          disabled={resolvingId === inquiry.id}
                        >
                          {resolvingId === inquiry.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Mark resolved
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <button
                  className="mt-4 text-xs font-medium text-primary hover:underline"
                  onClick={() => setExpandedId(isExpanded ? null : inquiry.id)}
                >
                  {isExpanded ? "Hide conversation" : "Show conversation"}
                </button>

                {isExpanded && (
                  <div className="mt-3 space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4">
                    {threadLoading ? (
                      <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                    ) : thread.length === 0 ? (
                      <p className="whitespace-pre-wrap text-sm leading-6">{inquiry.message}</p>
                    ) : (
                      thread.map((message) => {
                        const fromAdmin = message.sender_role === "admin";
                        return (
                          <div key={message.id} className={`flex ${fromAdmin ? "justify-end" : "justify-start"}`}>
                            <div
                              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                                fromAdmin ? "bg-primary text-primary-foreground" : "bg-card border border-border/60"
                              }`}
                            >
                              <p className="whitespace-pre-wrap">{message.message}</p>
                              <p className={`mt-1 text-[10px] ${fromAdmin ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                                {fromAdmin ? "SafeDrive" : inquiry.name} · {format(new Date(message.created_at), "MMM d, h:mm a")}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !sending && setSelected(null)}>
          <div className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <MessageSquare className="mt-1 h-5 w-5 text-primary" />
              <div>
                <h2 className="text-lg font-semibold">Reply to {selected.name}</h2>
                <p className="text-sm text-muted-foreground">
                  Emailed to {selected.email}
                  {selected.submitted_by_user_id ? " and added to their in-app inquiry thread" : ""}. This does not
                  close the inquiry &mdash; use &ldquo;Mark resolved&rdquo; when the question is answered.
                </p>
              </div>
            </div>
            <textarea className="mt-4 min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" maxLength={3000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write the SafeDrive support response..." />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelected(null)} disabled={sending}>Cancel</Button>
              <Button className="gap-2" onClick={() => void sendReply()} disabled={sending || !reply.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send reply
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
