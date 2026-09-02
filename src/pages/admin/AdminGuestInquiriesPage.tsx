import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, Mail, MessageSquare, RefreshCw, Send } from "lucide-react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import AdminSectionTabs from "@/components/AdminSectionTabs";
import { useAuth } from "@/contexts/AuthContext";
import { formatElapsed, getQueueTiming, queueSeverityClasses } from "@/lib/queueAge";
import { supabase } from "@/lib/supabase";
import type { GuestInquiry } from "@/types/database";

type Filter = "current" | "resolved" | "all";

export default function AdminGuestInquiriesPage() {
  const { session } = useAuth();
  const [searchParams] = useSearchParams();
  const [inquiries, setInquiries] = useState<GuestInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("current");
  const [selected, setSelected] = useState<GuestInquiry | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());

  const fetchInquiries = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("guest_inquiries").select("*").order("created_at", { ascending: false });
    if (error) toast.error("Guest inquiries could not be loaded", { description: error.message });
    else setInquiries((data ?? []) as GuestInquiry[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchInquiries();
    const clockId = window.setInterval(() => setNow(Date.now()), 60_000);
    const channel = supabase
      .channel("admin-guest-inquiries")
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_inquiries" }, () => void fetchInquiries())
      .subscribe();
    return () => {
      window.clearInterval(clockId);
      void supabase.removeChannel(channel);
    };
  }, [fetchInquiries]);

  useEffect(() => {
    const requestedId = searchParams.get("inquiry");
    if (!requestedId || inquiries.length === 0) return;
    const requestedInquiry = inquiries.find((item) => item.id === requestedId);
    if (!requestedInquiry) {
      toast.error("That guest inquiry could not be found");
      return;
    }
    setFilter(["resolved", "closed"].includes(requestedInquiry.status) ? "resolved" : "current");
    window.requestAnimationFrame(() => {
      document.getElementById(`guest-inquiry-${requestedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [inquiries, searchParams]);

  const visible = useMemo(() => {
    if (filter === "current") return inquiries.filter((item) => ["open", "in_progress"].includes(item.status));
    if (filter === "resolved") return inquiries.filter((item) => ["resolved", "closed"].includes(item.status));
    return inquiries;
  }, [filter, inquiries]);

  const startReview = async (inquiry: GuestInquiry) => {
    const adminId = session?.user.id;
    if (!adminId) return;
    const startedAt = new Date().toISOString();
    const { data: claimed, error } = await supabase
      .from("guest_inquiries")
      .update({ status: "in_progress", assigned_admin_id: adminId, review_started_at: startedAt })
      .eq("id", inquiry.id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (error) {
      toast.error("Review was not started", { description: error.message });
      return;
    }
    if (!claimed) {
      toast.info("Another administrator already started this review");
      await fetchInquiries();
      return;
    }
    await supabase.from("audit_log").insert({
      user_id: adminId,
      action: "guest_inquiry_review_started",
      entity_type: "guest_inquiry",
      entity_id: inquiry.id,
      details: { previous_status: inquiry.status, review_started_at: startedAt },
    });
    toast.success("Inquiry is now In review");
    await fetchInquiries();
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
      toast.success("Guest reply sent");
      setSelected(null);
      setReply("");
      await fetchInquiries();
    } catch (error) {
      toast.error("Guest reply failed", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Guest Inquiries</h1>
          <p className="mt-1 text-muted-foreground">Questions submitted by visitors without a SafeDrive account.</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => void fetchInquiries()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <AdminSectionTabs
        value={filter}
        onChange={setFilter}
        ariaLabel="Guest inquiry status"
        tabs={[
          { value: "current", label: "Open", count: inquiries.filter((item) => ["open", "in_progress"].includes(item.status)).length },
          { value: "resolved", label: "Resolved", count: inquiries.filter((item) => ["resolved", "closed"].includes(item.status)).length },
          { value: "all", label: "All", count: inquiries.length },
        ]}
      />

      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">No guest inquiries in this view.</div>
      ) : (
        <div className="grid gap-4">
          {visible.map((inquiry) => {
            const timing = getQueueTiming(inquiry.created_at, "guest", now);
            return (
              <article
                id={`guest-inquiry-${inquiry.id}`}
                key={inquiry.id}
                className={`rounded-xl border bg-card p-5 ${searchParams.get("inquiry") === inquiry.id ? "border-blue-500 ring-2 ring-blue-500/20" : "border-border/70"}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{inquiry.topics?.[0] || inquiry.subject}</h2>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{inquiry.status.replace("_", " ")}</span>
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
                      {!["resolved", "closed"].includes(inquiry.status) && (
                        <span className={`rounded-full border px-2 py-0.5 font-medium ${queueSeverityClasses[timing.severity]}`}>{timing.label}</span>
                      )}
                      {inquiry.review_started_at && !["resolved", "closed"].includes(inquiry.status) && (
                        <span className="text-muted-foreground">In review for {formatElapsed(inquiry.review_started_at, now)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {inquiry.status === "open" && <Button size="sm" variant="outline" onClick={() => void startReview(inquiry)}>Start review</Button>}
                    {["open", "in_progress"].includes(inquiry.status) && (
                      <Button size="sm" className="gap-1" onClick={() => { setSelected(inquiry); setReply(inquiry.admin_reply || ""); }}>
                        <Mail className="h-3.5 w-3.5" /> Reply
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-4 whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/20 p-4 text-sm leading-6">{inquiry.message}</div>
                {inquiry.admin_reply && (
                  <div className="mt-3 rounded-lg border border-green-500/20 bg-green-500/5 p-4 text-sm">
                    <p className="font-medium">Latest reply</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{inquiry.admin_reply}</p>
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
              <div><h2 className="text-lg font-semibold">Reply to {selected.name}</h2><p className="text-sm text-muted-foreground">The response will be emailed to {selected.email}.</p></div>
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
