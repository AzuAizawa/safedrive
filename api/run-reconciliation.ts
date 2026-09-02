import { createClient } from "@supabase/supabase-js";
import {
  extractPayMongoPaymentIds,
  findDuplicateProviderTransactions,
  groupCompletedCheckoutPayments,
  paymentLedgerEventKey,
} from "./lib/reconciliation";
import type { ServiceRoleSupabaseClient } from "./lib/supabaseTypes.js";

export const config = { runtime: "edge" };

type Issue = {
  booking_id?: string | null;
  issue_type: string;
  severity?: "info" | "warning" | "critical";
  provider_reference?: string | null;
  local_reference?: string | null;
  provider_amount_centavos?: number | null;
  local_amount_centavos?: number | null;
};

const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async function handler(req: Request) {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  let failedRun: { supabase: ServiceRoleSupabaseClient; id: string } | null = null;
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const paymongoKey = process.env.PAYMONGO_SECRET_KEY;
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !key) throw new Error("Reconciliation is not configured");
    if (!token) return respond({ error: "Unauthorized" }, 401);
    const supabase: ServiceRoleSupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return respond({ error: "Unauthorized" }, 401);
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "super_admin") return respond({ error: "Super admin access required" }, 403);

    const { data: settings } = await supabase.from("platform_settings").select("ledger_activated_at").eq("id", "default").maybeSingle();
    const periodStart = settings?.ledger_activated_at || new Date().toISOString();
    const periodEnd = new Date().toISOString();
    const { data: run, error: runError } = await supabase.from("reconciliation_runs").insert({ period_start: periodStart, period_end: periodEnd, started_by: user.id, status: "running" }).select("id").single();
    if (runError || !run) throw runError || new Error("Reconciliation run was not created");
    failedRun = { supabase, id: run.id };

    const issues: Issue[] = [];
    const [paymentsResult, journalsResult, entriesResult, depositsResult, subscriptionsResult] = await Promise.all([
      supabase.from("payments").select("id, booking_id, amount, payment_type, status, transaction_id, notes, created_at").gte("created_at", periodStart).order("created_at", { ascending: false }).limit(500),
      supabase.from("ledger_journals").select("id, booking_id, event_key, provider_reference, status, created_at").gte("created_at", periodStart).limit(1000),
      supabase.from("ledger_entries").select("journal_id, debit_centavos, credit_centavos").gte("created_at", periodStart).limit(5000),
      supabase.from("security_deposits").select("id, booking_id, amount_centavos, status, provider_payment_id, claim_deadline, created_at").gte("created_at", periodStart).limit(500),
      supabase.from("subscriptions").select("id, provider_checkout_id, provider_payment_id, amount_centavos, paid_at, created_at").gte("created_at", periodStart).limit(500),
    ]);
    const queryError = paymentsResult.error || journalsResult.error || entriesResult.error || depositsResult.error || subscriptionsResult.error;
    if (queryError) throw queryError;
    const payments = paymentsResult.data ?? [];
    const journals = journalsResult.data ?? [];
    const entries = entriesResult.data ?? [];

    for (const duplicate of findDuplicateProviderTransactions(payments)) {
      issues.push({ booking_id: duplicate.payments[0].booking_id, issue_type: "duplicate_provider_transaction_id", severity: "critical", provider_reference: duplicate.transactionId, local_reference: duplicate.payments.map((item) => item.id).join(",") });
    }

    for (const payment of payments) {
      const ageHours = (Date.now() - new Date(payment.created_at).getTime()) / 3_600_000;
      if (["payout", "refund"].includes(payment.payment_type) && payment.status === "pending" && ageHours >= 24) issues.push({ booking_id: payment.booking_id, issue_type: `pending_${payment.payment_type}_taking_too_long`, severity: "critical", provider_reference: payment.transaction_id, local_reference: payment.id, local_amount_centavos: Math.round(Number(payment.amount) * 100) });
      if (["payout", "refund"].includes(payment.payment_type) && payment.status === "failed") issues.push({ booking_id: payment.booking_id, issue_type: `failed_${payment.payment_type}_requires_attention`, severity: "critical", provider_reference: payment.transaction_id, local_reference: payment.id, local_amount_centavos: Math.round(Number(payment.amount) * 100) });
      if (payment.status === "completed" && payment.transaction_id) {
        const expectedKeys = payment.payment_type === "payout"
          ? [`payout:${payment.transaction_id}`, `manual-payout:${payment.transaction_id}`]
          : payment.payment_type === "refund"
            ? [`refund:${payment.transaction_id}`]
            : [paymentLedgerEventKey(payment)].filter((value): value is string => Boolean(value));
        if (!expectedKeys.some((key) => journals.some((journal) => journal.event_key === key))) {
          issues.push({ booking_id: payment.booking_id, issue_type: "completed_payment_missing_ledger_journal", severity: "critical", provider_reference: payment.transaction_id, local_reference: payment.id, local_amount_centavos: Math.round(Math.abs(Number(payment.amount)) * 100) });
        }
      }
    }

    const allProviderCheckoutGroups = groupCompletedCheckoutPayments(payments);
    const providerCheckoutGroups = allProviderCheckoutGroups.slice(0, 100);
    let providerPaymentRecordsChecked = 0;
    let providerPaymentListTruncated = false;
    if (paymongoKey) {
      const authorization = `Basic ${btoa(`${paymongoKey}:`)}`;
      for (let index = 0; index < providerCheckoutGroups.length; index += 10) {
        await Promise.all(providerCheckoutGroups.slice(index, index + 10).map(async (group) => {
          const providerResponse = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(group.transactionId)}`, { headers: { Accept: "application/json", Authorization: authorization } });
          if (!providerResponse.ok) {
            issues.push({ booking_id: group.bookingId, issue_type: "local_completed_but_provider_not_confirmed", severity: "critical", provider_reference: group.transactionId, local_reference: group.payments.map((payment) => payment.id).join(","), local_amount_centavos: group.localAmountCentavos });
          } else {
            const provider = await providerResponse.json();
            const attrs = provider?.data?.attributes;
            const providerStatus = String(attrs?.payment_intent?.attributes?.status || attrs?.status || "").toLowerCase();
            const providerAmount = Number(attrs?.payment_intent?.attributes?.amount ?? attrs?.payments?.[0]?.attributes?.amount);
            if (providerStatus && !["succeeded", "paid", "completed"].includes(providerStatus)) issues.push({ booking_id: group.bookingId, issue_type: "local_completed_but_provider_not_confirmed", severity: "critical", provider_reference: group.transactionId, local_reference: group.payments.map((payment) => payment.id).join(",") });
            if (Number.isFinite(providerAmount) && providerAmount !== group.localAmountCentavos) issues.push({ booking_id: group.bookingId, issue_type: "provider_local_amount_mismatch", severity: "critical", provider_reference: group.transactionId, local_reference: group.payments.map((payment) => payment.id).join(","), provider_amount_centavos: providerAmount, local_amount_centavos: group.localAmountCentavos });
          }
        }));
      }

      const localProviderPaymentIds = new Set<string>();
      for (const payment of payments) {
        for (const paymentId of extractPayMongoPaymentIds(payment.notes)) localProviderPaymentIds.add(paymentId);
      }
      for (const subscription of subscriptionsResult.data ?? []) {
        if (subscription.provider_payment_id) localProviderPaymentIds.add(subscription.provider_payment_id);
      }
      for (const deposit of depositsResult.data ?? []) {
        if (String(deposit.provider_payment_id || "").startsWith("pay_")) localProviderPaymentIds.add(deposit.provider_payment_id);
      }
      const providerListUrl = new URL("https://api.paymongo.com/v1/payments");
      providerListUrl.searchParams.set("limit", "100");
      providerListUrl.searchParams.set("status", "paid");
      providerListUrl.searchParams.set("created_at[gte]", String(Math.floor(new Date(periodStart).getTime() / 1000)));
      const providerListResponse = await fetch(providerListUrl, { headers: { Accept: "application/json", Authorization: authorization } });
      if (providerListResponse.ok) {
        const providerList = await providerListResponse.json();
        const providerRecords = Array.isArray(providerList?.data) ? providerList.data : [];
        providerPaymentRecordsChecked = providerRecords.length;
        providerPaymentListTruncated = providerRecords.length === 100;
        if (providerPaymentListTruncated) {
          issues.push({ issue_type: "provider_payment_list_may_be_truncated", severity: "warning", provider_reference: "first 100 paid payments" });
        }
        for (const providerRecord of providerRecords) {
          const providerId = typeof providerRecord?.id === "string" ? providerRecord.id : null;
          if (!providerId || localProviderPaymentIds.has(providerId)) continue;
          const providerAmount = Number(providerRecord?.attributes?.amount);
          issues.push({ issue_type: "provider_paid_payment_missing_local_record", severity: "critical", provider_reference: providerId, provider_amount_centavos: Number.isFinite(providerAmount) ? providerAmount : null });
        }
      } else {
        issues.push({ issue_type: "provider_payment_list_unavailable", severity: "warning", provider_reference: `HTTP ${providerListResponse.status}` });
      }
    }

    for (const journal of journals) {
      const lines = entries.filter((entry) => entry.journal_id === journal.id);
      const debits = lines.reduce((sum, line) => sum + Number(line.debit_centavos), 0);
      const credits = lines.reduce((sum, line) => sum + Number(line.credit_centavos), 0);
      if (debits === 0 || debits !== credits) issues.push({ booking_id: journal.booking_id, issue_type: "ledger_journal_does_not_balance", severity: "critical", provider_reference: journal.provider_reference, local_reference: journal.id, provider_amount_centavos: credits, local_amount_centavos: debits });
      if (journal.status !== "finalized") issues.push({ booking_id: journal.booking_id, issue_type: "draft_ledger_journal_requires_review", severity: "warning", provider_reference: journal.provider_reference, local_reference: journal.id });
    }

    for (const deposit of depositsResult.data ?? []) {
      if (deposit.status === "return_review" && deposit.claim_deadline && new Date(deposit.claim_deadline).getTime() < Date.now()) issues.push({ booking_id: deposit.booking_id, issue_type: "security_deposit_claim_window_expired_release_required", severity: "critical", provider_reference: deposit.provider_payment_id, local_reference: deposit.id, local_amount_centavos: Number(deposit.amount_centavos) });
    }

    if (issues.length) {
      const { error: itemError } = await supabase.from("reconciliation_items").insert(issues.map((issue) => ({ ...issue, run_id: run.id, status: "open" })));
      if (itemError) throw itemError;
    }
    const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
    const { error: completionError } = await supabase.from("reconciliation_runs").update({ status: "completed", completed_at: new Date().toISOString(), summary: { issues: issues.length, critical: criticalCount, records_checked: { payments: payments.length, journals: journals.length, deposits: depositsResult.data?.length ?? 0, subscriptions: subscriptionsResult.data?.length ?? 0 }, provider_checks_enabled: Boolean(paymongoKey), provider_checkout_groups_checked: paymongoKey ? providerCheckoutGroups.length : 0, provider_payment_records_checked: providerPaymentRecordsChecked, provider_checks_truncated: Boolean(paymongoKey && (allProviderCheckoutGroups.length > providerCheckoutGroups.length || providerPaymentListTruncated)) } }).eq("id", run.id);
    if (completionError) throw completionError;
    if (criticalCount > 0) {
      const { data: superAdmins } = await supabase.from("profiles").select("id").eq("role", "super_admin").is("deleted_at", null);
      if (superAdmins?.length) {
        await supabase.from("notifications").insert(superAdmins.map((admin) => ({
          user_id: admin.id,
          title: "Financial reconciliation needs review",
          message: `${criticalCount} critical mismatch${criticalCount === 1 ? "" : "es"} detected. No money was moved automatically.`,
          type: "financial",
          link: "/admin/reconciliation",
        })));
      }
    }
    await supabase.from("audit_log").insert({ user_id: user.id, action: "financial_reconciliation_run", entity_type: "reconciliation_run", entity_id: run.id, details: { period_start: periodStart, period_end: periodEnd, issues: issues.length, provider_checks_enabled: Boolean(paymongoKey) } });
    failedRun = null;
    return respond({ success: true, runId: run.id, issues: issues.length });
  } catch (error) {
    console.error("Reconciliation run failed", error);
    if (failedRun) {
      await failedRun.supabase.from("reconciliation_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        summary: { error: error instanceof Error ? error.message : "Reconciliation failed" },
      }).eq("id", failedRun.id);
    }
    return respond({ error: error instanceof Error ? error.message : "Reconciliation failed" }, 500);
  }
}
