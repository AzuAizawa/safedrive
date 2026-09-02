import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Deposit = Database["public"]["Tables"]["security_deposits"]["Row"];
type Claim = Database["public"]["Tables"]["security_deposit_claims"]["Row"];
const money = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(centavos / 100);

export default function SecurityDepositPage() {
  const { bookingId = "" } = useParams();
  const { user, session } = useAuth();
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [claimAmount, setClaimAmount] = useState("");
  const [claimReason, setClaimReason] = useState("");
  const [response, setResponse] = useState("");
  const load = useCallback(async () => { if (!bookingId) return; setLoading(true); const { data, error } = await supabase.from("security_deposits").select("*").eq("booking_id", bookingId).maybeSingle(); if (error) toast.error("Deposit could not be loaded", { description: error.message }); setDeposit(data); if (data) { const claimResult = await supabase.from("security_deposit_claims").select("*").eq("security_deposit_id", data.id).order("created_at", { ascending: false }); if (!claimResult.error) setClaims(claimResult.data ?? []); } setLoading(false); }, [bookingId]);
  useEffect(() => { void load(); }, [load]);
  const callAction = async (body: Record<string, unknown>) => { if (!session?.access_token) return false; const result = await fetch("/api/security-deposit-action", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ bookingId, ...body }) }); const payload = (await result.json()) as { error?: string }; if (!result.ok) throw new Error(payload.error || "Deposit action failed"); return true; };
  const pay = async () => { if (!session?.access_token || busy) return; setBusy(true); try { const result = await fetch("/api/create-security-deposit-checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ bookingId }) }); const payload = (await result.json()) as { error?: string; checkoutUrl?: string }; if (!result.ok || !payload.checkoutUrl) throw new Error(payload.error || "Checkout was not created"); window.location.assign(payload.checkoutUrl); } catch (error) { toast.error("Deposit checkout failed", { description: error instanceof Error ? error.message : "Please try again" }); setBusy(false); } };
  const submitClaim = async () => { if (!deposit || busy) return; setBusy(true); try { await callAction({ action: "submit_claim", amountCentavos: Math.round(Number(claimAmount) * 100), reason: claimReason }); toast.success("Claim submitted for review"); setClaimAmount(""); setClaimReason(""); await load(); } catch (error) { toast.error("Claim was not submitted", { description: error instanceof Error ? error.message : "Please try again" }); } finally { setBusy(false); } };
  const sendResponse = async (claimId: string) => { if (busy) return; setBusy(true); try { await callAction({ action: "renter_response", claimId, response }); toast.success("Response recorded"); setResponse(""); await load(); } catch (error) { toast.error("Response was not recorded", { description: error instanceof Error ? error.message : "Please try again" }); } finally { setBusy(false); } };
  if (loading) return <Loader2 className="h-6 w-6 animate-spin" />;
  if (!deposit) return <div className="rounded-xl border p-8">This booking has no refundable security deposit.</div>;
  const isRenter = deposit.renter_id === user?.id;
  const isLister = deposit.owner_id === user?.id;
  return <div className="mx-auto max-w-3xl space-y-6"><div><h1 className="flex items-center gap-2 text-3xl font-bold"><ShieldCheck className="h-7 w-7" /> Security Deposit</h1><p className="mt-1 text-muted-foreground">Separate refundable funds, not SafeDrive income. Deductions require evidence, renter response, and super-admin approval.</p></div><div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Amount</p><p className="text-3xl font-bold">{money(deposit.amount_centavos)}</p><p className="mt-2 text-sm">Status: <strong>{deposit.status.replace(/_/g, " ")}</strong></p>{deposit.claim_deadline && <p className="mt-1 text-sm text-muted-foreground">Claim deadline: {new Date(deposit.claim_deadline).toLocaleString()}</p>}{isRenter && ["required", "failed"].includes(deposit.status) && <Button className="mt-4" onClick={() => void pay()} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Pay refundable deposit</Button>}</div>{isLister && deposit.status === "return_review" && <div className="space-y-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">Submit documented claim</h2><p className="text-sm text-muted-foreground">Use only for actual supported damage or agreed charges. A request does not deduct funds automatically.</p><label className="space-y-2"><Label>Requested amount (PHP)</Label><Input type="number" min="0.01" max={deposit.amount_centavos / 100} step="0.01" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} /></label><label className="space-y-2"><Label>Detailed reason</Label><textarea className="min-h-28 w-full rounded-md border bg-background p-3 text-sm" value={claimReason} onChange={(e) => setClaimReason(e.target.value)} /></label><Button onClick={() => void submitClaim()} disabled={busy}>Submit claim</Button></div>}{claims.map((claim) => <article key={claim.id} className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Claim {money(claim.amount_centavos)} · {claim.status.replace(/_/g, " ")}</h2><p className="mt-2 text-sm">{claim.reason}</p>{claim.renter_response && <p className="mt-3 rounded-lg bg-muted p-3 text-sm"><strong>Renter response:</strong> {claim.renter_response}</p>}{isRenter && claim.status === "submitted" && <div className="mt-4 space-y-3"><Label>Your response</Label><textarea className="min-h-24 w-full rounded-md border bg-background p-3 text-sm" value={response} onChange={(e) => setResponse(e.target.value)} /><Button onClick={() => void sendResponse(claim.id)} disabled={busy}>Submit response</Button></div>}</article>)}</div>;
}
