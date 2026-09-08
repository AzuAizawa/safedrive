import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Coins, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
  cars: { location: string | null; car_models: { body_type: string | null } | null } | null;
};
type CarRow = { location: string | null; status: string };
type SubscriptionRow = { amount_centavos: number | null; paid_at: string | null };

type MonthBucket = { key: string; label: string; commission: number; subscription: number };

export default function AdminEarningsPage() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LedgerEntryRow[]>([]);
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [cars, setCars] = useState<CarRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [entryResult, journalResult, bookingResult, carResult, subscriptionResult] =
      await Promise.all([
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
            "commission, status, start_date, cars(location, car_models(body_type))",
          )
          .eq("status", "completed")
          .limit(ROW_LIMIT),
        supabase
          // Every listed car, to sit beside the booking counts per region.
          // A region with cars and no bookings is the finding that matters.
          .from("cars")
          .select("location, status")
          .in("status", ["approved", "active"])
          .limit(ROW_LIMIT),
        supabase
          .from("subscriptions")
          .select("amount_centavos, paid_at")
          .not("amount_centavos", "is", null)
          .limit(ROW_LIMIT),
      ]);

    const error =
      entryResult.error ||
      journalResult.error ||
      bookingResult.error ||
      carResult.error ||
      subscriptionResult.error;
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

    setEntries(entryRows);
    setJournals(journalRows);
    setBookings(bookingRows);
    setCars(carRows);
    setSubscriptions(subscriptionRows);
    setTruncated(
      entryRows.length >= ROW_LIMIT ||
        journalRows.length >= ROW_LIMIT ||
        bookingRows.length >= ROW_LIMIT ||
        carRows.length >= ROW_LIMIT ||
        subscriptionRows.length >= ROW_LIMIT,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const journalDate = new Map(journals.map((journal) => [journal.id, journal.effective_at]));

    // Revenue accounts are credit-balance: a credit adds revenue, a debit
    // (a correction or reversal) takes it back. Netting the two is what
    // makes a reversed journal disappear from the total instead of being
    // counted twice.
    const net = (accountCode: string) =>
      entries
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
    const bookingCommissionCentavos = bookings.reduce(
      (total, booking) => total + Math.round(Number(booking.commission || 0) * 100),
      0,
    );
    const subscriptionPaidCentavos = subscriptions.reduce(
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

    entries.forEach((entry) => {
      const amount = Number(entry.credit_centavos || 0) - Number(entry.debit_centavos || 0);
      if (amount === 0) return;
      addToMonth(
        journalDate.get(entry.journal_id),
        entry.account_code === SUBSCRIPTION_ACCOUNT ? "subscription" : "commission",
        amount,
      );
    });

    const months = Array.from(monthMap.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12);

    // Busiest periods are counted from completed bookings by the date the
    // rental starts - that is the season question ("when are we busy?"),
    // not the date someone happened to click Book.
    const monthCounts = new Array(12).fill(0) as number[];
    const dayCounts = new Array(7).fill(0) as number[];
    bookings.forEach((booking) => {
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
      completedBookings: bookings.length,
      paidSubscriptions: subscriptions.length,
      months,
      peakMonth: monthCounts[peakMonthIndex] > 0 ? MONTH_LABELS[peakMonthIndex] : null,
      peakMonthCount: monthCounts[peakMonthIndex] ?? 0,
      peakDay: dayCounts[peakDayIndex] > 0 ? DAY_LABELS[peakDayIndex] : null,
      peakDayCount: dayCounts[peakDayIndex] ?? 0,
    };
  }, [entries, journals, bookings, subscriptions]);

  // What renters are actually booking, and where. Both read columns that
  // already exist - car_models.body_type from the admin catalog, and the
  // region segment of cars.location, which is stored as
  // "Region - City - Specific" (same split MyVehiclesPage does).
  const regionOf = (location: string | null) =>
    (location ?? "").split(" - ")[0]?.trim() || "Not set";

  const demand = useMemo(() => {
    const byType = new Map<string, number>();
    const byRegion = new Map<string, number>();

    bookings.forEach((booking) => {
      const type = booking.cars?.car_models?.body_type?.trim() || "Not set";
      byType.set(type, (byType.get(type) ?? 0) + 1);
      const region = regionOf(booking.cars?.location ?? null);
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
  }, [bookings, cars]);

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
            <Coins className="h-7 w-7" /> Earnings
          </h1>
          <p className="mt-1 text-muted-foreground">
            What SafeDrive earned, and when the platform is busiest. Every total
            below is counted twice - once from the ledger, once from the
            original records - and flagged if the two disagree.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
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
            </div>
          </div>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">Earnings by month</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Last {summary.months.length} month
              {summary.months.length === 1 ? "" : "s"} with activity. Taller bar =
              more earned.
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
