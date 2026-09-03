import { useCallback, useEffect, useState } from "react";
import { DatabaseZap, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/database";
import { formatDayCount } from "@/lib/formatCount";

type Request = Database["public"]["Tables"]["data_retention_requests"]["Row"];
type Rule = Database["public"]["Tables"]["retention_policy_rules"]["Row"];

export default function AdminRetentionRequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: "", type: "access", details: "" });
  const [anonymizingId, setAnonymizingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [requestResult, ruleResult] = await Promise.all([
      supabase.from("data_retention_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("retention_policy_rules").select("*").order("record_category"),
    ]);
    const error = requestResult.error || ruleResult.error;
    if (error) toast.error("Retention work could not be loaded", { description: error.message });
    else { setRequests(requestResult.data ?? []); setRules(ruleResult.data ?? []); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id) return;
    const { error } = await supabase.from("data_retention_requests").insert({ requester_email: form.email.trim().toLowerCase(), request_type: form.type, request_details: form.details.trim(), assigned_to: user.id, due_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
    if (error) toast.error("Request was not recorded", { description: error.message });
    else { toast.success("Data request recorded"); setForm({ email: "", type: "access", details: "" }); await load(); }
  };

  const advance = async (item: Request) => {
    if (!user?.id) return;
    const next =
      item.status === "submitted"
        ? "identity_check"
        : item.status === "identity_check"
          ? "under_review"
          : item.status === "legal_hold"
            ? "under_review"
            : null;
    if (!next) return;
    const { error } = await supabase.from("data_retention_requests").update({ status: next, assigned_to: user.id }).eq("id", item.id);
    if (error) toast.error("Request was not updated", { description: error.message });
    else { await supabase.from("audit_log").insert({ user_id: user.id, action: "data_request_status_changed", entity_type: "data_retention_request", entity_id: item.id, details: { previous_status: item.status, next_status: next } }); await load(); }
  };

  const decide = async (item: Request, status: "approved" | "denied" | "legal_hold") => {
    if (!user?.id) return;
    const reason = window.prompt(status === "approved" ? "Explain the approved action and safeguards." : status === "legal_hold" ? "State the legal-hold reason." : "Explain why the request is denied or limited.");
    if (!reason?.trim()) return;
    const update = status === "legal_hold" ? { status, legal_hold_reason: reason.trim() } : { status, decision_reason: reason.trim() };
    const { error } = await supabase.from("data_retention_requests").update(update).eq("id", item.id);
    if (error) toast.error("Decision was not saved", { description: error.message });
    else { await supabase.from("audit_log").insert({ user_id: user.id, action: "data_request_decided", entity_type: "data_retention_request", entity_id: item.id, details: { status, reason: reason.trim() } }); await load(); }
  };

  const recordExecution = async (item: Request, proof: string) => {
    if (!user?.id) return;
    const completedAt = new Date().toISOString();
    const { error } = await supabase
      .from("data_retention_requests")
      .update({
        status: "executed",
        completed_at: completedAt,
        decision_reason: `${item.decision_reason || "Approved."} Execution: ${proof}`,
      })
      .eq("id", item.id)
      .eq("status", "approved");
    if (error) {
      toast.error("Execution was not recorded", { description: error.message });
      return;
    }
    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "data_request_executed",
      entity_type: "data_retention_request",
      entity_id: item.id,
      details: { completed_at: completedAt, execution_proof: proof },
    });
    await load();
  };

  const markExecuted = async (item: Request) => {
    const proof = window.prompt(
      "Describe exactly what was exported, corrected, deleted, anonymized, or restricted. Do not include secrets.",
    );
    if (!proof?.trim() || proof.trim().length < 10) return;
    await recordExecution(item, proof.trim());
  };

  const runAnonymization = async (item: Request) => {
    if (!user?.id || anonymizingId) return;
    if (!item.subject_user_id) {
      toast.error("This request has no linked account", {
        description: "It was likely filed by email only. Handle it manually and use Record execution.",
      });
      return;
    }
    if (
      !window.confirm(
        "Run scripted anonymization now? This blanks the account's personal data, deletes verification images, pulls their car listings offline, and soft-deletes the account. Transactional records are kept. This cannot be undone.",
      )
    ) {
      return;
    }
    setAnonymizingId(item.id);
    try {
      const { data, error } = await supabase.rpc("anonymize_user", {
        p_user_id: item.subject_user_id,
        p_request_id: item.id,
      });
      if (error) throw error;
      const report = JSON.stringify(data);
      toast.success("Account anonymized", {
        description: "Review the manual-review counts in the recorded execution note.",
      });
      await recordExecution(item, `Scripted anonymize_user report: ${report}`);
    } catch (error) {
      toast.error("Anonymization failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setAnonymizingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div><h1 className="flex items-center gap-2 text-3xl font-bold"><DatabaseZap className="h-7 w-7" /> Retention & Data Requests</h1><p className="mt-1 text-muted-foreground">A privacy-policy clause does not erase operational duties. Verify identity, check legal holds, document the decision, then execute or deny with reasons.</p></div>
      <form onSubmit={create} className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2"><label className="space-y-2"><Label>Requester email</Label><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label><label className="space-y-2"><Label>Request type</Label><select className="h-10 w-full rounded-md border bg-background px-3" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="access">Access</option><option value="correction">Correction</option><option value="deletion">Deletion</option><option value="anonymization">Anonymization</option><option value="restriction">Restriction</option></select></label><label className="space-y-2 md:col-span-2"><Label>Request details</Label><textarea className="min-h-24 w-full rounded-md border bg-background p-3 text-sm" value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} required /></label><Button type="submit" className="md:col-span-2"><Plus className="mr-2 h-4 w-4" />Record request</Button></form>
      {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <div className="space-y-3">{requests.map((item) => <article key={item.id} className="rounded-xl border bg-card p-4"><div className="flex flex-col justify-between gap-3 lg:flex-row"><div><h2 className="font-semibold">{item.request_type} · {item.requester_email}</h2><p className="mt-1 text-sm text-muted-foreground">{item.request_details}</p><p className="mt-2 text-xs text-muted-foreground">Status: {item.status.replace(/_/g, " ")} · Received {new Date(item.created_at).toLocaleString()}{item.due_at ? ` · Target ${new Date(item.due_at).toLocaleDateString()}` : ""}</p>{(item.decision_reason || item.legal_hold_reason) && <p className="mt-2 text-sm">Reason: {item.decision_reason || item.legal_hold_reason}</p>}</div><div className="flex flex-wrap gap-2">{["submitted", "identity_check"].includes(item.status) && <Button size="sm" variant="outline" onClick={() => void advance(item)}>Advance review</Button>}{item.status === "legal_hold" && <Button size="sm" variant="outline" onClick={() => void advance(item)}>Release legal hold</Button>}{item.status === "under_review" && <><Button size="sm" onClick={() => void decide(item, "approved")}>Approve</Button><Button size="sm" variant="outline" onClick={() => void decide(item, "denied")}>Deny</Button><Button size="sm" variant="outline" onClick={() => void decide(item, "legal_hold")}>Legal hold</Button></>}{item.status === "approved" && ["deletion", "anonymization"].includes(item.request_type) && item.subject_user_id && <Button size="sm" disabled={anonymizingId === item.id} onClick={() => void runAnonymization(item)}>{anonymizingId === item.id && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Run anonymization</Button>}{item.status === "approved" && <Button size="sm" variant="outline" onClick={() => void markExecuted(item)}>Record execution</Button>}</div></div></article>)}</div>}
      <section><h2 className="text-xl font-semibold">Active retention schedule</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{rules.map((rule) => <div key={rule.record_category} className="rounded-xl border bg-card p-4"><p className="font-medium">{rule.record_category.replace(/_/g, " ")}</p><p className="text-sm text-muted-foreground">{rule.retention_days === null ? "While legally or operationally required" : formatDayCount(rule.retention_days)} · {rule.rationale}</p></div>)}</div></section>
    </div>
  );
}
