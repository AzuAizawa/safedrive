import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import AdminSectionTabs from "@/components/AdminSectionTabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PayoutPaymentRow {
  id: string;
  payment_type: string;
  status: string;
  amount: number;
  payment_method: string | null;
  transaction_id: string | null;
  notes: string | null;
  created_at: string;
}

interface PayoutBooking {
  id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  base_price: number;
  commission: number;
  total_price: number;
  status: string;
  downpayment_amount: number;
  cars: {
    plate_number: string;
    car_models: { name: string; car_brands: { name: string } };
  };
  renter: { full_name: string | null; email: string };
  owner: {
    id: string;
    full_name: string | null;
    email: string;
    phone: string | null;
    payout_method: string | null;
    payout_account_name: string | null;
    payout_account_number: string | null;
  };
  payments: PayoutPaymentRow[];
}

type PayoutAutomationState = "ready" | "limited" | "missing";
type PayoutSupportCounts = Record<string, number>;
type PayoutPageTab = "overview" | "current" | "statistics";

type PayoutOutcome =
  | { state: "skipped"; bookingId: string; reason: string }
  | {
      state: "pending";
      bookingId: string;
      paymentId: string;
      transactionId: string | null;
      reason?: string;
    }
  | {
      state: "completed";
      bookingId: string;
      paymentId: string;
      transactionId: string | null;
    }
  | {
      state: "failed";
      bookingId: string;
      paymentId: string;
      transactionId: string | null;
      reason: string;
    };

const formatCurrency = (value: number) =>
  `PHP ${Number(value || 0).toLocaleString()}`;

const maskAccountNumber = (value: string | null) => {
  if (!value) return "Not provided";
  if (value.length <= 4) return value;
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
};

const getLatestPayout = (booking: PayoutBooking) =>
  [...booking.payments]
    .filter((payment) => payment.payment_type === "payout")
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    )[0] ?? null;

const getAutomationSupport = (
  booking: PayoutBooking,
): { state: PayoutAutomationState; label: string; description: string } => {
  if (
    !booking.owner.payout_method ||
    !booking.owner.payout_account_name ||
    !booking.owner.payout_account_number
  ) {
    return {
      state: "missing",
      label: "Incomplete payout details",
      description:
        "The lister still needs to complete their payout destination before automation can run.",
    };
  }

  if (booking.owner.payout_method === "GCash" || booking.owner.payout_method === "Maya") {
    return {
      state: "ready",
      label: "Auto payout ready",
      description:
        "This method can be sent through the current PayMongo wallet-disbursement flow when the environment is configured.",
    };
  }

  if (
    booking.owner.payout_method === "Business Bank Account" ||
    booking.owner.payout_method === "PayMongo Wallet"
  ) {
    return {
      state: "limited",
      label: "Unsupported payout method",
      description:
        "This payout destination is no longer supported in the current release. Use GCash or Maya instead.",
    };
  }

  return {
    state: "limited",
    label: "Method not mapped yet",
    description:
      "This payout method is not mapped to the current automatic disbursement flow yet.",
  };
};

const getLatestOpenIssue = (
  booking: PayoutBooking,
  supportCaseCount: number,
): { label: string; description: string; nextStep: string } => {
  const latestPayout = getLatestPayout(booking);
  const support = getAutomationSupport(booking);

  if (supportCaseCount > 0) {
    return {
      label: "Support case blocking payout",
      description:
        "A booking-linked support ticket is still open or in progress, so automation should stay blocked.",
      nextStep: "Resolve the support issue first, then retry payout.",
    };
  }

  if (latestPayout?.status === "pending" && latestPayout.transaction_id) {
    return {
      label: "Provider confirmation pending",
      description:
        latestPayout.notes ||
        "PayMongo already accepted the payout transfer and is still finalizing it.",
      nextStep: "Wait for the payout webhook before retrying anything.",
    };
  }

  if (latestPayout?.status === "failed") {
    return {
      label: "Last payout attempt failed",
      description:
        latestPayout.notes ||
        "The last payout transfer failed and needs admin review before another attempt.",
      nextStep: "Review the payout note, confirm the destination, then retry auto payout.",
    };
  }

  if (latestPayout?.status === "pending" && !latestPayout.transaction_id) {
    return {
      label: "Queued but not sent yet",
      description:
        latestPayout.notes ||
        "A payout record exists, but no provider transfer reference was stored yet.",
      nextStep: "Run the auto payout action when the destination is ready.",
    };
  }

  if (support.state === "missing") {
    return {
      label: support.label,
      description: support.description,
      nextStep: "Ask the lister to complete payout details in their account first.",
    };
  }

  if (
    booking.owner.payout_method === "Business Bank Account" ||
    booking.owner.payout_method === "PayMongo Wallet"
  ) {
    return {
      label: "Unsupported payout method",
      description:
        "The saved payout destination is no longer supported for automatic release in this version.",
      nextStep: "Ask the lister to switch their payout details to GCash or Maya, then retry the payout.",
    };
  }

  if (support.state === "ready") {
    return {
      label: "Ready for automation",
      description:
        "The payout destination is supported and there is no known blocker on this booking right now.",
      nextStep: "Run auto payout.",
    };
  }

  return {
    label: support.label,
    description: support.description,
    nextStep: "Review the payout setup and provider requirements before retrying.",
  };
};

const getOutcomeToast = (result: PayoutOutcome) => {
  if (result.state === "completed") {
    toast.success("Auto payout completed", {
      description:
        result.transactionId?.startsWith("sandbox_payout_")
          ? "Sandbox payout was recorded as released for the system showcase."
          : "PayMongo confirmed the payout transfer for this booking.",
    });
    return;
  }

  if (result.state === "pending") {
    toast.info("Auto payout is in progress", {
      description:
        result.reason ??
        "PayMongo accepted the payout and is still finalizing the transfer.",
    });
    return;
  }

  if (result.state === "failed") {
    toast.error("Auto payout failed", {
      description: result.reason,
    });
    return;
  }

  toast.message("Auto payout was skipped", {
    description: result.reason,
  });
};

type AdminPayoutsPageProps = {
  embedded?: boolean;
};

export default function AdminPayoutsPage({ embedded = false }: AdminPayoutsPageProps) {
  const { profile: adminProfile, session } = useAuth();
  const isSuperAdmin = adminProfile?.role === "super_admin";
  const [bookings, setBookings] = useState<PayoutBooking[]>([]);
  const [supportCaseCounts, setSupportCaseCounts] = useState<PayoutSupportCounts>({});
  const [loading, setLoading] = useState(true);
  const [processingBookingId, setProcessingBookingId] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const [manualPayoutTarget, setManualPayoutTarget] = useState<PayoutBooking | null>(null);
  const [manualPayoutDraft, setManualPayoutDraft] = useState({
    paymentMethod: "GCash",
    referenceNumber: "",
    note: "",
  });
  const [manualPayoutLoading, setManualPayoutLoading] = useState(false);
  const [pageTab, setPageTab] = useState<PayoutPageTab>("current");

  useEffect(() => {
    void fetchPayouts();
  }, []);

  const fetchPayouts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          `
          *,
          cars(plate_number, car_models(name, car_brands(name))),
          renter:profiles!bookings_renter_id_fkey(full_name, email),
          owner:profiles!bookings_owner_id_fkey(id, full_name, email, phone, payout_method, payout_account_name, payout_account_number),
          payments(*)
        `,
        )
        .eq("status", "completed")
        .eq("owner_completed", true)
        .eq("renter_completed", true)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      if (data) setBookings(data as unknown as PayoutBooking[]);

      const bookingIds = (data as Array<{ id: string }> | null)?.map((item) => item.id) ?? [];
      if (bookingIds.length > 0) {
        const { data: ticketRows, error: ticketError } = await supabase
          .from("support_tickets")
          .select("booking_id, status")
          .in("booking_id", bookingIds)
          .in("status", ["open", "in_progress"]);

        if (ticketError) throw ticketError;

        const counts = ((ticketRows ?? []) as Array<{ booking_id: string | null }>).reduce<PayoutSupportCounts>(
          (accumulator, row) => {
            if (!row.booking_id) return accumulator;
            accumulator[row.booking_id] = (accumulator[row.booking_id] ?? 0) + 1;
            return accumulator;
          },
          {},
        );

        setSupportCaseCounts(counts);
      } else {
        setSupportCaseCounts({});
      }
    } catch (err) {
      console.error("Failed to load payouts:", err);
      toast.error("Failed to load payout queue");
    } finally {
      setLoading(false);
    }
  };

  const queue = useMemo(
    () => bookings.filter((booking) => getLatestPayout(booking)?.status !== "completed"),
    [bookings],
  );
  const completed = useMemo(
    () => bookings.filter((booking) => getLatestPayout(booking)?.status === "completed"),
    [bookings],
  );
  const payoutStats = useMemo(() => {
    const released = completed.reduce(
      (total, booking) => total + Number(booking.base_price || 0),
      0,
    );
    const waiting = queue.reduce(
      (total, booking) => total + Number(booking.base_price || 0),
      0,
    );
    const platformFees = bookings.reduce(
      (total, booking) => total + Number(booking.commission || 0),
      0,
    );
    const failed = bookings.filter(
      (booking) => getLatestPayout(booking)?.status === "failed",
    ).length;

    return {
      released,
      waiting,
      platformFees,
      failed,
    };
  }, [bookings, completed, queue]);

  const processPayout = async (bookingId?: string) => {
    if (!session?.access_token) {
      toast.error("Missing session token");
      return;
    }

    const isBatch = !bookingId;
    if (isBatch) {
      setProcessingAll(true);
    } else {
      setProcessingBookingId(bookingId);
    }

    try {
      const res = await fetch("/api/process-payout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(bookingId ? { bookingId } : {}),
      });

      const payload = (await res.json()) as {
        error?: string;
        result?: PayoutOutcome;
        results?: PayoutOutcome[];
      };

      if (!res.ok) {
        throw new Error(payload.error || "Failed to process payout automation");
      }

      if (bookingId && payload.result) {
        getOutcomeToast(payload.result);
      } else if (payload.results) {
        const completedCount = payload.results.filter((item) => item.state === "completed").length;
        const pendingCount = payload.results.filter((item) => item.state === "pending").length;
        const failedCount = payload.results.filter((item) => item.state === "failed").length;
        const skippedCount = payload.results.filter((item) => item.state === "skipped").length;

        toast.success("Payout automation sweep finished", {
          description: `${completedCount} completed, ${pendingCount} pending, ${failedCount} failed, ${skippedCount} skipped.`,
        });
      }

      await fetchPayouts();
    } catch (error) {
      toast.error("Payout automation failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setProcessingBookingId(null);
      setProcessingAll(false);
    }
  };

  const openManualPayout = (booking: PayoutBooking) => {
    setManualPayoutTarget(booking);
    setManualPayoutDraft({
      paymentMethod:
        booking.owner.payout_method === "Maya" ? "Maya" : "GCash",
      referenceNumber: "",
      note: "",
    });
  };

  const markManualPayoutPaid = async () => {
    if (!manualPayoutTarget || !session?.access_token) return;
    if (!manualPayoutDraft.referenceNumber.trim()) {
      toast.error("Enter the payout reference number");
      return;
    }

    setManualPayoutLoading(true);
    try {
      const res = await fetch("/api/mark-manual-payout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          bookingId: manualPayoutTarget.id,
          paymentMethod: manualPayoutDraft.paymentMethod,
          referenceNumber: manualPayoutDraft.referenceNumber,
          note: manualPayoutDraft.note,
        }),
      });

      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "Failed to mark payout as paid");
      }

      toast.success("Manual payout recorded", {
        description:
          "The payout was marked released, the lister was notified, and an audit entry was saved.",
      });
      setManualPayoutTarget(null);
      await fetchPayouts();
    } catch (error) {
      toast.error("Manual payout failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setManualPayoutLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className={`flex flex-col gap-3 md:flex-row md:items-start ${embedded ? "md:justify-end" : "md:justify-between"}`}>
        {!embedded ? (
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Payout Review</h1>
            <p className="text-muted-foreground mt-1">
              Release eligible lister payouts after a booking is fully completed, either through PayMongo automation or the manual payout fallback.
            </p>
          </div>
        ) : null}
        {isSuperAdmin ? (
          <Button
            type="button"
            onClick={() => void processPayout()}
            disabled={processingAll || queue.length === 0}
            className="gap-2"
          >
            {processingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Run Queue Sweep
          </Button>
        ) : null}
      </div>

      <AdminSectionTabs
        value={pageTab}
        onChange={setPageTab}
        ariaLabel="Payout review view"
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "current", label: "Current payouts", count: queue.length },
          { value: "statistics", label: "Statistics" },
        ]}
      />

      {pageTab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Waiting for release</p>
              <p className="mt-2 text-2xl font-bold">{queue.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatCurrency(payoutStats.waiting)} still needs payout action.
              </p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Released payouts</p>
              <p className="mt-2 text-2xl font-bold">{completed.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatCurrency(payoutStats.released)} recorded as released.
              </p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Platform fees kept</p>
              <p className="mt-2 text-2xl font-bold">
                {formatCurrency(payoutStats.platformFees)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                From completed bookings in this review list.
              </p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Needs attention</p>
              <p className="mt-2 text-2xl font-bold">{payoutStats.failed}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Failed payout attempts that need admin review.
              </p>
            </div>
          </Card>
          <Card className="md:col-span-2 xl:col-span-4">
            <div className="p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">How payout release works</p>
              <p className="mt-1">
                For the live payment environment, PayMongo Money Movement must be configured with a funded wallet/source account for real automated disbursement.
                If PayMongo is not configured, Auto Payout skips instead of marking money released.
                Sandbox showcase completion only works when the explicit server flag is enabled.
                Manual Paid remains available when the admin sends money through GCash or Maya outside the app.
              </p>
            </div>
          </Card>
        </div>
      ) : null}

      {pageTab === "current" ? (
      <div>
        <h2 className="text-lg font-semibold mb-3">
          Queue Requiring Review ({queue.length})
        </h2>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CreditCard className="w-12 h-12 mx-auto opacity-30 mb-3" />
            <p>No payout items need review right now.</p>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {queue.map((booking) => {
              const support = getAutomationSupport(booking);
              const latestPayout = getLatestPayout(booking);
              const supportCaseCount = supportCaseCounts[booking.id] ?? 0;
              const reconciliation = getLatestOpenIssue(
                booking,
                supportCaseCount,
              );
              const canRunAutomation =
                isSuperAdmin &&
                supportCaseCount === 0 &&
                support.state === "ready" &&
                latestPayout?.status !== "pending";
              const canMarkManual =
                isSuperAdmin &&
                supportCaseCount === 0 &&
                support.state === "ready" &&
                latestPayout?.status !== "completed" &&
                !(latestPayout?.status === "pending" && latestPayout.transaction_id);
              const readyForRelease = reconciliation.label === "Ready for automation";
              const issueLabel = readyForRelease ? "Ready to release" : reconciliation.label;
              const issueDetail = readyForRelease
                ? "Payout details are complete. Try automatic payout, or send manually and mark it paid."
                : reconciliation.description;
              const nextStep = readyForRelease
                ? "Use Auto Payout first. If PayMongo Money Movement is not available, send the payout through GCash or Maya and record it as manual paid."
                : reconciliation.nextStep;

              return (
                <Card key={booking.id} className="border-border/70">
                  <div className="space-y-4 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="font-semibold">
                          {booking.cars.car_models.car_brands.name}{" "}
                          {booking.cars.car_models.name}
                        </h3>
                        <p className="mt-0.5 text-xs font-mono text-muted-foreground">
                          {booking.cars.plate_number}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Renter: {booking.renter.full_name || booking.renter.email}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(booking.start_date), "MMM d")} -{" "}
                          {format(new Date(booking.end_date), "MMM d")}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-lg font-bold text-green-600">
                          {formatCurrency(Number(booking.base_price))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Platform fee kept: {formatCurrency(Number(booking.commission))}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Lister payout details
                        </p>
                        <p className="mt-1 font-medium">
                          {booking.owner.full_name || booking.owner.email}
                        </p>
                        <p className="mt-2 text-sm">
                          {booking.owner.payout_method || "Not configured"}
                        </p>
                        <p className="font-mono text-sm text-muted-foreground">
                          {maskAccountNumber(booking.owner.payout_account_number)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {booking.owner.payout_account_name || "No account name"}
                        </p>
                      </div>

                      <div className="rounded-lg border border-border/60 p-3">
                        <div
                          className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${
                            readyForRelease
                              ? "bg-green-500/10 text-green-700 dark:text-green-300"
                              : supportCaseCount > 0
                                ? "bg-red-500/10 text-red-700 dark:text-red-300"
                                : support.state === "missing"
                                  ? "bg-red-500/10 text-red-700 dark:text-red-300"
                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          {issueLabel}
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {issueDetail}
                        </p>
                        <p className="mt-3 text-xs font-semibold text-foreground">
                          Next step
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {nextStep}
                        </p>
                      </div>
                    </div>

                    {latestPayout ? (
                      <div className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        Last payout attempt:{" "}
                        <span className="font-medium text-foreground">
                          {latestPayout.status}
                        </span>
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:justify-end">
                      {isSuperAdmin ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => void processPayout(booking.id)}
                            disabled={
                              processingBookingId === booking.id || !canRunAutomation
                            }
                            title={
                              canRunAutomation
                                ? "Run automatic payout"
                                : supportCaseCount > 0
                                  ? "Resolve the support case before retrying payout"
                                  : latestPayout?.status === "pending"
                                    ? "PayMongo is still processing the last payout attempt"
                                    : nextStep
                            }
                            className="gap-1"
                          >
                            {processingBookingId === booking.id ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Processing...
                              </>
                            ) : latestPayout?.status === "failed" ? (
                              <>
                                <RefreshCw className="h-3.5 w-3.5" />
                                Retry Auto
                              </>
                            ) : (
                              <>
                                <Send className="h-3.5 w-3.5" />
                                Auto Payout
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openManualPayout(booking)}
                            disabled={!canMarkManual}
                            title={
                              canMarkManual
                                ? "Record a manual GCash or Maya payout"
                                : supportCaseCount > 0
                                  ? "Resolve the support case before releasing payout"
                                  : latestPayout?.status === "pending" && latestPayout.transaction_id
                                    ? "Wait for the provider payout before using manual payout"
                                    : nextStep
                            }
                            className="gap-1"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Manual Paid
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-amber-500">
                          Super Admin only
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      ) : null}

      {pageTab === "statistics" ? (
        <div>
          <div className="mb-4 grid gap-4 md:grid-cols-3">
            <Card>
              <div className="p-4">
                <p className="text-sm text-muted-foreground">Total released</p>
                <p className="mt-2 text-2xl font-bold">
                  {formatCurrency(payoutStats.released)}
                </p>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <p className="text-sm text-muted-foreground">Still queued</p>
                <p className="mt-2 text-2xl font-bold">
                  {formatCurrency(payoutStats.waiting)}
                </p>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <p className="text-sm text-muted-foreground">Platform fees</p>
                <p className="mt-2 text-2xl font-bold">
                  {formatCurrency(payoutStats.platformFees)}
                </p>
              </div>
            </Card>
          </div>

          {completed.length > 0 ? (
            <>
              <h2 className="text-lg font-semibold mb-3">
                Released Payouts ({completed.length})
              </h2>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Lister</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completed.map((booking) => {
                      const payout = getLatestPayout(booking);
                      return (
                        <TableRow key={booking.id}>
                          <TableCell>
                            <div>
                              {booking.cars.car_models.car_brands.name}{" "}
                              {booking.cars.car_models.name}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {booking.cars.plate_number}
                            </div>
                          </TableCell>
                          <TableCell>{booking.owner.full_name || booking.owner.email}</TableCell>
                          <TableCell className="font-medium">
                            {formatCurrency(Number(booking.base_price))}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {payout?.transaction_id || "No transaction reference stored"}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                              <CheckCircle2 className="w-3 h-3" />
                              Released
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </>
          ) : (
            <Card>
              <div className="p-8 text-center text-muted-foreground">
                No released payouts are recorded yet.
              </div>
            </Card>
          )}
        </div>
      ) : null}

      {!loading && bookings.length === 0 ? (
        <Card className="border-border/50">
          <div className="p-8 text-center text-muted-foreground">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>No completed bookings are waiting for payout review yet.</p>
          </div>
        </Card>
      ) : null}

      {manualPayoutTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!manualPayoutLoading) setManualPayoutTarget(null);
            }}
          >
            <div
              className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 text-card-foreground shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Mark manual payout as paid</h2>
                <p className="text-sm text-muted-foreground">
                  Use this only after you have sent the lister payout through GCash or Maya outside SafeDrive.
                </p>
              </div>

              <div className="mt-4 grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Booking
                  </p>
                  <p className="mt-1 font-semibold">
                    {manualPayoutTarget.cars.car_models.car_brands.name}{" "}
                    {manualPayoutTarget.cars.car_models.name}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Lister: {manualPayoutTarget.owner.full_name || manualPayoutTarget.owner.email}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Send this payout
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Amount:{" "}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(Number(manualPayoutTarget.base_price))}
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Method: {manualPayoutTarget.owner.payout_method || "Not configured"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Account name: {manualPayoutTarget.owner.payout_account_name || "No account name"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Account number:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {manualPayoutTarget.owner.payout_account_number || "No account number"}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Payout method</span>
                  <select
                    value={manualPayoutDraft.paymentMethod}
                    onChange={(event) =>
                      setManualPayoutDraft((current) => ({
                        ...current,
                        paymentMethod: event.target.value,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="GCash">GCash</option>
                    <option value="Maya">Maya</option>
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-medium">Reference number</span>
                  <input
                    value={manualPayoutDraft.referenceNumber}
                    onChange={(event) =>
                      setManualPayoutDraft((current) => ({
                        ...current,
                        referenceNumber: event.target.value,
                      }))
                    }
                    placeholder="GCash/Maya transaction reference"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-medium">Admin note</span>
                  <textarea
                    value={manualPayoutDraft.note}
                    onChange={(event) =>
                      setManualPayoutDraft((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    rows={3}
                    placeholder="Optional note, such as who sent the payout or where proof is stored"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setManualPayoutTarget(null)}
                  disabled={manualPayoutLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void markManualPayoutPaid()}
                  disabled={manualPayoutLoading}
                  className="gap-2"
                >
                  {manualPayoutLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Mark as Paid
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
