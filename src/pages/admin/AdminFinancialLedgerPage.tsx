import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, Loader2, RefreshCw, RotateCcw, Scale } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Journal = Database["public"]["Tables"]["ledger_journals"]["Row"];
type Entry = Database["public"]["Tables"]["ledger_entries"]["Row"];
type Account = Database["public"]["Tables"]["financial_accounts"]["Row"];
type CorrectionLine = {
  account_code: string;
  debit_centavos: number;
  credit_centavos: number;
  party_user_id: string | null;
  memo: string;
};

const JOURNAL_LIMIT = 250;

const money = (centavos: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(centavos / 100);

// Every record here is money moving between two accounts. An admin needs to
// know WHAT happened; the account codes and debit/credit columns behind that
// are bookkeeping detail, kept in the Advanced view.
const PLAIN_EVENT_LABELS: Record<string, string> = {
  renter_payment_collected: "Renter paid",
  renter_refund_completed: "Refunded to renter",
  lister_payout_completed: "Paid out to lister",
  platform_commission_earned: "SafeDrive earned commission",
  subscription_payment_completed: "Subscription payment",
};

const describeEvent = (eventType: string) =>
  PLAIN_EVENT_LABELS[eventType] ?? eventType.replace(/_/g, " ");

export default function AdminFinancialLedgerPage() {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [correctingJournalId, setCorrectingJournalId] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionLines, setCorrectionLines] = useState<CorrectionLine[]>([]);
  const [savingCorrection, setSavingCorrection] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [journalResult, accountResult] = await Promise.all([
      supabase
        .from("ledger_journals")
        .select("*")
        .order("effective_at", { ascending: false })
        .limit(JOURNAL_LIMIT),
      supabase.from("financial_accounts").select("*").order("code"),
    ]);

    if (journalResult.error || accountResult.error) {
      toast.error("Money records could not be loaded", {
        description: (journalResult.error || accountResult.error)?.message,
      });
      setLoading(false);
      return;
    }

    const journalRows = journalResult.data ?? [];

    // Entries are fetched for exactly the journals being shown. They used to
    // be fetched independently with their own limit and a different sort key,
    // so a journal whose lines fell outside that separate cut-off rendered
    // with zero debits and zero credits - and was then labelled "unbalanced -
    // payout blocked" in red, on a journal the database itself had already
    // proved balanced before finalizing it.
    const entryResult = journalRows.length
      ? await supabase
          .from("ledger_entries")
          .select("*")
          .in(
            "journal_id",
            journalRows.map((journal) => journal.id),
          )
      : { data: [], error: null };

    if (entryResult.error) {
      toast.error("Money records could not be loaded", {
        description: entryResult.error.message,
      });
      setLoading(false);
      return;
    }

    setJournals(journalRows);
    setEntries(entryResult.data ?? []);
    setAccounts(accountResult.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.code, account.name])),
    [accounts],
  );
  const totals = useMemo(
    () =>
      entries.reduce(
        (result, entry) => ({
          debit: result.debit + Number(entry.debit_centavos),
          credit: result.credit + Number(entry.credit_centavos),
        }),
        { debit: 0, credit: 0 },
      ),
    [entries],
  );

  const beginCorrection = (journal: Journal) => {
    setCorrectingJournalId(journal.id);
    setCorrectionReason("");
    setCorrectionLines(
      entries
        .filter((entry) => entry.journal_id === journal.id)
        .map((entry) => ({
          account_code: entry.account_code,
          debit_centavos: Number(entry.debit_centavos),
          credit_centavos: Number(entry.credit_centavos),
          party_user_id: entry.party_user_id,
          memo: entry.memo || "",
        })),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateLine = (index: number, patch: Partial<CorrectionLine>) =>
    setCorrectionLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );

  const saveCorrection = async () => {
    if (!correctingJournalId || correctionReason.trim().length < 10 || correctionLines.length < 2) {
      toast.error("Explain the correction and keep at least two ledger lines.");
      return;
    }
    const debit = correctionLines.reduce((sum, line) => sum + Number(line.debit_centavos || 0), 0);
    const credit = correctionLines.reduce((sum, line) => sum + Number(line.credit_centavos || 0), 0);
    if (!Number.isInteger(debit) || debit <= 0 || debit !== credit) {
      toast.error("Corrected entries must balance in whole centavos.");
      return;
    }

    setSavingCorrection(true);
    const { error } = await supabase.rpc("create_ledger_correction", {
      p_original_journal_id: correctingJournalId,
      p_reason: correctionReason.trim(),
      p_corrected_entries: correctionLines,
    });
    if (error) {
      toast.error("Correction was not created", { description: error.message });
    } else {
      toast.success("Reversal and corrected record finalized");
      setCorrectingJournalId(null);
      setCorrectionLines([]);
      setCorrectionReason("");
      await load();
    }
    setSavingCorrection(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <BookOpenCheck className="h-7 w-7" /> Money Records
          </h1>
          <p className="mt-1 text-muted-foreground">
            Every payment, refund, payout and subscription, newest first. Records
            are never edited - a mistake is fixed by adding its exact reversal
            plus a corrected record, so the history always shows what happened.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={showAdvanced ? "default" : "outline"}
            className="gap-2"
            onClick={() => setShowAdvanced((current) => !current)}
          >
            <Scale className="h-4 w-4" />
            {showAdvanced ? "Hide accounting view" : "Accounting view"}
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {showAdvanced && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">Records shown</p>
            <p className="mt-1 text-2xl font-bold">{journals.length}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">Debits shown</p>
            <p className="mt-1 text-2xl font-bold">{money(totals.debit)}</p>
          </div>
          <div
            className={`rounded-xl border p-4 ${
              totals.debit === totals.credit
                ? "border-green-500/30 bg-green-500/5"
                : "border-red-500/30 bg-red-500/5"
            }`}
          >
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Scale className="h-4 w-4" />
              Credits shown
            </p>
            <p className="mt-1 text-2xl font-bold">{money(totals.credit)}</p>
          </div>
        </div>
      )}

      {correctingJournalId && (
        <section className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div>
            <h2 className="font-semibold">Correct this record</h2>
            <p className="text-sm text-muted-foreground">
              The original stays exactly as it is. SafeDrive adds its reversal and
              a replacement in one step. Amounts are in centavos, and the debit
              and credit totals must match.
            </p>
          </div>
          <label className="block space-y-2">
            <Label>Reason</Label>
            <Input
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
              placeholder="Explain the error and why the replacement is correct"
            />
          </label>
          <div className="space-y-3">
            {correctionLines.map((line, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-lg border bg-background p-3 md:grid-cols-[150px_1fr_130px_130px_auto]"
              >
                <select
                  className="h-10 rounded-md border bg-background px-2 text-sm"
                  value={line.account_code}
                  onChange={(event) => updateLine(index, { account_code: event.target.value })}
                >
                  {accounts.map((account) => (
                    <option key={account.code} value={account.code}>
                      {account.code} {account.name}
                    </option>
                  ))}
                </select>
                <Input
                  value={line.memo}
                  onChange={(event) => updateLine(index, { memo: event.target.value })}
                  placeholder="Memo"
                />
                <Input
                  aria-label="Debit centavos"
                  type="number"
                  min="0"
                  step="1"
                  value={line.debit_centavos}
                  onChange={(event) =>
                    updateLine(index, {
                      debit_centavos: Math.max(0, Math.round(Number(event.target.value) || 0)),
                      credit_centavos: Number(event.target.value) > 0 ? 0 : line.credit_centavos,
                    })
                  }
                />
                <Input
                  aria-label="Credit centavos"
                  type="number"
                  min="0"
                  step="1"
                  value={line.credit_centavos}
                  onChange={(event) =>
                    updateLine(index, {
                      credit_centavos: Math.max(0, Math.round(Number(event.target.value) || 0)),
                      debit_centavos: Number(event.target.value) > 0 ? 0 : line.debit_centavos,
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setCorrectionLines((current) =>
                      current.filter((_, lineIndex) => lineIndex !== index),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setCorrectionLines((current) => [
                  ...current,
                  {
                    account_code: accounts[0]?.code || "1010",
                    debit_centavos: 0,
                    credit_centavos: 0,
                    party_user_id: null,
                    memo: "",
                  },
                ])
              }
            >
              Add line
            </Button>
            <Button onClick={() => void saveCorrection()} disabled={savingCorrection}>
              {savingCorrection && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Finalize correction
            </Button>
            <Button variant="ghost" onClick={() => setCorrectingJournalId(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : journals.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          No money records yet. Records start from the date the ledger was switched
          on; anything older is intentionally not included.
        </div>
      ) : (
        <div className="space-y-4">
          {journals.map((journal) => {
            const lines = entries.filter((entry) => entry.journal_id === journal.id);
            const debit = lines.reduce((sum, line) => sum + Number(line.debit_centavos), 0);
            const credit = lines.reduce((sum, line) => sum + Number(line.credit_centavos), 0);
            const balanced = debit === credit;
            return (
              <article key={journal.id} className="rounded-xl border bg-card p-5">
                <div className="flex flex-col justify-between gap-2 sm:flex-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">
                        {describeEvent(journal.event_type)} {money(debit)}
                      </h2>
                      {!balanced && (
                        <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-500">
                          does not balance
                        </span>
                      )}
                      {journal.reversal_of && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">
                          correction
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(journal.effective_at).toLocaleString()}
                      {showAdvanced && ` · ${journal.event_key} · ${journal.status}`}
                    </p>
                    {journal.correction_reason && (
                      <p className="mt-2 text-sm text-amber-600">
                        Reason: {journal.correction_reason}
                      </p>
                    )}
                  </div>
                  {showAdvanced && journal.status === "finalized" && (
                    <div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => beginCorrection(journal)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Correct
                      </Button>
                    </div>
                  )}
                </div>

                {showAdvanced && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2">Account</th>
                          <th>Memo</th>
                          <th className="text-right">Debit</th>
                          <th className="text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => (
                          <tr key={line.id} className="border-b border-border/40">
                            <td className="py-2">
                              {line.account_code} · {accountMap[line.account_code] || "Unknown"}
                            </td>
                            <td>{line.memo || "-"}</td>
                            <td className="text-right">
                              {line.debit_centavos ? money(line.debit_centavos) : "-"}
                            </td>
                            <td className="text-right">
                              {line.credit_centavos ? money(line.credit_centavos) : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
