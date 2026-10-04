import { useCallback, useEffect, useState } from "react";
import { DatabaseZap, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/database";
import { formatDayCount } from "@/lib/formatCount";
import BookingPagination from "@/components/BookingPagination";
import { usePagedItems } from "@/lib/usePagedItems";

type Request = Database["public"]["Tables"]["data_retention_requests"]["Row"];
type Rule = Database["public"]["Tables"]["retention_policy_rules"]["Row"];

// The one retention rule a job enforces (api/purge-deleted-notifications.ts).
// Every other row is the policy SafeDrive keeps records by.
const ENFORCED_RULES = new Set(["deleted_notification"]);

const origin = (item: Request) =>
  item.request_details.startsWith("Self-service account deletion")
    ? "Asked by the member"
    : item.request_details.startsWith("Dormant account") || item.request_details.startsWith("System-flagged")
      ? "No sign-in past the limit"
      : "Earlier privacy request";

const manila = (value: string) =>
  new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

/**
 * Account Deletions (CHAPTER 121): a view of every account deletion - asked
 * for by the member (CHAPTER 96) or scheduled because nobody signed in - and of
 * the retention schedule. Nothing is approved here: a deletion runs on its
 * date unless its owner signs in and keeps the account, and one that is held
 * (a suspension, an unfinished booking or payout) is handled from User
 * Management. Requests filed before CHAPTER 121 stay listed as history.
 */
export default function AdminRetentionRequestsPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const requestPages = usePagedItems(requests, "deletions");

  const load = useCallback(async () => {
    setLoading(true);
    const [requestResult, ruleResult] = await Promise.all([
      supabase.from("data_retention_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("retention_policy_rules").select("*").order("record_category"),
    ]);
    const error = requestResult.error || ruleResult.error;
    if (error) toast.error("Account deletions could not be loaded", { description: error.message });
    else {
      setRequests(requestResult.data ?? []);
      setRules(ruleResult.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <DatabaseZap className="h-7 w-7" /> Account Deletions
        </h1>
        <p className="mt-1 text-muted-foreground">
          Every account scheduled for deletion - by its owner, or because nobody signed in to it
          past the limit in Platform Settings - and what happened to it. A deletion runs on its date
          unless the owner signs in and keeps the account. One that is on hold (a suspension, or a
          booking, refund or payout not yet finished) is handled from User Management.
        </p>
      </div>

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : requests.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No account deletions yet.
        </p>
      ) : (
        <div className="space-y-3">
          {requestPages.items.map((item) => (
            <article key={item.id} className="rounded-xl border bg-card p-4">
              <h2 className="font-semibold">{item.requester_email}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {origin(item)} · {item.request_type} · {item.request_details}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Status: {item.status.replace(/_/g, " ")} · Received {manila(item.created_at)}
                {item.due_at ? ` · Scheduled ${manila(item.due_at)}` : ""}
                {item.completed_at ? ` · Done ${manila(item.completed_at)}` : ""}
              </p>
              {(item.legal_hold_reason || item.decision_reason) && (
                <p className="mt-2 text-sm">{item.legal_hold_reason || item.decision_reason}</p>
              )}
            </article>
          ))}
          <BookingPagination {...requestPages.paginationProps} noun="deletions" />
        </div>
      )}

      <section>
        <h2 className="text-xl font-semibold">Retention schedule</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How long SafeDrive keeps each kind of record. These follow tax, contract and evidence
          rules, so they are fixed rather than settings; only the one marked "Enforced
          automatically" is removed by a job.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {rules.map((rule) => (
            <div key={rule.record_category} className="rounded-xl border bg-card p-4">
              <p className="flex items-center justify-between gap-2 font-medium">
                {rule.record_category.replace(/_/g, " ")}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {ENFORCED_RULES.has(rule.record_category) ? "Enforced automatically" : "Policy"}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {rule.retention_days === null
                  ? "While legally or operationally required"
                  : formatDayCount(rule.retention_days)}{" "}
                · {rule.rationale}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
