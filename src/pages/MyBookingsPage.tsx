import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { createPrivateStorageUrlMap } from "@/lib/privateStorage";
import {
  ensureReturnReminderNotifications,
  getNoShowWindowState,
  getReturnReminderState,
} from "@/lib/bookingLifecycle";
import { runIncidentAction } from "@/lib/incidents";
import {
  getExtensionDisplayStatus,
  getExtensionStatusLabel,
  getExtensionTone,
} from "@/lib/bookingExtensions";
import {
  earlyReturnStatusLabel,
  earlyReturnTone,
  latestEarlyReturn,
  runEarlyReturnAction,
  type EarlyReturnRow,
} from "@/lib/earlyReturns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrivalPhotoCapture,
  type ArrivalLocationEvidence,
} from "@/components/ArrivalPhotoCapture";
import ConfirmDialog from "@/components/ConfirmDialog";
import BookingPagination from "@/components/BookingPagination";
import { formatDayCount } from "@/lib/formatCount";
import { paginateItems } from "@/lib/pagination";
import { downloadReceiptPdf, RECEIPT_NOTICES } from "@/lib/receiptPdf";
import {
  DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS,
  fetchPlatformPolicyTimings,
} from "@/lib/platformSettings";
import {
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  Loader2,
  CreditCard,
  Download,
  Star,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Payment } from "@/types/database";
import { fetchCarRatingSummaries, fetchRenterReputation } from "@/lib/ratings";

interface BookingRow {
  id: string;
  car_id: string;
  owner_id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  total_price: number;
  base_price: number;
  commission: number;
  downpayment_amount: number;
  balance_amount: number;
  status: string;
  dispute_status?: string | null;
  renter_completed: boolean;
  owner_completed: boolean;
  payment_deadline: string | null;
  owner_response_deadline: string | null;
  paymongo_checkout_id?: string | null;
  paymongo_balance_checkout_id?: string | null;
  pickup_time: string | null;
  dropoff_time: string | null;
  created_at: string;
  agreement_storage_path_snapshot: string | null;
  cars: {
    plate_number: string;
    location: string | null;
    min_early_return_notice_hours: number | null;
    car_models: {
      name: string;
      car_brands: { name: string };
    };
    car_documents: { document_type: string; storage_path: string }[];
  };
  owner: {
    full_name: string | null;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
  renter_arrived_at: string | null;
  renter_return_arrived_at: string | null;
  renter_arrival_photo_url: string | null;
  renter_arrival_latitude: number | null;
  renter_arrival_longitude: number | null;
  renter_arrival_accuracy_meters: number | null;
  renter_arrival_location_captured_at: string | null;
  lister_arrived_at: string | null;
  lister_arrival_photo_url: string | null;
  lister_arrival_latitude: number | null;
  lister_arrival_longitude: number | null;
  lister_arrival_accuracy_meters: number | null;
  lister_arrival_location_captured_at: string | null;
  booking_reviews?: {
    id: string;
    reviewer_id: string;
    reviewer_role: string;
  }[];
  refund_full_hours_snapshot: number | null;
  refund_late_renter_percent_snapshot: number | null;
}

// Cancellation-refund policy (Terms 6.1/6.2). Values are snapshot per booking.
const DEFAULT_REFUND_FULL_HOURS = 24;
const DEFAULT_REFUND_LATE_RENTER_PERCENT = 50;
const UNPAID_STATES = ["pending", "awaiting_payment", "confirmed"];
const PAID_STATES = ["downpayment_paid", "fully_paid"];

const getBookingPickupMs = (booking: BookingRow): number | null => {
  const [year, month, day] = (booking.start_date || "")
    .split("-")
    .map((part) => Number(part));
  const [hour, minute] = (booking.pickup_time || "09:00")
    .split(":")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day, hour || 0, minute || 0) - 8 * 3600 * 1000;
};

interface RatingSummary {
  average: number;
  count: number;
}

interface BookingExtensionRow {
  id: string;
  booking_id: string;
  renter_id: string;
  owner_id: string;
  current_end_date: string;
  requested_end_date: string;
  extension_days: number;
  requested_total_days: number;
  reason: string;
  fuel_top_up_amount: number;
  extension_amount: number;
  total_additional_amount: number;
  status: string;
  owner_decision_note: string | null;
  payment_deadline: string | null;
  paymongo_checkout_id: string | null;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

const statusConfig: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  pending: {
    label: "Awaiting Owner",
    color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
    icon: Clock,
  },
  awaiting_payment: {
    label: "Payment Required",
    color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
    icon: AlertCircle,
  },
  confirmed: {
    label: "Payment Required",
    color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
    icon: AlertCircle,
  },
  rejected: {
    label: "Rejected",
    color: "text-red-600 bg-red-50 dark:bg-red-950/30",
    icon: XCircle,
  },
  downpayment_paid: {
    label: "Downpayment Paid",
    color: "text-green-600 bg-green-50 dark:bg-green-950/30",
    icon: CheckCircle2,
  },
  active: {
    label: "Active Rental",
    color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
    icon: Calendar,
  },
  fully_paid: {
    label: "Fully Paid",
    color: "text-green-600 bg-green-50 dark:bg-green-950/30",
    icon: CheckCircle2,
  },
  completed: {
    label: "Completed",
    color: "text-green-700 bg-green-50 dark:bg-green-950/30",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    color: "text-muted-foreground bg-muted",
    icon: XCircle,
  },
  expired: {
    label: "Expired",
    color: "text-muted-foreground bg-muted",
    icon: XCircle,
  },
};

export default function MyBookingsPage() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [documentUrls, setDocumentUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [arrivalLeadHours, setArrivalLeadHours] = useState(
    DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS,
  );
  const [payingFor, setPayingFor] = useState<string | null>(null);
  const [selectedOwner, setSelectedOwner] = useState<BookingRow | null>(null);
  const [ratingBooking, setRatingBooking] = useState<BookingRow | null>(null);
  const [ratingValue, setRatingValue] = useState<number>(5);
  const [ratingFeedback, setRatingFeedback] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);
  const [pageTab, setPageTab] = useState<"overview" | "bookings" | "payments">("bookings");
  const [bookingView, setBookingView] = useState<"active" | "history">("active");
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);
  const [bookingPage, setBookingPage] = useState(1);
  const [paymentLogs, setPaymentLogs] = useState<Payment[]>([]);
  const [paymentLogsLoading, setPaymentLogsLoading] = useState(false);
  const [cancelTargetBooking, setCancelTargetBooking] = useState<BookingRow | null>(null);
  const [noCarTarget, setNoCarTarget] = useState<BookingRow | null>(null);
  const [incidentLoading, setIncidentLoading] = useState<string | null>(null);
  const [carRatingSummaries, setCarRatingSummaries] = useState<Record<string, RatingSummary>>({});
  const [listerCancelledBookingIds, setListerCancelledBookingIds] = useState<
    Set<string>
  >(new Set());
  // Which trip-condition-report phases the LISTER has already filed, per
  // booking - drives the "Vehicle handover" / "Vehicle return" trip-progress
  // checkpoints (both participants can read either side's reports; RLS
  // scopes this to bookings the current user is actually part of).
  const [ownerReportsByBooking, setOwnerReportsByBooking] = useState<
    Record<string, { pickup: boolean; return: boolean }>
  >({});
  // The renter's (this account's) own report status per booking - both
  // phases are optional now, this just drives the "submitted" button state.
  const [ownReportsByBooking, setOwnReportsByBooking] = useState<
    Record<string, { pickup: boolean; return: boolean }>
  >({});
  const [renterReputation, setRenterReputation] = useState<
    Awaited<ReturnType<typeof fetchRenterReputation>> | null
  >(null);
  const [bookingExtensionsByBooking, setBookingExtensionsByBooking] = useState<
    Record<string, BookingExtensionRow[]>
  >({});
  const [extensionRequestBooking, setExtensionRequestBooking] = useState<BookingRow | null>(null);
  const [extensionRequestDrafts, setExtensionRequestDrafts] = useState<
    Record<string, { requestedEndDate: string; reason: string; fuelTopUpAmount: string }>
  >({});
  const [extensionActionLoading, setExtensionActionLoading] = useState<string | null>(null);
  const [earlyReturnsByBooking, setEarlyReturnsByBooking] = useState<
    Record<string, EarlyReturnRow[]>
  >({});
  const [earlyReturnModalBooking, setEarlyReturnModalBooking] =
    useState<BookingRow | null>(null);
  const [earlyReturnDraft, setEarlyReturnDraft] = useState({
    requestedEndDate: "",
    reason: "",
  });
  const [earlyReturnLoading, setEarlyReturnLoading] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPlatformPolicyTimings().then((timings) => {
      if (active) setArrivalLeadHours(timings.arrivalCheckinLeadHours);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const resetCheckoutLoading = () => {
      setPayingFor(null);
      setExtensionActionLoading(null);
    };

    window.addEventListener("pageshow", resetCheckoutLoading);
    return () => window.removeEventListener("pageshow", resetCheckoutLoading);
  }, []);

  const fetchBookings = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          `
          *,
          cars (
            plate_number, location, min_early_return_notice_hours,
            car_models (name, car_brands (name)),
            car_documents (document_type, storage_path)
          ),
          owner:profiles!bookings_owner_id_fkey (
            full_name, phone, avatar_url, email
          ),
          booking_reviews (id, reviewer_id, reviewer_role)
        `,
        )
        .eq("renter_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (data) {
        const typedBookings = data as unknown as BookingRow[];
        setBookings(typedBookings);

        // Separate, non-fatal query: a missing table (SQL chapter not yet run)
        // must never break the bookings list.
        try {
          const cancelledIds = typedBookings
            .filter((b) => b.status === "cancelled")
            .map((b) => b.id);
          if (cancelledIds.length > 0) {
            const { data: cancels } = await supabase
              .from("booking_cancellations")
              .select("booking_id, cancelled_by_role")
              .in("booking_id", cancelledIds)
              .eq("cancelled_by_role", "lister");
            setListerCancelledBookingIds(
              new Set((cancels ?? []).map((row) => row.booking_id)),
            );
          } else {
            setListerCancelledBookingIds(new Set());
          }
        } catch {
          setListerCancelledBookingIds(new Set());
        }

        // Separate, non-fatal query: drives the "Vehicle handover" / "Vehicle
        // return" trip-progress checkpoints. A missing table or RLS hiccup
        // must never break the bookings list itself.
        try {
          const activeIds = typedBookings
            .filter((b) => ["fully_paid", "active", "completed"].includes(b.status))
            .map((b) => b.id);
          if (activeIds.length > 0) {
            const { data: reports } = await supabase
              .from("trip_condition_reports")
              .select("booking_id, phase, reporter_id, reporter_role")
              .in("booking_id", activeIds);
            const ownerGrouped: Record<string, { pickup: boolean; return: boolean }> = {};
            const ownGrouped: Record<string, { pickup: boolean; return: boolean }> = {};
            for (const report of reports ?? []) {
              if (report.reporter_role === "lister") {
                const entry = ownerGrouped[report.booking_id] ?? { pickup: false, return: false };
                if (report.phase === "pickup") entry.pickup = true;
                if (report.phase === "return") entry.return = true;
                ownerGrouped[report.booking_id] = entry;
              }
              if (report.reporter_id === user!.id) {
                const entry = ownGrouped[report.booking_id] ?? { pickup: false, return: false };
                if (report.phase === "pickup") entry.pickup = true;
                if (report.phase === "return") entry.return = true;
                ownGrouped[report.booking_id] = entry;
              }
            }
            setOwnerReportsByBooking(ownerGrouped);
            setOwnReportsByBooking(ownGrouped);
          } else {
            setOwnerReportsByBooking({});
            setOwnReportsByBooking({});
          }
        } catch {
          setOwnerReportsByBooking({});
          setOwnReportsByBooking({});
        }

        setDocumentUrls(
          await createPrivateStorageUrlMap(
            "vehicle-private-documents",
            typedBookings.flatMap((booking) => [
              ...(booking.cars.car_documents ?? [])
                .map((document) => document.storage_path)
                .filter((path) => !path.startsWith("http")),
              ...(booking.agreement_storage_path_snapshot &&
              !booking.agreement_storage_path_snapshot.startsWith("http")
                ? [booking.agreement_storage_path_snapshot]
                : []),
            ]),
            "vehicle-documents",
          ),
        );
      }
    } catch (err) {
      console.error("Error fetching bookings:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchBookings();
  }, [user, fetchBookings]);

  // Keep the list live: refetch when the tab regains focus, and subscribe to
  // this renter's booking rows so a payment / status change shows within ~1s
  // without a reload. Silent so the loading skeleton never flashes.
  useEffect(() => {
    if (!user?.id) return;
    const refetch = () => void fetchBookings({ silent: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase
      .channel(`my-bookings-live-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `renter_id=eq.${user.id}` },
        refetch,
      )
      .subscribe();
    // Safety-net poll so updates still land within ~1 min if realtime is not
    // enabled for the table. Skips a backgrounded tab.
    const pollId = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, 60_000);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, fetchBookings]);

  useEffect(() => {
    if (!user || bookings.length === 0) return;

    const reminderBookings = bookings.map((booking) => ({
      id: booking.id,
      status: getApparentStatus(booking),
      end_date: booking.end_date,
      dropoff_time: booking.dropoff_time,
      label: `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`,
    }));

    void ensureReturnReminderNotifications(user.id, reminderBookings, "/my-bookings");
  }, [bookings, user]);

  useEffect(() => {
    // Published renter->trip ratings only, grouped by car - via the shared RPC
    // so the double-blind rule and the reviewer_role filter are applied server
    // side (a plain select here had been counting owner->renter reviews too).
    void fetchCarRatingSummaries().then(setCarRatingSummaries);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void fetchRenterReputation(user.id).then(setRenterReputation);
  }, [user?.id]);

  useEffect(() => {
    const fetchPaymentLogs = async () => {
      if (!user) return;
      setPaymentLogsLoading(true);
      try {
        const bookingIds = bookings.map((booking) => booking.id);
        if (bookingIds.length > 0) {
          const { data: payments } = await supabase
            .from("payments")
            .select("*")
            .in("booking_id", bookingIds)
            .order("created_at", { ascending: false });
          setPaymentLogs((payments as Payment[]) ?? []);
        } else {
          setPaymentLogs([]);
        }

      } finally {
        setPaymentLogsLoading(false);
      }
    };

    void fetchPaymentLogs();
  }, [bookings, user]);

  useEffect(() => {
    const fetchBookingExtensions = async () => {
      if (!user) return;

      const bookingIds = bookings.map((booking) => booking.id);
      if (bookingIds.length === 0) {
        setBookingExtensionsByBooking({});
        return;
      }

      const { data, error } = await supabase
        .from("booking_extensions")
        .select("*")
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load booking extensions:", error);
        return;
      }

      const grouped = ((data ?? []) as BookingExtensionRow[]).reduce<
        Record<string, BookingExtensionRow[]>
      >((accumulator, row) => {
        accumulator[row.booking_id] = accumulator[row.booking_id] || [];
        accumulator[row.booking_id].push(row);
        return accumulator;
      }, {});

      setBookingExtensionsByBooking(grouped);
    };

    void fetchBookingExtensions();
  }, [bookings, user]);

  useEffect(() => {
    const loadEarlyReturns = async () => {
      const ids = bookings.map((b) => b.id);
      if (ids.length === 0) {
        setEarlyReturnsByBooking({});
        return;
      }
      // Non-fatal: a deploy that lands before CHAPTER 30 has no such table.
      const { data, error } = await supabase
        .from("booking_early_returns")
        .select("*")
        .in("booking_id", ids)
        .order("created_at", { ascending: false });
      if (error) {
        setEarlyReturnsByBooking({});
        return;
      }
      const grouped = ((data ?? []) as EarlyReturnRow[]).reduce<
        Record<string, EarlyReturnRow[]>
      >((acc, row) => {
        (acc[row.booking_id] ||= []).push(row);
        return acc;
      }, {});
      setEarlyReturnsByBooking(grouped);
    };
    void loadEarlyReturns();
  }, [bookings]);

  const submitEarlyReturnRequest = async () => {
    if (!earlyReturnModalBooking) return;
    const bookingId = earlyReturnModalBooking.id;
    if (!earlyReturnDraft.requestedEndDate) {
      toast.error("Pick the new return date.");
      return;
    }
    setEarlyReturnLoading(bookingId);
    try {
      await runEarlyReturnAction(session?.access_token, {
        action: "request",
        bookingId,
        requestedEndDate: earlyReturnDraft.requestedEndDate,
        reason: earlyReturnDraft.reason.trim() || null,
      });
      toast.success("Early-return request sent to the lister.");
      setEarlyReturnModalBooking(null);
      setEarlyReturnDraft({ requestedEndDate: "", reason: "" });
      fetchBookings();
    } catch (err) {
      toast.error("Could not send the request", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setEarlyReturnLoading(null);
    }
  };

  const cancelEarlyReturn = async (earlyReturnId: string, bookingId: string) => {
    setEarlyReturnLoading(bookingId);
    try {
      await runEarlyReturnAction(session?.access_token, {
        action: "cancel",
        earlyReturnId,
      });
      toast.success("Early-return request withdrawn.");
      fetchBookings();
    } catch (err) {
      toast.error("Could not withdraw the request", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setEarlyReturnLoading(null);
    }
  };

  const runBookingAction = async (
    bookingId: string,
    action: "arrive" | "return_arrive" | "complete" | "cancel",
    arrivalPhotoUrl?: string | null,
    arrivalLocation?: ArrivalLocationEvidence | null,
    note?: string | null,
  ) => {
    const res = await fetch("/api/booking-action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        bookingId,
        action,
        arrivalPhotoUrl,
        arrivalLocation,
        note,
      }),
    });

    const data = (await res.json()) as {
      error?: string;
      state?: string;
      status?: string;
    };
    if (!res.ok) {
      const errorMessage = data.error || "Booking action failed";
      if (
        errorMessage.includes("parameter_above_maximum") &&
        errorMessage.includes("notes")
      ) {
        throw new Error(
          "PayMongo rejected the refund note length. Redeploy the latest SafeDrive build, then try the refund again.",
        );
      }
      throw new Error(errorMessage);
    }

    return data;
  };

  const runExtensionAction = async (
    payload:
      | {
          action: "request";
          bookingId: string;
          requestedEndDate: string;
          reason: string;
          fuelTopUpAmount?: string | number;
        }
      | {
          action: "cancel";
          extensionId: string;
        },
  ) => {
    const res = await fetch("/api/booking-extension-action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      throw new Error(data.error || "Extension action failed");
    }
  };

  const handleCheckout = async (
    booking: BookingRow,
    paymentMode: "downpayment" | "full",
  ) => {
    const selectedAmount =
      paymentMode === "full"
        ? Number(booking.total_price)
        : Number(booking.downpayment_amount);

    if (selectedAmount > 100000) {
      toast.error("Payment Exceeds Online Limit", {
        description:
          paymentMode === "full"
            ? `This full payment (PHP ${selectedAmount.toLocaleString()}) exceeds PayMongo's PHP 100,000 limit. Please use the downpayment option instead.`
            : `This downpayment (PHP ${selectedAmount.toLocaleString()}) exceeds PayMongo's PHP 100,000 limit. Please arrange payment directly with the car owner.`,
      });
      return;
    }

    setPayingFor(booking.id);

    try {
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          bookingId: booking.id,
          paymentMode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to initiate payment");
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error("Invalid response from payment gateway");
      }
    } catch (err) {
      console.error(err);
      toast.error(
        paymentMode === "full" ? "Full Payment Failed" : "Payment Initialization Failed",
        {
          description: err instanceof Error ? err.message : "Please try again.",
        },
      );
      setPayingFor(null);
    }
  };

  const handlePayDownpayment = async (booking: BookingRow) => {
    await handleCheckout(booking, "downpayment");
  };

  const handlePayFull = async (booking: BookingRow) => {
    await handleCheckout(booking, "full");
  };
  const handleArrive = async (
    bookingId: string,
    arrivalLocation?: ArrivalLocationEvidence | null,
  ) => {
    setPayingFor(bookingId);
    const toastId = toast.loading(
      arrivalLocation
        ? "Recording arrival with optional location..."
        : "Recording arrival...",
    );
    try {
      await runBookingAction(bookingId, "arrive", null, arrivalLocation ?? null);
      toast.success("Arrival recorded successfully!", { id: toastId });
      fetchBookings();
    } catch (err) {
      toast.error("Failed to record arrival", {
        id: toastId,
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setPayingFor(null);
    }
  };

  const handleReturnArrive = async (booking: BookingRow) => {
    setPayingFor(booking.id);
    try {
      await runBookingAction(booking.id, "return_arrive");
      toast.success("Return recorded. Waiting for the lister to confirm receipt.");
      fetchBookings();
    } catch (error) {
      toast.error("Could not record the return", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPayingFor(null);
    }
  };

  const handleComplete = async (booking: BookingRow) => {
    setPayingFor(booking.id);
    try {
      const result = await runBookingAction(booking.id, "complete");
      const reviewedByRenter = booking.booking_reviews?.some(
        (review) =>
          review.reviewer_id === user?.id && review.reviewer_role === "renter",
      );
      if (result?.status === "completed" && !reviewedByRenter) {
        toast.success("Trip completed. Add your quick rating.");
        openRateBookingModal({ ...booking, status: "completed" });
      } else {
        toast.success("Your side is done. Waiting for the lister to finish.");
      }
      fetchBookings();
    } catch (error) {
      toast.error("Failed to mark as complete", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPayingFor(null);
    }
  };

  const updateExtensionDraft = (
    bookingId: string,
    patch: Partial<{ requestedEndDate: string; reason: string; fuelTopUpAmount: string }>,
  ) => {
    setExtensionRequestDrafts((current) => ({
      ...current,
      [bookingId]: {
        requestedEndDate: current[bookingId]?.requestedEndDate ?? "",
        reason: current[bookingId]?.reason ?? "",
        fuelTopUpAmount: current[bookingId]?.fuelTopUpAmount ?? "",
        ...patch,
      },
    }));
  };

  const handleRequestExtension = async (booking: BookingRow) => {
    const draft = extensionRequestDrafts[booking.id] ?? {
      requestedEndDate: "",
      reason: "",
      fuelTopUpAmount: "",
    };

    if (!draft.requestedEndDate || !draft.reason.trim()) {
      toast.error("Set the new return date and explain why you need the extension.");
      return;
    }

    setExtensionActionLoading(booking.id);
    try {
      await runExtensionAction({
        action: "request",
        bookingId: booking.id,
        requestedEndDate: draft.requestedEndDate,
        reason: draft.reason.trim(),
        fuelTopUpAmount: draft.fuelTopUpAmount,
      });
      toast.success("Extension request sent to the lister.");
      setExtensionRequestDrafts((current) => ({
        ...current,
        [booking.id]: { requestedEndDate: "", reason: "", fuelTopUpAmount: "" },
      }));
      setExtensionRequestBooking(null);
      await fetchBookings();
    } catch (error) {
      toast.error("Extension request failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setExtensionActionLoading(null);
    }
  };

  const handleCancelExtension = async (extension: BookingExtensionRow) => {
    setExtensionActionLoading(extension.id);
    try {
      await runExtensionAction({ action: "cancel", extensionId: extension.id });
      toast.success("Extension request cancelled.");
      await fetchBookings();
    } catch (error) {
      toast.error("Could not cancel extension request", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setExtensionActionLoading(null);
    }
  };

  const handlePayExtension = async (extension: BookingExtensionRow) => {
    if (Number(extension.total_additional_amount) > 100000) {
      toast.error("Extension payment exceeds the PayMongo checkout limit.");
      return;
    }

    setExtensionActionLoading(extension.id);
    try {
      const res = await fetch("/api/create-booking-extension-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ extensionId: extension.id }),
      });

      const data = (await res.json()) as { error?: string; checkoutUrl?: string };
      if (!res.ok || !data.checkoutUrl) {
        throw new Error(data.error || "Failed to create extension payment checkout.");
      }

      window.location.href = data.checkoutUrl;
    } catch (error) {
      toast.error("Extension payment failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setExtensionActionLoading(null);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    setPayingFor(bookingId);
    try {
       const result = await runBookingAction(bookingId, "cancel");
       toast.success(
         result?.state === "cancelled_refunded"
           ? "Booking cancelled and refund completed."
           : result?.state === "cancelled_refund_pending"
             ? "Booking cancelled. Refund processing has started."
             : "Booking request cancelled successfully.",
       );
       fetchBookings();
    } catch (error) {
       toast.error("Failed to cancel booking", {
         description:
           error instanceof Error ? error.message : "Please try again.",
       });
     } finally {
      setPayingFor(null);
      setCancelTargetBooking(null);
    }
  };

  const handleReportBooking = (booking: BookingRow) => {
    const subject = encodeURIComponent(
      `Report booking: ${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`,
    );
    navigate(
      `/support?bookingId=${booking.id}&tag=booking_report&subject=${subject}`,
    );
  };

  const handleReportNoCar = async () => {
    if (!noCarTarget) return;
    setIncidentLoading(noCarTarget.id);
    try {
      await runIncidentAction(session?.access_token, {
        bookingId: noCarTarget.id,
        action: "renter_no_car",
      });
      toast.success("Booking cancelled — your full refund is being processed.", {
        description: "Your reliability record is not affected. You can rebook another car now.",
      });
      setNoCarTarget(null);
      fetchBookings();
    } catch (err) {
      toast.error("Could not file the report", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setIncidentLoading(null);
    }
  };

  const openRateBookingModal = (booking: BookingRow) => {
    setRatingBooking(booking);
    setRatingValue(5);
    setRatingFeedback("");
  };

  const handleRateBooking = async () => {
    if (!user) return;
    if (!ratingBooking) return;
    if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
      toast.error("Rating must be a whole number from 1 to 5.");
      return;
    }
    setSubmittingRating(true);

      const { data: existingReview, error: existingReviewError } = await supabase
        .from("booking_reviews")
        .select("id")
        .eq("booking_id", ratingBooking.id)
      .eq("reviewer_id", user.id)
      .maybeSingle();

    if (existingReviewError) {
      toast.error("Could not check your previous rating", {
        description: existingReviewError.message,
      });
      setSubmittingRating(false);
      return;
    }

    if (existingReview) {
      toast.info("You already rated this booking.");
      setRatingBooking(null);
      setSubmittingRating(false);
      fetchBookings();
      return;
    }

    const { error } = await supabase.from("booking_reviews").insert({
      booking_id: ratingBooking.id,
      car_id: ratingBooking.car_id,
      reviewer_id: user.id,
      reviewee_id: ratingBooking.owner_id,
      reviewer_role: "renter",
      rating: ratingValue,
      feedback: ratingFeedback.trim(),
    });

    if (error) {
      const duplicateReview =
        error.code === "23505" ||
        error.message.toLowerCase().includes("duplicate");

      if (duplicateReview) {
        toast.info("You already rated this booking.");
        setRatingBooking(null);
        fetchBookings();
      } else {
        toast.error("Failed to submit rating", { description: error.message });
      }
    } else {
      toast.success("Thanks for your rating.");
      setRatingBooking(null);
      setRatingFeedback("");
      fetchBookings();
    }
    setSubmittingRating(false);
  };

  const handlePayBalance = async (booking: BookingRow) => {
    if (booking.balance_amount > 100000) {
      toast.error("Payment Exceeds Online Limit", {
        description: `This remaining balance (PHP ${Number(booking.balance_amount).toLocaleString()}) exceeds PayMongo's PHP 100,000 limit.`,
      });
      return;
    }

    setPayingFor(booking.id);

    try {
      const res = await fetch("/api/create-balance-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          bookingId: booking.id,
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        checkoutUrl?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || "Failed to initiate balance payment");
      }

      if (!data.checkoutUrl) {
        throw new Error("Invalid response from payment gateway");
      }

      window.location.href = data.checkoutUrl;
    } catch (err) {
      console.error(err);
      toast.error("Balance Payment Failed", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
      setPayingFor(null);
    }
  };

  const getDocUrl = (path: string) => {
    if (path.startsWith("http")) return path;
    return documentUrls[path] ?? "";
  };

  const getApparentStatus = (b: BookingRow) => {
    if (b.status === "completed") return "completed";
    if (
      b.status === "cancelled" ||
      b.status === "rejected" ||
      b.status === "pending"
    )
      return b.status;
    if (b.status === "awaiting_payment" || b.status === "confirmed") {
      return b.status === "confirmed" ? "confirmed" : "awaiting_payment";
    }
    return b.status;
  };

  const getOwnerDisplay = (booking: BookingRow) => ({
    fullName: booking.owner?.full_name || "Unknown Lister",
    phone: booking.owner?.phone || "No contact info",
    email: booking.owner?.email || "No email available",
    avatarUrl: booking.owner?.avatar_url || null,
    initial: (
      booking.owner?.full_name ||
      booking.owner?.email ||
      "L"
    )
      .charAt(0)
      .toUpperCase(),
  });

  const renderRatingSummary = (
    summary: RatingSummary | undefined,
    emptyLabel: string,
  ) => {
    if (!summary || summary.count === 0) {
      return <span className="text-muted-foreground">{emptyLabel}</span>;
    }

    return (
      <>
        <span className="font-semibold text-foreground">{summary.average.toFixed(1)}</span>
        <span className="text-muted-foreground">({summary.count} {summary.count === 1 ? "review" : "reviews"})</span>
      </>
    );
  };

  const formatTimeAMPM = (timeStr: string | null) => {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const startH = h % 12 || 12;
    return `${startH}:${m.toString().padStart(2, '0')} ${period}`;
  };

  const formatDeadlineStamp = (deadline: string | null) => {
    if (!deadline) return null;
    const parsed = new Date(deadline);
    if (Number.isNaN(parsed.getTime())) return null;
    return format(parsed, "MMM d, yyyy 'at' h:mm a");
  };

  const formatCountdown = (deadline: string | null) => {
    if (!deadline) return null;
    const parsed = new Date(deadline);
    const targetMs = parsed.getTime();
    if (Number.isNaN(targetMs)) return null;

    const diffMs = targetMs - clockNow;
    const expired = diffMs <= 0;
    const absMs = Math.abs(diffMs);
    const totalMinutes = Math.max(0, Math.floor(absMs / 60000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    const parts = [
      days > 0 ? `${days}d` : null,
      days > 0 || hours > 0 ? `${hours}h` : null,
      `${minutes}m`,
    ].filter(Boolean);

    return `${expired ? "Expired" : "Ends"} ${expired ? "" : "in "}${parts.join(" ")}`.trim();
  };

  const getCapturedBookingTotal = (bookingId: string) =>
    paymentLogs
      .filter(
        (payment) =>
          payment.booking_id === bookingId &&
          payment.payment_type !== "refund" &&
          payment.status === "completed" &&
          Number(payment.amount) > 0,
      )
      .reduce((total, payment) => total + Number(payment.amount || 0), 0);

  const getCancellationGuidance = (
    booking: BookingRow,
    apparentState: string,
  ): { tone: string; note: string } | null => {
    const freeTone =
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    const reviewTone =
      "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";

    if (UNPAID_STATES.includes(apparentState)) {
      return {
        tone: freeTone,
        note: "Free to cancel any time before you pay and the trip starts - no money has been collected yet.",
      };
    }

    if (PAID_STATES.includes(apparentState)) {
      const fullHours =
        Number(booking.refund_full_hours_snapshot) || DEFAULT_REFUND_FULL_HOURS;
      const latePercent =
        booking.refund_late_renter_percent_snapshot === null ||
        booking.refund_late_renter_percent_snapshot === undefined
          ? DEFAULT_REFUND_LATE_RENTER_PERCENT
          : Number(booking.refund_late_renter_percent_snapshot);
      const pickupMs = getBookingPickupMs(booking);
      const hoursToPickup =
        pickupMs === null ? null : (pickupMs - clockNow) / (3600 * 1000);

      if (hoursToPickup === null || hoursToPickup >= fullHours) {
        return {
          tone: freeTone,
          note: `Cancel now for a full 100% refund, handled automatically. The full-refund window closes ${fullHours} hours before pickup.`,
        };
      }

      if (hoursToPickup <= 0) {
        return {
          tone: reviewTone,
          note: "Your pickup time has passed. You can still cancel, but any refund is decided by SafeDrive support review.",
        };
      }

      const capturedTotal = getCapturedBookingTotal(booking.id);
      const estimate =
        capturedTotal > 0
          ? ` About ${formatCurrency(
              Math.round(capturedTotal * (latePercent / 100)),
            )} of ${formatCurrency(capturedTotal)}.`
          : "";
      return {
        tone: reviewTone,
        note: `Short-notice cancellation (less than ${fullHours} hours before pickup). You would get about ${latePercent}% back; the rest compensates the lister.${estimate} Released through SafeDrive support review - no automatic penalty beyond this share.`,
      };
    }

    return null;
  };

  const formatDateInputMin = (dateValue: string) => {
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) return undefined;
    const nextDay = new Date(parsed);
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay.toISOString().slice(0, 10);
  };

  const getLatestExtension = (bookingId: string) =>
    bookingExtensionsByBooking[bookingId]?.[0];

  const canStartFreshExtension = (booking: BookingRow, latestExtension?: BookingExtensionRow) => {
    const apparentState = getApparentStatus(booking);
    if (!["fully_paid", "active"].includes(apparentState)) return false;
    if (!latestExtension) return true;
    return !["pending", "approved"].includes(
      getExtensionDisplayStatus(latestExtension, new Date(clockNow)),
    );
  };

  const canCancelBooking = (booking: BookingRow, apparentState: string) => {
    if (booking.renter_arrived_at || booking.lister_arrived_at) return false;
    return [
      "pending",
      "confirmed",
      "awaiting_payment",
      "downpayment_paid",
      "fully_paid",
    ].includes(apparentState);
  };

  const getProcessGuidance = (booking: BookingRow, apparentState: string) => {
    if (apparentState === "pending") {
      const cancellationGuidance = getCancellationGuidance(booking, apparentState);
      return {
        tone: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        title: "Waiting for lister response",
        body: booking.owner_response_deadline
          ? `${formatCountdown(booking.owner_response_deadline)}. The lister still needs to accept or reject this request.`
          : "The lister still needs to accept or reject this request.",
        footnote: booking.owner_response_deadline
          ? `Response deadline: ${formatDeadlineStamp(booking.owner_response_deadline)}`
          : cancellationGuidance?.note || "You can still cancel while the request is waiting for review.",
      };
    }

    if (apparentState === "awaiting_payment" || apparentState === "confirmed") {
      return {
        tone: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        title: "Downpayment still needed",
        body: booking.payment_deadline
          ? `${formatCountdown(booking.payment_deadline)}. Complete the PayMongo checkout before the payment window closes.`
          : "Complete the PayMongo checkout to lock in this booking.",
        footnote: booking.payment_deadline
          ? `Payment deadline: ${formatDeadlineStamp(booking.payment_deadline)}`
          : "Your request will only move forward after the payment is confirmed.",
      };
    }

    if (apparentState === "downpayment_paid") {
      return {
        tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        title: "Downpayment confirmed",
        body: "Your request is reserved. Settle the remaining balance before pickup so the rental can move into the arrival stage.",
        footnote: "Keep your rental agreement and payment records ready for pickup day.",
      };
    }

    if (apparentState === "fully_paid" || apparentState === "active") {
      const returnReminder = getReturnReminderState(
        {
          status: apparentState,
          end_date: booking.end_date,
          dropoff_time: booking.dropoff_time,
        },
        new Date(clockNow),
      );

      if (returnReminder) {
        return returnReminder;
      }
    }

    return null;
  };

  const getNextStep = (
    booking: BookingRow,
    apparentState: string,
    reviewedByRenter: boolean | undefined,
    extensionBlocksCompletion: boolean,
  ) => {
    const tone = "border-primary/20 bg-primary/5 text-foreground";

    if (apparentState === "pending") {
      return {
        tone,
        title: "Wait for lister response",
        body: "The lister still needs to accept or reject this request.",
      };
    }

    if (apparentState === "awaiting_payment" || apparentState === "confirmed") {
      return {
        tone,
        title: "Pay to secure the booking",
        body: "Use downpayment or full payment before the payment window closes.",
      };
    }

    if (apparentState === "downpayment_paid") {
      return {
        tone,
        title: "Pay the remaining balance",
        body: "The rental can start after the balance is confirmed by PayMongo.",
      };
    }

    if (apparentState === "fully_paid" || apparentState === "active") {
      if (!booking.renter_arrived_at) {
        return {
          tone,
          title: "Confirm arrival at pickup",
          body: "Tap arrival when you are at the agreed meetup location.",
        };
      }

      if (!booking.lister_arrived_at) {
        return {
          tone,
          title: "Wait for the lister arrival",
          body: "Your check-in is recorded. If they do not arrive after the grace window, report a no-show.",
        };
      }

      if (extensionBlocksCompletion) {
        return {
          tone,
          title: "Resolve the extension first",
          body: "Complete, pay, or cancel the active extension request before finishing the trip.",
        };
      }

      if (!booking.renter_completed) {
        if (!booking.renter_return_arrived_at) {
          return {
            tone,
            title: "Confirm you've returned the car",
            body: 'Submit your return report, then tap "I\'ve Returned the Car" once you\'re back with the lister.',
          };
        }
        if (!booking.owner_completed) {
          return {
            tone,
            title: "Waiting for the lister to confirm receipt",
            body: "Your return is recorded. The lister needs to inspect the car and confirm receipt before you can finish.",
          };
        }
        return {
          tone,
          title: "Confirm the car was delivered",
          body: 'The lister confirmed receipt. Tap "Car Confirm" to finish the trip.',
        };
      }

      if (!booking.owner_completed) {
        return {
          tone,
          title: "Wait for the lister to finish",
          body: "Your side is done. The booking completes when the lister confirms too.",
        };
      }
    }

    if (apparentState === "completed") {
      return reviewedByRenter
        ? {
            tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            title: "All done",
            body: "Your trip and rating are complete.",
          }
        : {
            tone,
            title: "Rate this booking",
            body: "Leave a quick rating while the trip is still fresh.",
          };
    }

    return null;
  };

  const historyStatuses = new Set([
    "completed",
    "cancelled",
    "rejected",
    "expired",
  ]);
  const activeBookings = bookings.filter(
    (booking) => !historyStatuses.has(getApparentStatus(booking)),
  );
  const bookingHistory = bookings.filter((booking) =>
    historyStatuses.has(getApparentStatus(booking)),
  );
  const visibleBookings =
    bookingView === "active" ? activeBookings : bookingHistory;
  const bookingPagination = paginateItems(visibleBookings, bookingPage);

  useEffect(() => {
    if (bookingPagination.page !== bookingPage) setBookingPage(bookingPagination.page);
  }, [bookingPage, bookingPagination.page]);

  useEffect(() => {
    setBookingPage(1);
    setOpenBookingId(null);
  }, [bookingView]);

  useEffect(() => {
    if (!openBookingId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenBookingId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openBookingId]);

  const changeBookingPage = (nextPage: number) => {
    setBookingPage(nextPage);
    window.requestAnimationFrame(() => {
      document.getElementById("renter-booking-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const bookingLookup = new Map(bookings.map((booking) => [booking.id, booking]));
  const renterSummary = useMemo(
    () => ({
      waitingOwner: bookings.filter((booking) => getApparentStatus(booking) === "pending").length,
      paymentAttention: bookings.filter((booking) =>
        ["awaiting_payment", "confirmed", "downpayment_paid"].includes(getApparentStatus(booking)),
      ).length,
      activeTrips: bookings.filter((booking) =>
        ["fully_paid", "active"].includes(getApparentStatus(booking)),
      ).length,
      completedTrips: bookings.filter((booking) => getApparentStatus(booking) === "completed").length,
    }),
    [bookings],
  );
  const upcomingRenterBookings = useMemo(
    () =>
      bookings
        .filter((booking) => ["fully_paid", "active", "downpayment_paid"].includes(getApparentStatus(booking)))
        .slice()
        .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())
        .slice(0, 3),
    [bookings],
  );

  const formatCurrency = (amount: number) =>
    `PHP ${Number(amount).toLocaleString()}`;

  const downloadPaymentAcknowledgment = async (payment: Payment, booking?: BookingRow) => {
    const isRefund = payment.payment_type === "refund" || Number(payment.amount) < 0;
    const isFullPaymentReceipt =
      Boolean(payment.transaction_id) &&
      payment.notes?.includes("Captured as part of full booking payment via PayMongo webhook");
    const bookingLabel = booking
      ? `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`
      : "Booking payment";
    const paymentType = isRefund
      ? "Refund"
      : isFullPaymentReceipt
        ? "Full booking payment"
        : payment.payment_type.replaceAll("_", " ");
    const amount = Math.abs(
      isFullPaymentReceipt && booking ? Number(booking.total_price) : Number(payment.amount || 0),
    );
    const recordedAt = (() => {
      const parsed = new Date(payment.created_at);
      return Number.isNaN(parsed.getTime())
        ? "Not recorded"
        : format(parsed, "MMM d, yyyy h:mm a");
    })();
    const renterName = user?.user_metadata?.full_name || user?.email || "SafeDrive renter";
    const listerName = booking?.owner?.full_name || "Vehicle lister";

    try {
      await downloadReceiptPdf({
        title: isRefund ? "Refund Receipt" : "Payment Acknowledgment",
        subtitle: isRefund
          ? "Confirmation of a refund recorded and requested through SafeDrive"
          : "Confirmation of a payment recorded through the SafeDrive platform",
        documentNo: `${isRefund ? "SD-RF-" : "SD-PA-"}${payment.id.slice(0, 8).toUpperCase()}`,
        statusLabel: payment.status,
        recordedAt,
        amount,
        amountLabel: isRefund ? "Amount refunded" : "Amount acknowledged",
        rows: [
          ["Payer", renterName],
          ["Lister", listerName],
          ["Booking", bookingLabel],
          ["Booking ID", booking?.id || payment.booking_id || "Not recorded"],
          [isRefund ? "Refund type" : "Payment type", paymentType],
          [isRefund ? "Return method" : "Payment method", payment.payment_method || "Not recorded"],
          ["PayMongo reference", payment.transaction_id || "Not recorded"],
        ],
        notice: isRefund ? RECEIPT_NOTICES.refund : RECEIPT_NOTICES.payment,
        recordId: payment.id,
        filename: `safedrive-${isRefund ? "refund" : "payment-acknowledgment"}-${payment.id}.pdf`,
      });
      toast.success(isRefund ? "Refund receipt downloaded." : "Payment acknowledgment downloaded.");
    } catch (error) {
      console.error("Failed to generate receipt", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not generate the receipt. Please try again.",
      );
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Bookings</h1>
          <p className="text-muted-foreground mt-1">
            Track your rental requests and active bookings
          </p>
        </div>
        {renterReputation && renterReputation.reviewCount > 0 && (
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-right">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Your renter rating
            </p>
            <p className="flex items-center justify-end gap-1 text-sm font-semibold">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              {renterReputation.average?.toFixed(1)}
              <span className="font-normal text-muted-foreground">
                ({renterReputation.reviewCount})
              </span>
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: "overview", label: "Overview" },
          { id: "bookings", label: "Bookings" },
          { id: "payments", label: "Payments" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPageTab(tab.id as "overview" | "bookings" | "payments")}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              pageTab === tab.id
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {pageTab === "overview" && (
        <>
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-blue-600 dark:text-blue-400">
          Booking process reminder
        </p>
        <p className="mt-1">
          A trip can start as early as tomorrow. The lister has 24 hours to accept and you then have 24 hours to pay, but both steps must finish before the pickup time shown on the card &mdash; otherwise the request auto-cancels and the car is released.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Waiting for owner</p>
            <p className="mt-1 text-2xl font-bold">{renterSummary.waitingOwner}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Payment attention</p>
            <p className="mt-1 text-2xl font-bold">{renterSummary.paymentAttention}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Active trips</p>
            <p className="mt-1 text-2xl font-bold">{renterSummary.activeTrips}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Completed</p>
            <p className="mt-1 text-2xl font-bold">{renterSummary.completedTrips}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Upcoming Bookings</h2>
              <p className="text-sm text-muted-foreground">
                Your nearest paid or active rentals that may need payment, arrival, or completion soon.
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {upcomingRenterBookings.length}
            </span>
          </div>
          {upcomingRenterBookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No upcoming paid bookings yet.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {upcomingRenterBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="rounded-lg border border-border/60 p-3"
                >
                  <p className="font-medium">
                    {booking.cars.car_models.car_brands.name} {booking.cars.car_models.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {format(new Date(booking.start_date), "MMM d, yyyy")}
                    {booking.pickup_time ? ` at ${formatTimeAMPM(booking.pickup_time)}` : ""}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {booking.cars.location || "Pickup location not set"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
        </>
      )}

      {pageTab === "bookings" && (loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="flex gap-4">
                  <Skeleton className="h-16 w-16 rounded-lg" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-20">
          <Calendar className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold">No bookings yet</h3>
          <p className="text-muted-foreground text-sm mt-1">
            Browse available cars and make your first booking!
          </p>
        </div>
      ) : (
        <div id="renter-booking-list" className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap gap-2">
            {([
              { id: "active", label: "Active", count: activeBookings.length },
              { id: "history", label: "History", count: bookingHistory.length },
            ] as const).map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => setBookingView(view.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                  bookingView === view.id
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {view.label}
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    bookingView === view.id
                      ? "bg-primary/20"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {view.count}
                </span>
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-semibold">
              {bookingView === "active" ? "Active Bookings" : "Booking History"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {bookingView === "active"
                ? "Requests and rentals that still need payment, arrival, or completion."
                : "Completed, cancelled, rejected, and expired bookings stay here for reference."}
            </p>
          </div>

          {visibleBookings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 py-14 text-center text-sm text-muted-foreground">
              {bookingView === "active"
                ? "No active bookings right now."
                : "No past bookings yet."}
            </div>
          ) : null}

          {bookingPagination.items.map((booking) => {
            const apparentState = getApparentStatus(booking);
            const status = statusConfig[apparentState] || statusConfig.pending;
            const StatusIcon = status.icon;
            const ownerDisplay = getOwnerDisplay(booking);
            const rentalAgreement = booking.cars.car_documents?.find(
              (d) => d.document_type === "rental_agreement",
            );
            const agreementDocPath =
              booking.agreement_storage_path_snapshot ||
              rentalAgreement?.storage_path ||
              null;
            const carRatingSummary = carRatingSummaries[booking.car_id];
            const reviewedByRenter = booking.booking_reviews?.some(
              (review) =>
                review.reviewer_id === user?.id &&
                review.reviewer_role === "renter",
            );
            const listerCancelled = listerCancelledBookingIds.has(booking.id);
            const processGuidance = getProcessGuidance(booking, apparentState);
            const cancellationGuidance = canCancelBooking(booking, apparentState)
              ? getCancellationGuidance(booking, apparentState)
              : null;
            const latestExtension = getLatestExtension(booking.id);
            const extensionHistory = bookingExtensionsByBooking[booking.id] ?? [];
            const apparentExtensionStatus = latestExtension
              ? getExtensionDisplayStatus(latestExtension, new Date(clockNow))
              : null;
            const extensionServiceFee = latestExtension
              ? Math.max(
                  0,
                  Number(latestExtension.total_additional_amount) -
                    Number(latestExtension.extension_amount) -
                    Number(latestExtension.fuel_top_up_amount),
                )
              : 0;
            const extensionBlocksCompletion =
              apparentExtensionStatus === "pending" || apparentExtensionStatus === "approved";
            const latestEarly = latestEarlyReturn(earlyReturnsByBooking[booking.id]);
            const canRequestEarlyReturn =
              (apparentState === "fully_paid" || apparentState === "active") &&
              !booking.renter_completed &&
              !booking.owner_completed &&
              !extensionBlocksCompletion &&
              (!latestEarly || latestEarly.status !== "pending");
            const noShowState = getNoShowWindowState(
              booking,
              "renter",
              new Date(clockNow),
            );
            const nextStep = getNextStep(
              booking,
              apparentState,
              reviewedByRenter,
              extensionBlocksCompletion,
            );
            const refundPayments = paymentLogs.filter(
              (payment) =>
                payment.booking_id === booking.id && payment.payment_type === "refund",
            );
            const latestRefund = refundPayments[0] ?? null;
            const refundAmount = refundPayments.reduce(
              (total, payment) => total + Math.abs(Number(payment.amount) || 0),
              0,
            );
            const isManualRefundReview = latestRefund?.payment_method === "manual_review";
            const showTripProgress = ["fully_paid", "active", "completed"].includes(apparentState);
            const isOpen = openBookingId === booking.id;
            const carTitle = `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name}`;
            const bookingPickupMs = getBookingPickupMs(booking);
            const arrivalCheckinOpensMs =
              bookingPickupMs === null
                ? null
                : bookingPickupMs - arrivalLeadHours * 60 * 60 * 1000;
            const arrivalCheckinOpen =
              arrivalCheckinOpensMs === null || clockNow >= arrivalCheckinOpensMs;
            const tripHasStarted =
              bookingPickupMs === null || clockNow >= bookingPickupMs;

            return (
              <div key={booking.id} className="space-y-4">
                <Card
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenBookingId(booking.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setOpenBookingId(booking.id);
                    }
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-base">{carTitle}</h3>
                          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {booking.cars.plate_number}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </span>
                        </div>
                        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(booking.start_date), "MMM d, yyyy")} -{" "}
                          {format(new Date(booking.end_date), "MMM d, yyyy")}
                          <span className="ml-1 font-medium text-foreground">
                            ({formatDayCount(booking.total_days)})
                          </span>
                        </p>
                        {nextStep ? (
                          <p className="text-xs text-muted-foreground">
                            <span className="font-semibold uppercase tracking-wide opacity-70">
                              Next:{" "}
                            </span>
                            {nextStep.title}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-base font-bold">
                          PHP {Number(booking.total_price).toLocaleString()}
                        </p>
                        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                          View details
                          <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {isOpen &&
                  createPortal(
                    <div
                      className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
                      onClick={() => setOpenBookingId(null)}
                    >
                      <Card
                        className="my-4 w-full max-w-3xl shadow-2xl md:max-w-4xl"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-3">
                          <p className="min-w-0 truncate font-semibold">
                            {carTitle}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {booking.cars.plate_number}
                            </span>
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0"
                            onClick={() => setOpenBookingId(null)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                        <CardContent className="max-h-[75vh] space-y-5 overflow-y-auto p-5 [&_.justify-end]:justify-start [&_.text-right]:text-left">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-semibold text-base">
                          {booking.cars.car_models.car_brands.name}{" "}
                          {booking.cars.car_models.name}{" "}
                          <span className="text-xs ml-1 bg-muted px-2 py-0.5 rounded text-muted-foreground">{booking.cars.plate_number}</span>
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                        >
                          <StatusIcon className="w-3 h-3" />
                          {status.label}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-0.5">
                        <p>Plate: {booking.cars.plate_number}</p>
                        <p className="flex items-center gap-1.5">
                          <Star className="w-3.5 h-3.5 text-amber-500 fill-current" />
                          <span className="text-xs">
                            Car rating:{" "}
                            {renderRatingSummary(carRatingSummary, "No ratings yet")}
                          </span>
                        </p>
                        <p className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {format(
                            new Date(booking.start_date),
                            "MMM d, yyyy",
                          )}{" "}
                          {booking.pickup_time ? `at ${formatTimeAMPM(booking.pickup_time)}` : ""}
                          - {format(new Date(booking.end_date), "MMM d, yyyy")}{" "}
                          {booking.dropoff_time ? `at ${formatTimeAMPM(booking.dropoff_time)}` : ""}
                          <span className="font-medium text-foreground ml-1">
                            ({formatDayCount(booking.total_days)})
                          </span>
                        </p>
                        {booking.cars.location && (
                          <p className="mt-1 flex items-center gap-1">
                            <span aria-hidden="true">Location:</span> {booking.cars.location}
                          </p>
                        )}
                      </div>

                      {/* Lister Basic Info */}
                      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border/40">
                        <button
                          onClick={() => setSelectedOwner(booking)}
                          className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
                        >
                          {ownerDisplay.avatarUrl ? (
                            <img src={ownerDisplay.avatarUrl} alt="Lister" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                              {ownerDisplay.initial}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground">
                            <p className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                              {ownerDisplay.fullName} <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-md uppercase tracking-wider font-bold">Lister</span>
                            </p>
                            <p className="flex items-center gap-1 mt-0.5">Phone: {ownerDisplay.phone}</p>
                          </div>
                        </button>
                      </div>

                      {/* Rental Agreement */}
                      {agreementDocPath &&
                        (apparentState === "downpayment_paid" ||
                          apparentState === "active" ||
                          apparentState === "fully_paid" ||
                          apparentState === "completed") &&
                        getDocUrl(agreementDocPath) && (
                          <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-left">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Rental agreement
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              The lister&apos;s terms you accepted for this rental. Review them anytime during the trip.
                            </p>
                            <a
                              href={getDocUrl(agreementDocPath)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                            >
                              <Download className="w-3.5 h-3.5" />
                              View rental agreement
                            </a>
                          </div>
                        )}
                    </div>

                    <div className="mt-5 space-y-3 border-t border-border/50 pt-5">
                      <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Total
                          </span>
                          <span className="text-lg font-bold">
                            PHP {Number(booking.total_price).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            Down:{" "}
                            <span className="font-medium text-foreground">
                              PHP {Number(booking.downpayment_amount).toLocaleString()}
                            </span>
                          </span>
                          <span>
                            Balance:{" "}
                            <span className="font-medium text-foreground">
                              PHP {Number(booking.balance_amount).toLocaleString()}
                            </span>
                          </span>
                        </div>
                      </div>

                      {nextStep ? (
                        <div
                          className={`mt-3 rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${nextStep.tone}`}
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                            Next step
                          </p>
                          <p className="mt-1 font-semibold">{nextStep.title}</p>
                          <p className="mt-1 opacity-80">{nextStep.body}</p>
                        </div>
                      ) : null}

                      {processGuidance && (
                        <div
                          className={`mt-3 max-w-xl rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${processGuidance.tone}`}
                        >
                          <p className="font-semibold">{processGuidance.title}</p>
                          <p className="mt-1">{processGuidance.body}</p>
                          {processGuidance.footnote && (
                            <p className="mt-1 opacity-80">{processGuidance.footnote}</p>
                          )}
                        </div>
                      )}

                      {apparentState === "cancelled" ? (
                        <div
                          className={`mt-3 rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${
                            latestRefund?.status === "completed"
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : latestRefund
                                ? "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                                : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          <p className="font-semibold">
                            {latestRefund?.status === "completed"
                              ? "Refund completed"
                              : latestRefund
                                ? "Refund processing"
                                : "Refund needs review"}
                          </p>
                          <p className="mt-1">
                            {latestRefund
                              ? latestRefund.status === "completed"
                                ? `${formatCurrency(refundAmount || Math.abs(Number(latestRefund.amount)))} was marked returned by SafeDrive.`
                                : isManualRefundReview
                                  ? `${formatCurrency(refundAmount || Math.abs(Number(latestRefund.amount)))} is waiting for admin refund review.`
                                  : `${formatCurrency(refundAmount || Math.abs(Number(latestRefund.amount)))} was accepted by PayMongo and will return to the payment method used at checkout once the provider finishes processing it.`
                              : "No automatic refund record was found for this cancelled booking."}
                          </p>
                          {latestRefund ? (
                            <p className="mt-1 opacity-80">
                              {isManualRefundReview
                                ? "Admin will send the refund back and record the release details."
                                : "You do not need to enter GCash, Maya, or card details here."}
                            </p>
                          ) : null}
                          {latestRefund?.created_at ? (
                            <p className="mt-1 opacity-80">
                              Recorded: {format(new Date(latestRefund.created_at), "MMM d, yyyy h:mm a")}
                            </p>
                          ) : null}
                          {!latestRefund ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 h-8 px-2 text-xs"
                              onClick={() => handleReportBooking(booking)}
                            >
                              Ask support to review
                            </Button>
                          ) : null}
                        </div>
                      ) : null}

                      {latestExtension ? (
                        <div
                          className={`mt-3 max-w-xl rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${getExtensionTone(apparentExtensionStatus ?? latestExtension.status)}`}
                        >
                          <p className="font-semibold">Booking extension</p>
                          <p className="mt-1">
                            {getExtensionStatusLabel(apparentExtensionStatus ?? latestExtension.status)}.
                            Requested return:{" "}
                            {format(new Date(latestExtension.requested_end_date), "MMM d, yyyy")}.
                          </p>
                          <p className="mt-1">
                            Reason: {latestExtension.reason}
                          </p>
                          <p className="mt-1">
                            Added: {formatDayCount(latestExtension.extension_days)} | Extension:
                            {" "}{formatCurrency(Number(latestExtension.extension_amount))}
                            {extensionServiceFee > 0
                              ? ` | Service fee: ${formatCurrency(extensionServiceFee)}`
                              : ""}
                            {Number(latestExtension.fuel_top_up_amount) > 0
                              ? ` | Fuel top-up: ${formatCurrency(Number(latestExtension.fuel_top_up_amount))}`
                              : ""}
                          </p>
                          <p className="mt-1 font-medium">
                            Total additional payment: {formatCurrency(Number(latestExtension.total_additional_amount))}
                          </p>
                          {latestExtension.owner_decision_note ? (
                            <p className="mt-1 opacity-80">
                              Lister note: {latestExtension.owner_decision_note}
                            </p>
                          ) : null}
                          {latestExtension.payment_deadline ? (
                            <p className="mt-1 opacity-80">
                              Payment deadline: {formatDeadlineStamp(latestExtension.payment_deadline)}
                            </p>
                          ) : null}
                          {apparentExtensionStatus === "expired" ? (
                            <p className="mt-1 font-medium">
                              The approved extension was not paid before the deadline and is no longer payable.
                            </p>
                          ) : null}
                          {extensionHistory.length > 1 ? (
                            <div className="mt-2 border-t border-current/15 pt-2 opacity-90">
                              <p className="font-medium">Extension history</p>
                              <div className="mt-1 space-y-1">
                                {extensionHistory.slice(1).map((entry) => {
                                  const historyStatus = getExtensionDisplayStatus(
                                    entry,
                                    new Date(clockNow),
                                  );
                                  return (
                                    <p key={entry.id}>
                                      {format(new Date(entry.created_at), "MMM d, yyyy")} -{" "}
                                      {getExtensionStatusLabel(historyStatus)}
                                    </p>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {apparentExtensionStatus === "approved" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2 text-xs"
                                disabled={extensionActionLoading === latestExtension.id}
                                onClick={() => handlePayExtension(latestExtension)}
                              >
                                {extensionActionLoading === latestExtension.id ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CreditCard className="mr-1 h-3.5 w-3.5" />
                                )}
                                Pay extension
                              </Button>
                            ) : null}
                            {["pending", "approved"].includes(apparentExtensionStatus ?? latestExtension.status) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2 text-xs text-red-500 hover:text-red-600"
                                disabled={extensionActionLoading === latestExtension.id}
                                onClick={() => handleCancelExtension(latestExtension)}
                              >
                                {extensionActionLoading === latestExtension.id ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <XCircle className="mr-1 h-3.5 w-3.5" />
                                )}
                                Cancel extension
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {canStartFreshExtension(booking, latestExtension) ? (
                        <div className="mt-3 flex items-center justify-end gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            Need more time?
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            onClick={() => setExtensionRequestBooking(booking)}
                          >
                            Request extension
                          </Button>
                        </div>
                      ) : null}

                      {latestEarly &&
                      latestEarly.status !== "cancelled" ? (
                        <div
                          className={`mt-3 max-w-xl rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${earlyReturnTone(
                            latestEarly.status,
                          )}`}
                        >
                          <p className="font-semibold">Early return</p>
                          <p className="mt-1">
                            {earlyReturnStatusLabel(latestEarly.status)}. Requested
                            new return:{" "}
                            {format(
                              new Date(latestEarly.requested_end_date),
                              "MMM d, yyyy",
                            )}
                            .
                          </p>
                          {latestEarly.reason ? (
                            <p className="mt-1">Reason: {latestEarly.reason}</p>
                          ) : null}
                          {latestEarly.owner_decision_note ? (
                            <p className="mt-1 opacity-80">
                              Lister note: {latestEarly.owner_decision_note}
                            </p>
                          ) : null}
                          {latestEarly.status === "approved" &&
                          Number(latestEarly.goodwill_refund_amount) > 0 ? (
                            <p className="mt-1 font-medium">
                              Goodwill refund:{" "}
                              {formatCurrency(
                                Number(latestEarly.goodwill_refund_amount),
                              )}{" "}
                              (released by SafeDrive support)
                            </p>
                          ) : latestEarly.status === "approved" ? (
                            <p className="mt-1">
                              No refund for the unused days.
                            </p>
                          ) : null}
                          {latestEarly.status === "pending" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 h-8 px-2 text-xs text-red-500 hover:text-red-600"
                              disabled={earlyReturnLoading === booking.id}
                              onClick={() =>
                                void cancelEarlyReturn(latestEarly.id, booking.id)
                              }
                            >
                              Withdraw request
                            </Button>
                          ) : null}
                        </div>
                      ) : null}

                      {canRequestEarlyReturn ? (
                        <div className="mt-3 flex items-center justify-end gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            Finishing early?
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            onClick={() => {
                              setEarlyReturnDraft({
                                requestedEndDate: "",
                                reason: "",
                              });
                              setEarlyReturnModalBooking(booking);
                            }}
                          >
                            Request early return
                          </Button>
                        </div>
                      ) : null}

                      {/* Payment Options */}
                      {(apparentState === "awaiting_payment" ||
                        apparentState === "confirmed") && (
                        <div className="mt-2 text-right">
                          <p className="text-[10px] text-muted-foreground mb-2 max-w-md leading-tight">
                            After the lister accepts, you can secure the booking with the reservation downpayment or settle the full amount in one checkout.
                          </p>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePayDownpayment(booking)}
                              disabled={payingFor === booking.id}
                              className="gap-1"
                            >
                              {payingFor === booking.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CreditCard className="w-3.5 h-3.5" />
                              )}
                              Pay Down PHP {Number(booking.downpayment_amount).toLocaleString()}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handlePayFull(booking)}
                              disabled={payingFor === booking.id}
                              className="gap-1 shadow-lg shadow-primary/20"
                            >
                              {payingFor === booking.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CreditCard className="w-3.5 h-3.5" />
                              )}
                              Pay Full PHP {Number(booking.total_price).toLocaleString()}
                            </Button>
                          </div>
                        </div>
                      )}
                      {apparentState === "downpayment_paid" && (
                        <div className="mt-2 text-right">
                          <Button
                            size="sm"
                            onClick={() => handlePayBalance(booking)}
                            disabled={payingFor === booking.id}
                            className="gap-1 shadow-lg shadow-primary/20"
                          >
                            {payingFor === booking.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CreditCard className="w-3.5 h-3.5" />
                            )}
                            Pay Balance PHP {Number(booking.balance_amount).toLocaleString()}
                          </Button>
                          <p className="text-[10px] text-amber-600 mt-2 max-w-md leading-tight">
                            Remaining balance must be confirmed before the rental can start.
                          </p>
                        </div>
                      )}

                      {/* Cancel Booking */}
                      {canCancelBooking(booking, apparentState) && (
                        <div className="mt-2 space-y-2 text-right">
                          {cancellationGuidance ? (
                            <p
                              className={`max-w-xl rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${cancellationGuidance.tone}`}
                            >
                              {cancellationGuidance.note}
                            </p>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCancelTargetBooking(booking)}
                            disabled={payingFor === booking.id}
                            className="gap-1 text-red-500 hover:text-red-600 hover:bg-red-50"
                          >
                            {payingFor === booking.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5" />
                            )}
                            {["downpayment_paid", "fully_paid"].includes(apparentState)
                              ? "Cancel & Refund"
                              : "Cancel Booking"}
                          </Button>
                        </div>
                      )}

                      {/* Arrival Phase - opens only near the booked pickup time */}
                      {(apparentState === "fully_paid" || apparentState === "active") &&
                        !booking.renter_arrived_at &&
                        !arrivalCheckinOpen &&
                        arrivalCheckinOpensMs !== null && (
                          <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left text-[11px] leading-relaxed text-muted-foreground">
                            <p className="font-semibold text-foreground">Arrival check-in not open yet</p>
                            <p className="mt-1">
                              Opens {arrivalLeadHours} hour{arrivalLeadHours === 1 ? "" : "s"} before pickup -{" "}
                              {format(new Date(arrivalCheckinOpensMs), "MMM d, yyyy h:mm a")}.
                            </p>
                          </div>
                        )}

                      {(apparentState === "fully_paid" || apparentState === "active") && !booking.renter_arrived_at && arrivalCheckinOpen && (
                        <div className="mt-2 text-right">
                          <p className="mb-2 text-xs font-medium text-foreground">
                            {booking.lister_arrived_at
                              ? "The lister confirmed the handover - confirm you have the car"
                              : "Confirm you have the car"}
                          </p>
                          {!booking.lister_arrived_at && (
                            <p className="mb-2 text-[10px] text-muted-foreground leading-tight">
                              The lister confirms the handover first. You can also confirm now if you have the car.
                            </p>
                          )}
                          <ArrivalPhotoCapture
                            loading={payingFor === booking.id}
                            disabled={payingFor === booking.id}
                            onConfirmArrival={(location) => handleArrive(booking.id, location)}
                          />
                          <div className="mt-2 flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => navigate(`/trip-report/${booking.id}/pickup`)}>
                              Add pickup photos (optional)
                            </Button>
                            <span
                              className="inline-flex h-7 w-7 shrink-0 cursor-help items-center justify-center rounded-md text-muted-foreground"
                              title="Optional, but highly encouraged: if there's ever a dispute, you and the lister both need this evidence."
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                            Confirm arrival first. Your own pickup photos are optional - the lister files the "before" report. Arrival location is optional and stored only with your consent.
                          </p>
                        </div>
                      )}

                      {noShowState ? (
                        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                          <p className="font-semibold text-amber-900 dark:text-amber-100">
                            {noShowState.canReport
                              ? "The lister still has not checked in."
                              : "Waiting through the pickup grace window."}
                          </p>
                          <p className="mt-1">
                            {noShowState.canReport
                              ? "Your arrival check-in is on file and the lister still has not arrived with the car. You can cancel this booking now for a full refund — this will not affect your reliability record."
                              : `SafeDrive waits until ${noShowState.reportReadyAt.toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })} before you can cancel for no car at pickup. Add optional pickup photos in the meantime if you want extra evidence.`}
                          </p>
                          {noShowState.canReport ? (
                            <div className="mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setNoCarTarget(booking)}
                                className="gap-1"
                              >
                                <AlertCircle className="w-3.5 h-3.5" />
                                No car at pickup — cancel &amp; refund
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {showTripProgress && (
                        <div className="mt-3 max-w-xl rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left text-[11px] leading-relaxed">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="font-semibold text-foreground">Trip progress</p>
                            <span className="text-[10px] text-muted-foreground">
                              {apparentState === "completed" ? "Complete" : "In handoff"}
                            </span>
                          </div>
                          <div className="grid gap-1.5">
                            {(() => {
                              const bothArrived = Boolean(booking.renter_arrived_at) && Boolean(booking.lister_arrived_at);
                              const ownerReports = ownerReportsByBooking[booking.id] ?? { pickup: false, return: false };
                              return [
                                { label: "You arrived", done: Boolean(booking.renter_arrived_at) },
                                { label: "Lister arrived", done: Boolean(booking.lister_arrived_at) },
                                { label: "Vehicle handover", done: ownerReports.pickup },
                                { label: "Vehicle received", done: bothArrived && ownerReports.pickup },
                                { label: "Rental in progress", done: booking.status === "active" || booking.status === "completed" },
                                { label: "Vehicle returned", done: Boolean(booking.renter_return_arrived_at) },
                                { label: "Return confirmed", done: booking.owner_completed },
                                { label: "Your rating", done: Boolean(reviewedByRenter) },
                              ];
                            })().map((step) => (
                              <div key={step.label} className="flex items-center gap-2">
                                {step.done ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                                ) : (
                                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                )}
                                <span className={step.done ? "text-foreground" : "text-muted-foreground"}>
                                  {step.label}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {[
                        "fully_paid",
                        "active",
                        "completed",
                      ].includes(apparentState) && (
                        <div className="mt-2 flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleReportBooking(booking)}
                            className="gap-1 text-muted-foreground"
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            Report Booking
                          </Button>
                        </div>
                      )}

                      {apparentState === "completed" && !reviewedByRenter && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openRateBookingModal(booking)}
                            className="gap-1"
                          >
                            Rate Booking
                        </Button>
                      )}

                      {apparentState === "cancelled" &&
                        listerCancelled &&
                        !reviewedByRenter && (
                          <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-left">
                            <p className="text-xs text-muted-foreground">
                              The lister cancelled this booking. You can leave
                              feedback about the experience.
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openRateBookingModal(booking)}
                              className="mt-2 gap-1"
                            >
                              Rate this experience
                            </Button>
                          </div>
                        )}

                      {(apparentState === "awaiting_payment" ||
                        apparentState === "confirmed") &&
                        booking.paymongo_checkout_id && (
                          <p className="text-[10px] text-amber-600 mt-2 max-w-md leading-tight">
                            Checkout created. Your payment stays pending until
                            PayMongo confirms it through the signed webhook.
                          </p>
                        )}
                      {apparentState === "downpayment_paid" &&
                        booking.paymongo_balance_checkout_id && (
                          <p className="text-[10px] text-amber-600 mt-2 max-w-md leading-tight">
                            Balance checkout created. The booking becomes fully paid only after the signed PayMongo webhook confirms it.
                          </p>
                        )}
                      {apparentState === "completed" && reviewedByRenter && (
                        <p className="text-[10px] text-green-600 font-medium">
                          Rating submitted
                        </p>
                      )}

                      {/* Confirm Agreement */}
                      {(apparentState === "fully_paid" || apparentState === "active") && booking.renter_arrived_at && !booking.renter_completed && (
                        <div className="mt-2 text-right">
                          <p className="text-[10px] text-green-500 font-semibold flex flex-col items-start mb-2">
                             <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Arrived: {new Date(booking.renter_arrived_at).toLocaleTimeString()}</span>
                          </p>
                          {extensionBlocksCompletion ? (
                            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                              Complete or cancel the extension request before marking the agreement done.
                            </div>
                          ) : !tripHasStarted && bookingPickupMs !== null ? (
                            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left text-[11px] leading-relaxed text-muted-foreground">
                              You can finish the trip once it starts - pickup is{" "}
                              {format(new Date(bookingPickupMs), "MMM d, yyyy h:mm a")}.
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant={ownReportsByBooking[booking.id]?.return ? "ghost" : "outline"}
                                  className={ownReportsByBooking[booking.id]?.return ? "gap-1 text-green-600" : undefined}
                                  onClick={() => navigate(`/trip-report/${booking.id}/return`)}
                                  disabled={Boolean(ownReportsByBooking[booking.id]?.return)}
                                >
                                  {ownReportsByBooking[booking.id]?.return && <CheckCircle2 className="w-3.5 h-3.5" />}
                                  {ownReportsByBooking[booking.id]?.return ? "Return report (submitted)" : "Return report (optional)"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={ownReportsByBooking[booking.id]?.pickup ? "gap-1 text-green-600" : "text-muted-foreground"}
                                  onClick={() => navigate(`/trip-report/${booking.id}/pickup`)}
                                  disabled={Boolean(ownReportsByBooking[booking.id]?.pickup)}
                                >
                                  {ownReportsByBooking[booking.id]?.pickup && <CheckCircle2 className="w-3.5 h-3.5" />}
                                  {ownReportsByBooking[booking.id]?.pickup ? "Pickup photos (submitted)" : "Pickup photos (optional)"}
                                </Button>
                                {!booking.renter_return_arrived_at ? (
                                  <Button
                                    size="sm"
                                    onClick={() => handleReturnArrive(booking)}
                                    disabled={payingFor === booking.id}
                                    className="gap-1 whitespace-nowrap shadow-lg shadow-primary/20"
                                  >
                                    {payingFor === booking.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    )}
                                    I've Returned the Car
                                  </Button>
                                ) : booking.owner_completed ? (
                                  <Button
                                    size="sm"
                                    onClick={() => handleComplete(booking)}
                                    disabled={payingFor === booking.id}
                                    className="gap-1 whitespace-nowrap shadow-lg shadow-primary/20"
                                  >
                                    {payingFor === booking.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    )}
                                    Car Confirm
                                  </Button>
                                ) : null}
                              </div>
                              {!booking.renter_return_arrived_at ? (
                                <p className="text-[10px] text-muted-foreground text-right leading-tight">
                                  Tap "I've Returned the Car" once you're back with the lister - the lister carries the
                                  required evidence at pickup and return, so your own reports are optional but recommended
                                  for your own protection.
                                </p>
                              ) : booking.owner_completed ? (
                                <div className="flex flex-col items-end gap-1">
                                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                    Car Delivered - lister confirmed receipt
                                  </span>
                                  <p className="text-[10px] text-muted-foreground text-right leading-tight">
                                    Tap "Car Confirm" to put your own record on file and finish the trip.
                                  </p>
                                </div>
                              ) : (
                                <p className="text-[10px] text-amber-500 text-right font-medium leading-tight">
                                  Return recorded - waiting for the lister to confirm they received the car.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {booking.renter_completed &&
                        !booking.owner_completed &&
                        booking.status !== "completed" && (
                          <p className="text-[10px] text-amber-500 mt-2 font-medium">
                            Waiting for owner to confirm
                          </p>
                        )}
                    </div>
                  </div>
                        </CardContent>
                      </Card>
                    </div>,
                    document.body,
                  )}
              </div>
            );
          })}
          <BookingPagination
            page={bookingPagination.page}
            pageCount={bookingPagination.pageCount}
            startIndex={bookingPagination.startIndex}
            endIndex={bookingPagination.endIndex}
            total={visibleBookings.length}
            onPageChange={changeBookingPage}
          />
        </div>
      ))}

      {pageTab === "payments" && (
      <div className="grid gap-6">
        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Payment History</h2>
              <p className="text-sm text-muted-foreground">
                Your complete SafeDrive booking payment and refund records.
              </p>
            </div>
            {paymentLogsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : paymentLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No booking payment records yet.
              </p>
            ) : (
              <div className="space-y-3">
                {paymentLogs.reduce<
                  Array<{
                    key: string;
                    booking?: BookingRow;
                    displayAmount: number;
                    displayLabel: string;
                    paymentMethod: string | null;
                    transactionId: string | null;
                    createdAt: string;
                    notes: string | null;
                    receiptPayment: Payment;
                  }>
                >((entries, payment) => {
                  const booking = bookingLookup.get(payment.booking_id);
                  const isSplitFullPayment =
                    Boolean(payment.transaction_id) &&
                    payment.notes?.includes("Captured as part of full booking payment via PayMongo webhook") &&
                    ["downpayment", "balance"].includes(payment.payment_type);

                  if (isSplitFullPayment) {
                    const existing = entries.find(
                      (entry) =>
                        entry.transactionId === payment.transaction_id &&
                        entry.booking?.id === booking?.id &&
                        entry.displayLabel === "full payment",
                    );

                    if (existing) {
                      existing.displayAmount += Number(payment.amount || 0);
                      return entries;
                    }

                    entries.push({
                      key: `full:${payment.booking_id}:${payment.transaction_id}`,
                      booking,
                      displayAmount: Number(payment.amount || 0),
                      displayLabel: "full payment",
                      paymentMethod: payment.payment_method || null,
                      transactionId: payment.transaction_id || null,
                      createdAt: payment.created_at,
                      notes: "Captured as one full booking payment via PayMongo webhook",
                      receiptPayment: payment,
                    });
                    return entries;
                  }

                  entries.push({
                    key: payment.id,
                    booking,
                    displayAmount: Number(payment.amount || 0),
                    displayLabel: payment.payment_type.replaceAll("_", " "),
                    paymentMethod: payment.payment_method || null,
                    transactionId: payment.transaction_id || null,
                    createdAt: payment.created_at,
                    notes: payment.notes || null,
                    receiptPayment: payment,
                  });
                  return entries;
                }, []).map((payment) => {
                  const booking = payment.booking;
                  return (
                    <div
                      key={payment.key}
                      className="rounded-lg border border-border/50 bg-muted/10 p-3"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="font-medium">
                            {booking
                              ? `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name}`
                              : "Booking payment"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {payment.displayLabel} - {payment.receiptPayment.status}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(payment.createdAt), "MMM d, yyyy h:mm a")}
                          </p>
                          {payment.notes && (
                            <p className="text-xs text-muted-foreground">
                              Note: {payment.notes}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{formatCurrency(payment.displayAmount)}</p>
                          {payment.paymentMethod && (
                            <p className="text-xs text-muted-foreground">{payment.paymentMethod}</p>
                          )}
                          {payment.transactionId && (
                            <p className="text-xs text-muted-foreground">
                              Ref: {payment.transactionId}
                            </p>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => downloadPaymentAcknowledgment(payment.receiptPayment, booking)}
                            className="mt-1 h-7 px-2 text-xs"
                          >
                            <Download className="mr-1 h-3.5 w-3.5" />
                            {payment.receiptPayment.payment_type === "refund" ||
                            Number(payment.receiptPayment.amount) < 0
                              ? "Download Refund Receipt"
                              : "Download Acknowledgment"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {earlyReturnModalBooking &&
        createPortal(
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setEarlyReturnModalBooking(null)}
          >
            <div
              className="w-full max-w-md rounded-xl border border-border bg-background shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-border px-5 py-4">
                <h2 className="text-lg font-semibold">Request early return</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask the lister to move the return date earlier. There is no
                  automatic refund for the unused days — the lister may choose to
                  give a goodwill refund.
                </p>
                {earlyReturnModalBooking.cars.min_early_return_notice_hours != null && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    This lister prefers at least{" "}
                    {earlyReturnModalBooking.cars.min_early_return_notice_hours} hour
                    {earlyReturnModalBooking.cars.min_early_return_notice_hours === 1 ? "" : "s"}{" "}
                    of notice, though they may still accept a shorter one.
                  </p>
                )}
              </div>
              <div className="space-y-3 px-5 py-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">New return date</label>
                  <input
                    type="date"
                    value={earlyReturnDraft.requestedEndDate}
                    min={new Date().toISOString().slice(0, 10)}
                    max={format(
                      new Date(
                        new Date(earlyReturnModalBooking.end_date).getTime() -
                          86_400_000,
                      ),
                      "yyyy-MM-dd",
                    )}
                    onChange={(e) =>
                      setEarlyReturnDraft((d) => ({
                        ...d,
                        requestedEndDate: e.target.value,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Current return:{" "}
                    {format(
                      new Date(earlyReturnModalBooking.end_date),
                      "MMM d, yyyy",
                    )}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Reason (optional)</label>
                  <textarea
                    value={earlyReturnDraft.reason}
                    maxLength={500}
                    onChange={(e) =>
                      setEarlyReturnDraft((d) => ({ ...d, reason: e.target.value }))
                    }
                    className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="e.g. trip ended sooner than planned"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
                <Button
                  variant="ghost"
                  onClick={() => setEarlyReturnModalBooking(null)}
                  disabled={earlyReturnLoading === earlyReturnModalBooking.id}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void submitEarlyReturnRequest()}
                  disabled={
                    earlyReturnLoading === earlyReturnModalBooking.id ||
                    !earlyReturnDraft.requestedEndDate
                  }
                >
                  {earlyReturnLoading === earlyReturnModalBooking.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Send request"
                  )}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {extensionRequestBooking &&
        (() => {
          const extensionDraft = extensionRequestDrafts[extensionRequestBooking.id] ?? {
            requestedEndDate: "",
            reason: "",
            fuelTopUpAmount: "",
          };

          return createPortal(
            <div
              className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
              onClick={() => setExtensionRequestBooking(null)}
            >
              <div
                className="w-full max-w-md rounded-xl border border-border bg-background shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <h2 className="text-lg font-semibold">Request extension</h2>
                    <p className="text-sm text-muted-foreground">
                      Choose the new return date, explain why you need the extension, and add an optional fuel top-up.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setExtensionRequestBooking(null)}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-4 px-5 py-4">
                  <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-xs text-muted-foreground">
                    <p className="font-medium text-orange-700 dark:text-orange-300">
                      {extensionRequestBooking.cars.car_models.car_brands.name}{" "}
                      {extensionRequestBooking.cars.car_models.name}
                    </p>
                    <p className="mt-1">
                      Current return date: {format(new Date(extensionRequestBooking.end_date), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Requested return date
                    </label>
                    <input
                      type="date"
                      min={formatDateInputMin(extensionRequestBooking.end_date)}
                      value={extensionDraft.requestedEndDate}
                      onChange={(event) =>
                        updateExtensionDraft(extensionRequestBooking.id, {
                          requestedEndDate: event.target.value,
                        })
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Reason
                    </label>
                    <textarea
                      value={extensionDraft.reason}
                      onChange={(event) =>
                        updateExtensionDraft(extensionRequestBooking.id, {
                          reason: event.target.value,
                        })
                      }
                      placeholder="Why do you need the extension?"
                      className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fuel top-up (optional)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={extensionDraft.fuelTopUpAmount}
                      onChange={(event) =>
                        updateExtensionDraft(extensionRequestBooking.id, {
                          fuelTopUpAmount: event.target.value,
                        })
                      }
                      placeholder="0.00"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setExtensionRequestBooking(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={extensionActionLoading === extensionRequestBooking.id}
                    onClick={() => handleRequestExtension(extensionRequestBooking)}
                  >
                    {extensionActionLoading === extensionRequestBooking.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Send extension request
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          );
        })()}

      {selectedOwner &&
        (() => {
          const selectedOwnerDisplay = getOwnerDisplay(selectedOwner);
          return createPortal(
        <div
          className="fixed inset-0 z-[130] flex items-start sm:items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 py-6"
          onClick={() => setSelectedOwner(null)}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-2xl w-full max-w-sm max-h-[calc(100vh-2rem)] sm:max-h-[80vh] overflow-y-auto animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold">Lister Information</h2>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSelectedOwner(null)}
              >
                <XCircle className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-5 space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-secondary overflow-hidden shrink-0 border border-border">
                  {selectedOwnerDisplay.avatarUrl ? (
                    <img 
                      src={selectedOwnerDisplay.avatarUrl} 
                      alt="Lister" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground font-semibold text-lg">
                      {selectedOwnerDisplay.initial}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-lg">{selectedOwnerDisplay.fullName}</h3>
                  <p className="text-sm text-muted-foreground">{selectedOwnerDisplay.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 text-sm bg-muted/30 p-4 rounded-xl border border-border/50">
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Phone Number</span>
                  <p className="font-medium text-lg">
                    {selectedOwnerDisplay.phone}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      );
        })()}

      {ratingBooking &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-start sm:items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 py-6"
            onClick={() => !submittingRating && setRatingBooking(null)}
          >
            <div
              className="bg-background border border-border rounded-lg shadow-2xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Rate your trip</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    One rating for the whole experience - the car and how the
                    lister hosted it. Visible once the lister also rates, or
                    after 14 days.
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setRatingBooking(null)}
                  disabled={submittingRating}
                >
                  <XCircle className="w-4 h-4" />
                </Button>
              </div>

              <div className="p-5 space-y-5">
                <div>
                  <p className="text-sm font-medium mb-3">Your rating</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRatingValue(star)}
                        className={`inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                          ratingValue >= star
                            ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                            : "border-border bg-background text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        <Star
                          className={`w-4 h-4 ${ratingValue >= star ? "fill-current" : ""}`}
                        />
                        {star}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Optional feedback
                  </label>
                  <textarea
                    value={ratingFeedback}
                    onChange={(e) => setRatingFeedback(e.target.value)}
                    rows={4}
                    maxLength={500}
                    placeholder="Tell us about the car condition, pickup, and overall experience."
                    className="flex min-h-[110px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    {ratingFeedback.length}/500 characters
                  </p>
                </div>
              </div>

              <div className="p-5 border-t border-border flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRatingBooking(null)}
                  disabled={submittingRating}
                >
                  Skip for now
                </Button>
                <Button
                  type="button"
                  onClick={handleRateBooking}
                  disabled={submittingRating}
                  className="gap-2"
                >
                  {submittingRating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Star className="w-4 h-4" />
                  )}
                  Submit Rating
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      <ConfirmDialog
        open={Boolean(cancelTargetBooking)}
        title="Cancel booking request?"
        description={
          cancelTargetBooking
            ? (() => {
                const apparentState = getApparentStatus(cancelTargetBooking);
                const vehicleLabel = `${cancelTargetBooking.cars.car_models.car_brands.name} ${cancelTargetBooking.cars.car_models.name} (${cancelTargetBooking.cars.plate_number})`;
                const cancellationGuidance = getCancellationGuidance(
                  cancelTargetBooking,
                  apparentState,
                );
                const base = PAID_STATES.includes(apparentState)
                  ? `This will cancel ${vehicleLabel} and start the refund.`
                  : `This will cancel your request for ${vehicleLabel}.`;
                return cancellationGuidance
                  ? `${base} ${cancellationGuidance.note}`
                  : base;
              })()
            : ""
        }
        confirmText={
          cancelTargetBooking &&
          ["downpayment_paid", "fully_paid"].includes(getApparentStatus(cancelTargetBooking))
            ? "Cancel & Start Refund"
            : "Cancel Booking"
        }
        destructive
        isLoading={Boolean(cancelTargetBooking && payingFor === cancelTargetBooking.id)}
        onCancel={() => {
          setCancelTargetBooking(null);
        }}
        onConfirm={() =>
          cancelTargetBooking
            ? handleCancelBooking(cancelTargetBooking.id)
            : Promise.resolve()
        }
      >
        {cancelTargetBooking &&
        ["downpayment_paid", "fully_paid"].includes(getApparentStatus(cancelTargetBooking)) ? (
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
            <div>
              <p className="font-medium">Refund handling</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                SafeDrive will try to return the payment through PayMongo first. If manual handling is needed,
                admin will review the refund and record how the money was sent back.
              </p>
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(noCarTarget)}
        title="No car available at pickup?"
        description={
          noCarTarget
            ? `This cancels your booking for ${noCarTarget.cars.car_models.car_brands.name} ${noCarTarget.cars.car_models.name} (${noCarTarget.cars.plate_number}) and starts your full refund. Only do this if you checked in at the pickup point and the lister did not arrive with the car.`
            : ""
        }
        confirmText="Cancel & Get Full Refund"
        destructive
        isLoading={Boolean(noCarTarget && incidentLoading === noCarTarget.id)}
        onCancel={() => setNoCarTarget(null)}
        onConfirm={handleReportNoCar}
      >
        <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            SafeDrive refunds every peso you paid through PayMongo. Your
            cancellation and completion rate are not affected — the record shows
            the lister missed the handover.
          </p>
          <p>
            SafeDrive support opens a case automatically so the lister can
            respond.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}







