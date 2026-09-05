import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { createPrivateStorageUrlMap } from "@/lib/privateStorage";
import {
  ensureReturnReminderNotifications,
  getNoShowWindowState,
  getReturnReminderState,
} from "@/lib/bookingLifecycle";
import {
  canReportNonReturn,
  runIncidentAction,
  NON_RETURN_REASON_OPTIONS,
  type NonReturnReason,
} from "@/lib/incidents";
import { openBookingConversation } from "@/lib/bookingConversation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrivalPhotoCapture,
  type ArrivalLocationEvidence,
} from "@/components/ArrivalPhotoCapture";
import { Skeleton } from "@/components/ui/skeleton";
import BookingPagination from "@/components/BookingPagination";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatDayCount } from "@/lib/formatCount";
import { paginateItems } from "@/lib/pagination";
import { downloadReceiptPdf, RECEIPT_NOTICES } from "@/lib/receiptPdf";
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  XCircle,
  LayoutDashboard,
  Loader2,
  MapPin,
  Phone,
  X,
  Star,
  Filter,
  CarFront,
  CircleAlert,
  CreditCard,
  Download,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Payment } from "@/types/database";
import {
  fetchRenterReliability,
  fetchRenterReputation,
  type Reliability,
  type RenterReputation,
} from "@/lib/ratings";
import {
  DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS,
  DEFAULT_REFUND_LATE_RENTER_PERCENT,
  fetchPlatformPolicyTimings,
  fetchPlatformPricingSettings,
} from "@/lib/platformSettings";

const getBookingPickupMs = (booking: {
  start_date: string;
  pickup_time: string | null;
}): number | null => {
  const [year, month, day] = (booking.start_date || "")
    .split("-")
    .map((part) => Number(part));
  const [hour, minute] = (booking.pickup_time || "09:00")
    .split(":")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  // start_date is a plain calendar date; treat pickup as Manila local time.
  return Date.UTC(year, month - 1, day, hour || 0, minute || 0) - 8 * 60 * 60 * 1000;
};

interface ListerBooking {
  id: string;
  car_id: string;
  renter_id: string;
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
  owner_completed: boolean;
  renter_completed: boolean;
  owner_response_deadline: string | null;
  payment_deadline: string | null;
  paymongo_checkout_id: string | null;
  paymongo_balance_checkout_id: string | null;
  pickup_time: string | null;
  dropoff_time: string | null;
  created_at: string;
  agreement_storage_path_snapshot: string | null;
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
  renter: {
    full_name: string | null;
    email: string;
    phone: string | null;
    address: string | null;
    birthday: string | null;
    avatar_url: string | null;
    verification_images: { image_type: string; storage_path: string }[];
  } | null;
  cars: {
    plate_number: string;
    location: string | null;
    car_models: { name: string; car_brands: { name: string } };
  };
}

interface ListerVehicleActionItem {
  id: string;
  plate_number: string;
  status: string;
  rejection_reason: string | null;
  car_models: {
    name: string;
    car_brands: { name: string };
  };
}

interface ListerRenewalItem {
  id: string;
  status: string;
  submitted_at: string;
  admin_notes: string | null;
  cars: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: { name: string };
    };
  } | null;
}

interface ListerNotificationItem {
  id: string;
  title: string;
  message: string;
  created_at: string | null;
  read: boolean | null;
}

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

const getListerBookingStatus = (booking: ListerBooking) => {
  if (booking.status === "completed") return "completed";
  if (
    booking.status === "cancelled" ||
    booking.status === "rejected" ||
    booking.status === "pending"
  ) {
    return booking.status;
  }
  if (booking.status === "awaiting_payment" || booking.status === "confirmed") {
    return booking.status === "confirmed" ? "confirmed" : "awaiting_payment";
  }
  return booking.status;
};

export default function ListerBookingsPage() {
  const { user, session, profile } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<ListerBooking[]>([]);
  const [verificationImageUrls, setVerificationImageUrls] = useState<Record<string, string>>({});
  const [agreementUrls, setAgreementUrls] = useState<Record<string, string>>({});
  // Which trip-condition-report phases the LISTER (this account) has already
  // filed for each booking - drives the "Vehicle verification" / "Vehicle
  // handover" / "Vehicle return" trip-progress checkpoints.
  const [ownReportsByBooking, setOwnReportsByBooking] = useState<
    Record<string, { pickup: boolean; return: boolean }>
  >({});
  const [loading, setLoading] = useState(true);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [arrivalLeadHours, setArrivalLeadHours] = useState(
    DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS,
  );
  const [noShowRefundPercent, setNoShowRefundPercent] = useState(
    DEFAULT_REFUND_LATE_RENTER_PERCENT,
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedRenter, setSelectedRenter] = useState<ListerBooking | null>(
    null,
  );
  const [ratingBooking, setRatingBooking] = useState<ListerBooking | null>(null);
  const [incidentTarget, setIncidentTarget] = useState<{
    booking: ListerBooking;
    kind: "renter_no_show" | "report_non_return";
  } | null>(null);
  const [nonReturnReason, setNonReturnReason] =
    useState<NonReturnReason>("renter_unreachable");
  const [incidentLoading, setIncidentLoading] = useState<string | null>(null);
  const [conversationLoading, setConversationLoading] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState<number>(5);
  const [ratingFeedback, setRatingFeedback] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);
  const [pageTab, setPageTab] = useState<"overview" | "bookings" | "statistics">("bookings");
  const [bookingSection, setBookingSection] = useState<
    "all" | "incoming" | "active" | "completed" | "issues"
  >("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bookingPage, setBookingPage] = useState(1);
  const [rejectingBooking, setRejectingBooking] = useState<ListerBooking | null>(null);
  const [cancellingBooking, setCancellingBooking] = useState<ListerBooking | null>(null);
  const [cancelReason, setCancelReason] = useState("Vehicle problem");
  const [rejectionReason, setRejectionReason] = useState("");
  const [vehicleActions, setVehicleActions] = useState<ListerVehicleActionItem[]>([]);
  const [renewalActions, setRenewalActions] = useState<ListerRenewalItem[]>([]);
  const [supportOpenCount, setSupportOpenCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState<ListerNotificationItem[]>([]);
  const [payoutLogs, setPayoutLogs] = useState<Payment[]>([]);
  const [payoutLogsLoading, setPayoutLogsLoading] = useState(false);
  const [renterReputations, setRenterReputations] = useState<
    Record<string, RenterReputation>
  >({});
  const [renterReliabilities, setRenterReliabilities] = useState<
    Record<string, Reliability>
  >({});
  const [bookingExtensionsByBooking, setBookingExtensionsByBooking] = useState<
    Record<string, BookingExtensionRow[]>
  >({});
  const [extensionDecisionNotes, setExtensionDecisionNotes] = useState<Record<string, string>>({});
  const [earlyReturnsByBooking, setEarlyReturnsByBooking] = useState<
    Record<string, EarlyReturnRow[]>
  >({});
  const [earlyReturnNotes, setEarlyReturnNotes] = useState<Record<string, string>>({});
  const [earlyReturnGoodwill, setEarlyReturnGoodwill] = useState<Record<string, string>>({});
  const [earlyReturnActionLoading, setEarlyReturnActionLoading] = useState<string | null>(null);
  const [extensionActionLoading, setExtensionActionLoading] = useState<string | null>(null);
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);
  const getApparentStatus = getListerBookingStatus;

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!openBookingId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenBookingId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openBookingId]);

  useEffect(() => {
    let active = true;
    void fetchPlatformPolicyTimings().then((timings) => {
      if (active) setArrivalLeadHours(timings.arrivalCheckinLeadHours);
    });
    void fetchPlatformPricingSettings().then((pricing) => {
      if (active) setNoShowRefundPercent(pricing.refundLateRenterPercent);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const resetCheckoutLoading = () => {
      setActionLoading(null);
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
          renter:profiles!bookings_renter_id_fkey(full_name, email, phone, address, birthday, avatar_url),
          cars(plate_number, location, car_models(name, car_brands(name))),
          booking_reviews (id, reviewer_id, reviewer_role)
        `,
        )
        .eq("owner_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const bookingRows = (data ?? []) as unknown as ListerBooking[];
      const renterIds = [
        ...new Set(bookingRows.map((booking) => booking.renter_id).filter(Boolean)),
      ];
      let verificationImagesByUser: Record<string, { image_type: string; storage_path: string }[]> = {};

      if (renterIds.length > 0) {
        const { data: imageRows, error: imageError } = await supabase
          .from("verification_images")
          .select("user_id, image_type, storage_path")
          .in("user_id", renterIds);

        if (imageError) {
          console.warn("Unable to load renter verification images:", imageError.message);
        } else {
          verificationImagesByUser = (imageRows ?? []).reduce<
            Record<string, { image_type: string; storage_path: string }[]>
          >((accumulator, image) => {
            accumulator[image.user_id] = accumulator[image.user_id] ?? [];
            accumulator[image.user_id].push({
              image_type: image.image_type,
              storage_path: image.storage_path,
            });
            return accumulator;
          }, {});
        }
      }

      setBookings(
        bookingRows.map((booking) => ({
          ...booking,
          renter: booking.renter
            ? {
                ...booking.renter,
                verification_images:
                  verificationImagesByUser[booking.renter_id] ?? [],
              }
            : null,
        })),
      );
      setVerificationImageUrls(
        await createPrivateStorageUrlMap(
          "user-verification",
          Object.values(verificationImagesByUser).flatMap((images) =>
            images.map((image) => image.storage_path),
          ),
        ),
      );
      setAgreementUrls(
        await createPrivateStorageUrlMap(
          "vehicle-private-documents",
          bookingRows
            .map((booking) => booking.agreement_storage_path_snapshot)
            .filter(
              (path): path is string =>
                typeof path === "string" &&
                path.length > 0 &&
                !path.startsWith("http"),
            ),
          "vehicle-documents",
        ),
      );

      // Separate, non-fatal query: drives the "Vehicle verification" /
      // "Vehicle handover" / "Vehicle return" trip-progress checkpoints. A
      // missing table or RLS hiccup must never break the bookings list.
      try {
        const activeIds = bookingRows
          .filter((b) => ["fully_paid", "active", "completed"].includes(b.status))
          .map((b) => b.id);
        if (activeIds.length > 0) {
          const { data: reports } = await supabase
            .from("trip_condition_reports")
            .select("booking_id, phase")
            .in("booking_id", activeIds)
            .eq("reporter_id", user!.id)
            .eq("reporter_role", "lister");
          const grouped: Record<string, { pickup: boolean; return: boolean }> = {};
          for (const report of reports ?? []) {
            const entry = grouped[report.booking_id] ?? { pickup: false, return: false };
            if (report.phase === "pickup") entry.pickup = true;
            if (report.phase === "return") entry.return = true;
            grouped[report.booking_id] = entry;
          }
          setOwnReportsByBooking(grouped);
        } else {
          setOwnReportsByBooking({});
        }
      } catch {
        setOwnReportsByBooking({});
      }
    } catch (err) {
      console.error("Error fetching lister bookings:", err);
      toast.error("Failed to load lister bookings", {
        description:
          err instanceof Error ? err.message : "Please refresh and try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchBookings();
  }, [user, fetchBookings]);

  // Keep the list live: refetch on tab focus, and subscribe to this lister's
  // booking rows so a payment / status change shows within ~1s without a
  // reload. Silent so the loading skeleton never flashes.
  useEffect(() => {
    if (!user?.id) return;
    const refetch = () => void fetchBookings({ silent: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase
      .channel(`lister-bookings-live-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `owner_id=eq.${user.id}` },
        refetch,
      )
      .subscribe();
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

    void ensureReturnReminderNotifications(user.id, reminderBookings, "/lister-bookings");
  }, [bookings, getApparentStatus, user]);

  useEffect(() => {
    const loadRenterReputations = async () => {
      const renterIds = [
        ...new Set(bookings.map((booking) => booking.renter_id).filter(Boolean)),
      ];
      if (renterIds.length === 0) {
        setRenterReputations({});
        setRenterReliabilities({});
        return;
      }
      // Per-renter so the server applies the double-blind rule (only counts a
      // review once both parties rated that booking, or 14 days passed).
      const [reputationEntries, reliabilityEntries] = await Promise.all([
        Promise.all(
          renterIds.map(
            async (rid) => [rid, await fetchRenterReputation(rid)] as const,
          ),
        ),
        Promise.all(
          renterIds.map(
            async (rid) => [rid, await fetchRenterReliability(rid)] as const,
          ),
        ),
      ]);
      setRenterReputations(Object.fromEntries(reputationEntries));
      setRenterReliabilities(Object.fromEntries(reliabilityEntries));
    };

    void loadRenterReputations();
  }, [bookings]);

  useEffect(() => {
    if (!user) return;

    const fetchOperationalData = async () => {
      const [
        vehiclesResult,
        renewalsResult,
        ticketsResult,
        notificationsResult,
      ] = await Promise.all([
        supabase
          .from("cars")
          .select(
            "id, plate_number, status, rejection_reason, car_models(name, car_brands(name))",
          )
          .eq("owner_id", user.id)
          .in("status", ["pending", "rejected"])
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase
          .from("car_renewals")
          .select(
            "id, status, submitted_at, admin_notes, cars(plate_number, car_models(name, car_brands(name)))",
          )
          .eq("lister_id", user.id)
          .in("status", ["pending", "rejected"])
          .order("submitted_at", { ascending: false })
          .limit(5),
        supabase
          .from("support_tickets")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .in("status", ["open", "pending"]),
        supabase
          .from("notifications")
          .select("id, title, message, created_at, read")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      if (!vehiclesResult.error && vehiclesResult.data) {
        setVehicleActions(vehiclesResult.data as unknown as ListerVehicleActionItem[]);
      }

      if (!renewalsResult.error && renewalsResult.data) {
        setRenewalActions(renewalsResult.data as unknown as ListerRenewalItem[]);
      }

      if (!ticketsResult.error) {
        setSupportOpenCount(ticketsResult.count ?? 0);
      }

      if (!notificationsResult.error && notificationsResult.data) {
        setRecentNotifications(
          notificationsResult.data as unknown as ListerNotificationItem[],
        );
      }
    };

    void fetchOperationalData();
  }, [user]);

  useEffect(() => {
    const fetchPayoutLogs = async () => {
      if (!user) return;

      setPayoutLogsLoading(true);
      try {
        const bookingIds = bookings.map((booking) => booking.id);
        if (bookingIds.length === 0) {
          setPayoutLogs([]);
          return;
        }

        const { data, error } = await supabase
          .from("payments")
          .select("*")
          .in("booking_id", bookingIds)
          .eq("payment_type", "payout")
          .order("created_at", { ascending: false });

        if (error) throw error;
        setPayoutLogs((data as Payment[]) ?? []);
      } catch (error) {
        console.error("Error fetching payout logs:", error);
        toast.error("Failed to load payout history");
      } finally {
        setPayoutLogsLoading(false);
      }
    };

    void fetchPayoutLogs();
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
        console.error("Error fetching booking extensions:", error);
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

  const decideEarlyReturn = async (
    earlyReturn: EarlyReturnRow,
    action: "approve" | "reject",
  ) => {
    setEarlyReturnActionLoading(earlyReturn.id);
    try {
      await runEarlyReturnAction(session?.access_token, {
        action,
        earlyReturnId: earlyReturn.id,
        ownerDecisionNote:
          earlyReturnNotes[earlyReturn.id]?.trim() || null,
        goodwillRefundAmount:
          action === "approve"
            ? Number(earlyReturnGoodwill[earlyReturn.id] || 0) || 0
            : undefined,
      });
      toast.success(
        action === "approve"
          ? "Early return approved — the return date was moved earlier."
          : "Early-return request declined.",
      );
      fetchBookings();
    } catch (err) {
      toast.error("Could not save the decision", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setEarlyReturnActionLoading(null);
    }
  };

  const runBookingAction = async (
    bookingId: string,
    action: "accept" | "reject" | "arrive" | "complete" | "cancel",
    arrivalPhotoUrl?: string | null,
    arrivalLocation?: ArrivalLocationEvidence | null,
    note?: string | null,
    confirmOnBehalfOfRenter?: boolean,
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
        confirmOnBehalfOfRenter,
      }),
    });

    const data = (await res.json()) as { error?: string; state?: string; status?: string };
    if (!res.ok) {
      const errorMessage = data.error || "Booking action failed";
      if (
        errorMessage.includes("parameter_above_maximum") &&
        errorMessage.includes("notes")
      ) {
        throw new Error(
          "PayMongo rejected the refund note length. Redeploy the latest SafeDrive build, then try again.",
        );
      }
      throw new Error(errorMessage);
    }
    return data;
  };

  const runExtensionAction = async (
    payload:
      | { action: "approve" | "reject"; extensionId: string; ownerDecisionNote?: string | null }
      | { action: "cancel"; extensionId: string },
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

  const getImageUrl = (path: string) => verificationImageUrls[path] ?? "";

  const getAgreementUrl = (path: string | null) => {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return agreementUrls[path] ?? "";
  };

  const handleAccept = async (bookingId: string) => {
    setActionLoading(bookingId);
    try {
      await runBookingAction(bookingId, "accept");
      toast.success("Booking accepted! Renter has 24 hrs to pay downpayment.");
      fetchBookings();
    } catch (error) {
      toast.error("Failed to accept booking", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
    setActionLoading(null);
  };

  const handleReject = async (bookingId: string) => {
    if (!rejectionReason.trim()) {
      toast.error("Please provide a rejection reason.");
      return;
    }
    setActionLoading(bookingId);
    try {
      await runBookingAction(bookingId, "reject", null, null, rejectionReason);
      toast.success("Booking rejected");
      setRejectingBooking(null);
      setRejectionReason("");
      fetchBookings();
    } catch (error) {
      toast.error("Failed to reject booking", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
    setActionLoading(null);
  };

  const handleListerCancel = async (bookingId: string) => {
    setActionLoading(bookingId);
    try {
      await runBookingAction(bookingId, "cancel", null, null, cancelReason);
      toast.success("Booking cancelled", {
        description: "The renter has been notified and their full refund is being processed.",
      });
      setCancellingBooking(null);
      setCancelReason("Vehicle problem");
      fetchBookings();
    } catch (error) {
      toast.error("Failed to cancel booking", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
    setActionLoading(null);
  };

  const handleArrive = async (
    bookingId: string,
    arrivalLocation?: ArrivalLocationEvidence | null,
  ) => {
    setActionLoading(bookingId);
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
      setActionLoading(null);
    }
  };

  const handleConfirmRenterArrived = async (bookingId: string) => {
    setActionLoading(bookingId);
    const toastId = toast.loading("Confirming renter's arrival...");
    try {
      await runBookingAction(bookingId, "arrive", null, null, null, true);
      toast.success("Renter's arrival recorded.", { id: toastId });
      fetchBookings();
    } catch (err) {
      toast.error("Could not confirm the renter's arrival", {
        id: toastId,
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleComplete = async (booking: ListerBooking) => {
    setActionLoading(booking.id);
    try {
      const result = await runBookingAction(booking.id, "complete");
      const reviewedByOwner = booking.booking_reviews?.some(
        (review) =>
          review.reviewer_id === user?.id && review.reviewer_role === "owner",
      );
      if (result?.status === "completed" && !reviewedByOwner) {
        toast.success("Trip completed. Add your quick rating.");
        openRateRenterModal({ ...booking, status: "completed" });
      } else {
        toast.success("Your side is done. Waiting for the renter to finish.");
      }
      fetchBookings();
    } catch (error) {
      toast.error("Failed to confirm completion", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
    setActionLoading(null);
  };

  const handleApproveExtension = async (extension: BookingExtensionRow) => {
    setExtensionActionLoading(extension.id);
    try {
      await runExtensionAction({
        action: "approve",
        extensionId: extension.id,
        ownerDecisionNote: extensionDecisionNotes[extension.id]?.trim() || null,
      });
      toast.success("Extension approved. The renter can now pay the added amount.");
      await fetchBookings();
    } catch (error) {
      toast.error("Could not approve extension", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setExtensionActionLoading(null);
    }
  };

  const handleRejectExtension = async (extension: BookingExtensionRow) => {
    const note = extensionDecisionNotes[extension.id]?.trim();
    if (!note) {
      toast.error("Add a short reason before rejecting the extension.");
      return;
    }

    setExtensionActionLoading(extension.id);
    try {
      await runExtensionAction({
        action: "reject",
        extensionId: extension.id,
        ownerDecisionNote: note,
      });
      toast.success("Extension rejected.");
      await fetchBookings();
    } catch (error) {
      toast.error("Could not reject extension", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setExtensionActionLoading(null);
    }
  };

  const openRateRenterModal = (booking: ListerBooking) => {
    setRatingBooking(booking);
    setRatingValue(5);
    setRatingFeedback("");
  };

  const handleReportBooking = (booking: ListerBooking) => {
    const subject = encodeURIComponent(
      `Report booking: ${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`,
    );
    navigate(
      `/support?bookingId=${booking.id}&tag=booking_report&subject=${subject}`,
    );
  };

  const handleMessageRenter = async (booking: ListerBooking) => {
    if (conversationLoading) return;
    setConversationLoading(booking.id);
    try {
      const ticketId = await openBookingConversation(session?.access_token, booking.id);
      navigate(`/support?ticketId=${ticketId}`);
    } catch (error) {
      toast.error("Could not open the conversation", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setConversationLoading(null);
    }
  };

  const runIncident = async () => {
    if (!incidentTarget) return;
    const { booking, kind } = incidentTarget;
    setIncidentLoading(booking.id);
    try {
      await runIncidentAction(session?.access_token, {
        bookingId: booking.id,
        action: kind,
        ...(kind === "report_non_return" ? { reason: nonReturnReason } : {}),
      });
      toast.success(
        kind === "renter_no_show"
          ? "Renter no-show recorded. The booking was cancelled."
          : "Reported. SafeDrive support is now handling the non-return.",
      );
      setIncidentTarget(null);
      await fetchBookings();
    } catch (err) {
      toast.error("Could not file the report", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setIncidentLoading(null);
    }
  };

  const handleRateRenter = async () => {
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
      reviewee_id: ratingBooking.renter_id,
      reviewer_role: "owner",
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

  const getBookingSection = useCallback((booking: ListerBooking) => {
    const apparentStatus = getApparentStatus(booking);

    if (["pending", "confirmed", "awaiting_payment"].includes(apparentStatus)) {
      return "incoming";
    }

    if (["downpayment_paid", "fully_paid", "active"].includes(apparentStatus)) {
      return "active";
    }

    if (apparentStatus === "completed") {
      return "completed";
    }

    if (["rejected", "cancelled", "expired"].includes(apparentStatus)) {
      return "issues";
    }

    return "all";
  }, [getApparentStatus]);

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

    return `${expired ? "Expired" : "-"} ${expired ? "" : "in "}${parts.join(" ")}`.trim();
  };

  const getProcessGuidance = (booking: ListerBooking, apparentState: string) => {
    if (apparentState === "pending") {
      return {
        tone: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        title: "Response still needed",
        body: booking.owner_response_deadline
          ? `${formatCountdown(booking.owner_response_deadline)}. Accept or reject the request before the review window closes.`
          : "Accept or reject the request to keep the booking moving.",
        footnote: booking.owner_response_deadline
          ? `Response deadline: ${formatDeadlineStamp(booking.owner_response_deadline)}`
          : "A clear rejection reason helps the renter understand what to change.",
      };
    }

    if (apparentState === "awaiting_payment" || apparentState === "confirmed") {
      return {
        tone: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        title: "Waiting for renter payment",
        body: booking.payment_deadline
          ? `${formatCountdown(booking.payment_deadline)}. The booking will only move forward after PayMongo confirms the downpayment.`
          : "Wait for PayMongo to confirm the renter's downpayment before preparing handoff.",
        footnote: booking.payment_deadline
          ? `Payment deadline: ${formatDeadlineStamp(booking.payment_deadline)}`
          : "Do not hand over the vehicle until payment is confirmed in-app.",
      };
    }

    if (apparentState === "downpayment_paid") {
      return {
        tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        title: "Downpayment confirmed",
        body: "The renter has reserved the trip. Wait for the remaining balance, then use the arrival and completion steps to document handoff.",
        footnote: "Keep the agreement and condition photos ready before pickup.",
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
    booking: ListerBooking,
    apparentState: string,
    reviewedByOwner: boolean | undefined,
    extensionBlocksCompletion: boolean,
  ) => {
    const tone = "border-primary/20 bg-primary/5 text-foreground";

    if (apparentState === "pending") {
      return {
        tone,
        title: "Accept or reject request",
        body: "Review the renter and booking details, then keep the request moving.",
      };
    }

    if (apparentState === "awaiting_payment" || apparentState === "confirmed") {
      return {
        tone,
        title: "Wait for renter payment",
        body: "Prepare only after PayMongo confirms the renter's payment in-app.",
      };
    }

    if (apparentState === "downpayment_paid") {
      return {
        tone,
        title: "Wait for full payment",
        body: "The renter still needs to settle the remaining balance before handoff.",
      };
    }

    if (apparentState === "fully_paid" || apparentState === "active") {
      if (!booking.lister_arrived_at) {
        return {
          tone,
          title: "Confirm arrival at pickup",
          body: "Tap arrival when you are at the agreed meetup location.",
        };
      }

      if (!booking.renter_arrived_at) {
        return {
          tone,
          title: "Wait for renter arrival",
          body: "Your check-in is recorded. If they do not arrive after the grace window, report a no-show.",
        };
      }

      if (extensionBlocksCompletion) {
        return {
          tone,
          title: "Resolve the extension first",
          body: "Approve, reject, complete, pay, or cancel the active extension request before finishing the trip.",
        };
      }

      if (!booking.owner_completed) {
        if (!booking.renter_return_arrived_at && !booking.renter_completed) {
          return {
            tone,
            title: "Waiting for the renter to return the car",
            body: "You'll be notified once the renter confirms they've returned it - then inspect the car and confirm receipt.",
          };
        }
        return {
          tone,
          title: "Confirm the car was received",
          body: 'The renter reported returning the car. Inspect it, then tap "Confirm - Car Received".',
        };
      }

      if (!booking.renter_completed) {
        return {
          tone,
          title: "Wait for renter to finish",
          body: "Your side is done. The booking completes when the renter confirms too.",
        };
      }
    }

    if (apparentState === "completed") {
      return reviewedByOwner
        ? {
            tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            title: "All done",
            body: "Your trip and rating are complete. Track payout status from this card.",
          }
        : {
            tone,
            title: "Rate the renter",
            body: "Leave a quick rating while the trip is still fresh.",
          };
    }

    return null;
  };

  const getLatestExtension = (bookingId: string) =>
    bookingExtensionsByBooking[bookingId]?.[0];

  const getRenterDisplay = (booking: ListerBooking) => ({
    fullName: booking.renter?.full_name || "Unknown Renter",
    email: booking.renter?.email || "No email available",
    phone: booking.renter?.phone || "No contact info",
    address: booking.renter?.address || "-",
    birthday: booking.renter?.birthday || null,
    avatarUrl: booking.renter?.avatar_url || null,
    verificationImages: booking.renter?.verification_images || [],
    initial: (
      booking.renter?.full_name ||
      booking.renter?.email ||
      "R"
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

  const statusBadge = (status: string) => {
    const configs: Record<string, { label: string; color: string }> = {
      pending: {
        label: "Pending Your Response",
        color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
      },
      awaiting_payment: {
        label: "Awaiting Payment",
        color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
      },
      confirmed: {
        label: "Awaiting Payment",
        color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
      },
      downpayment_paid: {
        label: "Downpayment Paid",
        color: "text-green-600 bg-green-50 dark:bg-green-950/30",
      },
      active: {
        label: "Active Rental",
        color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
      },
      fully_paid: {
        label: "Fully Paid",
        color: "text-green-600 bg-green-50 dark:bg-green-950/30",
      },
      completed: {
        label: "Completed",
        color: "text-green-700 bg-green-50 dark:bg-green-950/30",
      },
      owner_accepted: {
        label: "Accepted",
        color: "text-green-600 bg-green-50 dark:bg-green-950/30",
      },
      rejected: {
        label: "Rejected",
        color: "text-red-600 bg-red-50 dark:bg-red-950/30",
      },
      cancelled: {
        label: "Cancelled",
        color: "text-muted-foreground bg-muted",
      },
      expired: { label: "Expired", color: "text-muted-foreground bg-muted" },
    };
    return (
      configs[status] || {
        label: status,
        color: "text-muted-foreground bg-muted",
      }
    );
  };

  const summary = useMemo(() => {
    const now = new Date();
    return {
      pending: bookings.filter((booking) => getApparentStatus(booking) === "pending").length,
      paymentAttention: bookings.filter((booking) =>
        ["confirmed", "awaiting_payment", "downpayment_paid"].includes(getApparentStatus(booking)),
      ).length,
      upcoming: bookings.filter((booking) => {
        const apparentStatus = getApparentStatus(booking);
        return new Date(booking.start_date) >= now && ["fully_paid", "active", "downpayment_paid"].includes(apparentStatus);
      }).length,
      completed: bookings.filter((booking) => getApparentStatus(booking) === "completed").length,
    };
  }, [bookings, getApparentStatus]);

  const statistics = useMemo(() => {
    const statusBuckets = [
      {
        label: "Incoming",
        value: bookings.filter((booking) => getBookingSection(booking) === "incoming").length,
        color: "#f59e0b",
      },
      {
        label: "Payment",
        value: bookings.filter((booking) =>
          ["confirmed", "awaiting_payment", "downpayment_paid"].includes(
            getApparentStatus(booking),
          ),
        ).length,
        color: "#3b82f6",
      },
      {
        label: "Active",
        value: bookings.filter((booking) => getBookingSection(booking) === "active").length,
        color: "#10b981",
      },
      {
        label: "Completed",
        value: bookings.filter((booking) => getBookingSection(booking) === "completed").length,
        color: "#22c55e",
      },
      {
        label: "Issues",
        value: bookings.filter((booking) => getBookingSection(booking) === "issues").length,
        color: "#ef4444",
      },
    ];

    const total = Math.max(1, statusBuckets.reduce((sum, item) => sum + item.value, 0));
    let cursor = 0;
    const conicStops = statusBuckets
      .filter((item) => item.value > 0)
      .map((item) => {
        const start = cursor;
        const end = cursor + (item.value / total) * 100;
        cursor = end;
        return `${item.color} ${start}% ${end}%`;
      })
      .join(", ");

    const monthBuckets = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - index));
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        label: format(date, "MMM"),
        bookings: 0,
        revenue: 0,
      };
    });

    const monthMap = new Map(monthBuckets.map((bucket) => [bucket.key, bucket]));
    bookings.forEach((booking) => {
      const date = new Date(booking.start_date);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const bucket = monthMap.get(key);
      if (!bucket) return;
      bucket.bookings += 1;
      if (getApparentStatus(booking) === "completed") {
        bucket.revenue += Number(booking.base_price || 0);
      }
    });

    const vehicleMap = new Map<string, { label: string; count: number; revenue: number }>();
    bookings.forEach((booking) => {
      const label = `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name}`;
      const current = vehicleMap.get(booking.car_id) ?? {
        label,
        count: 0,
        revenue: 0,
      };
      current.count += 1;
      if (getApparentStatus(booking) === "completed") {
        current.revenue += Number(booking.base_price || 0);
      }
      vehicleMap.set(booking.car_id, current);
    });

    const topVehicles = [...vehicleMap.values()]
      .sort((left, right) => right.count - left.count || right.revenue - left.revenue)
      .slice(0, 5);

    const completedCount = statusBuckets.find((item) => item.label === "Completed")?.value ?? 0;
    const completionRate = bookings.length
      ? Math.round((completedCount / bookings.length) * 100)
      : 0;
    const totalRevenue = bookings
      .filter((booking) => getApparentStatus(booking) === "completed")
      .reduce((sum, booking) => sum + Number(booking.base_price || 0), 0);
    const maxMonthlyRevenue = Math.max(1, ...monthBuckets.map((bucket) => bucket.revenue));
    const maxVehicleCount = Math.max(1, ...topVehicles.map((vehicle) => vehicle.count));

    return {
      statusBuckets,
      conicStops,
      monthBuckets,
      topVehicles,
      completionRate,
      totalRevenue,
      maxMonthlyRevenue,
      maxVehicleCount,
    };
  }, [bookings, getApparentStatus, getBookingSection]);

  const sectionCounts = useMemo(
    () => ({
      all: bookings.length,
      incoming: bookings.filter((booking) => getBookingSection(booking) === "incoming").length,
      active: bookings.filter((booking) => getBookingSection(booking) === "active").length,
      completed: bookings.filter((booking) => getBookingSection(booking) === "completed").length,
      issues: bookings.filter((booking) => getBookingSection(booking) === "issues").length,
    }),
    [bookings, getBookingSection],
  );

  const filteredBookings = useMemo(() => {
    const sectionFiltered =
      bookingSection === "all"
        ? bookings
        : bookings.filter((booking) => getBookingSection(booking) === bookingSection);

    if (statusFilter === "all") return sectionFiltered;
    return sectionFiltered.filter((booking) => getApparentStatus(booking) === statusFilter);
  }, [bookingSection, bookings, getApparentStatus, getBookingSection, statusFilter]);
  const bookingPagination = paginateItems(filteredBookings, bookingPage);

  useEffect(() => {
    if (bookingPagination.page !== bookingPage) setBookingPage(bookingPagination.page);
  }, [bookingPage, bookingPagination.page]);

  const changeBookingPage = (nextPage: number) => {
    setBookingPage(nextPage);
    window.requestAnimationFrame(() => {
      document.getElementById("lister-booking-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const upcomingBookings = useMemo(
    () =>
      bookings
        .filter((booking) => {
          const apparentStatus = getApparentStatus(booking);
          return ["fully_paid", "active", "downpayment_paid"].includes(apparentStatus);
        })
        .slice()
        .sort(
          (a, b) =>
            new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
        )
        .slice(0, 3),
    [bookings, getApparentStatus],
  );

  const bookingLookup = useMemo(
    () => new Map(bookings.map((booking) => [booking.id, booking])),
    [bookings],
  );

  const completedPayouts = useMemo(
    () =>
      payoutLogs.filter(
        (payment) =>
          payment.payment_type === "payout" && payment.status === "completed",
      ),
    [payoutLogs],
  );

  const pendingPayoutBookings = useMemo(
    () =>
      bookings.filter((booking) => {
        if (getApparentStatus(booking) !== "completed") return false;
        return !completedPayouts.some(
          (payment) => payment.booking_id === booking.id,
        );
      }),
    [bookings, completedPayouts, getApparentStatus],
  );

  const totalPayoutReleased = useMemo(
    () =>
      completedPayouts.reduce(
        (total, payment) => total + Number(payment.amount || 0),
        0,
      ),
    [completedPayouts],
  );

  const latestPayoutByBooking = useMemo(() => {
    const map = new Map<string, Payment>();
    payoutLogs.forEach((payment) => {
      if (!map.has(payment.booking_id)) {
        map.set(payment.booking_id, payment);
      }
    });
    return map;
  }, [payoutLogs]);

  const hasPayoutSetup = Boolean(
    profile?.payout_method && profile?.payout_account_name && profile?.payout_account_number,
  );

  const getBookingPayoutStatus = useCallback(
    (booking: ListerBooking) => {
      const payoutRecord = latestPayoutByBooking.get(booking.id);

      if (payoutRecord) {
        if (payoutRecord.status === "completed") {
          return {
            label: "Released",
            tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            detail: `Sent to ${payoutRecord.payment_method || profile?.payout_method || "your saved destination"}.`,
          };
        }

        if (payoutRecord.status === "pending") {
          return {
            label: "Processing",
            tone: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
            detail: payoutRecord.notes || "Automatic payout is queued or waiting for provider confirmation.",
          };
        }

        if (payoutRecord.status === "failed") {
          return {
            label: "Needs review",
            tone: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
            detail: payoutRecord.notes || "SafeDrive could not finish the payout automatically.",
          };
        }

        return {
          label: humanizePayoutStatus(payoutRecord.status),
          tone: "border-border/60 bg-muted/30 text-muted-foreground",
          detail: payoutRecord.notes || "Payout record already exists for this booking.",
        };
      }

      if (getApparentStatus(booking) !== "completed") {
        return {
          label: "Waiting for completion",
          tone: "border-border/60 bg-muted/30 text-muted-foreground",
          detail: "Automatic payout only starts after both renter and lister confirm the booking is done.",
        };
      }

      if (!hasPayoutSetup) {
        return {
          label: "Setup needed",
          tone: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
          detail: "Add your GCash or Maya payout details so the automatic release can continue.",
        };
      }

      return {
        label: "Queued for release",
        tone: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        detail: "The booking is complete and waiting for the automatic payout check to finish.",
      };
    },
    [getApparentStatus, hasPayoutSetup, latestPayoutByBooking, profile?.payout_method],
  );

  const maskPayoutAccount = (value: string | null) => {
    if (!value) return "Not provided";
    if (value.length <= 4) return value;
    return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
  };

  const humanizePayoutStatus = (status: string | null) => {
    if (!status) return "Recorded";
    const normalized = status.toLowerCase();
    if (normalized === "completed") return "Released";
    if (normalized === "pending") return "Pending review";
    if (normalized === "failed") return "Failed";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const downloadPayoutReceipt = async (payment: Payment, booking?: ListerBooking) => {
    const bookingLabel = booking
      ? `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`
      : payment.booking_id;
    const recordedAt = (() => {
      if (!payment.created_at) return "Not recorded";
      const parsed = new Date(payment.created_at);
      return Number.isNaN(parsed.getTime()) ? "Not recorded" : format(parsed, "MMM d, yyyy h:mm a");
    })();
    try {
      await downloadReceiptPdf({
        title: "Payout Receipt",
        subtitle: "Confirmation of a lister payout recorded through SafeDrive",
        documentNo: `SD-PO-${payment.id.slice(0, 8).toUpperCase()}`,
        statusLabel: humanizePayoutStatus(payment.status),
        recordedAt,
        amount: Math.abs(Number(payment.amount || 0)),
        amountLabel: "Amount released",
        rows: [
          ["Lister", profile?.full_name || user?.email || "Vehicle lister"],
          ["Booking", bookingLabel],
          ["Booking ID", booking?.id || payment.booking_id || "Not recorded"],
          ["Destination", payment.payment_method || profile?.payout_method || "Saved payout destination"],
          ["Account name", profile?.payout_account_name || "Not available"],
          ["Account number", maskPayoutAccount(profile?.payout_account_number ?? null)],
          ["Provider reference", payment.transaction_id || "Not provided"],
          ["Notes", payment.notes || "None"],
        ],
        notice: RECEIPT_NOTICES.payout,
        recordId: payment.id,
        filename: `safedrive-payout-${payment.id}.pdf`,
      });
      toast.success("Payout receipt downloaded.");
    } catch (error) {
      console.error("Failed to generate payout receipt", error);
      toast.error(
        error instanceof Error ? error.message : "Could not generate the payout receipt. Please try again.",
      );
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bookings Received</h1>
        <p className="text-muted-foreground mt-1">
          Manage incoming rental requests for your vehicles
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: "overview", label: "Overview" },
          { id: "bookings", label: "Current bookings" },
          { id: "statistics", label: "Statistics" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPageTab(tab.id as "overview" | "bookings" | "statistics")}
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending responses</p>
                <p className="mt-1 text-2xl font-bold">{summary.pending}</p>
              </div>
              <CircleAlert className="h-5 w-5 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Payment attention</p>
                <p className="mt-1 text-2xl font-bold">{summary.paymentAttention}</p>
              </div>
              <Loader2 className="h-5 w-5 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Upcoming bookings</p>
                <p className="mt-1 text-2xl font-bold">{summary.upcoming}</p>
              </div>
              <Calendar className="h-5 w-5 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completed rentals</p>
                <p className="mt-1 text-2xl font-bold">{summary.completed}</p>
              </div>
              <CarFront className="h-5 w-5 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Vehicles Needing Action</h2>
                <p className="text-sm text-muted-foreground">
                  Listings that are still pending review or were rejected.
                </p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {vehicleActions.length}
              </span>
            </div>
            {vehicleActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No vehicle issues need attention right now.
              </p>
            ) : (
              <div className="max-h-[280px] space-y-3 overflow-y-auto pr-1">
                {vehicleActions.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    className="rounded-lg border border-border/60 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {vehicle.car_models.car_brands.name} {vehicle.car_models.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Plate: {vehicle.plate_number}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize">
                        {vehicle.status}
                      </span>
                    </div>
                    {vehicle.rejection_reason ? (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        Reason: {vehicle.rejection_reason}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Renewals Due</h2>
                <p className="text-sm text-muted-foreground">
                  Renewal submissions still waiting for a decision or revision.
                </p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {renewalActions.length}
              </span>
            </div>
            {renewalActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No renewal actions are pending right now.
              </p>
            ) : (
              <div className="max-h-[280px] space-y-3 overflow-y-auto pr-1">
                {renewalActions.map((renewal) => (
                  <div
                    key={renewal.id}
                    className="rounded-lg border border-border/60 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {renewal.cars
                            ? `${renewal.cars.car_models.car_brands.name} ${renewal.cars.car_models.name}`
                            : "Vehicle renewal"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {renewal.cars?.plate_number
                            ? `Plate: ${renewal.cars.plate_number}`
                            : "Plate unavailable"}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize">
                        {renewal.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Submitted {format(new Date(renewal.submitted_at), "MMM d, yyyy")}
                    </p>
                    {renewal.admin_notes ? (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        Notes: {renewal.admin_notes}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Support Updates</h2>
                <p className="text-sm text-muted-foreground">
                  Open or pending support conversations tied to your account.
                </p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {supportOpenCount}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {supportOpenCount > 0
                ? `You currently have ${supportOpenCount} support ticket${supportOpenCount === 1 ? "" : "s"} that may need a reply or follow-up.`
                : "You have no open support tickets right now."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Recent Notifications</h2>
                <p className="text-sm text-muted-foreground">
                  The latest alerts connected to your listings, bookings, and account.
                </p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {recentNotifications.length}
              </span>
            </div>
            {recentNotifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent notifications yet.
              </p>
            ) : (
              <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                {recentNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="rounded-lg border border-border/60 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{notification.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {notification.message}
                        </p>
                      </div>
                      {!notification.read ? (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                          New
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {notification.created_at
                        ? format(new Date(notification.created_at), "MMM d, yyyy h:mm a")
                        : "Recently"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Upcoming Bookings</h2>
              <p className="text-sm text-muted-foreground">
                Your nearest upcoming rentals that may need coordination soon.
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {upcomingBookings.length}
            </span>
          </div>
          {upcomingBookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No upcoming paid bookings are lined up right now.
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {upcomingBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="min-w-[260px] rounded-lg border border-border/60 p-3 md:min-w-[300px]"
                >
                  <p className="font-medium">
                    {booking.cars.car_models.car_brands.name} {booking.cars.car_models.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {format(new Date(booking.start_date), "MMM d, yyyy h:mm a")}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Renter: {booking.renter?.full_name || booking.renter?.email || "Unknown renter"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {booking.cars.location || "Pickup location not set"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Payout Setup</h2>
                <p className="text-sm text-muted-foreground">
                  This is the destination SafeDrive will use when an automatic payout release is ready.
                </p>
              </div>
              <CreditCard className="h-5 w-5 text-primary" />
            </div>

            {profile?.payout_method && profile?.payout_account_name && profile?.payout_account_number ? (
              <div className="rounded-lg border border-border/60 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{profile.payout_method}</p>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:bg-green-950/40 dark:text-green-300">
                    Ready
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Account name: <span className="font-medium text-foreground">{profile.payout_account_name}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Account number: <span className="font-medium text-foreground">{maskPayoutAccount(profile.payout_account_number)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Update this anytime from verification if you need to change where completed-rental payouts are sent.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  No payout destination saved yet
                </p>
                <p className="mt-1">
                  Add your payout details in verification so SafeDrive can release completed-rental payouts automatically.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Current Payout Status</h2>
                <p className="text-sm text-muted-foreground">
                  What SafeDrive is doing with your latest completed-rental payouts right now.
                </p>
              </div>
              <CircleAlert className="h-5 w-5 text-primary" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Queued or pending</p>
                <p className="mt-1 text-2xl font-bold">
                  {pendingPayoutBookings.length + payoutLogs.filter((payment) => payment.payment_type === "payout" && payment.status === "pending").length}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  These bookings are still waiting for automatic release or provider confirmation.
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Needs attention</p>
                <p className="mt-1 text-2xl font-bold">
                  {payoutLogs.filter((payment) => payment.payment_type === "payout" && payment.status === "failed").length}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Failed payout attempts that may need admin review or a retry.
                </p>
              </div>
            </div>

            {!hasPayoutSetup ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                Add your GCash or Maya payout details first so automatic release can proceed after booking completion.
              </div>
            ) : pendingPayoutBookings.length > 0 ? (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
                SafeDrive will attempt payout release automatically after both sides confirm the booking is done and no payout hold is found.
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                No payout release is waiting right now.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Payout History</h2>
                <p className="text-sm text-muted-foreground">
                  Completed rental payouts already recorded by SafeDrive.
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Released</p>
                <p className="font-semibold">PHP {totalPayoutReleased.toLocaleString()}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending release</p>
                <p className="mt-1 text-2xl font-bold">{pendingPayoutBookings.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Completed rentals still waiting for automatic release or confirmation.
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Completed payouts</p>
                <p className="mt-1 text-2xl font-bold">{completedPayouts.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Payout records already sent to your saved destination.
                </p>
              </div>
            </div>

            {payoutLogsLoading ? (
              <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : completedPayouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No payout records yet. Completed bookings will appear here once SafeDrive records the payout result.
              </p>
            ) : (
              <div className="space-y-3">
                {completedPayouts.map((payment) => {
                  const booking = bookingLookup.get(payment.booking_id);
                  return (
                    <div
                      key={payment.id}
                      className="rounded-lg border border-border/60 p-3"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="font-medium">
                            {booking
                              ? `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name}`
                              : "Rental payout"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {payment.payment_method || profile?.payout_method || "Payout destination"} | {humanizePayoutStatus(payment.status)}
                          </p>
                          {payment.transaction_id ? (
                            <p className="text-xs text-muted-foreground">
                              Reference: {payment.transaction_id}
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(payment.created_at), "MMM d, yyyy h:mm a")}
                          </p>
                          {payment.notes ? (
                            <p className="text-xs text-muted-foreground">
                              Note: {payment.notes}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">
                            PHP {Number(payment.amount).toLocaleString()}
                          </p>
                          {booking ? (
                            <p className="text-xs text-muted-foreground">
                              Plate: {booking.cars.plate_number}
                            </p>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2 h-8 px-2 text-xs"
                            onClick={() => downloadPayoutReceipt(payment, booking)}
                          >
                            <Download className="mr-1 h-3.5 w-3.5" />
                            Download proof
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
        </>
      )}

      {pageTab === "statistics" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Completed payout value</p>
                <p className="mt-2 text-2xl font-bold">
                  PHP {statistics.totalRevenue.toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Net lister payout from completed rentals.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Completion rate</p>
                <p className="mt-2 text-2xl font-bold">{statistics.completionRate}%</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Completed rentals compared with all booking records.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Most booked vehicle</p>
                <p className="mt-2 text-xl font-bold">
                  {statistics.topVehicles[0]?.label ?? "No bookings yet"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {statistics.topVehicles[0]
                    ? `${statistics.topVehicles[0].count} booking${statistics.topVehicles[0].count === 1 ? "" : "s"} recorded`
                    : "Vehicle stats will appear after bookings are created."}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Booking Mix</h2>
                    <p className="text-sm text-muted-foreground">
                      Current spread of incoming, active, completed, and issue bookings.
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-center">
                  <div
                    className="relative grid h-44 w-44 place-items-center rounded-full"
                    style={{
                      background: statistics.conicStops
                        ? `conic-gradient(${statistics.conicStops})`
                        : "conic-gradient(#27272a 0% 100%)",
                    }}
                  >
                    <div className="grid h-28 w-28 place-items-center rounded-full bg-card text-center">
                      <div>
                        <p className="text-2xl font-bold">{bookings.length}</p>
                        <p className="text-xs text-muted-foreground">bookings</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  {statistics.statusBuckets.map((bucket) => (
                    <div key={bucket.label} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: bucket.color }}
                        />
                        <span className="text-muted-foreground">{bucket.label}</span>
                      </div>
                      <span className="font-medium">{bucket.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Six-Month Rental Performance</h2>
                    <p className="text-sm text-muted-foreground">
                      Completed payout value by pickup month.
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex h-64 items-end gap-3 border-b border-border/60 pb-3">
                  {statistics.monthBuckets.map((bucket) => {
                    const height = Math.max(
                      bucket.revenue > 0 ? 18 : 6,
                      Math.round((bucket.revenue / statistics.maxMonthlyRevenue) * 190),
                    );
                    return (
                      <div key={bucket.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                        <div className="flex h-52 w-full items-end justify-center">
                          <div
                            className="w-full max-w-14 rounded-t-md bg-primary/80 transition-all"
                            style={{ height }}
                            title={`${bucket.label}: PHP ${bucket.revenue.toLocaleString()}`}
                          />
                        </div>
                        <div className="text-center">
                          <p className="text-xs font-medium">{bucket.label}</p>
                          <p className="text-[10px] text-muted-foreground">
                            PHP {bucket.revenue.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Top Vehicles by Bookings</h2>
                  <p className="text-sm text-muted-foreground">
                    Which listings are getting the most rental activity.
                  </p>
                </div>
              </div>

              {statistics.topVehicles.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No booking statistics yet.
                </p>
              ) : (
                <div className="mt-5 space-y-4">
                  {statistics.topVehicles.map((vehicle) => (
                    <div key={vehicle.label} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium">{vehicle.label}</span>
                        <span className="text-muted-foreground">
                          {vehicle.count} booking{vehicle.count === 1 ? "" : "s"} | PHP {vehicle.revenue.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-green-500"
                          style={{
                            width: `${Math.max(
                              8,
                              Math.round((vehicle.count / statistics.maxVehicleCount) * 100),
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {pageTab === "bookings" && (
        <>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "all", label: "All", count: sectionCounts.all },
            { id: "incoming", label: "Incoming", count: sectionCounts.incoming },
            { id: "active", label: "Active", count: sectionCounts.active },
            { id: "completed", label: "Completed", count: sectionCounts.completed },
            { id: "issues", label: "Issues", count: sectionCounts.issues },
          ].map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => {
                setBookingSection(
                  section.id as "all" | "incoming" | "active" | "completed" | "issues",
                );
                setStatusFilter("all");
                setBookingPage(1);
              }}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                bookingSection === section.id
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{section.label}</span>
              <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs">
                {section.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Status</span>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              if (!value) return;
              setStatusFilter(value);
              setBookingPage(1);
            }}
          >
            <SelectTrigger className="h-7 w-[150px] border-0 bg-transparent px-1 text-sm shadow-none focus:ring-0">
              <SelectValue placeholder="All bookings" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All bookings</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Awaiting payment</SelectItem>
              <SelectItem value="awaiting_payment">Checkout pending</SelectItem>
              <SelectItem value="downpayment_paid">Downpayment paid</SelectItem>
              <SelectItem value="fully_paid">Fully paid</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      </div>

      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-blue-600 dark:text-blue-400">
          Booking response reminder
        </p>
        <p className="mt-1">
          Review new requests within the response window shown on each card. Once you accept, the renter must finish the downpayment before the payment deadline before handoff should proceed.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5 space-y-3">
                <Skeleton className="h-5 w-64" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="text-center py-20">
          <LayoutDashboard className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold">No bookings match this view</h3>
          <p className="text-muted-foreground text-sm mt-1">
            Change the filter or wait for new booking activity.
          </p>
        </div>
      ) : (
        <div id="lister-booking-list" className="scroll-mt-24 space-y-4">
          {bookingPagination.items.map((b) => {
            const apparentState = getApparentStatus(b);
            const badge = statusBadge(apparentState);
            const renterDisplay = getRenterDisplay(b);
            const renterRep = renterReputations[b.renter_id];
            const renterRel = renterReliabilities[b.renter_id];
            const latestExtension = getLatestExtension(b.id);
            const latestEarly = latestEarlyReturn(earlyReturnsByBooking[b.id]);
            const processGuidance = getProcessGuidance(b, apparentState);
            const payoutStatus = getBookingPayoutStatus(b);
            const shouldShowPayoutStatus =
              apparentState === "completed" || Boolean(latestPayoutByBooking.get(b.id));
            const showProjectedPayout = [
              "downpayment_paid",
              "fully_paid",
              "active",
              "completed",
            ].includes(apparentState);
            const payoutLabel =
              apparentState === "downpayment_paid"
                ? "Projected payout after full payment"
                : apparentState === "completed"
                  ? "Eligible payout"
                  : "Payout after completion";
            const extensionServiceFee = latestExtension
              ? Math.max(
                  0,
                  Number(latestExtension.total_additional_amount) -
                    Number(latestExtension.extension_amount) -
                    Number(latestExtension.fuel_top_up_amount),
                )
              : 0;
            const apparentExtensionStatus = latestExtension
              ? getExtensionDisplayStatus(latestExtension, new Date(clockNow))
              : null;
            const extensionBlocksCompletion =
              apparentExtensionStatus === "pending" || apparentExtensionStatus === "approved";
            const noShowState = getNoShowWindowState(
              b,
              "owner",
              new Date(clockNow),
            );
            const canReportNonReturnNow = canReportNonReturn(b, new Date(clockNow));
            const nonReturnFlagged = (b.dispute_status ?? "none") === "open";
            const reviewedByOwner = b.booking_reviews?.some(
              (review) =>
                review.reviewer_id === user?.id &&
                review.reviewer_role === "owner",
            );
            const showTripProgress = ["fully_paid", "active", "completed"].includes(apparentState);
            const bookingPickupMs = getBookingPickupMs(b);
            const arrivalCheckinOpensMs =
              bookingPickupMs === null
                ? null
                : bookingPickupMs - arrivalLeadHours * 60 * 60 * 1000;
            const arrivalCheckinOpen =
              arrivalCheckinOpensMs === null || clockNow >= arrivalCheckinOpensMs;
            const tripHasStarted =
              bookingPickupMs === null || clockNow >= bookingPickupMs;
            const nextStep = getNextStep(
              b,
              apparentState,
              reviewedByOwner,
              extensionBlocksCompletion,
            );
            const isOpen = openBookingId === b.id;
            const carTitle = `${b.cars.car_models.car_brands.name} ${b.cars.car_models.name}`;
            return (
              <div key={b.id} className="space-y-4">
                <Card
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenBookingId(b.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setOpenBookingId(b.id);
                    }
                  }}
                >
                  <CardContent className="flex items-start justify-between gap-4 p-4 sm:p-5">
                    <div className="min-w-0 space-y-1.5">
                      <p className="truncate font-semibold">
                        {carTitle}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {b.cars.plate_number}
                        </span>
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                      <p className="text-sm text-muted-foreground">
                        {renterDisplay.fullName} · {format(new Date(b.start_date), "MMM d")} - {format(new Date(b.end_date), "MMM d, yyyy")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-bold">PHP {Number(b.total_price).toLocaleString()}</p>
                      <span className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary">
                        View details
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
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
                              {b.cars.plate_number}
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
                <CardContent className="max-h-[75vh] space-y-4 overflow-y-auto p-5 [&_.justify-end]:justify-start [&_.text-right]:text-left">
                  <div className="space-y-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-semibold">
                          {b.cars.car_models.car_brands.name}{" "}
                          {b.cars.car_models.name}
                          <span className="text-muted-foreground font-normal ml-2 text-sm">
                            ({b.cars.plate_number})
                          </span>
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}
                        >
                          {badge.label}
                        </span>
                      </div>

                      {/* Renter info */}
                      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border/40">
                        <button
                          onClick={() => setSelectedRenter(b)}
                          className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
                        >
                          {(() => {
                            const selfie = renterDisplay.verificationImages.find(
                              (i) => i.image_type === "selfie" || i.image_type === "selfie_with_id"
                            );
                            return selfie ? (
                              <img
                                src={getImageUrl(selfie.storage_path)}
                                alt="Renter"
                                className="w-8 h-8 rounded-full object-cover shadow-sm"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                                {renterDisplay.initial}
                              </div>
                            );
                          })()}
                          <div className="text-xs text-muted-foreground">
                            <p className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                              {renterDisplay.fullName} <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-md uppercase tracking-wider font-bold">Renter</span>
                            </p>
                            {b.renter?.phone && (
                              <p className="flex items-center gap-1 mt-0.5">
                                <Phone className="w-3 h-3" /> {renterDisplay.phone}
                              </p>
                            )}
                            <p className="flex items-center gap-1 mt-1">
                              <Star className="w-3 h-3 text-amber-500 fill-current" />
                              <span>
                                Renter rating:{" "}
                                {renderRatingSummary(
                                  renterRep && renterRep.reviewCount > 0
                                    ? {
                                        average: renterRep.average ?? 0,
                                        count: renterRep.reviewCount,
                                      }
                                    : undefined,
                                  "No ratings yet",
                                )}
                                {renterRep && renterRep.tripCount > 0 ? (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · {renterRep.tripCount}{" "}
                                    {renterRep.tripCount === 1 ? "trip" : "trips"}
                                  </span>
                                ) : null}
                              </span>
                            </p>
                            {renterRel?.hasEnoughHistory &&
                              renterRel.cancellationRate !== null && (
                                <p
                                  className={`mt-1 text-xs ${
                                    renterRel.cancellationRate >= 15
                                      ? "font-medium text-red-500"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  {100 - renterRel.cancellationRate}% completion
                                  rate
                                </p>
                              )}
                          </div>
                        </button>
                      </div>

                      <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
                        <Calendar className="w-3.5 h-3.5" />
                        {format(new Date(b.start_date), "MMM d, yyyy")}{" "}
                        {b.pickup_time ? `at ${formatTimeAMPM(b.pickup_time)}` : ""}
                        -{" "}
                        {format(new Date(b.end_date), "MMM d, yyyy")}{" "}
                        {b.dropoff_time ? `at ${formatTimeAMPM(b.dropoff_time)}` : ""}
                        <span className="font-medium text-foreground ml-1">
                          ({formatDayCount(b.total_days)})
                        </span>
                      </p>
                      {b.cars.location && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" /> {b.cars.location}
                        </p>
                      )}
                      {getAgreementUrl(b.agreement_storage_path_snapshot) &&
                        ["downpayment_paid", "active", "fully_paid", "completed"].includes(
                          apparentState,
                        ) && (
                          <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-left">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Rental agreement
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              The version the renter accepted for this booking.
                            </p>
                            <a
                              href={getAgreementUrl(b.agreement_storage_path_snapshot)}
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
                      <p className="text-lg font-bold">
                        PHP {Number(b.total_price).toLocaleString()}
                      </p>
                      {showProjectedPayout ? (
                        <p className="text-xs text-muted-foreground">
                          {payoutLabel}:{" "}
                          <span className="text-green-600 font-semibold">
                            PHP {Number(b.base_price).toLocaleString()}
                          </span>
                        </p>
                      ) : null}

                      {nextStep ? (
                        <div
                          className={`mt-3 w-full rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${nextStep.tone}`}
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                            Next step
                          </p>
                          <p className="mt-1 font-semibold">{nextStep.title}</p>
                          <p className="mt-1 opacity-80">{nextStep.body}</p>
                        </div>
                      ) : null}

                      {shouldShowPayoutStatus ? (
                        <div
                          className={`mt-2 w-full rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${payoutStatus.tone}`}
                        >
                          <p className="font-semibold">Payout status: {payoutStatus.label}</p>
                          <p className="mt-1">{payoutStatus.detail}</p>
                        </div>
                      ) : null}

                      {processGuidance && (
                        <div
                          className={`mt-3 w-full rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${processGuidance.tone}`}
                        >
                          <p className="font-semibold">{processGuidance.title}</p>
                          <p className="mt-1">{processGuidance.body}</p>
                          {processGuidance.footnote && (
                            <p className="mt-1 opacity-80">{processGuidance.footnote}</p>
                          )}
                        </div>
                      )}

                      {latestExtension ? (
                        <div
                          className={`mt-3 w-full rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${getExtensionTone(
                            apparentExtensionStatus ?? latestExtension.status,
                          )}`}
                        >
                          <p className="font-semibold">Extension request</p>
                          <p className="mt-1">
                            {getExtensionStatusLabel(
                              apparentExtensionStatus ?? latestExtension.status,
                            )}.
                            Requested return:{" "}
                            {format(new Date(latestExtension.requested_end_date), "MMM d, yyyy")}.
                          </p>
                          <p className="mt-1">Reason: {latestExtension.reason}</p>
                          <p className="mt-1">
                            Added: {formatDayCount(latestExtension.extension_days)} | Extension:
                            {" "}PHP {Number(latestExtension.extension_amount).toLocaleString()}
                            {extensionServiceFee > 0
                              ? ` | Service fee: PHP ${extensionServiceFee.toLocaleString()}`
                              : ""}
                            {Number(latestExtension.fuel_top_up_amount) > 0
                              ? ` | Fuel top-up: PHP ${Number(latestExtension.fuel_top_up_amount).toLocaleString()}`
                              : ""}
                          </p>
                          <p className="mt-1 font-medium">
                            Total additional amount: PHP {Number(latestExtension.total_additional_amount).toLocaleString()}
                          </p>
                          {latestExtension.payment_deadline ? (
                            <p className="mt-1 opacity-80">
                              Payment deadline: {formatDeadlineStamp(latestExtension.payment_deadline)}
                            </p>
                          ) : null}
                          {latestExtension.owner_decision_note ? (
                            <p className="mt-1 opacity-80">
                              Your note: {latestExtension.owner_decision_note}
                            </p>
                          ) : null}
                          {apparentExtensionStatus === "expired" ? (
                            <p className="mt-1 font-medium">
                              The renter missed the payment deadline. This extension can no longer be paid.
                            </p>
                          ) : null}
                          {(bookingExtensionsByBooking[b.id]?.length ?? 0) > 1 ? (
                            <div className="mt-2 border-t border-current/15 pt-2 opacity-90">
                              <p className="font-medium">Extension history</p>
                              <div className="mt-1 space-y-1">
                                {bookingExtensionsByBooking[b.id]!.slice(1).map((entry) => (
                                  <p key={entry.id}>
                                    {format(new Date(entry.created_at), "MMM d, yyyy")} -{" "}
                                    {getExtensionStatusLabel(
                                      getExtensionDisplayStatus(entry, new Date(clockNow)),
                                    )}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {getExtensionDisplayStatus(latestExtension, new Date(clockNow)) === "pending" ? (
                            <div className="mt-3 space-y-2">
                              <textarea
                                value={extensionDecisionNotes[latestExtension.id] ?? ""}
                                onChange={(event) =>
                                  setExtensionDecisionNotes((current) => ({
                                    ...current,
                                    [latestExtension.id]: event.target.value,
                                  }))
                                }
                                placeholder="Optional note for approval, required reason for rejection"
                                className="min-h-20 w-full rounded-md border border-input bg-background px-2 py-2 text-xs"
                              />
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  className="h-8 px-2 text-xs"
                                  disabled={extensionActionLoading === latestExtension.id}
                                  onClick={() => handleApproveExtension(latestExtension)}
                                >
                                  {extensionActionLoading === latestExtension.id ? (
                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                  )}
                                  Approve extension
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-8 px-2 text-xs"
                                  disabled={extensionActionLoading === latestExtension.id}
                                  onClick={() => handleRejectExtension(latestExtension)}
                                >
                                  {extensionActionLoading === latestExtension.id ? (
                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <XCircle className="mr-1 h-3.5 w-3.5" />
                                  )}
                                  Reject extension
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {latestEarly && latestEarly.status !== "cancelled" ? (
                        <div
                          className={`mt-3 w-full rounded-lg border px-3 py-2 text-left text-[11px] leading-relaxed ${earlyReturnTone(
                            latestEarly.status,
                          )}`}
                        >
                          <p className="font-semibold">Early return request</p>
                          <p className="mt-1">
                            {earlyReturnStatusLabel(latestEarly.status)}. New
                            return:{" "}
                            {format(
                              new Date(latestEarly.requested_end_date),
                              "MMM d, yyyy",
                            )}{" "}
                            (was{" "}
                            {format(
                              new Date(latestEarly.current_end_date),
                              "MMM d, yyyy",
                            )}
                            ).
                          </p>
                          {latestEarly.reason ? (
                            <p className="mt-1">Reason: {latestEarly.reason}</p>
                          ) : null}
                          {latestEarly.status === "pending" ? (
                            <div className="mt-2 space-y-2">
                              <input
                                type="number"
                                min={0}
                                placeholder="Goodwill refund (optional, PHP)"
                                value={earlyReturnGoodwill[latestEarly.id] ?? ""}
                                onChange={(e) =>
                                  setEarlyReturnGoodwill((m) => ({
                                    ...m,
                                    [latestEarly.id]: e.target.value,
                                  }))
                                }
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                              />
                              <input
                                type="text"
                                placeholder="Note to the renter (optional)"
                                value={earlyReturnNotes[latestEarly.id] ?? ""}
                                onChange={(e) =>
                                  setEarlyReturnNotes((m) => ({
                                    ...m,
                                    [latestEarly.id]: e.target.value,
                                  }))
                                }
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-8 px-2 text-xs"
                                  disabled={earlyReturnActionLoading === latestEarly.id}
                                  onClick={() =>
                                    void decideEarlyReturn(latestEarly, "approve")
                                  }
                                >
                                  {earlyReturnActionLoading === latestEarly.id ? (
                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                  )}
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2 text-xs text-red-500 hover:text-red-600"
                                  disabled={earlyReturnActionLoading === latestEarly.id}
                                  onClick={() =>
                                    void decideEarlyReturn(latestEarly, "reject")
                                  }
                                >
                                  <XCircle className="mr-1 h-3.5 w-3.5" />
                                  Reject
                                </Button>
                              </div>
                              <p className="text-[10px] opacity-80">
                                No refund is owed for unused days. A goodwill
                                refund, if you set one, is released by SafeDrive
                                support.
                              </p>
                            </div>
                          ) : null}
                          {latestEarly.status === "approved" &&
                          Number(latestEarly.goodwill_refund_amount) > 0 ? (
                            <p className="mt-1 font-medium">
                              Goodwill refund: PHP{" "}
                              {Number(
                                latestEarly.goodwill_refund_amount,
                              ).toLocaleString()}{" "}
                              (SafeDrive support will release it)
                            </p>
                          ) : null}
                          {latestEarly.owner_decision_note ? (
                            <p className="mt-1 opacity-80">
                              Your note: {latestEarly.owner_decision_note}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {apparentState === "pending" && (
                        <div className="flex gap-2 mt-2 justify-end">
                          <Button
                            size="sm"
                            onClick={() => handleAccept(b.id)}
                            disabled={actionLoading === b.id}
                            className="gap-1"
                          >
                            {actionLoading === b.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setRejectingBooking(b);
                              setRejectionReason("");
                            }}
                            disabled={actionLoading === b.id}
                            className="gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Reject
                          </Button>
                        </div>
                      )}

                      {["confirmed", "downpayment_paid", "fully_paid"].includes(
                        apparentState,
                      ) &&
                        !b.lister_arrived_at &&
                        !b.renter_arrived_at && (
                          <div className="mt-2 flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setCancellingBooking(b);
                                setCancelReason("Vehicle problem");
                              }}
                              disabled={actionLoading === b.id}
                              className="gap-1 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                            >
                              <XCircle className="w-3.5 h-3.5" /> Cancel booking
                            </Button>
                          </div>
                        )}

                      {/* Arrival Phase - opens only near the booked pickup time */}
                      {(apparentState === "fully_paid" || apparentState === "active") &&
                        !b.lister_arrived_at &&
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

                      {(apparentState === "fully_paid" || apparentState === "active") && !b.lister_arrived_at && arrivalCheckinOpen && (
                        <div className="mt-2 text-right">
                          <p className="mb-2 text-xs font-medium text-foreground">Handover complete - renter has the car</p>
                          <ArrivalPhotoCapture
                            loading={actionLoading === b.id}
                            disabled={actionLoading === b.id}
                            onConfirmArrival={(location) => handleArrive(b.id, location)}
                          />
                          <div className="mt-2 flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => navigate(`/trip-report/${b.id}/pickup`)}>
                              Add pickup photos (optional)
                            </Button>
                            <span
                              className="inline-flex h-7 w-7 shrink-0 cursor-help items-center justify-center rounded-md text-muted-foreground"
                              title="Optional, but highly encouraged: if there's ever a dispute, you and the renter both need this evidence."
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                            Confirm arrival first, then the renter confirms they have the car. Arrival location is optional and stored only with your consent.
                          </p>
                        </div>
                      )}

                      {(apparentState === "fully_paid" || apparentState === "active") &&
                        !b.renter_arrived_at &&
                        arrivalCheckinOpen && (
                          <div className="mt-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={actionLoading === b.id}
                              onClick={() => handleConfirmRenterArrived(b.id)}
                            >
                              {actionLoading === b.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              Confirm - Renter Is Here
                            </Button>
                            <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                              Only if needed - e.g. the renter's phone is dead. Prefer letting them confirm it themselves.
                            </p>
                          </div>
                        )}

                      {showTripProgress && (
                        <div className="mt-3 w-full rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left text-[11px] leading-relaxed">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="font-semibold text-foreground">Trip progress</p>
                            <span className="text-[10px] text-muted-foreground">
                              {apparentState === "completed" ? "Complete" : "In handoff"}
                            </span>
                          </div>
                          <div className="grid gap-1.5">
                            {(() => {
                              const ownReports = ownReportsByBooking[b.id] ?? { pickup: false, return: false };
                              return [
                                { label: "Renter arrived", done: Boolean(b.renter_arrived_at) },
                                { label: "You arrived", done: Boolean(b.lister_arrived_at) },
                                { label: "Vehicle verification", done: ownReports.pickup },
                                { label: "Vehicle handover", done: ownReports.pickup },
                                { label: "Rental in progress", done: b.status === "active" || b.status === "completed" },
                                { label: "Vehicle return", done: ownReports.return },
                                { label: "Trip completed", done: b.status === "completed" },
                                { label: "Your rating", done: Boolean(reviewedByOwner) },
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

                      {noShowState ? (
                        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                          <p className="font-semibold text-amber-900 dark:text-amber-100">
                            {noShowState.canReport
                              ? "The renter still has not checked in."
                              : "Waiting through the pickup grace window."}
                          </p>
                          <p className="mt-1">
                            {noShowState.canReport
                              ? `Your arrival check-in is on file and the renter has not shown up. You can cancel this booking as a renter no-show — your reliability record is not affected and the renter keeps a ${noShowRefundPercent}% forfeit.`
                              : `SafeDrive waits until ${noShowState.reportReadyAt.toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })} before a renter no-show can be filed. Add optional pickup evidence in the meantime.`}
                          </p>
                          {noShowState.canReport ? (
                            <div className="mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setIncidentTarget({ booking: b, kind: "renter_no_show" })
                                }
                                className="gap-1"
                              >
                                <CircleAlert className="w-3.5 h-3.5" />
                                Renter no-show — cancel booking
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {nonReturnFlagged ? (
                        <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-left text-[11px] leading-relaxed text-red-800 dark:text-red-200">
                          <p className="font-semibold text-red-900 dark:text-red-100">
                            Flagged: vehicle not returned
                          </p>
                          <p className="mt-1">
                            SafeDrive support is handling this case. Any refund
                            stays on hold. You can take this car offline from My
                            Vehicles while the case is open.
                          </p>
                        </div>
                      ) : canReportNonReturnNow ? (
                        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                          <p className="font-semibold text-amber-900 dark:text-amber-100">
                            Return time has passed
                          </p>
                          <p className="mt-1">
                            The agreed return time plus the grace window is over and
                            the renter has not completed the trip. Report a
                            non-return so SafeDrive support can step in — this does
                            not cancel the booking.
                          </p>
                          <div className="mt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setNonReturnReason("renter_unreachable");
                                setIncidentTarget({ booking: b, kind: "report_non_return" });
                              }}
                              className="gap-1"
                            >
                              <CircleAlert className="w-3.5 h-3.5" />
                              Report vehicle not returned
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {(apparentState === "awaiting_payment" ||
                        apparentState === "confirmed") &&
                        b.paymongo_checkout_id && (
                          <p className="text-[10px] text-amber-600 mt-2 max-w-md leading-tight">
                            Checkout created. Wait for the signed PayMongo
                            webhook before treating this booking as paid.
                          </p>
                        )}
                      {apparentState === "downpayment_paid" && (
                        <p className="text-[10px] text-amber-600 mt-2 max-w-[220px] leading-tight">
                          Waiting for the renter to settle the remaining balance before the rental can begin.
                        </p>
                      )}

                      {["fully_paid", "active", "completed"].includes(apparentState) && (
                        <div className="mt-2 flex flex-wrap justify-end gap-2">
                          {["fully_paid", "active"].includes(apparentState) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleMessageRenter(b)}
                              disabled={conversationLoading === b.id}
                              className="gap-1"
                            >
                              {conversationLoading === b.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <MessageCircle className="w-3.5 h-3.5" />
                              )}
                              Message Renter
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleReportBooking(b)}
                            className="gap-1 text-muted-foreground"
                          >
                            <CircleAlert className="w-3.5 h-3.5" />
                            Report Booking
                          </Button>
                        </div>
                      )}

                      {/* Confirm Agreement (After Arrival) */}
                      {(apparentState === "fully_paid" ||
                        apparentState === "active") &&
                        b.lister_arrived_at &&
                        !b.owner_completed && (
                        <div className="mt-2 text-right">
                          <p className="text-[10px] text-green-500 font-semibold flex flex-col items-start mb-2">
                             <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Arrived: {new Date(b.lister_arrived_at).toLocaleTimeString()}</span>
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
                                  variant={ownReportsByBooking[b.id]?.pickup ? "ghost" : "outline"}
                                  className={ownReportsByBooking[b.id]?.pickup ? "gap-1 text-green-600" : undefined}
                                  onClick={() => navigate(`/trip-report/${b.id}/pickup`)}
                                  disabled={Boolean(ownReportsByBooking[b.id]?.pickup)}
                                >
                                  {ownReportsByBooking[b.id]?.pickup && <CheckCircle2 className="w-3.5 h-3.5" />}
                                  {ownReportsByBooking[b.id]?.pickup ? "Pickup report (submitted)" : "Pickup report (required)"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant={ownReportsByBooking[b.id]?.return ? "ghost" : "outline"}
                                  className={ownReportsByBooking[b.id]?.return ? "gap-1 text-green-600" : undefined}
                                  onClick={() => navigate(`/trip-report/${b.id}/return`)}
                                  disabled={Boolean(ownReportsByBooking[b.id]?.return)}
                                >
                                  {ownReportsByBooking[b.id]?.return && <CheckCircle2 className="w-3.5 h-3.5" />}
                                  {ownReportsByBooking[b.id]?.return ? "Return report (submitted)" : "Return report (required)"}
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleComplete(b)}
                                  disabled={actionLoading === b.id}
                                  className="gap-1 whitespace-nowrap shadow-lg shadow-primary/20"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Confirm - Car Received
                                </Button>
                              </div>
                              <p className="text-[10px] text-muted-foreground text-right leading-tight">
                                As the lister you must file both the pickup ("before") and return ("after") reports with
                                at least one live photo each before you can confirm receipt - with or without the renter's
                                own "I've Returned the Car" tap.
                              </p>
                            </div>
                          )}
                        </div>
                        )}

                      {b.owner_completed &&
                        !b.renter_completed &&
                        b.status !== "completed" && (
                          <p className="text-xs text-amber-600 mt-1">
                            Waiting for renter to complete
                          </p>
                        )}
                      {apparentState === "completed" && !reviewedByOwner && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openRateRenterModal(b)}
                            className="gap-1"
                          >
                            Rate Renter
                        </Button>
                      )}
                      {apparentState === "completed" && reviewedByOwner && (
                        <p className="text-[10px] text-green-600 font-medium">
                          Rating submitted
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
            total={filteredBookings.length}
            onPageChange={changeBookingPage}
          />
        </div>
      )}
        </>
      )}

      {rejectingBooking &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => {
              if (actionLoading !== rejectingBooking.id) {
                setRejectingBooking(null);
                setRejectionReason("");
              }
            }}
          >
            <div
              className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">Reject booking request</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Tell the renter why this booking cannot be accepted.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setRejectingBooking(null);
                    setRejectionReason("");
                  }}
                  disabled={actionLoading === rejectingBooking.id}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <textarea
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Example: The requested pickup time is no longer available."
                className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                This note will be shown to the renter in their notification.
              </p>

              <div className="mt-5 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setRejectingBooking(null);
                    setRejectionReason("");
                  }}
                  disabled={actionLoading === rejectingBooking.id}
                >
                  Skip for now
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleReject(rejectingBooking.id)}
                  disabled={actionLoading === rejectingBooking.id || !rejectionReason.trim()}
                >
                  {actionLoading === rejectingBooking.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Rejecting...
                    </>
                  ) : (
                    "Reject Booking"
                  )}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {cancellingBooking &&
        createPortal(
          <div
            className="fixed inset-0 z-[130] flex items-start sm:items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 py-6"
            onClick={() => {
              if (actionLoading !== cancellingBooking.id) {
                setCancellingBooking(null);
              }
            }}
          >
            <div
              className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">Cancel this booking?</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The renter gets an automatic full refund and is notified to rebook.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCancellingBooking(null)}
                  disabled={actionLoading === cancellingBooking.id}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <label className="text-sm font-medium">Reason</label>
              <select
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Vehicle problem">Vehicle problem</option>
                <option value="Personal emergency">Personal emergency</option>
                <option value="Double-booked">Double-booked</option>
                <option value="Other">Other</option>
              </select>

              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                Cancelling a paid booking close to pickup counts toward your
                cancellation record and can pause your listings after repeated
                last-minute cancellations.
              </p>

              <div className="mt-5 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCancellingBooking(null)}
                  disabled={actionLoading === cancellingBooking.id}
                >
                  Keep booking
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleListerCancel(cancellingBooking.id)}
                  disabled={actionLoading === cancellingBooking.id}
                >
                  {actionLoading === cancellingBooking.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    "Cancel booking"
                  )}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {selectedRenter &&
        (() => {
          const selectedRenterDisplay = getRenterDisplay(selectedRenter);
          return createPortal(
        <div
          className="fixed inset-0 z-[130] flex items-start sm:items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 py-6"
          onClick={() => setSelectedRenter(null)}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-2xl w-full max-w-lg max-h-[calc(100vh-2rem)] sm:max-h-[80vh] overflow-y-auto animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold">Renter Information</h2>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSelectedRenter(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-5 space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-secondary overflow-hidden shrink-0 border border-border">
                  {selectedRenterDisplay.avatarUrl ? (
                    <img 
                      src={selectedRenterDisplay.avatarUrl} 
                      alt="Renter" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground font-semibold text-lg">
                      {selectedRenterDisplay.initial}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-lg">{selectedRenterDisplay.fullName}</h3>
                  <p className="text-sm text-muted-foreground">{selectedRenterDisplay.email}</p>
                  {(() => {
                    const rep = renterReputations[selectedRenter.renter_id];
                    if (rep && rep.reviewCount > 0) {
                      return (
                        <p className="mt-1 flex items-center gap-1 text-sm">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          <span className="font-semibold">
                            {rep.average?.toFixed(1)}
                          </span>
                          <span className="text-muted-foreground">
                            ({rep.reviewCount} review{rep.reviewCount === 1 ? "" : "s"}
                            {rep.tripCount > 0 ? ` · ${rep.tripCount} trip${rep.tripCount === 1 ? "" : "s"}` : ""})
                          </span>
                        </p>
                      );
                    }
                    return (
                      <p className="mt-1 text-sm text-muted-foreground">
                        No renter reviews yet
                      </p>
                    );
                  })()}
                </div>
              </div>

              {(() => {
                const rep = renterReputations[selectedRenter.renter_id];
                if (!rep || rep.recent.length === 0) return null;
                return (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">
                      Recent feedback from other listers
                    </h4>
                    <div className="space-y-2">
                      {rep.recent.map((item, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-border/50 bg-muted/20 p-3 text-sm"
                        >
                          <div className="flex items-center gap-0.5 text-amber-500">
                            {Array.from({ length: 5 }).map((_, s) => (
                              <Star
                                key={s}
                                className={`h-3 w-3 ${s < item.rating ? "fill-current" : ""}`}
                              />
                            ))}
                          </div>
                          {item.feedback?.trim() && (
                            <p className="mt-1 text-muted-foreground">
                              {item.feedback.trim()}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-xl border border-border/50">
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Phone</span>
                  <p className="font-medium">
                    {selectedRenterDisplay.phone}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Birthday</span>
                  <p className="font-medium">
                    {selectedRenterDisplay.birthday
                      ? format(
                          new Date(selectedRenterDisplay.birthday),
                          "MMM d, yyyy",
                        )
                      : "-"}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Address</span>
                  <p className="font-medium">
                    {selectedRenterDisplay.address}
                  </p>
                </div>
              </div>

              {/* Renter selfie for meetup verification */}
              {selectedRenterDisplay.verificationImages.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">
                    Verification Images
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedRenterDisplay.verificationImages
                      .filter(
                        (img) =>
                          img.image_type === "selfie" ||
                          img.image_type === "selfie_with_id",
                      )
                      .map((img, i) => (
                        <div key={i}>
                          <p className="text-xs text-muted-foreground capitalize mb-1">
                            {img.image_type.replace(/_/g, " ")}
                          </p>
                          <a
                            href={getImageUrl(img.storage_path)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <img
                              src={getImageUrl(img.storage_path)}
                              alt={img.image_type}
                              className="w-full h-28 object-cover rounded-lg border hover:ring-2 hover:ring-primary cursor-pointer"
                            />
                          </a>
                        </div>
                      ))}
                  </div>
                </div>
              )}
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
                  <h2 className="text-lg font-bold">Rate this renter</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    How did they care for the car, keep to the schedule, and
                    communicate? Visible once the renter also rates, or after
                    14 days.
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setRatingBooking(null)}
                  disabled={submittingRating}
                >
                  <X className="w-4 h-4" />
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
                    placeholder="Tell us about communication, punctuality, and how the handoff went."
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
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleRateRenter}
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
        open={Boolean(incidentTarget)}
        title={
          incidentTarget?.kind === "renter_no_show"
            ? "Report renter no-show?"
            : "Report vehicle not returned?"
        }
        description={
          incidentTarget
            ? incidentTarget.kind === "renter_no_show"
              ? `This cancels ${incidentTarget.booking.cars.car_models.car_brands.name} ${incidentTarget.booking.cars.car_models.name} (${incidentTarget.booking.cars.plate_number}). Only do this if you checked in at the pickup point and the renter never arrived.`
              : `This flags ${incidentTarget.booking.cars.car_models.car_brands.name} ${incidentTarget.booking.cars.car_models.name} (${incidentTarget.booking.cars.plate_number}) as overdue and opens a SafeDrive support case. The booking is not cancelled.`
            : ""
        }
        confirmText={
          incidentTarget?.kind === "renter_no_show"
            ? "Cancel Booking — Renter No-Show"
            : "Report Non-Return"
        }
        destructive
        isLoading={Boolean(
          incidentTarget && incidentLoading === incidentTarget.booking.id,
        )}
        onCancel={() => setIncidentTarget(null)}
        onConfirm={runIncident}
      >
        {incidentTarget?.kind === "report_non_return" && (
          <div className="mb-3 space-y-1.5 text-left">
            <label className="text-xs font-medium text-foreground">
              Reason for the support case
            </label>
            <select
              value={nonReturnReason}
              onChange={(e) => setNonReturnReason(e.target.value as NonReturnReason)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {NON_RETURN_REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          {incidentTarget?.kind === "renter_no_show"
            ? `The renter keeps a ${noShowRefundPercent}% forfeit; SafeDrive support releases the rest after confirming the return method. Your completion rate is not affected.`
            : "SafeDrive support contacts the renter and manages recovery. Keep any pickup evidence ready. You can take the car offline from My Vehicles while the case is open."}
        </div>
      </ConfirmDialog>
    </div>
  );
}



