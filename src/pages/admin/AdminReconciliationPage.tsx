import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Item = Database["public"]["Tables"]["reconciliation_items"]["Row"];

export default function AdminReconciliationPage() {
  const { session, user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => { setLoading(true); const { data, error } = await supabase.from("reconciliation_items").select("*").order("created_at", { ascending: false }).limit(500); if (error) toast.error("Reconciliation items could not be loaded", { description: error.message }); else setItems(data ?? []); setLoading(false); }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async () => { if (!session?.access_token || running) return; setRunning(true); try { const response = await fetch("/api/run-reconciliation", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } }); const result = (await response.json()) as { error?: string; issues?: number }; if (!response.ok) throw new Error(result.error || "Reconciliation failed"); toast.success(`Reconciliation completed: ${result.issues ?? 0} issue(s)`); await load(); } catch (error) { toast.error("Reconciliation failed", { description: error instanceof Error ? error.message : "Please try again" }); } finally { setRunning(false); } };
  const resolve = async (item: Item) => { const resolution = window.prompt("Explain exactly how this mismatch was resolved. This does not edit ledger history."); if (!resolution?.trim() || !user?.id) return; const { error } = await supabase.from("reconciliation_items").update({ status: "resolved", resolution: resolution.trim(), resolved_by: user.id, resolved_at: new Date().toISOString() }).eq("id", item.id).eq("status", "open"); if (error) toast.error("Issue was not resolved", { description: error.message }); else { await supabase.from("audit_log").insert({ user_id: user.id, action: "reconciliation_issue_resolved", entity_type: "reconciliation_item", entity_id: item.id, details: { issue_type: item.issue_type, resolution: resolution.trim() } }); await load(); } };

  return <div className="space-y-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h1 className="text-3xl font-bold">Reconciliation</h1><p className="mt-1 text-muted-foreground">Detect and freeze mismatches; never invent a transaction or silently send money.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button onClick={() => void run()} disabled={running}>{running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Run checks</Button></div></div>{loading ? <Loader2 className="h-6 w-6 animate-spin" /> : items.length === 0 ? <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-10 text-center"><CheckCircle2 className="mx-auto h-9 w-9 text-green-500" /><p className="mt-2 font-medium">No reconciliation issues recorded</p></div> : <div className="space-y-3">{items.map((item) => <article key={item.id} className={`rounded-xl border p-4 ${item.status === "open" ? item.severity === "critical" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5" : "bg-card opacity-75"}`}><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{item.issue_type.replace(/_/g, " ")}</h2><p className="mt-1 text-sm text-muted-foreground">Provider: {item.provider_reference || "none"} · Local: {item.local_reference || "none"}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()} · {item.status}</p>{item.resolution && <p className="mt-2 text-sm">Resolution: {item.resolution}</p>}</div>{item.status === "open" && <Button size="sm" variant="outline" onClick={() => void resolve(item)}>Record resolution</Button>}</div></article>)}</div>}</div>;
}
