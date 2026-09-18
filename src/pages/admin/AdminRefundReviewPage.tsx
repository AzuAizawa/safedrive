import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { format } from "date-fns";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  MANUAL_REFUND_KINDS,
  REFUND_DECISION_REASON_MIN,
  classifyManualRefund,
  decideRefund,
  getRefundCapacity,
  roundPesos,
  type ManualRefundKind,
} from "@/lib/refundDecision";
import { Button } from "@/components/ui/button";
import AdminSectionTabs from "@/components/AdminSectionTabs";
import BookingPagination from "@/components/BookingPagination";
import { usePagedItems } from "@/lib/usePagedItems";
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
    status: string;
    start_date: string;
    end_date: string;
    base_price: number;
    total_price: number;
    pickup_time: string | null;
    renter_arrived_at: string | null;
    lister_arrived_at: string | null;
    lister_handover_confirmed_at: string | null;
    renter_handover_received_at: string | null;
    renter: { full_name: string | null; email: string };
    owner: { full_name: string | null; email: string };
    cars: {
      plate_number: string;
      car_models: { name: string; car_brands: { name: string } };
    };
  };
};

// What the review dialog loads for the booking behind a refund.
type ReviewEvidence = {
  loading: boolean;
  capacity: ReturnType<typeof getRefundCapacity> | null;
  cancellation: {
    cancelled_by_role: string;
    reason: string | null;
    cancelled_at: string;
  } | null;
  cases: Array<{
    id: string;
    subject: string;
    tag: string | null;
    status: string;
    created_at: string;
  }>;
};

type DecisionChoice = "recommended" | "other" | "deny";

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

const EMPTY_EVIDENCE: ReviewEvidence = {
  loading: false,
  capacity: null,
  cancellation: null,
  cases: [],
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

// A policy refund of PHP 0: the cancellation fee covered everything the
// renter paid. Settled without a transfer (api/mark-manual-refund.ts).
const isNoRefundDue = (refund: RefundPayment) =>
  Math.abs(Number(refund.amount || 0)) < 0.005;

// Only a policy/claim review row can be decided; a failed provider refund is
// simply owed. Same rule as api/mark-manual-refund.ts.
const getReviewKind = (refund: RefundPayment): ManualRefundKind =>
  refund.payment_method === "manual_review"
    ? classifyManualRefund(refund.notes)
    : "automatic_refund_failed";

const formatStamp = (value: string | null | undefined) => {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Not recorded" : format(parsed, "MMM d, yyyy h:mm a");
};

const formatPickup = (booking: RefundPayment["bookings"]) => {
  const time = booking.pickup_time?.slice(0, 5);
  const parsed = new Date(`${booking.start_date}T${time || "00:00"}:00`);
  if (Number.isNaN(parsed.getTime())) return booking.start_date;
  return time ? format(parsed, "MMM d, yyyy h:mm a") : format(parsed, "MMM d, yyyy");
};

const getRefundStatusCopy = (refund: RefundPayment) => {
  if (refund.status === "completed" && refund.payment_method === "No refund due") {
    return {
      label: "Settled",
      detail:
        "No refund was sent - either the cancellation fee covered what the renter paid, or a super admin decided no refund was due. Any lister compensation was released with this decision.",
      tone: "bg-green-500/10 text-green-700 dark:text-green-300",
    };
  }

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

  if (refund.payment_method === "manual_review" && isNoRefundDue(refund)) {
    return {
      label: "No refund due",
      detail:
        "The cancellation fee covers everything the renter paid, so nothing goes back. Settle it to release the lister's compensation.",
      tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  // What kind of case this is - a claim to judge, a policy fee, or money that
  // is simply owed - instead of one line that blamed PayMongo for all of them.
  if (refund.payment_method === "manual_review") {
    const kind = MANUAL_REFUND_KINDS[classifyManualRefund(refund.notes)];
    return {
      label: kind.label,
      detail: kind.guidance,
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
  // Set only when SafeDrive answers that the provider cannot carry this refund.
  // Until then the release goes back to the account the renter paid from, so
  // there is no destination for anyone to choose.
  const [manualTransferRequired, setManualTransferRequired] = useState(false);
  const [providerBlockedReason, setProviderBlockedReason] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<ReviewEvidence>(EMPTY_EVIDENCE);
  const [decisionChoice, setDecisionChoice] = useState<DecisionChoice>("recommended");
  const [otherAmount, setOtherAmount] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  // The refund whose evidence is loading, so a slow load for one refund can
  // never fill in the dialog of another opened after it.
  const evidenceForRef = useRef<string | null>(null);

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
            status,
            start_date,
            end_date,
            base_price,
            total_price,
            pickup_time,
            renter_arrived_at,
            lister_arrived_at,
            lister_handover_confirmed_at,
            renter_handover_received_at,
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
  const pendingPages = usePagedItems(pendingRefunds, "pending");
  const releasedPages = usePagedItems(releasedRefunds, "released");
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
    setDecisionChoice("recommended");
    setOtherAmount("");
    setDecisionReason("");
    // Each review starts on the provider path; the manual fields appear only if
    // SafeDrive answers that this particular refund cannot take it.
    setManualTransferRequired(false);
    setProviderBlockedReason(null);
    setEvidence({ ...EMPTY_EVIDENCE, loading: true });
    evidenceForRef.current = refund.id;

    // Everything an admin needs to judge the case, read in one go: what the
    // booking collected and already refunded, who cancelled and when, and the
    // support cases (chat, photos) behind it.
    void Promise.all([
      supabase
        .from("payments")
        .select("id, amount, payment_type, status")
        .eq("booking_id", refund.booking_id),
      supabase
        .from("booking_cancellations")
        .select("cancelled_by_role, reason, cancelled_at")
        .eq("booking_id", refund.booking_id)
        .maybeSingle(),
      supabase
        .from("support_tickets")
        .select("id, subject, tag, status, created_at")
        .eq("booking_id", refund.booking_id)
        .order("created_at", { ascending: true }),
    ]).then(([paymentsResult, cancellationResult, casesResult]) => {
      if (evidenceForRef.current !== refund.id) return;
      setEvidence({
        loading: false,
        capacity: paymentsResult.error
          ? null
          : getRefundCapacity(
              (paymentsResult.data ?? []) as Array<{
                id: string;
                payment_type: string;
                status: string;
                amount: number;
              }>,
              refund.id,
            ),
        cancellation: (cancellationResult.data as ReviewEvidence["cancellation"]) ?? null,
        cases: (casesResult.data ?? []) as ReviewEvidence["cases"],
      });
    });
  };

  const closeManualRefund = () => {
    evidenceForRef.current = null;
    setManualTarget(null);
    setEvidence(EMPTY_EVIDENCE);
  };

  // The decision, worked out with the same rules the server applies.
  const review = useMemo(() => {
    if (!manualTarget) return null;
    const kind = getReviewKind(manualTarget);
    const copy = MANUAL_REFUND_KINDS[kind];
    const recommended = roundPesos(Math.abs(Number(manualTarget.amount || 0)));
    // Same rule as decideRefund: only a cancelled booking has somewhere for the
    // difference to go (the lister's compensation).
    const bookingCancelled = manualTarget.bookings.status === "cancelled";
    const canDecide =
      manualTarget.payment_method === "manual_review" && copy.adjustable && bookingCancelled;
    const choice: DecisionChoice = canDecide ? decisionChoice : "recommended";
    const requested =
      choice === "recommended"
        ? null
        : choice === "deny"
          ? 0
          : otherAmount.trim() === ""
            ? Number.NaN
            : Number(otherAmount);
    const result = evidence.capacity
      ? decideRefund({
          kind,
          bookingStatus: manualTarget.bookings.status,
          recommended,
          requested,
          available: evidence.capacity.available,
          reservedByOtherRefunds: evidence.capacity.reservedByOtherRefunds,
          reason: decisionReason,
        })
      : null;
    const finalAmount =
      result && result.ok
        ? result.amount
        : choice === "deny"
          ? 0
          : choice === "recommended"
            ? recommended
            : Number(otherAmount) || 0;
    const finalIsZero = Math.round(finalAmount * 100) === 0;
    const capacity = evidence.capacity;
    const maxForDecision = capacity
      ? roundPesos(Math.max(0, capacity.available - capacity.reservedByOtherRefunds))
      : null;
    // What this decision leaves unrefunded. The ledger reverses every refunded
    // peso in the proportions it was collected (server/ledger.ts), so of what is
    // left the lister gets the base-price part and the processing-fee part stays
    // with SafeDrive - server/cancellationCompensation.ts pays it, no commission.
    const leftover = capacity
      ? roundPesos(Math.max(0, capacity.available - capacity.reservedByOtherRefunds - finalAmount))
      : null;
    const basePrice = Number(manualTarget.bookings.base_price);
    const totalPrice = Number(manualTarget.bookings.total_price);
    const listerRatio =
      totalPrice > 0 && Number.isFinite(basePrice) ? Math.min(1, Math.max(0, basePrice / totalPrice)) : 1;
    const listerShare =
      bookingCancelled && leftover !== null ? roundPesos(leftover * listerRatio) : null;
    return {
      kind,
      copy,
      recommended,
      bookingCancelled,
      canDecide,
      choice,
      result,
      finalAmount,
      finalIsZero,
      maxForDecision,
      leftover: leftover !== null && leftover > 0.005 ? leftover : null,
      listerShare: listerShare !== null && listerShare > 0.005 ? listerShare : null,
      waitsOnOtherRefunds: Boolean(capacity && capacity.reservedByOtherRefunds > 0.005),
    };
  }, [manualTarget, decisionChoice, otherAmount, decisionReason, evidence.capacity]);

  const markManualRefundReleased = async () => {
    if (!manualTarget || !review || !session?.access_token) return;
    if (review.result && !review.result.ok) {
      toast.error("Check the decision", { description: review.result.error });
      return;
    }
    // Only a transfer the admin sends themselves needs a reference.
    if (
      !review.finalIsZero &&
      manualTransferRequired &&
      !manualDraft.referenceNumber.trim()
    ) {
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
          note: manualDraft.note,
          // Sent only once SafeDrive has said the provider cannot carry it;
          // otherwise the refund goes back through the original payment.
          ...(manualTransferRequired
            ? {
                manualTransfer: true,
                refundMethod: manualDraft.refundMethod,
                referenceNumber: manualDraft.referenceNumber,
              }
            : {}),
          ...(review.choice === "recommended"
            ? {}
            : { amount: review.finalAmount, reason: decisionReason.trim() }),
        }),
      });

      const payload = (await res.json()) as {
        error?: string;
        state?: "completed" | "pending";
        decision?: "as_recommended" | "adjusted" | "denied";
        returnedToSource?: boolean;
        method?: string | null;
        needsManualTransfer?: boolean;
        reason?: string;
        compensation?: {
          state: string;
          amount?: number;
          reason?: string;
          waitingOnRefunds?: boolean;
        };
      };

      // The provider could not carry this one. Nothing was changed, so the
      // admin is asked for a destination only now, and told why.
      if (!res.ok && payload.needsManualTransfer) {
        setManualTransferRequired(true);
        setProviderBlockedReason(payload.reason ?? null);
        toast.warning("Send this refund manually", {
          description:
            payload.reason ??
            "SafeDrive could not return this refund through the original payment.",
        });
        return;
      }

      if (!res.ok) {
        throw new Error(payload.error || "Failed to mark refund as released");
      }

      if (payload.state === "pending") {
        toast.success("Refund sent back to the original payment method", {
          description: `${formatCurrency(review.finalAmount)} is on its way to the account the renter paid from. It stays pending here until PayMongo confirms it - use Sync PayMongo Status.`,
        });
        closeManualRefund();
        await fetchRefunds();
        return;
      }

      const decisionSentence =
        payload.decision === "denied"
          ? "The refund was denied, and the renter and the lister were told why."
          : payload.decision === "adjusted"
            ? "The refund was changed from the recommended amount, and the renter and the lister were told why."
            : null;

      const compensation = payload.compensation;
      if (compensation?.state === "completed") {
        toast.success(
          payload.decision === "denied"
            ? "Refund denied - lister compensation released"
            : "Refund and lister compensation released",
          {
            description: [
              decisionSentence,
              `The lister received ${formatCurrency(compensation.amount ?? 0)} as short-notice compensation, with no commission.`,
            ]
              .filter(Boolean)
              .join(" "),
          },
        );
      } else if (compensation?.state === "pending") {
        toast.warning("Decision recorded - lister compensation still to send", {
          description: [
            decisionSentence,
            `${formatCurrency(compensation.amount ?? 0)} is owed to the lister. ${compensation.reason ?? ""}`,
          ]
            .filter(Boolean)
            .join(" "),
        });
      } else if (compensation?.state === "failed") {
        toast.warning("Decision recorded - lister compensation did not go through", {
          description: `${compensation.reason ?? "Please try again."} Releasing this refund again retries only the lister's share.`,
        });
      } else if (compensation?.state === "skipped" && compensation.waitingOnRefunds) {
        toast.info("Decision recorded - lister compensation waits for the other refund", {
          description: [decisionSentence, compensation.reason].filter(Boolean).join(" "),
        });
      } else {
        toast.success(payload.decision === "denied" ? "Refund denied" : "Refund released", {
          description: decisionSentence ?? "The renter was notified and the audit trail was updated.",
        });
      }
      closeManualRefund();
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
          // A manual_review row is a DELIBERATE partial: the short-notice
          // cancellation policy already decided the renter gets only a
          // percentage back, and this row carries that share alone.
          // "Retry PayMongo" refunds 100% of what was captured and does not
          // recognise this row as covering anything (its blocker check
          // requires a transaction_id, which a manual row never has), so
          // offering it here meant a full refund on top of a partial - and
          // the partial could then still be released separately.
          const isManualPolicyRefund = refund.payment_method === "manual_review";

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
                    ) : isPending && !isManualPolicyRefund ? (
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
                            : isNoRefundDue(refund)
                              ? "The fee covers everything the renter paid - settle it to release the lister's compensation"
                              : isManualPolicyRefund
                                ? "Review the evidence, decide the amount and record the release"
                                : "Record a manual GCash or Maya refund release"
                        }
                        onClick={() => openManualRefund(refund)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {isNoRefundDue(refund)
                          ? "Settle - No Refund Due"
                          : isManualPolicyRefund
                            ? "Review & Decide"
                            : "Mark Manual Released"}
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

  const timeline =
    manualTarget && review
      ? ([
          ["Pickup scheduled", formatPickup(manualTarget.bookings)],
          ["Renter checked in", formatStamp(manualTarget.bookings.renter_arrived_at)],
          ["Lister checked in", formatStamp(manualTarget.bookings.lister_arrived_at)],
          ["Lister confirmed handover", formatStamp(manualTarget.bookings.lister_handover_confirmed_at)],
          ["Renter confirmed receiving the car", formatStamp(manualTarget.bookings.renter_handover_received_at)],
          [
            "Cancelled",
            evidence.cancellation
              ? `${formatStamp(evidence.cancellation.cancelled_at)} - counted against ${
                  evidence.cancellation.cancelled_by_role === "both"
                    ? "both sides"
                    : `the ${evidence.cancellation.cancelled_by_role}`
                }${
                  evidence.cancellation.reason ? ` (${evidence.cancellation.reason.replace(/_/g, " ")})` : ""
                }`
              : manualTarget.bookings.status === "cancelled"
                ? "Cancelled (no cancellation record)"
                : `Not cancelled (booking is ${manualTarget.bookings.status.replace(/_/g, " ")})`,
          ],
          ["Refund queued", formatStamp(manualTarget.created_at)],
        ] as Array<[string, string]>)
      : [];

  return (
    <div className="space-y-6 animate-fade-in">
      {!embedded ? (
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Refund Review</h1>
          <p className="mt-1 text-muted-foreground">
            Track cancelled-booking refunds, review the evidence behind a manual refund, and record the decision.
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

      {pageTab === "pending" ? (
        <>
          {renderRefundCards(pendingPages.items, "No refunds need admin review right now.")}
          <BookingPagination {...pendingPages.paginationProps} noun="refunds" />
        </>
      ) : null}

      {pageTab === "released" ? (
        <>
          {renderRefundCards(releasedPages.items, "No released refunds are recorded yet.")}
          <BookingPagination {...releasedPages.paginationProps} noun="refunds" />
        </>
      ) : null}

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
        review &&
        createPortal(
          /* The panel is capped to the viewport and scrolls inside itself. It
             used to be centred with the backdrop scrolling instead: once the
             evidence made the dialog taller than the screen, the top overflowed
             above the scroll container and could not be reached at all. */
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!manualLoading) closeManualRefund();
            }}
          >
            <div
              className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-xl border border-border bg-card text-card-foreground shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              {/* Fixed: the title stays in view however long the evidence runs. */}
              <div className="shrink-0 space-y-1 border-b border-border/60 px-5 py-4">
                <h2 className="text-lg font-semibold">
                  {review.finalIsZero
                    ? review.choice === "deny"
                      ? "Deny this refund"
                      : "Settle cancellation - no refund due"
                    : "Review and release refund"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {review.finalIsZero
                    ? "Nothing is sent back, so no reference is needed. Any compensation owed to the lister is released with this decision."
                    : manualTransferRequired
                      ? "PayMongo could not carry this one. Send it through GCash or Maya outside SafeDrive, then record the method and reference here."
                      : "Check what happened and decide the amount. SafeDrive returns it through the original payment, so it lands back in the account the renter paid from."}
                </p>
              </div>

              {/* The one scrolling region: everything the admin reads and fills in. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm">
                <p className="font-semibold">{getVehicleLabel(manualTarget)}</p>
                <p className="mt-1 text-muted-foreground">
                  Renter: {manualTarget.bookings.renter.full_name || manualTarget.bookings.renter.email}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Lister: {manualTarget.bookings.owner.full_name || manualTarget.bookings.owner.email}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Recommended refund:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(review.recommended)}
                  </span>
                </p>
                <span className="mt-2 inline-flex rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  {review.copy.label}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">{review.copy.guidance}</p>
                {manualTarget.notes ? (
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {manualTarget.notes}
                  </p>
                ) : null}
              </div>

              <div className="mt-4 rounded-lg border border-border/70 p-4 text-sm">
                <p className="font-semibold">What happened</p>
                <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
                  {timeline.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="text-xs font-medium break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 border-t border-border/60 pt-3">
                  <p className="text-xs font-medium">Cases for this booking (chat, photos, reports)</p>
                  {evidence.loading ? (
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
                    </p>
                  ) : evidence.cases.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">No support case is linked to this booking.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {evidence.cases.map((supportCase) => (
                        <li key={supportCase.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                          <Link
                            to={`/admin/support?ticket=${supportCase.id}`}
                            className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
                          >
                            {supportCase.subject}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                          <span className="text-muted-foreground">
                            {supportCase.status.replace(/_/g, " ")} - opened {formatStamp(supportCase.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {review.canDecide ? (
                  <fieldset className="space-y-2 rounded-lg border border-border/70 p-4 text-sm">
                    <legend className="px-1 font-semibold">Decision</legend>
                    {(
                      [
                        ["recommended", `Release as recommended (${formatCurrency(review.recommended)})`],
                        ["other", "Release a different amount"],
                        ["deny", "Deny - no refund (PHP 0)"],
                      ] as Array<[DecisionChoice, string]>
                    ).map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="refund-decision"
                          value={value}
                          checked={review.choice === value}
                          onChange={() => setDecisionChoice(value)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                    {review.choice === "other" ? (
                      <label className="block space-y-1">
                        <span className="text-xs text-muted-foreground">
                          Amount to refund
                          {review.maxForDecision !== null
                            ? ` (at most ${formatCurrency(review.maxForDecision)} - collected and not yet refunded${
                                review.waitsOnOtherRefunds ? " or owed through another refund" : ""
                              })`
                            : ""}
                        </span>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min={0}
                            max={review.maxForDecision ?? undefined}
                            step="0.01"
                            value={otherAmount}
                            onChange={(event) => setOtherAmount(event.target.value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          />
                          {review.maxForDecision !== null ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10 shrink-0"
                              onClick={() => setOtherAmount(String(review.maxForDecision))}
                            >
                              Full refund
                            </Button>
                          ) : null}
                        </div>
                      </label>
                    ) : null}
                    {review.choice !== "recommended" ? (
                      <label className="block space-y-1">
                        <span className="text-xs text-muted-foreground">
                          Reason (sent to the renter and the lister) *
                        </span>
                        <textarea
                          value={decisionReason}
                          onChange={(event) => setDecisionReason(event.target.value)}
                          rows={3}
                          maxLength={500}
                          placeholder="What the evidence shows - e.g. the lister checked in on time with a photo, the renter checked in 40 minutes late."
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                        <span className="text-[11px] text-muted-foreground">
                          At least {REFUND_DECISION_REASON_MIN} characters ({decisionReason.trim().length} so far).
                        </span>
                      </label>
                    ) : null}
                    {review.result && !review.result.ok && review.choice !== "recommended" ? (
                      <p className="text-xs text-red-600 dark:text-red-400">{review.result.error}</p>
                    ) : null}
                  </fieldset>
                ) : manualTarget.payment_method === "manual_review" ? (
                  <p className="rounded-lg border border-border/70 p-3 text-xs text-muted-foreground">
                    {review.copy.adjustable && !review.bookingCancelled
                      ? "Released as recommended - only a cancelled booking's refund can be changed, because on this booking nothing would receive the difference."
                      : "Released as recommended - this is not a judgement call."}
                  </p>
                ) : null}

                {review.result && !review.result.ok && review.choice === "recommended" ? (
                  <p className="text-xs text-red-600 dark:text-red-400">{review.result.error}</p>
                ) : null}

                {review.bookingCancelled && review.leftover !== null ? (
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                    <p>
                      Not refunded:{" "}
                      <span className="font-semibold text-foreground">
                        {formatCurrency(review.leftover)}
                      </span>
                    </p>
                    {review.waitsOnOtherRefunds ? (
                      <p className="mt-1">
                        Another refund on this booking is still open, so the lister's compensation is released
                        when the last refund is settled, not in this click.
                      </p>
                    ) : review.listerShare !== null ? (
                      <p className="mt-1">
                        Lister receives in the same click:{" "}
                        <span className="font-semibold text-foreground">
                          about {formatCurrency(review.listerShare)}
                        </span>{" "}
                        as compensation, no commission. The processing-fee part
                        {review.leftover - review.listerShare > 0.005
                          ? ` (about ${formatCurrency(roundPesos(review.leftover - review.listerShare))})`
                          : ""}{" "}
                        stays with SafeDrive. The exact figure is read from the ledger on release.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {review.finalIsZero ? null : !manualTransferRequired ? (
                  /* No destination to choose: the refund goes back through the
                     original payment, which is the only place SafeDrive knows
                     the money came from. */
                  <p className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Returns to the payment method used at checkout.
                    </span>{" "}
                    SafeDrive asks PayMongo to refund the original payment, so there is
                    nothing to enter - the renter gets it back where they paid from. If
                    PayMongo cannot carry it, SafeDrive says so and asks for the transfer
                    details then.
                  </p>
                ) : (
                  <>
                    {providerBlockedReason ? (
                      <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
                        {providerBlockedReason} Send it yourself, then record the method and
                        reference below.
                      </p>
                    ) : null}
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
                      <span className="font-medium">
                        Reference number ({formatCurrency(review.finalAmount)} sent)
                      </span>
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
                  </>
                )}

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
                    rows={2}
                    placeholder="Optional note, such as who sent it or where the proof is stored"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
              </div>
              </div>

              {/* Fixed: Cancel and the decision stay reachable without scrolling. */}
              <div className="shrink-0 flex flex-col-reverse gap-2 border-t border-border/60 px-5 py-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeManualRefund}
                  disabled={manualLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void markManualRefundReleased()}
                  disabled={
                    manualLoading ||
                    evidence.loading ||
                    Boolean(review.result && !review.result.ok)
                  }
                  className="gap-2"
                >
                  {manualLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {review.finalIsZero
                    ? review.choice === "deny"
                      ? "Deny Refund"
                      : "Settle & Release Compensation"
                    : manualTransferRequired
                      ? "Mark Released"
                      : "Release to Original Method"}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
