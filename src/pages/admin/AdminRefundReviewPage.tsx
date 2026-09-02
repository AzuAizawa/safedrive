import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import AdminSectionTabs from "@/components/AdminSectionTabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type RefundPayment = {
  id: string;
  booking_id: string;
  amount: number;
  payment_type: string;
  status: string;
  payment_method: string | null;
  transaction_id: string | null;
  notes: string | null;
  created_at: string;
  bookings: {
    id: string;
    start_date: string;
    end_date: string;
    renter: { full_name: string | null; email: string };
    owner: { full_name: string | null; email: string };
    cars: {
      plate_number: string;
      car_models: { name: string; car_brands: { name: string } };
    };
  };
};

type RefundPageTab = "pending" | "released" | "statistics";
type RefundRetryResult = {
  state?: "completed" | "failed" | "pending" | "skipped";
  reason?: string;
};
type RefundRetryPayload = {
  error?: string;
  result?: RefundRetryResult;
};
type RefundSyncPayload = {
  error?: string;
  state?: "completed" | "failed" | "pending" | "already_completed" | "already_reconciled";
  providerStatus?: string;
};

const getRefundRetryToastCopy = (result?: RefundRetryResult) => {
  if (result?.state === "completed") {
    return {
      tone: "success" as const,
      title: "Refund retry completed",
      description: "PayMongo reported this refund as completed.",
    };
  }

  if (result?.state === "pending") {
    return {
      tone: "info" as const,
      title: "Refund retry started",
      description:
        result.reason || "PayMongo accepted the refund and is still finalizing it.",
    };
  }

  if (result?.state === "skipped") {
    return {
      tone: "warning" as const,
      title: "Refund retry skipped",
      description:
        result.reason || "SafeDrive did not find a refundable PayMongo payment.",
    };
  }

  if (result?.state === "failed") {
    return {
      tone: "error" as const,
      title: "Refund retry failed",
      description:
        result.reason || "PayMongo could not complete the refund retry.",
    };
  }

  return {
    tone: "info" as const,
    title: "Refund retry finished",
    description: "Refresh the refund status after PayMongo responds.",
  };
};

const showRefundRetryToast = (
  copy: ReturnType<typeof getRefundRetryToastCopy>,
) => {
  if (copy.tone === "success") {
    toast.success(copy.title, { description: copy.description });
    return;
  }

  if (copy.tone === "warning") {
    toast.warning(copy.title, { description: copy.description });
    return;
  }

  if (copy.tone === "error") {
    toast.error(copy.title, { description: copy.description });
    return;
  }

  toast.info(copy.title, { description: copy.description });
};

const formatCurrency = (value: number) =>
  `PHP ${Math.abs(Number(value || 0)).toLocaleString()}`;

const getVehicleLabel = (refund: RefundPayment) =>
  `${refund.bookings.cars.car_models.car_brands.name} ${refund.bookings.cars.car_models.name}`;

const getRefundStatusCopy = (refund: RefundPayment) => {
  if (refund.status === "completed") {
    return {
      label: "Released",
      detail:
        refund.payment_method === "PayMongo"
          ? "PayMongo handled this refund back to the original checkout method."
          : `Admin marked this refund released through ${refund.payment_method || "manual transfer"}.`,
      tone: "bg-green-500/10 text-green-700 dark:text-green-300",
    };
  }

  if (refund.status === "failed") {
    return {
      label: "Provider refund failed",
      detail:
        "PayMongo could not complete this refund. Retry PayMongo after checking the issue, or send the refund manually through GCash/Maya and record the reference.",
      tone: "bg-red-500/10 text-red-700 dark:text-red-300",
    };
  }

  if (refund.payment_method === "manual_review") {
    return {
      label: "Manual review needed",
      detail:
        "PayMongo could not finish the refund automatically. Admin should send the money manually using the fallback details in the linked support case.",
      tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  return {
    label: "Provider confirmation pending",
    detail:
      "PayMongo accepted the refund request and is still finalizing it with the payment provider.",
    tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  };
};

type AdminRefundReviewPageProps = {
  embedded?: boolean;
};

export default function AdminRefundReviewPage({ embedded = false }: AdminRefundReviewPageProps) {
  const { profile: adminProfile, session } = useAuth();
  const isSuperAdmin = adminProfile?.role === "super_admin";
  const [refunds, setRefunds] = useState<RefundPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageTab, setPageTab] = useState<RefundPageTab>("pending");
  const [retryingBookingId, setRetryingBookingId] = useState<string | null>(null);
  const [syncingPaymentId, setSyncingPaymentId] = useState<string | null>(null);
  const [manualTarget, setManualTarget] = useState<RefundPayment | null>(null);
  const [manualDraft, setManualDraft] = useState({
    refundMethod: "GCash",
    referenceNumber: "",
    note: "",
  });
  const [manualLoading, setManualLoading] = useState(false);

  const fetchRefunds = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("payments")
        .select(
          `
          id,
          booking_id,
          amount,
          payment_type,
          status,
          payment_method,
          transaction_id,
          notes,
          created_at,
          bookings(
            id,
            start_date,
            end_date,
            renter:profiles!bookings_renter_id_fkey(full_name, email),
            owner:profiles!bookings_owner_id_fkey(full_name, email),
            cars(plate_number, car_models(name, car_brands(name)))
          )
        `,
        )
        .eq("payment_type", "refund")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRefunds((data ?? []) as unknown as RefundPayment[]);
    } catch (error) {
      toast.error("Failed to load refund review", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRefunds();
  }, []);

  const pendingRefunds = useMemo(
    () => refunds.filter((refund) => refund.status !== "completed"),
    [refunds],
  );
  const releasedRefunds = useMemo(
    () => refunds.filter((refund) => refund.status === "completed"),
    [refunds],
  );
  const stats = useMemo(
    () => ({
      pendingAmount: pendingRefunds.reduce(
        (total, refund) => total + Math.abs(Number(refund.amount || 0)),
        0,
      ),
      releasedAmount: releasedRefunds.reduce(
        (total, refund) => total + Math.abs(Number(refund.amount || 0)),
        0,
      ),
      manualCount: pendingRefunds.filter(
        (refund) => refund.payment_method === "manual_review",
      ).length,
    }),
    [pendingRefunds, releasedRefunds],
  );

  const retryPayMongoRefund = async (bookingId: string) => {
    if (!session?.access_token) {
      toast.error("Missing session token");
      return;
    }

    setRetryingBookingId(bookingId);
    try {
      const res = await fetch("/api/process-refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ bookingId }),
      });

      const payload = (await res.json()) as RefundRetryPayload;
      if (!res.ok) {
        throw new Error(payload.error || "Failed to retry PayMongo refund");
      }

      showRefundRetryToast(getRefundRetryToastCopy(payload.result));
      await fetchRefunds();
    } catch (error) {
      toast.error("Refund retry failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setRetryingBookingId(null);
    }
  };

  const syncPayMongoRefundStatus = async (paymentId: string) => {
    if (!session?.access_token) {
      toast.error("Missing session token");
      return;
    }

    setSyncingPaymentId(paymentId);
    try {
      const res = await fetch("/api/sync-paymongo-refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ paymentId }),
      });
      const payload = (await res.json()) as RefundSyncPayload;
      if (!res.ok) {
        throw new Error(payload.error || "Failed to sync PayMongo refund status");
      }

      if (payload.state === "completed") {
        toast.success("Refund synchronized", {
          description: "PayMongo confirmed the refund. SafeDrive recorded the release and ledger entry.",
        });
      } else if (payload.state === "failed") {
        toast.warning("Provider refund failed", {
          description: "SafeDrive updated the record. You can now retry PayMongo or use the manual fallback.",
        });
      } else if (payload.state === "already_completed" || payload.state === "already_reconciled") {
        toast.info("Refund already synchronized", {
          description: "The SafeDrive record was already updated.",
        });
      } else {
        toast.info("Provider confirmation still pending", {
          description: `PayMongo currently reports ${payload.providerStatus || "pending"}. No refund was created.`,
        });
      }
      await fetchRefunds();
    } catch (error) {
      toast.error("Refund sync failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSyncingPaymentId(null);
    }
  };

  const openManualRefund = (refund: RefundPayment) => {
    setManualTarget(refund);
    setManualDraft({
      refundMethod: "GCash",
      referenceNumber: "",
      note: "",
    });
  };

  const markManualRefundReleased = async () => {
    if (!manualTarget || !session?.access_token) return;
    if (!manualDraft.referenceNumber.trim()) {
      toast.error("Enter the refund reference number");
      return;
    }

    setManualLoading(true);
    try {
      const res = await fetch("/api/mark-manual-refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          paymentId: manualTarget.id,
          refundMethod: manualDraft.refundMethod,
          referenceNumber: manualDraft.referenceNumber,
          note: manualDraft.note,
        }),
      });

      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "Failed to mark refund as released");
      }

      toast.success("Refund released", {
        description: "The renter was notified and the audit trail was updated.",
      });
      setManualTarget(null);
      await fetchRefunds();
    } catch (error) {
      toast.error("Manual refund failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setManualLoading(false);
    }
  };

  const renderRefundCards = (items: RefundPayment[], emptyText: string) => {
    if (loading) {
      return (
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-56 w-full rounded-xl" />
          ))}
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <Card>
          <div className="p-10 text-center text-muted-foreground">
            <RotateCcw className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>{emptyText}</p>
          </div>
        </Card>
      );
    }

    return (
      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((refund) => {
          const statusCopy = getRefundStatusCopy(refund);
          const isPending = refund.status !== "completed";
          const providerRefundStillPending =
            refund.status === "pending" &&
            refund.payment_method?.toLowerCase() === "paymongo" &&
            Boolean(refund.transaction_id);
          const isPayMongoRefund =
            refund.payment_method?.toLowerCase() === "paymongo" &&
            Boolean(refund.transaction_id);

          return (
            <Card key={refund.id} className="border-border/70">
              <div className="space-y-4 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold">{getVehicleLabel(refund)}</h3>
                    <p className="mt-0.5 text-xs font-mono text-muted-foreground">
                      {refund.bookings.cars.plate_number}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Renter:{" "}
                      {refund.bookings.renter.full_name ||
                        refund.bookings.renter.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Lister:{" "}
                      {refund.bookings.owner.full_name ||
                        refund.bookings.owner.email}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xl font-bold text-blue-600">
                      {formatCurrency(refund.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Requested {format(new Date(refund.created_at), "MMM d, h:mm a")}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border/60 p-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${statusCopy.tone}`}
                  >
                    {statusCopy.label}
                  </span>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {statusCopy.detail}
                  </p>
                  {refund.transaction_id ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Reference:{" "}
                      <span className="font-mono text-foreground">
                        {refund.transaction_id}
                      </span>
                    </p>
                  ) : null}
                </div>

                {(isPending || isPayMongoRefund) && isSuperAdmin ? (
                  <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:justify-end">
                    {isPayMongoRefund && (providerRefundStillPending || !isPending) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={syncingPaymentId === refund.id}
                        onClick={() => void syncPayMongoRefundStatus(refund.id)}
                      >
                        {syncingPaymentId === refund.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        {isPending ? "Sync PayMongo Status" : "Verify PayMongo Status"}
                      </Button>
                    ) : isPending ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={retryingBookingId === refund.booking_id}
                        onClick={() => void retryPayMongoRefund(refund.booking_id)}
                      >
                        {retryingBookingId === refund.booking_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Retry PayMongo
                      </Button>
                    ) : null}
                    {isPending ? (
                      <Button
                        type="button"
                        size="sm"
                        className="gap-2"
                        disabled={providerRefundStillPending}
                        title={
                          providerRefundStillPending
                            ? "PayMongo is still processing this refund. Wait for provider confirmation before using manual fallback."
                            : "Record a manual GCash or Maya refund release"
                        }
                        onClick={() => openManualRefund(refund)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Mark Manual Released
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {!embedded ? (
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Refund Review</h1>
          <p className="mt-1 text-muted-foreground">
            Track cancelled-booking refunds and finish manual releases when PayMongo cannot process them automatically.
          </p>
        </div>
      ) : null}

      <AdminSectionTabs
        value={pageTab}
        onChange={setPageTab}
        ariaLabel="Refund review view"
        tabs={[
          { value: "pending", label: "Pending refunds", count: pendingRefunds.length },
          { value: "released", label: "Released refunds", count: releasedRefunds.length },
          { value: "statistics", label: "Statistics" },
        ]}
      />

      {pageTab === "pending"
        ? renderRefundCards(pendingRefunds, "No refunds need admin review right now.")
        : null}

      {pageTab === "released"
        ? renderRefundCards(releasedRefunds, "No released refunds are recorded yet.")
        : null}

      {pageTab === "statistics" ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Pending refund value</p>
              <p className="mt-2 text-2xl font-bold">
                {formatCurrency(stats.pendingAmount)}
              </p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Released refund value</p>
              <p className="mt-2 text-2xl font-bold">
                {formatCurrency(stats.releasedAmount)}
              </p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Manual review cases</p>
              <p className="mt-2 text-2xl font-bold">{stats.manualCount}</p>
            </div>
          </Card>
        </div>
      ) : null}

      {manualTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!manualLoading) setManualTarget(null);
            }}
          >
            <div
              className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 text-card-foreground shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Mark manual refund as released</h2>
                <p className="text-sm text-muted-foreground">
                  Use this after the admin sends the refund back through GCash or Maya outside SafeDrive, then record the method and reference here.
                </p>
              </div>

              <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 p-4 text-sm">
                <p className="font-semibold">{getVehicleLabel(manualTarget)}</p>
                <p className="mt-1 text-muted-foreground">
                  Renter: {manualTarget.bookings.renter.full_name || manualTarget.bookings.renter.email}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Refund amount:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(manualTarget.amount)}
                  </span>
                </p>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Refund return method</span>
                  <select
                    value={manualDraft.refundMethod}
                    onChange={(event) =>
                      setManualDraft((current) => ({
                        ...current,
                        refundMethod: event.target.value,
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
                    value={manualDraft.referenceNumber}
                    onChange={(event) =>
                      setManualDraft((current) => ({
                        ...current,
                        referenceNumber: event.target.value,
                      }))
                    }
                    placeholder="GCash/Maya reference"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-medium">Admin note</span>
                  <textarea
                    value={manualDraft.note}
                    onChange={(event) =>
                      setManualDraft((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    rows={3}
                    placeholder="Optional note, such as who sent it or where the proof is stored"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setManualTarget(null)}
                  disabled={manualLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void markManualRefundReleased()}
                  disabled={manualLoading}
                  className="gap-2"
                >
                  {manualLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Mark Released
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
