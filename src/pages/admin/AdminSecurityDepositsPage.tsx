import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Deposit = Database["public"]["Tables"]["security_deposits"]["Row"];
type Claim = Database["public"]["Tables"]["security_deposit_claims"]["Row"];

const money = (centavos: number) => new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
}).format(centavos / 100);

type AdminSecurityDepositsPageProps = {
  embedded?: boolean;
};

export default function AdminSecurityDepositsPage({ embedded = false }: AdminSecurityDepositsPageProps) {
  const { session } = useAuth();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decisionAmounts, setDecisionAmounts] = useState<Record<string, string>>({});
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [depositResult, claimResult] = await Promise.all([
      supabase.from("security_deposits").select("*").order("updated_at", { ascending: false }),
      supabase.from("security_deposit_claims").select("*").order("created_at", { ascending: false }),
    ]);
    const error = depositResult.error || claimResult.error;
    if (error) {
      toast.error("Deposit review could not be loaded", { description: error.message });
    } else {
      setDeposits(depositResult.data ?? []);
      setClaims(claimResult.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const depositMap = useMemo(
    () => Object.fromEntries(deposits.map((deposit) => [deposit.id, deposit])),
    [deposits],
  );

  const request = async (path: string, body: Record<string, unknown>) => {
    if (!session?.access_token) throw new Error("Sign in again before continuing");
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { error?: string; status?: string };
    if (!response.ok) throw new Error(result.error || "Request failed");
    return result;
  };

  const decide = async (claim: Claim) => {
    const deposit = depositMap[claim.security_deposit_id];
    if (!deposit) return;

    const amount = Math.round(Number(decisionAmounts[claim.id] || 0) * 100);
    const reason = decisionReasons[claim.id]?.trim() || "";
    if (!Number.isInteger(amount) || amount < 0 || amount > claim.amount_centavos || reason.length < 10) {
      toast.error("Enter a valid approved amount and a reason of at least 10 characters.");
      return;
    }

    setBusyId(claim.id);
    try {
      await request("/api/security-deposit-action", {
        bookingId: deposit.booking_id,
        action: "decide_claim",
        claimId: claim.id,
        approvedAmountCentavos: amount,
        decisionReason: reason,
      });
      toast.success(amount > 0 ? "Claim decision recorded" : "Claim rejected");
      await load();
    } catch (error) {
      toast.error("Claim decision failed", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setBusyId(null);
    }
  };

  const release = async (deposit: Deposit) => {
    setBusyId(deposit.id);
    try {
      const result = await request("/api/process-security-deposit-release", { depositId: deposit.id });
      toast.success(
        result.status === "pending" || result.status === "processing"
          ? "Refund accepted; provider confirmation is pending"
          : "Deposit allocation completed",
      );
      await load();
    } catch (error) {
      toast.error("Deposit was not released", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-col gap-3 sm:flex-row ${embedded ? "sm:justify-end" : "justify-between"}`}>
        {!embedded ? (
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <ShieldCheck className="h-7 w-7" /> Security Deposit Review
            </h1>
            <p className="mt-1 text-muted-foreground">
              Decide documented claims, return the balance to the renter, and add only approved deductions to the lister payable.
            </p>
          </div>
        ) : null}
        <Button variant="outline" className="gap-2" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />Refresh
        </Button>
      </div>

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : deposits.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          No security deposits yet.
        </div>
      ) : (
        <div className="space-y-4">
          {deposits.map((deposit) => {
            const depositClaims = claims.filter((claim) => claim.security_deposit_id === deposit.id);
            const openClaims = depositClaims.filter((claim) => ["submitted", "renter_responded"].includes(claim.status));
            const canRelease = ["return_review", "no_claim", "deduction_approved", "refund_pending", "failed"].includes(deposit.status)
              && openClaims.length === 0;

            return (
              <article key={deposit.id} className="rounded-xl border bg-card p-5">
                <div className="flex flex-col justify-between gap-3 lg:flex-row">
                  <div>
                    <h2 className="font-semibold">
                      {money(deposit.amount_centavos)} · {deposit.status.replace(/_/g, " ")}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">Booking {deposit.booking_id}</p>
                    {deposit.claim_deadline && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Lister claim window ends {new Date(deposit.claim_deadline).toLocaleString()}
                      </p>
                    )}
                  </div>
                  {canRelease && (
                    <Button onClick={() => void release(deposit)} disabled={busyId === deposit.id}>
                      {busyId === deposit.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {deposit.status === "refund_pending" ? "Refresh refund status" : "Release allocation"}
                    </Button>
                  )}
                </div>

                <div className="mt-4 space-y-3">
                  {depositClaims.map((claim) => (
                    <div key={claim.id} className="rounded-lg border bg-background p-4">
                      <p className="font-medium">
                        Claim {money(claim.amount_centavos)} · {claim.status.replace(/_/g, " ")}
                      </p>
                      <p className="mt-1 text-sm">{claim.reason}</p>
                      {claim.renter_response && (
                        <p className="mt-2 rounded-md bg-muted p-3 text-sm">
                          <strong>Renter response:</strong> {claim.renter_response}
                        </p>
                      )}
                      {["submitted", "renter_responded"].includes(claim.status) && (
                        <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]">
                          <label className="space-y-2">
                            <Label>Approved amount (PHP)</Label>
                            <Input
                              type="number"
                              min="0"
                              max={claim.amount_centavos / 100}
                              step="0.01"
                              value={decisionAmounts[claim.id] || ""}
                              onChange={(event) => setDecisionAmounts((current) => ({
                                ...current,
                                [claim.id]: event.target.value,
                              }))}
                            />
                          </label>
                          <label className="space-y-2">
                            <Label>Decision reason</Label>
                            <Input
                              value={decisionReasons[claim.id] || ""}
                              onChange={(event) => setDecisionReasons((current) => ({
                                ...current,
                                [claim.id]: event.target.value,
                              }))}
                              placeholder="Explain the evidence and decision"
                            />
                          </label>
                          <Button className="self-end" onClick={() => void decide(claim)} disabled={busyId === claim.id}>
                            Save decision
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
