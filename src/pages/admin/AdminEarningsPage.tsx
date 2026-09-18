import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Coins, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { loadAdminAttentionItems, type AdminAttentionItem } from "@/lib/adminAttention";
import { buildCsv, csvFileName, downloadCsv } from "@/lib/csvExport";
import {
  describeRange,
  isDayWithinRange,
  isWithinRange,
  periodRange,
  PERIOD_LABELS,
  type EarningsPeriod,
} from "@/lib/earningsPeriod";
import {
  summarizeCancellations,
  summarizeQueueHealth,
  summarizeRefundKinds,
  type CancellationRow,
  type RefundRow,
} from "@/lib/insightsSummary";
import { buildEarningsExportRows, EARNINGS_EXPORT_HEADERS } from "@/lib/ledgerExportRows";
import { formatElapsed } from "@/lib/queueAge";
import { supabase } from "@/lib/supabase";

// Revenue accounts in the double-entry ledger. Commission is recognised when
// a booking completes; subscription revenue when the plan is paid.
const COMMISSION_ACCOUNT = "4010";
const SUBSCRIPTION_ACCOUNT = "4030";

// Every query is capped. If a cap is actually reached the page says so
// instead of quietly showing a total that is missing rows - the Financial
// Ledger page's mismatched limits used to produce exactly that kind of
// silently-wrong figure.
const ROW_LIMIT = 5000;

const peso = (centavos: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(centavos / 100);

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

type LedgerEntryRow = {
  journal_id: string;
  account_code: string;
  credit_centavos: number;
  debit_centavos: number;
};
type JournalRow = { id: string; effective_at: string };
type BookingRow = {
  commission: number | string | null;
  status: string;
  start_date: string;
  // Where the trip actually started, frozen at booking time. Reading the live
  // car meant a lister who moved provinces silently re-bucketed every one of
  // their completed bookings into the new region.
  pickup_location_snapshot: string | null;
  cars: { location: string | null; car_models: { body_type: string | null } | null } | null;
};
type CarRow = { location: string | null; status: string };
type SubscriptionRow = { amount_centavos: number | null; paid_at: string | null };

type MonthBucket = { key: string; label: string; commission: number; subscription: number };

// A Manila calendar day: the day an admin picks means midnight to midnight in
// Manila, which is how the books are kept.
const manilaDayStart = (day: string) => `${day}T00:00:00+08:00`;
const manilaDayEnd = (day: string) => `${day}T23:59:59.999+08:00`;
const todayInManila = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const firstOfManilaYear = () => `${todayInManila().slice(0, 4)}-01-01`;
const manilaMonthKey = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" })
    .format(parsed)
    .slice(0, 7);
};
const monthLabelFromKey = (key: string) => {
  const [year, month] = key.split("-");
  return `${MONTH_LABELS[Number(month) - 1] ?? month} ${year}`;
};

// Every query is capped, so the export walks its range in pages instead of
// reusing the page view - a short file would be read as a low month.
const EXPORT_PAGE_SIZE = 1000;

export default function AdminEarningsPage() {
  const { user } = useAuth();
  // One period drives the whole page: the three totals, the chart and the
  // export. They used to disagree - the totals counted every record ever while
  // the dates above them only steered the download, so "Total earned" answered
  // a question nobody had asked.
  const [period, setPeriod] = useState<EarningsPeriod>("year");
  const [customFrom, setCustomFrom] = useState(firstOfManilaYear);
  const [customTo, setCustomTo] = useState(todayInManila);
  const [exporting, setExporting] = useState(false);

  const range = useMemo(
    () => periodRange(period, { from: customFrom, to: customTo }),
    [period, customFrom, customTo],
  );
  const exportFrom = range.from;
  const exportTo = range.to;
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LedgerEntryRow[]>([]);
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [cars, setCars] = useState<CarRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [cancellations, setCancellations] = useState<CancellationRow[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [queueItems, setQueueItems] = useState<AdminAttentionItem[]>([]);
  const [truncated, setTruncated] = useState(false);

  // The three Insights sections: counted from records already kept, never from
  // tracking. Each one answers a question the money figures cannot.
  const cancellationSummary = useMemo(
    () => summarizeCancellations(cancellations),
    [cancellations],
  );
  const refundSummary = useMemo(() => summarizeRefundKinds(refunds), [refunds]);
  const queueHealth = useMemo(() => summarizeQueueHealth(queueItems), [queueItems]);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      entryResult,
      journalResult,
      bookingResult,
      carResult,
      subscriptionResult,
      cancellationResult,
      refundResult,
      attentionItems,
    ] = await Promise.all([
        supabase
          .from("ledger_entries")
          .select("journal_id, account_code, credit_centavos, debit_centavos")
          .in("account_code", [COMMISSION_ACCOUNT, SUBSCRIPTION_ACCOUNT])
          .limit(ROW_LIMIT),
        supabase.from("ledger_journals").select("id, effective_at").limit(ROW_LIMIT),
        supabase
          .from("bookings")
          // body_type and the car's location come along so the demand
          // sections below need no second trip - both are columns that
          // already exist, nothing new is being recorded.
          .select(
            "commission, status, start_date, pickup_location_snapshot, cars(location, car_models(body_type))",
          )
          .eq("status", "completed")
          .limit(ROW_LIMIT),
        supabase
          // Every listed car, to sit beside the booking counts per region.
          // A region with cars and no bookings is the finding that matters.
          .from("cars")
          .select("location, status")
          .in("status", ["approved", "active"])
          .is("deleted_at", null)
          .limit(ROW_LIMIT),
        supabase
          .from("subscriptions")
          .select("amount_centavos, paid_at")
          .not("amount_centavos", "is", null)
          .limit(ROW_LIMIT),
        // Why bookings ended early, and what refunds were actually for. Both
        // are records SafeDrive already keeps - nothing new is collected.
        supabase
          .from("booking_cancellations")
          .select("cancelled_by_role, reason, was_late")
          .limit(ROW_LIMIT),
        supabase
          .from("payments")
          .select("notes, payment_method")
          .eq("payment_type", "refund")
          .limit(ROW_LIMIT),
        // The same queue list the notification bell and the sidebar dots read,
        // so the three can never tell the admin different things.
        loadAdminAttentionItems(true).catch(() => []),
      ]);

    const error =
      entryResult.error ||
      journalResult.error ||
      bookingResult.error ||
      carResult.error ||
      subscriptionResult.error ||
      cancellationResult.error ||
      refundResult.error;
    if (error) {
      toast.error("Earnings could not be loaded", { description: error.message });
      setLoading(false);
      return;
    }

    const entryRows = (entryResult.data ?? []) as LedgerEntryRow[];
    const journalRows = (journalResult.data ?? []) as JournalRow[];
    const bookingRows = (bookingResult.data ?? []) as BookingRow[];
    const carRows = (carResult.data ?? []) as CarRow[];
    const subscriptionRows = (subscriptionResult.data ?? []) as SubscriptionRow[];

    const cancellationRows = (cancellationResult.data ?? []) as CancellationRow[];
    const refundRows = (refundResult.data ?? []) as RefundRow[];

    setEntries(entryRows);
    setJournals(journalRows);
    setBookings(bookingRows);
    setCars(carRows);
    setSubscriptions(subscriptionRows);
    setCancellations(cancellationRows);
    setRefunds(refundRows);
    setQueueItems(attentionItems);
    setTruncated(
      entryRows.length >= ROW_LIMIT ||
        journalRows.length >= ROW_LIMIT ||
        bookingRows.length >= ROW_LIMIT ||
        carRows.length >= ROW_LIMIT ||
        subscriptionRows.length >= ROW_LIMIT ||
        cancellationRows.length >= ROW_LIMIT ||
        refundRows.length >= ROW_LIMIT,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // SafeDrive's own income for a chosen period: commission and subscriptions,
  // read from the ledger. Deliberately not the gross value of bookings - most
  // of that is money held for listers, not revenue.
  const exportEarnings = async () => {
    if (!exportFrom || !exportTo) {
      toast.error("Choose both dates", {
        description: "The export covers a start and an end date.",
      });
      return;
    }
    if (exportFrom > exportTo) {
      toast.error("Check the dates", {
        description: "The start date must come before the end date.",
      });
      return;
    }

    setExporting(true);
    try {
      // Journals carry the date; revenue entries hang off them. Both are walked
      // in pages so a long period cannot be cut short.
      const rangeJournals: Array<{ id: string; effective_at: string }> = [];
      for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
        const { data, error } = await supabase
          .from("ledger_journals")
          .select("id, effective_at")
          .gte("effective_at", manilaDayStart(exportFrom))
          .lte("effective_at", manilaDayEnd(exportTo))
          .order("effective_at", { ascending: true })
          .range(offset, offset + EXPORT_PAGE_SIZE - 1);
        if (error) throw error;
        const rows = (data ?? []) as Array<{ id: string; effective_at: string }>;
        rangeJournals.push(...rows);
        if (rows.length < EXPORT_PAGE_SIZE) break;
      }

      const monthByJournal = new Map<string, string>();
      for (const journal of rangeJournals) {
        const key = manilaMonthKey(journal.effective_at);
        if (key) monthByJournal.set(journal.id, key);
      }

      const buckets = new Map<string, { commission: number; subscription: number }>();
      const addTo = (key: string, field: "commission" | "subscription", centavos: number) => {
        const bucket = buckets.get(key) ?? { commission: 0, subscription: 0 };
        bucket[field] += centavos;
        buckets.set(key, bucket);
      };

      if (rangeJournals.length) {
        const ids = rangeJournals.map((journal) => journal.id);
        for (let index = 0; index < ids.length; index += 200) {
          const { data, error } = await supabase
            .from("ledger_entries")
            .select("journal_id, account_code, credit_centavos, debit_centavos")
            .in("account_code", [COMMISSION_ACCOUNT, SUBSCRIPTION_ACCOUNT])
            .in("journal_id", ids.slice(index, index + 200));
          if (error) throw error;
          for (const entry of (data ?? []) as LedgerEntryRow[]) {
            // Revenue accounts are credit-balance, so a reversal subtracts.
            const amount =
              Number(entry.credit_centavos || 0) - Number(entry.debit_centavos || 0);
            const key = monthByJournal.get(entry.journal_id);
            if (!key || amount === 0) continue;
            addTo(
              key,
              entry.account_code === SUBSCRIPTION_ACCOUNT ? "subscription" : "commission",
              amount,
            );
          }
        }
      }

      const monthKeys = Array.from(buckets.keys()).sort();
      if (!monthKeys.length) {
        toast.info("No earnings in that range", {
          description: "No commission or subscription was recorded between those dates.",
        });
        return;
      }

      downloadCsv(
        csvFileName("earnings", exportFrom, exportTo),
        buildCsv(
          EARNINGS_EXPORT_HEADERS,
          buildEarningsExportRows(
            monthKeys.map((key) => ({
              label: monthLabelFromKey(key),
              commission: buckets.get(key)?.commission ?? 0,
              subscription: buckets.get(key)?.subscription ?? 0,
            })),
          ),
        ),
      );

      const { error: auditError } = await supabase.from("audit_log").insert({
        user_id: user?.id ?? null,
        action: "earnings_exported",
        entity_type: "ledger_journals",
        entity_id: `${exportFrom}_${exportTo}`,
        details: {
          admin_email: user?.email,
          from: exportFrom,
          to: exportTo,
          months: monthKeys.length,
        },
      });
      if (auditError) {
        console.warn("Earnings export was not audited:", auditError.message);
      }

      toast.success("Earnings exported", {
        description: `${monthKeys.length} month${
          monthKeys.length === 1 ? "" : "s"
        } for ${exportFrom} to ${exportTo}.`,
      });
    } catch (error) {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setExporting(false);
    }
  };

  const summary = useMemo(() => {
    const journalDate = new Map(journals.map((journal) => [journal.id, journal.effective_at]));
    // Everything below counts only what falls inside the chosen period, and
    // both counts - ledger and source records - are filtered the same way, or
    // the cross-check would report a mismatch that is really just two
    // different spans of time.
    const inRange = (entry: LedgerEntryRow) =>
      isWithinRange(journalDate.get(entry.journal_id), range);
    const entriesInRange = entries.filter(inRange);
    const bookingsInRange = bookings.filter((booking) =>
      isDayWithinRange(booking.start_date, range),
    );
    const subscriptionsInRange = subscriptions.filter((row) =>
      isWithinRange(row.paid_at, range),
    );

    // Revenue accounts are credit-balance: a credit adds revenue, a debit
    // (a correction or reversal) takes it back. Netting the two is what
    // makes a reversed journal disappear from the total instead of being
    // counted twice.
    const net = (accountCode: string) =>
      entriesInRange
        .filter((entry) => entry.account_code === accountCode)
        .reduce(
          (total, entry) =>
            total + Number(entry.credit_centavos || 0) - Number(entry.debit_centavos || 0),
          0,
        );

    const commissionCentavos = net(COMMISSION_ACCOUNT);
    const subscriptionCentavos = net(SUBSCRIPTION_ACCOUNT);

    // Independent second count, from the source tables rather than the
    // ledger. Two separate paths agreeing is the proof that a figure is
    // right - not the fact that one of them was printed confidently.
    const bookingCommissionCentavos = bookingsInRange.reduce(
      (total, booking) => total + Math.round(Number(booking.commission || 0) * 100),
      0,
    );
    const subscriptionPaidCentavos = subscriptionsInRange.reduce(
      (total, row) => total + Number(row.amount_centavos || 0),
      0,
    );

    const monthMap = new Map<string, MonthBucket>();
    const addToMonth = (isoDate: string | undefined, field: "commission" | "subscription", centavos: number) => {
      if (!isoDate) return;
      const date = new Date(isoDate);
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const bucket =
        monthMap.get(key) ??
        { key, label: `${MONTH_LABELS[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`, commission: 0, subscription: 0 };
      bucket[field] += centavos;
      monthMap.set(key, bucket);
    };

    entriesInRange.forEach((entry) => {
      const amount = Number(entry.credit_centavos || 0) - Number(entry.debit_centavos || 0);
      if (amount === 0) return;
      addToMonth(
        journalDate.get(entry.journal_id),
        entry.account_code === SUBSCRIPTION_ACCOUNT ? "subscription" : "commission",
        amount,
      );
    });

    // Every month inside the period, not a silent "last 12". Once more than a
    // year of records exists, the period control is what narrows the chart -
    // dropping the older bars without saying so hid earnings that happened.
    const months = Array.from(monthMap.values()).sort((a, b) =>
      a.key.localeCompare(b.key),
    );

    // Busiest periods are counted from completed bookings by the date the
    // rental starts - that is the season question ("when are we busy?"),
    // not the date someone happened to click Book.
    const monthCounts = new Array(12).fill(0) as number[];
    const dayCounts = new Array(7).fill(0) as number[];
    bookingsInRange.forEach((booking) => {
      const date = new Date(booking.start_date);
      if (Number.isNaN(date.getTime())) return;
      monthCounts[date.getMonth()] += 1;
      dayCounts[date.getDay()] += 1;
    });
    const peakMonthIndex = monthCounts.indexOf(Math.max(...monthCounts));
    const peakDayIndex = dayCounts.indexOf(Math.max(...dayCounts));

    return {
      commissionCentavos,
      subscriptionCentavos,
      totalCentavos: commissionCentavos + subscriptionCentavos,
      bookingCommissionCentavos,
      subscriptionPaidCentavos,
      completedBookings: bookingsInRange.length,
      paidSubscriptions: subscriptionsInRange.length,
      months,
      peakMonth: monthCounts[peakMonthIndex] > 0 ? MONTH_LABELS[peakMonthIndex] : null,
      peakMonthCount: monthCounts[peakMonthIndex] ?? 0,
      peakDay: dayCounts[peakDayIndex] > 0 ? DAY_LABELS[peakDayIndex] : null,
      peakDayCount: dayCounts[peakDayIndex] ?? 0,
    };
  }, [entries, journals, bookings, subscriptions, range]);

  // What renters are actually booking, and where. Both read columns that
  // already exist - car_models.body_type from the admin catalog, and the
  // region segment of cars.location, which is stored as
  // "Region - City - Specific" (same split MyVehiclesPage does).
  const regionOf = (location: string | null) =>
    (location ?? "").split(" - ")[0]?.trim() || "Not set";

  const demand = useMemo(() => {
    const byType = new Map<string, number>();
    const byRegion = new Map<string, number>();

    // Bookings follow the period; listed cars do not - a car is listed now or
    // it is not, so "cars listed vs bookings" compares today's fleet against
    // the period's trips.
    const bookingsInRange = bookings.filter((booking) =>
      isDayWithinRange(booking.start_date, range),
    );

    bookingsInRange.forEach((booking) => {
      const type = booking.cars?.car_models?.body_type?.trim() || "Not set";
      byType.set(type, (byType.get(type) ?? 0) + 1);
      const region = regionOf(
        booking.pickup_location_snapshot ?? booking.cars?.location ?? null,
      );
      byRegion.set(region, (byRegion.get(region) ?? 0) + 1);
    });

    const listedByRegion = new Map<string, number>();
    cars.forEach((car) => {
      const region = regionOf(car.location);
      listedByRegion.set(region, (listedByRegion.get(region) ?? 0) + 1);
    });

    // Every region that has EITHER a car or a booking. A region holding cars
    // with zero bookings is the whole reason this section exists, so it must
    // not be dropped for having no bookings.
    const regionNames = Array.from(
      new Set([...listedByRegion.keys(), ...byRegion.keys()]),
    );

    const sortDesc = (map: Map<string, number>) =>
      Array.from(map.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    return {
      types: sortDesc(byType),
      regions: regionNames
        .map((name) => ({
          label: name,
          listed: listedByRegion.get(name) ?? 0,
          booked: byRegion.get(name) ?? 0,
        }))
        .sort((a, b) => b.booked - a.booked || b.listed - a.listed),
      totalListed: cars.length,
    };
  }, [bookings, cars, range]);

  const chartMax = Math.max(
    1,
    ...summary.months.map((month) => month.commission + month.subscription),
  );

  const renderCheck = (ledgerCentavos: number, sourceCentavos: number, sourceLabel: string) => {
    // A centavo of tolerance: stored pesos are rounded to 2 decimals, the
    // ledger is whole centavos, so an exact-equality check would flag noise.
    const matches = Math.abs(ledgerCentavos - sourceCentavos) <= 1;
    return (
      <p
        className={`mt-2 flex items-start gap-1.5 text-xs ${
          matches ? "text-green-600" : "text-red-500"
        }`}
      >
        {matches ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <span>
          {matches
            ? `Matches ${sourceLabel} (${peso(sourceCentavos)})`
            : `Does not match ${sourceLabel} (${peso(sourceCentavos)}) - difference ${peso(
                Math.abs(ledgerCentavos - sourceCentavos),
              )}. Check Reconciliation.`}
        </span>
      </p>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Coins className="h-7 w-7" /> Earnings &amp; Insights
          </h1>
          <p className="mt-1 text-muted-foreground">
            What SafeDrive earned, when the platform is busiest, and what the
            records say about cancellations, refunds and work still waiting.
            Every total below is counted twice - once from the ledger, once from
            the original records - and flagged if the two disagree.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* For the accountant: the monthly summary for a chosen period, walked in
          full rather than taken from the capped view above. */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end">
        <div className="flex flex-wrap items-center gap-2">
          {(["month", "year", "all", "custom"] as EarningsPeriod[]).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={period === option ? "default" : "outline"}
              onClick={() => setPeriod(option)}
            >
              {PERIOD_LABELS[option]}
            </Button>
          ))}
        </div>

        {period === "custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="earnings-from">From</Label>
              <Input
                id="earnings-from"
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="w-full sm:w-44"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="earnings-to">To</Label>
              <Input
                id="earnings-to"
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) => setCustomTo(event.target.value)}
                className="w-full sm:w-44"
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={exporting}
            onClick={() => void exportEarnings()}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
          <p className="text-xs text-muted-foreground sm:max-w-md">
            Everything on this page - the totals, the chart and the export -
            covers <strong className="text-foreground">{describeRange(period, range)}</strong>,
            on the Manila calendar. The export adds the month-by-month split.
          </p>
        </div>
      </div>

      {truncated && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            More records exist than this page loads ({ROW_LIMIT.toLocaleString()} per
            table), so these totals are incomplete. Treat them as a partial view.
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-card p-5">
              <p className="text-sm text-muted-foreground">From booking commission</p>
              <p className="mt-1 text-3xl font-bold">{peso(summary.commissionCentavos)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {summary.completedBookings} completed booking
                {summary.completedBookings === 1 ? "" : "s"}
                {summary.completedBookings > 0 &&
                  ` · average ${peso(
                    Math.round(summary.commissionCentavos / summary.completedBookings),
                  )} each`}
              </p>
              {renderCheck(
                summary.commissionCentavos,
                summary.bookingCommissionCentavos,
                "booking records",
              )}
            </div>

            <div className="rounded-xl border bg-card p-5">
              <p className="text-sm text-muted-foreground">From subscriptions</p>
              <p className="mt-1 text-3xl font-bold">{peso(summary.subscriptionCentavos)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {summary.paidSubscriptions} paid subscription
                {summary.paidSubscriptions === 1 ? "" : "s"}
              </p>
              {renderCheck(
                summary.subscriptionCentavos,
                summary.subscriptionPaidCentavos,
                "subscription records",
              )}
            </div>

            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
              <p className="text-sm text-muted-foreground">Total earned</p>
              <p className="mt-1 text-3xl font-bold">{peso(summary.totalCentavos)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {peso(summary.commissionCentavos)} commission +{" "}
                {peso(summary.subscriptionCentavos)} subscriptions
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {describeRange(period, range)}
              </p>
            </div>
          </div>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">Earnings by month</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.months.length} month
              {summary.months.length === 1 ? "" : "s"} with activity in{" "}
              {describeRange(period, range).toLowerCase()}. Each bar shows what
              that month earned, split into commission and subscriptions.
            </p>
            {summary.months.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No earnings recorded yet.
              </p>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <div className="flex min-w-[520px] items-end gap-3" style={{ height: 200 }}>
                  {summary.months.map((month) => {
                    const total = month.commission + month.subscription;
                    return (
                      <div key={month.key} className="flex flex-1 flex-col items-center gap-2">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {peso(total)}
                        </span>
                        <div
                          className="flex w-full flex-col justify-end overflow-hidden rounded-t-md bg-muted/40"
                          style={{ height: `${Math.max(4, (total / chartMax) * 150)}px` }}
                          title={`${month.label}: ${peso(total)}`}
                        >
                          {month.subscription > 0 && (
                            <div
                              className="w-full bg-amber-500/70"
                              style={{ height: `${(month.subscription / total) * 100}%` }}
                            />
                          )}
                          {month.commission > 0 && (
                            <div
                              className="w-full bg-primary/70"
                              style={{ height: `${(month.commission / total) * 100}%` }}
                            />
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground">{month.label}</span>
                        {/* The split in figures, not only in colour: the bar
                            showed which was bigger, never by how much. */}
                        <span className="text-[10px] leading-tight text-primary/80">
                          {peso(month.commission)}
                        </span>
                        <span className="text-[10px] leading-tight text-amber-600 dark:text-amber-400">
                          {peso(month.subscription)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-primary/70" /> Commission
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-amber-500/70" /> Subscriptions
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-card p-5">
              <p className="text-sm text-muted-foreground">Busiest month</p>
              <p className="mt-1 text-2xl font-bold">{summary.peakMonth ?? "Not enough data"}</p>
              {summary.peakMonth && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {summary.peakMonthCount} completed booking
                  {summary.peakMonthCount === 1 ? "" : "s"} started in this month,
                  counted across all years.
                </p>
              )}
            </div>
            <div className="rounded-xl border bg-card p-5">
              <p className="text-sm text-muted-foreground">Busiest day of the week</p>
              <p className="mt-1 text-2xl font-bold">{summary.peakDay ?? "Not enough data"}</p>
              {summary.peakDay && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {summary.peakDayCount} completed booking
                  {summary.peakDayCount === 1 ? "" : "s"} started on this day.
                </p>
              )}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-card p-5">
              <h2 className="font-semibold">Most booked car types</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Completed bookings, counted by the kind of vehicle. Tells you
                what to look for when recruiting more cars.
              </p>
              {demand.types.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No completed bookings yet.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {demand.types.map((row) => (
                    <div key={row.label} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-sm">{row.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{
                            width: `${(row.count / demand.types[0].count) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-sm font-medium">
                        {row.count} {row.count === 1 ? "trip" : "trips"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-card p-5">
              <h2 className="font-semibold">Cars listed vs bookings, by area</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {demand.totalListed} car{demand.totalListed === 1 ? "" : "s"}{" "}
                listed. An area with cars but no bookings is the one to look at
                - the cars are there and nobody is renting them.
              </p>
              {demand.regions.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No cars listed yet.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2">Area</th>
                        <th className="text-right">Cars listed</th>
                        <th className="text-right">Bookings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {demand.regions.map((row) => (
                        <tr key={row.label} className="border-b border-border/40">
                          <td className="py-2">{row.label}</td>
                          <td className="text-right">{row.listed}</td>
                          <td
                            className={`text-right font-medium ${
                              row.listed > 0 && row.booked === 0 ? "text-amber-600" : ""
                            }`}
                          >
                            {row.booked}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* The findings the money figures cannot answer: who walks away from a
              booking, what refunds were really for, and what is waiting. */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-card p-5">
              <h2 className="font-semibold">Why bookings were cancelled</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {cancellationSummary.total} cancellation
                {cancellationSummary.total === 1 ? "" : "s"} on record
                {cancellationSummary.late > 0
                  ? `, ${cancellationSummary.late} of them late enough to charge a fee`
                  : ""}
                . A lister who accepts and then backs out costs a renter their
                trip - that is a moderation question, not a statistic.
              </p>
              {cancellationSummary.total === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No cancellations recorded yet.
                </p>
              ) : (
                <>
                  <div className="mt-4 space-y-2">
                    {cancellationSummary.byRole.map((row) => (
                      <div key={row.key} className="flex items-center gap-3">
                        <span className="w-44 shrink-0 text-sm">{row.label}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{
                              width: `${(row.count / cancellationSummary.byRole[0].count) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-sm font-medium">
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 border-t border-border/40 pt-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Reasons given
                    </p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {cancellationSummary.byReason.slice(0, 5).map((row) => (
                        <li key={row.key} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate">{row.label}</span>
                          <span className="shrink-0 font-medium">{row.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>

            <div className="rounded-xl border bg-card p-5">
              <h2 className="font-semibold">What refunds were for</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {refundSummary.total} refund record
                {refundSummary.total === 1 ? "" : "s"}, grouped the same way the
                Refund Review screen groups them. A run of "Claim: no car at
                pickup" means something different from a run of "Cancellation
                fee".
              </p>
              {refundSummary.total === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No refunds recorded yet.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {refundSummary.slices.map((slice) => (
                    <div key={slice.key} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 text-sm">{slice.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-amber-500/70"
                          style={{
                            width: `${(slice.count / refundSummary.slices[0].count) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-sm font-medium">
                        {slice.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">Work still waiting</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The same queues the notification bell and the sidebar dots read, so
              the three always agree. A count alone hides the shape: five items
              waiting an hour is a busy day, one waiting nine days is a person
              who was forgotten.
            </p>
            {queueHealth.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing is waiting for review right now.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2">Queue</th>
                      <th className="text-right">Waiting</th>
                      <th className="text-right">Oldest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueHealth.map((row) => (
                      <tr key={row.key} className="border-b border-border/40">
                        <td className="py-2">{row.label}</td>
                        <td className="text-right">{row.count}</td>
                        <td className="text-right font-medium">
                          {formatElapsed(row.oldestCreatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            <h2 className="font-semibold text-foreground">How these numbers are counted</h2>
            <ul className="mt-2 space-y-1.5">
              <li>
                <strong className="text-foreground">Commission</strong> - SafeDrive's
                share of a rental. The renter pays the listed price and the lister
                absorbs the commission, so it is earned when a booking completes.
                Counted from ledger account {COMMISSION_ACCOUNT}, then checked
                against the commission stored on completed bookings.
              </li>
              <li>
                <strong className="text-foreground">Subscriptions</strong> - lister
                plan payments, earned as soon as they are paid. Counted from ledger
                account {SUBSCRIPTION_ACCOUNT}, then checked against the
                subscription records themselves.
              </li>
              <li>
                <strong className="text-foreground">Corrections</strong> - a reversed
                or corrected entry subtracts from the total, so a fixed mistake is
                not counted twice.
              </li>
              <li>
                <strong className="text-foreground">Busiest periods</strong> - counted
                from completed bookings by the date the rental starts.
              </li>
              <li>
                <strong className="text-foreground">Car types and areas</strong> -
                also from completed bookings. The area is the region chosen on the
                listing. A car with no area set is grouped under "Not set".
              </li>
              <li>
                <strong className="text-foreground">Cancellations</strong> - from the
                cancellation record written when a booking is called off, counted by
                the side it was charged against. "Late" means it fell inside the
                window where the policy charges a fee.
              </li>
              <li>
                <strong className="text-foreground">Refund kinds</strong> - read from
                each refund's own review note, using the same classification the
                Refund Review screen shows. A refund PayMongo handled automatically
                carries no review note, so it is counted on its own line.
              </li>
              <li>
                <strong className="text-foreground">Work still waiting</strong> - the
                open queues themselves, not a separate tally: the same list the
                notification bell and the sidebar dots read. "Oldest" is how long the
                longest-waiting item in that queue has been there.
              </li>
              <li>
                <strong className="text-foreground">None of this is tracking</strong> -
                every figure above is counted from records SafeDrive already keeps to
                run a booking. Nothing observes how a person uses the app.
              </li>
            </ul>
            <p className="mt-3">
              While SafeDrive runs against PayMongo's test environment, these are
              test transactions, not collected cash.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
