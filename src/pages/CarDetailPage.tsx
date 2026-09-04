import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { supabase } from "@/lib/supabase";
import {
  calculateCommissionAmount,
  calculateProcessingFee,
  DEFAULT_COMMISSION_RATE,
  DEFAULT_DOWNPAYMENT_RATE,
  fetchPlatformPricingSettings,
  formatCommissionPercent,
} from "@/lib/platformSettings";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CarFront,
  MapPin,
  Fuel,
  Users,
  Gauge,
  Calendar,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Settings,
  ShieldCheck,
  Loader2,
  Eye,
  Star,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { differenceInDays, format, addDays } from "date-fns";
import { DayPicker, DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import type { CarWithDetails } from "@/types/database";
import { formatDayCount } from "@/lib/formatCount";
import {
  fetchCarRatingSummaries,
  fetchListerRatingSummaries,
  fetchListerReliability,
  fetchPublicCarReviews,
  formatAverage,
  type ListerRating,
  type PublicCarReview,
  type RatingSummary,
  type Reliability,
} from "@/lib/ratings";
import { carTransmissionLabel, isLicenseExpired } from "@/lib/driversLicense";

const MAX_BOOKING_TOTAL = 100000;

type AgreementAccess = {
  agreementVersionId: string;
  versionNumber: number;
  contentSha256: string | null;
  url: string;
  expiresInSeconds: number;
};

const combineDateAndTime = (date: Date | undefined, time: string) => {
  if (!date || !time) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const combined = new Date(date);
  combined.setHours(hours, minutes, 0, 0);
  return combined;
};

export default function CarDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile } = useAuth();
  const [car, setCar] = useState<CarWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [pickupTime, setPickupTime] = useState("");
  const [dropoffTime, setDropoffTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commissionRate, setCommissionRate] = useState(DEFAULT_COMMISSION_RATE);
  const [processingFeeRate, setProcessingFeeRate] = useState(0);
  const [processingFixedCentavos, setProcessingFixedCentavos] = useState(0);
  const [downpaymentRate, setDownpaymentRate] = useState(DEFAULT_DOWNPAYMENT_RATE);
  const [bookedDates, setBookedDates] = useState<
    { start: string; end: string }[]
  >([]);
  const [blackoutDates, setBlackoutDates] = useState<
    { start: string; end: string; category: string }[]
  >([]);
  const [showAgreement, setShowAgreement] = useState(false);
  // Each lister's agreement PDF has its own conditions, so accepting must
  // require actually opening this one - a previous car's "viewed" state
  // must never carry over.
  const [pdfViewed, setPdfViewed] = useState(false);
  const [acceptedAgreement, setAcceptedAgreement] = useState(false);
  const [agreementAccess, setAgreementAccess] = useState<AgreementAccess | null>(null);
  const [agreementLoading, setAgreementLoading] = useState(false);
  const [agreementError, setAgreementError] = useState<string | null>(null);
  const [agreementReloadNonce, setAgreementReloadNonce] = useState(0);
  const [agreementIntent, setAgreementIntent] = useState<"review" | "booking">(
    "review",
  );
  const [publicReviews, setPublicReviews] = useState<PublicCarReview[]>([]);
  const [carRating, setCarRating] = useState<RatingSummary | null>(null);
  const [listerRating, setListerRating] = useState<ListerRating | null>(null);
  const [listerReliability, setListerReliability] = useState<Reliability | null>(
    null,
  );
  const [showInquiry, setShowInquiry] = useState(false);
  const [inquiryMessage, setInquiryMessage] = useState("");
  const [sendingInquiry, setSendingInquiry] = useState(false);
  const legalReturnTo =
    `${location.pathname}${location.search}${location.hash}` || "/browse";

  const fetchCar = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("cars")
      .select(
        `
        *,
        car_models!inner (
          *,
          car_brands!inner (*)
        ),
        car_images (*),
        profiles!cars_owner_id_fkey (full_name, phone, email, deleted_at)
      `,
      )
      .eq("id", id)
      .single();

    if (
      !error &&
      data &&
      !(data as unknown as { profiles?: { deleted_at?: string | null } }).profiles
        ?.deleted_at
    ) {
      const carRow = data as unknown as CarWithDetails;
      setCar(carRow);
      // Fetch active bookings to block dates
      const { data: bookings } = await supabase
        .from("bookings")
        .select("start_date, end_date")
        .eq("car_id", id)
        .in("status", [
          "pending",
          "confirmed",
          "awaiting_payment",
          "downpayment_paid",
          "fully_paid",
          "active",
        ]);

      if (bookings) {
        setBookedDates(
          bookings.map((b) => ({ start: b.start_date, end: b.end_date })),
        );
      }

      // Owner maintenance / personal-use blackouts (date ranges only, no reason).
      const { data: blackouts, error: blackoutError } = await supabase.rpc(
        "get_car_blackout_ranges",
        { p_car_id: id },
      );
      if (blackoutError) {
        console.warn("Unable to load vehicle blackouts:", blackoutError.message);
      } else if (blackouts) {
        setBlackoutDates(
          blackouts.map((b) => ({
            start: b.start_date,
            end: b.end_date,
            category: b.category,
          })),
        );
      }

      const [reviews, carRatingMap, listerRatingMap, reliability] =
        await Promise.all([
          fetchPublicCarReviews(id),
          fetchCarRatingSummaries(),
          fetchListerRatingSummaries(),
          carRow.owner_id
            ? fetchListerReliability(carRow.owner_id)
            : Promise.resolve(null),
        ]);
      setPublicReviews(reviews);
      setCarRating(carRatingMap[id] ?? null);
      setListerRating(
        carRow.owner_id ? listerRatingMap[carRow.owner_id] ?? null : null,
      );
      setListerReliability(reliability);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchCar();
  }, [fetchCar]);

  useEffect(() => {
    void (async () => {
      const settings = await fetchPlatformPricingSettings();
      setCommissionRate(settings.commissionRate);
      setProcessingFeeRate(settings.processingFeeRate);
      setProcessingFixedCentavos(settings.processingFixedCentavos);
      setDownpaymentRate(settings.downpaymentRate);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadApprovedAgreement = async () => {
      setAcceptedAgreement(false);
      setAgreementAccess(null);
      setAgreementError(null);
      setPdfViewed(false);

      if (!id || !user || profile?.verified_status !== "verified") return;

      setAgreementLoading(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error("Please sign in again to review the rental agreement.");
        }

        const response = await fetch(
          `/api/get-approved-rental-agreement?carId=${encodeURIComponent(id)}`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
            cache: "no-store",
          },
        );
        const result = (await response.json().catch(() => null)) as
          | (Partial<AgreementAccess> & { error?: string })
          | null;
        if (!response.ok || !result?.agreementVersionId || !result.url) {
          throw new Error(result?.error || "The approved rental agreement is unavailable.");
        }

        if (!cancelled) setAgreementAccess(result as AgreementAccess);
      } catch (error) {
        if (!cancelled) {
          setAgreementError(
            error instanceof Error
              ? error.message
              : "The approved rental agreement is unavailable.",
          );
        }
      } finally {
        if (!cancelled) setAgreementLoading(false);
      }
    };

    void loadApprovedAgreement();
    return () => {
      cancelled = true;
    };
  }, [agreementReloadNonce, id, profile?.verified_status, user]);

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage
      .from("vehicle-documents")
      .getPublicUrl(path);
    return data.publicUrl;
  };

  const images = car?.car_images || [];
  const currentImage = images[currentImageIndex];

  // Driver's-licence gate (mirrors api/create-booking.ts): only explicit values
  // block. Shown as a booking-disabled reason with a link to the update flow.
  const licenceExpired = isLicenseExpired(profile?.license_expiry);
  const transmissionBlocked =
    profile?.license_transmission === "automatic_only" &&
    car?.transmission === "manual";
  const licenceGateReason = licenceExpired
    ? "Your driver's licence has expired. Submit an updated licence from Account & Identity."
    : transmissionBlocked
      ? "This vehicle is manual and your driver's licence is automatic-only. Submit an updated licence if this changed."
      : null;

  const handleBooking = async (agreementOverride = false) => {
    if (!user || !car || !profile) return;

    if (profile.verified_status !== "verified") {
      toast.error("Verification required", {
        description: "Complete identity verification before booking.",
      });
      navigate("/verify");
      return;
    }

    if (car.owner_id === user.id) {
      toast.error("You can't book your own car");
      return;
    }

    if (licenceGateReason) {
      toast.error("Driver's licence check", { description: licenceGateReason });
      navigate("/verify");
      return;
    }

    if (!dateRange?.from || !dateRange?.to) {
      toast.error("Please select both start and end dates");
      return;
    }

    const start = dateRange.from;
    const end = dateRange.to;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const minAllowedStart = addDays(today, 1); // earliest trip start is tomorrow

    if (start < minAllowedStart) {
      toast.error("The earliest a trip can start is tomorrow", {
        description:
          "The owner still has 24 hours to accept and you have 24 hours to pay, but both must finish before the pickup time or the request auto-cancels.",
      });
      return;
    }

    if (end <= start) {
      toast.error("End date must be after start date");
      return;
    }
    
    if (!pickupTime || !dropoffTime) {
      toast.error("Please specify both pickup and drop-off times.");
      return;
    }

    const pickupDateTime = combineDateAndTime(start, pickupTime);
    const dropoffDateTime = combineDateAndTime(end, dropoffTime);

    if (!pickupDateTime || !dropoffDateTime || dropoffDateTime <= pickupDateTime) {
      toast.error("Drop-off must be after pickup", {
        description: "Please choose a return time that happens after the pickup time.",
      });
      return;
    }

    if (isOverlapping) {
      toast.error("Selected dates overlap an existing booking or an owner-blocked period.");
      return;
    }

    if (!acceptedAgreement && !agreementOverride) {
      setAgreementIntent("booking");
      setShowAgreement(true);
      return;
    }

    if (!agreementAccess) {
      toast.error("Rental agreement unavailable", {
        description: agreementError || "Wait for the approved agreement to load, then try again.",
      });
      return;
    }

    const requestedDays = differenceInDays(end, start);
    const pricePerDay = Number(car.price_per_day);
    const basePrice = pricePerDay * requestedDays;
    const commission = calculateCommissionAmount(basePrice, commissionRate);
    const subtotal = basePrice + commission;
    const processingFee = calculateProcessingFee(subtotal, processingFeeRate, processingFixedCentavos);
    const totalPrice = subtotal + processingFee;

    if (totalPrice > MAX_BOOKING_TOTAL) {
      toast.error("Booking total exceeds online payment limit", {
        description: `Please choose fewer days. SafeDrive can only process bookings up to PHP ${MAX_BOOKING_TOTAL.toLocaleString()}.`,
      });
      return;
    }

    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again before sending a booking request.");
      }

      const response = await fetch("/api/create-booking", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          carId: car.id,
          startDate: format(start, "yyyy-MM-dd"),
          endDate: format(end, "yyyy-MM-dd"),
          pickupTime,
          dropoffTime,
          agreementAccepted: agreementOverride || acceptedAgreement,
          agreementVersionId: agreementAccess.agreementVersionId,
        }),
      });

      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(result?.error || "Booking failed. Please try again.");
      }

      toast.success("Booking request sent!", {
        description: "Waiting for owner approval.",
      });
      navigate("/my-bookings");
    } catch (error) {
      toast.error("Booking failed", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAgreementAccept = () => {
    if (!agreementAccess) {
      toast.error("Rental agreement unavailable", {
        description: agreementError || "The lister's approved agreement must be available before you can accept it.",
      });
      return;
    }
    if (!pdfViewed) {
      toast.error("Open the rental agreement PDF first", {
        description: "Each lister sets their own conditions - review the PDF before accepting.",
      });
      return;
    }
    setAcceptedAgreement(true);
    setShowAgreement(false);
    if (agreementIntent === "booking") {
      void handleBooking(true);
    }
  };

  const handleAgreementDecline = () => {
    setShowAgreement(false);
    toast.error("Agreement required", {
      description:
        "Booking cannot continue unless you accept the rental agreement, platform agreement, terms, and privacy notice.",
    });
  };

  const handleSendInquiry = async () => {
    if (!user || !car || sendingInquiry) return;

    const trimmedMessage = inquiryMessage.trim();
    if (!trimmedMessage) {
      toast.error("Write your question first");
      return;
    }

    if (car.owner_id === user.id) {
      toast.error("You cannot inquire about your own listing");
      return;
    }

    setSendingInquiry(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const response = await fetch("/api/create-car-inquiry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ carId: car.id, message: trimmedMessage }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to open inquiry thread.");
      }

      toast.success("Inquiry sent", {
        description: "The lister can reply from Support.",
      });
      setInquiryMessage("");
      setShowInquiry(false);
    } catch (error) {
      toast.error("Failed to send inquiry", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSendingInquiry(false);
    }
  };

  // Price calculations for preview
  const isDateOverlapping = (start: Date, end: Date) => {
    if (!start || !end) return false;
    const s = new Date(start);
    const e = new Date(end);
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    const rangeHits = (ranges: { start: string; end: string }[]) =>
      ranges.some((range) => {
        const rStart = new Date(range.start);
        const rEnd = new Date(range.end);
        rStart.setHours(0, 0, 0, 0);
        rEnd.setHours(0, 0, 0, 0);
        return s <= rEnd && e >= rStart; // Standard overlap formula
      });
    return rangeHits(bookedDates) || rangeHits(blackoutDates);
  };

  const totalDays =
    dateRange?.from && dateRange?.to
      ? Math.max(differenceInDays(dateRange.to, dateRange.from), 0)
      : 0;
  const pickupDateTime = combineDateAndTime(dateRange?.from, pickupTime);
  const dropoffDateTime = combineDateAndTime(dateRange?.to, dropoffTime);
  const actualDurationMinutes =
    pickupDateTime && dropoffDateTime
      ? Math.max(0, Math.round((dropoffDateTime.getTime() - pickupDateTime.getTime()) / 60000))
      : 0;
  const sameOrEarlierDropoff =
    Boolean(pickupDateTime && dropoffDateTime) && dropoffDateTime!.getTime() <= pickupDateTime!.getTime();
  const showDailyPricingClarifier =
    totalDays === 1 && actualDurationMinutes > 0 && actualDurationMinutes < 24 * 60;
  const pricePerDay = car ? Number(car.price_per_day) : 0;
  const isOwnListing = Boolean(user && car && car.owner_id === user.id);
  const basePrice = pricePerDay * totalDays;
  const commissionAmount = calculateCommissionAmount(basePrice, commissionRate);
  const processingFee = calculateProcessingFee(basePrice + commissionAmount, processingFeeRate, processingFixedCentavos);
  const totalPrice = basePrice + commissionAmount + processingFee;
  const exceedsPaymentLimit = totalPrice > MAX_BOOKING_TOTAL;
  const isOverlapping =
    dateRange?.from && dateRange?.to
      ? isDateOverlapping(dateRange.from, dateRange.to)
      : false;
  const bookingDisabledReason = licenceGateReason
    ? licenceGateReason
    : !dateRange?.from || !dateRange?.to
    ? "Select both pickup and return dates first."
    : totalDays <= 0
      ? "Choose a valid rental duration."
        : isOverlapping
        ? "Those dates are booked or blocked by the owner. Pick another schedule."
        : exceedsPaymentLimit
          ? `Online checkout is limited to bookings worth ${MAX_BOOKING_TOTAL.toLocaleString()} pesos or less.`
          : !pickupTime || !dropoffTime
            ? "Choose both pickup and drop-off times before sending the request."
            : sameOrEarlierDropoff
              ? "Drop-off time must be later than the pickup time."
              : agreementLoading
                ? "Loading the approved rental agreement."
                : !agreementAccess
                  ? agreementError || "This listing needs an approved rental agreement before it can accept bookings."
            : null;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
        <Skeleton className="h-8 w-48" />
        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <Skeleton className="h-80 w-full rounded-xl" />
          </div>
          <div className="lg:col-span-2">
            <Skeleton className="h-80 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!car) {
    return (
      <div className="text-center py-20">
        <CarFront className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold">Car not found</h3>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/browse")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Browse
        </Button>
      </div>
    );
  }

  const minDate = addDays(new Date(), 1);
  const maxDate = addDays(new Date(), 30);

  const agreementUrl = agreementAccess?.url ?? null;

  // Trip reviews drive the star score; a lister-cancellation review is shown in
  // the list (badged) but never moves the numeric rating.
  const tripReviews = publicReviews.filter(
    (review) => !review.is_cancellation_review,
  );
  const reviewCount = carRating?.count ?? tripReviews.length;
  const averageReviewRating =
    carRating?.average ??
    (tripReviews.length > 0
      ? tripReviews.reduce((total, review) => total + Number(review.rating), 0) /
        tripReviews.length
      : 0);
  const ratingBuckets = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: tripReviews.filter((review) => review.rating === stars).length,
  }));

  const bookedDayRanges = bookedDates.map((b) => ({
    from: new Date(b.start),
    to: new Date(b.end),
  }));
  const blackoutDayRanges = blackoutDates.map((b) => ({
    from: new Date(b.start),
    to: new Date(b.end),
  }));
  const availabilityWindow = {
    before: minDate,
    after: maxDate,
  };
  const disabledDays = [
    availabilityWindow, // Keep requests between tomorrow and 30 days out
    ...bookedDayRanges,
    ...blackoutDayRanges,
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/browse")}
        className="gap-2 -ml-2"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Browse
      </Button>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Left: Images & Details */}
        <div className="lg:col-span-3 space-y-5">
          {/* Image Gallery */}
          <div className="relative rounded-xl overflow-hidden bg-muted aspect-[16/10]">
            {currentImage ? (
              <img
                src={getImageUrl(currentImage.storage_path)}
                alt="Car"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <CarFront className="w-24 h-24 text-muted-foreground/15" />
              </div>
            )}
            {images.length > 1 && (
              <>
                <button
                  onClick={() =>
                    setCurrentImageIndex(
                      (i) => (i - 1 + images.length) % images.length,
                    )
                  }
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors shadow"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() =>
                    setCurrentImageIndex((i) => (i + 1) % images.length)
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors shadow"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentImageIndex(i)}
                      className={`w-2 h-2 rounded-full transition-all ${
                        i === currentImageIndex ? "bg-white w-5" : "bg-white/50"
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Car Info */}
          <div>
            <h1 className="text-2xl font-bold">
              {car.car_models.car_brands.name} {car.car_models.name}
            </h1>

            {/* Owner Info Card */}
            <div className="mt-3 p-4 rounded-xl border border-border/60 bg-muted/30 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Listed by</p>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                  {(car.profiles?.full_name || "O").charAt(0).toUpperCase()}
                </div>
                <div className="space-y-0.5">
                  <p className="font-semibold text-foreground text-sm">
                    {car.profiles?.full_name || "Owner"}
                  </p>
                  {listerRating && listerRating.count > 0 ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      <span className="font-medium text-foreground">
                        {formatAverage(listerRating.average)}
                      </span>
                      · {listerRating.tripCount}{" "}
                      {listerRating.tripCount === 1 ? "trip" : "trips"} hosted
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">New lister</p>
                  )}
                  {listerReliability?.hasEnoughHistory &&
                    listerReliability.cancellationRate !== null && (
                      <p
                        className={`text-xs ${
                          listerReliability.cancellationRate >= 15
                            ? "font-medium text-red-500"
                            : "text-muted-foreground"
                        }`}
                      >
                        {100 - listerReliability.cancellationRate}% completion
                        rate
                        {listerReliability.cancellationRate >= 15
                          ? ` · ${listerReliability.cancellations} recent cancellation${
                              listerReliability.cancellations === 1 ? "" : "s"
                            }`
                          : ""}
                      </p>
                    )}
                  {(car.contact_number || car.profiles?.phone) && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      📞 <span className="text-foreground font-medium">{car.contact_number || car.profiles?.phone}</span>
                    </p>
                  )}
                  {car.profiles?.email && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      ✉️ <span className="text-foreground font-medium">{car.profiles.email}</span>
                    </p>
                  )}
                  {!car.contact_number && !car.profiles?.phone && !car.profiles?.email && (
                    <p className="text-xs text-muted-foreground italic">Contact info will be shared upon booking confirmation.</p>
                  )}
                </div>
              </div>
              {user && car.owner_id !== user.id && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-2"
                  onClick={() => setShowInquiry(true)}
                >
                  <MessageSquare className="h-4 w-4" />
                  Ask lister
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                icon: CarFront,
                label: "Type",
                value: car.car_models.body_type,
              },
              {
                icon: Users,
                label: "Seats",
                value: `${car.car_models.seats} seats`,
              },
              { icon: Fuel, label: "Fuel", value: car.car_models.fuel_type },
              {
                icon: Settings,
                label: "Transmission",
                value: carTransmissionLabel(car.transmission),
              },
              {
                icon: Gauge,
                label: "Mileage",
                value: car.mileage
                  ? `${car.mileage.toLocaleString()} km`
                  : "N/A",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="p-3 rounded-lg bg-muted/50 border border-border/50"
              >
                <item.icon className="w-4 h-4 text-muted-foreground mb-1" />
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-medium capitalize">{item.value}</p>
              </div>
            ))}
          </div>

          {car.location && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4" />
              Pickup/Dropoff: {car.location}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4" />
            GPS option:{" "}
            <span className="font-medium text-foreground">
              {car.gps_available ? "Available in this vehicle" : "Not included"}
            </span>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
            <h3 className="font-semibold">Reviews from renters</h3>
            <p className="text-xs text-muted-foreground">
              Feedback from completed SafeDrive bookings for this vehicle.
            </p>

            {reviewCount === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No renter reviews yet. A review appears here once both the renter
                and the lister have rated the trip, or 14 days after it ends.
              </p>
            ) : (
              <>
                <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex flex-col items-center sm:w-32">
                    <span className="text-4xl font-bold text-foreground">
                      {formatAverage(averageReviewRating)}
                    </span>
                    <div className="mt-1 flex items-center gap-0.5 text-amber-500">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Star
                          key={index}
                          className={`h-3.5 w-3.5 ${
                            index < Math.round(averageReviewRating) ? "fill-current" : ""
                          }`}
                        />
                      ))}
                    </div>
                    <span className="mt-1 text-xs text-muted-foreground">
                      {reviewCount} {reviewCount === 1 ? "review" : "reviews"}
                    </span>
                  </div>
                  <div className="flex-1 space-y-1">
                    {ratingBuckets.map((bucket) => {
                      const shown = tripReviews.length || 1;
                      return (
                        <div key={bucket.stars} className="flex items-center gap-2 text-xs">
                          <span className="w-3 text-muted-foreground">{bucket.stars}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-amber-400"
                              style={{ width: `${(bucket.count / shown) * 100}%` }}
                            />
                          </div>
                          <span className="w-6 text-right text-muted-foreground">
                            {bucket.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {publicReviews.slice(0, 6).map((review) => (
                    <div
                      key={review.id}
                      className="rounded-lg border border-border/50 bg-background/70 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-xs font-bold text-primary">
                            {review.reviewer_avatar ? (
                              <img
                                src={review.reviewer_avatar}
                                alt={review.reviewer_name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              review.reviewer_name.charAt(0).toUpperCase()
                            )}
                          </div>
                          <span className="text-sm font-medium text-foreground">
                            {review.reviewer_name}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {review.created_at
                            ? format(new Date(review.created_at), "MMM d, yyyy")
                            : "Recently"}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-0.5 text-amber-500">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <Star
                            key={index}
                            className={`h-3 w-3 ${index < review.rating ? "fill-current" : ""}`}
                          />
                        ))}
                      </div>
                      {review.is_cancellation_review && (
                        <p className="mt-1.5 inline-flex rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-500">
                          The lister cancelled this booking
                        </p>
                      )}
                      {review.feedback?.trim() && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {review.feedback.trim()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {car.additional_info && (
            <div>
              <h3 className="font-semibold mb-1">Additional Info</h3>
              <p className="text-sm text-muted-foreground">
                {car.additional_info}
              </p>
            </div>
          )}
        </div>

        {/* Right: Booking Card */}
        <div className="lg:col-span-2">
          {isOwnListing ? (
            <Card className="sticky top-24 shadow-lg border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CarFront className="h-5 w-5 text-primary" />
                  Your listing
                </CardTitle>
                <CardDescription>
                  This is the page renters see. You cannot book your own car.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(() => {
                  const statusLabel: Record<string, { label: string; tone: string }> = {
                    approved: { label: "Live on the marketplace", tone: "text-green-600 dark:text-green-400" },
                    active: { label: "Live on the marketplace", tone: "text-green-600 dark:text-green-400" },
                    inactive: { label: "Paused - hidden from browse", tone: "text-muted-foreground" },
                    pending: { label: "Pending admin review", tone: "text-amber-600 dark:text-amber-400" },
                    rejected: { label: "Rejected - see My Vehicles for the reason", tone: "text-red-600 dark:text-red-400" },
                    renewal_required: { label: "Renewal required - submit updated documents", tone: "text-amber-600 dark:text-amber-400" },
                  };
                  const info = statusLabel[car.status] ?? { label: car.status, tone: "text-muted-foreground" };
                  return (
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Status
                      </p>
                      <p className={`mt-1 text-sm font-medium ${info.tone}`}>{info.label}</p>
                    </div>
                  );
                })()}
                <p className="text-sm text-muted-foreground">
                  Renters see your price, photos, reviews, and the rental agreement
                  exactly as shown on this page.
                </p>
                <Button className="w-full h-11" onClick={() => navigate("/my-vehicles")}>
                  <CarFront className="mr-2 h-4 w-4" />
                  Manage this listing
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-11"
                  onClick={() => navigate("/vehicle-availability")}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  View bookings &amp; availability
                </Button>
              </CardContent>
            </Card>
          ) : (
          <Card className="sticky top-24 shadow-lg border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Book this car</span>
                <span className="text-primary">
                  ₱{pricePerDay.toLocaleString()}
                  <span className="text-sm text-muted-foreground font-normal">
                    /day
                  </span>
                </span>
              </CardTitle>
              <CardDescription className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                Verified owner · Insured rental
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Availability guide
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 text-xs">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 h-3 w-3 rounded-sm bg-red-500/20 ring-1 ring-red-500/30" />
                      <div>
                        <p className="font-medium text-red-500">Red dates</p>
                        <p className="text-muted-foreground">Already booked or conflicting with another reservation.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 h-3 w-3 rounded-sm bg-amber-500/20 ring-1 ring-amber-500/30" />
                      <div>
                        <p className="font-medium text-amber-600 dark:text-amber-400">Amber dates</p>
                        <p className="text-muted-foreground">Owner marked the car unavailable (maintenance or personal use).</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 h-3 w-3 rounded-sm bg-muted ring-1 ring-border" />
                      <div>
                        <p className="font-medium text-foreground">Gray dates</p>
                        <p className="text-muted-foreground">Outside the allowed booking window.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 h-3 w-3 rounded-sm bg-primary/20 ring-1 ring-primary/30" />
                      <div>
                        <p className="font-medium text-primary">Selectable dates</p>
                        <p className="text-muted-foreground">Trips can start as early as tomorrow and up to 30 days out.</p>
                      </div>
                    </div>
                  </div>
                </div>

              <div
                className="booking-calendar flex justify-center overflow-x-auto overflow-y-hidden rounded-xl border border-border/60 bg-card/70 p-3 shadow-sm"
                style={{ minHeight: "350px" }}
              >
                <DayPicker
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  disabled={disabledDays}
                  min={1}
                  modifiers={{
                    booked: bookedDayRanges,
                    blackout: blackoutDayRanges,
                    unavailableWindow: availabilityWindow,
                  }}
                  modifiersStyles={{
                    booked: {
                      backgroundColor: "rgb(239 68 68 / 0.15)",
                      color: "rgb(239 68 68)",
                      textDecoration: "line-through",
                    },
                    blackout: {
                      backgroundColor: "rgb(245 158 11 / 0.15)",
                      color: "rgb(217 119 6)",
                      textDecoration: "line-through",
                    },
                    unavailableWindow: {
                      backgroundColor: "rgb(100 116 139 / 0.12)",
                      color: "rgb(100 116 139)",
                    },
                  }}
                  className="font-sans"
                  styles={{
                    caption: { color: "inherit" },
                    day: { borderRadius: "8px" },
                  }}
                />
              </div>

              {totalDays > 0 && (
                <div className="p-4 rounded-lg bg-muted/50 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      ₱{pricePerDay.toLocaleString()} × {formatDayCount(totalDays)}
                      {totalDays > 1 ? "s" : ""}
                    </span>
                    <span>₱{basePrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Service fee ({formatCommissionPercent(commissionRate)})
                    </span>
                    <span>₱{commissionAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment processing fee</span>
                    <span>₱{processingFee.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-border pt-2 mt-2">
                    <span>Total</span>
                    <span>₱{totalPrice.toLocaleString()}</span>
                  </div>
                  {Number(car.security_deposit_amount) > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Owner-set security deposit</span>
                      <span>₱{Number(car.security_deposit_amount).toLocaleString()}</span>
                    </div>
                  )}
                  {downpaymentRate < 1 ? (
                    <>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          Reservation downpayment ({Math.round(downpaymentRate * 100)}%)
                        </span>
                        <span>₱{Math.ceil(totalPrice * downpaymentRate).toLocaleString()}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        The {Math.round(downpaymentRate * 100)}% downpayment reserves the booking and is part of the rental price. It is not the security deposit.
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      This booking must be paid in full to reserve it.
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    The renter pays this separately disclosed processing fee. It is never deducted from the lister's base rental.
                  </p>
                  {Number(car.security_deposit_amount) > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      The security deposit is a separate owner requirement for possible damage, missing fuel, or return issues. It is shown separately from the PayMongo booking total.
                    </p>
                  )}
                  {showDailyPricingClarifier && (
                    <p className="text-[11px] text-muted-foreground">
                      Actual rental window: about {actualDurationMinutes} minute
                      {actualDurationMinutes === 1 ? "" : "s"}. SafeDrive currently bills by
                      calendar day, so a next-day return is still charged as a 1-day booking.
                    </p>
                  )}
                </div>
              )}

                {isOverlapping && (
                  <p className="text-sm font-semibold text-red-500 bg-red-500/10 p-2 rounded text-center">
                    Dates unavailable. They overlap an existing booking or a period the owner blocked off.
                  </p>
                )}
                {!isOverlapping && dateRange?.from && !dateRange?.to && (
                  <p className="text-sm text-muted-foreground bg-muted/40 p-2 rounded text-center">
                    Pick a return date next. Only dates from tomorrow through 30 days out can be selected.
                  </p>
                )}
                {exceedsPaymentLimit && (
                  <p className="text-sm font-semibold text-red-500 bg-red-500/10 p-2 rounded text-center">
                    Booking total must be PHP {MAX_BOOKING_TOTAL.toLocaleString()} or below.
                  </p>
                )}
              
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Pickup Time
                  </label>
                  <input
                    type="time"
                    value={pickupTime}
                    onChange={(e) => setPickupTime(e.target.value)}
                    className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Drop-off Time
                  </label>
                  <input
                    type="time"
                    value={dropoffTime}
                    onChange={(e) => setDropoffTime(e.target.value)}
                    className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>

              {profile?.role !== "lister" && (
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">
                        {agreementLoading
                          ? "Loading approved rental agreement"
                          : acceptedAgreement
                          ? "Rental agreement accepted"
                          : agreementAccess
                            ? `Rental agreement v${agreementAccess.versionNumber} review required`
                            : "Rental agreement unavailable"}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {agreementError || "Review the lister's approved terms before sending a booking request."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!agreementAccess) {
                          setAgreementReloadNonce((current) => current + 1);
                          return;
                        }
                        setAgreementIntent("review");
                        setShowAgreement(true);
                      }}
                      disabled={agreementLoading}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                    >
                      {agreementLoading
                        ? "Loading..."
                        : acceptedAgreement
                          ? "Review again"
                          : agreementAccess
                            ? "Open agreement"
                            : "Retry loading"}
                    </button>
                  </div>
                </div>
              )}

              {profile && profile.verified_status !== "verified" && profile?.role !== "lister" && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm">
                  <p className="font-medium text-amber-700 dark:text-amber-300">
                    Verification required before booking
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    You can browse this listing now, but booking is locked until your identity is verified.
                  </p>
                </div>
              )}

              {profile?.role === "lister" ? (
                <Button
                  disabled
                  className="w-full h-11 bg-muted text-muted-foreground"
                >
                  Listers Cannot Book Cars
                </Button>
              ) : profile && profile.verified_status !== "verified" ? (
                <Button
                  onClick={() => navigate("/verify")}
                  className="w-full h-11 shadow-lg shadow-primary/20 text-base"
                >
                  Verify to Book
                </Button>
              ) : !acceptedAgreement ? (
                <Button
                  onClick={() => {
                    setAgreementIntent("booking");
                    setShowAgreement(true);
                  }}
                  disabled={
                    submitting ||
                    agreementLoading ||
                    !agreementAccess ||
                    !dateRange?.from ||
                    !dateRange?.to ||
                    totalDays <= 0 ||
                    isOverlapping ||
                    exceedsPaymentLimit ||
                    !pickupTime ||
                    !dropoffTime ||
                    sameOrEarlierDropoff
                  }
                  className="w-full h-11 shadow-lg shadow-primary/20 text-base"
                  title={bookingDisabledReason ?? "Review the rental agreement to continue"}
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Review Agreement to Book
                </Button>
              ) : (
                <Button
                  onClick={() => void handleBooking()}
                  disabled={
                    submitting ||
                    agreementLoading ||
                    !agreementAccess ||
                    Boolean(licenceGateReason) ||
                    !dateRange?.from ||
                    !dateRange?.to ||
                    totalDays <= 0 ||
                    isOverlapping ||
                    exceedsPaymentLimit ||
                    !pickupTime ||
                    !dropoffTime ||
                    sameOrEarlierDropoff
                  }
                  className="w-full h-11 shadow-lg shadow-primary/20 text-base"
                  title={bookingDisabledReason ?? "Send your booking request to the lister"}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending Request...
                    </>
                  ) : (
                    <>
                      <Calendar className="w-4 h-4 mr-2" />
                      Request to Book
                    </>
                  )}
                </Button>
              )}

              {profile?.role !== "lister" && (
                <div className="space-y-2">
                  {bookingDisabledReason && profile?.verified_status === "verified" && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-left text-xs text-muted-foreground">
                      <p className="font-medium text-amber-700 dark:text-amber-300">
                        Request to Book help
                      </p>
                      <p className="mt-1">{bookingDisabledReason}</p>
                    </div>
                  )}
                  <p className="text-xs text-center text-muted-foreground">
                    You won't be charged until the owner accepts your request.
                  </p>
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-left text-xs text-muted-foreground">
                    <p className="font-medium text-blue-600 dark:text-blue-400">
                      How the request works
                    </p>
                    <p className="mt-1">
                      A trip can start as early as tomorrow if the car is free. After you send the request the lister has 24 hours to accept and you then have 24 hours to pay - but both steps are capped at the pickup time. If the request is not accepted and paid before pickup, it is automatically cancelled and the car is released.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          )}
        </div>
      </div>

      {showAgreement &&
        createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto p-4 py-6 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowAgreement(false)}
        >
          <div
            className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border/70 bg-card p-6 text-card-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold">Standard Rental Agreement</h2>
            {agreementAccess && (
              <p className="mb-3 text-xs text-muted-foreground">
                Approved lister agreement version {agreementAccess.versionNumber}
              </p>
            )}
            <div className="space-y-3 pb-4 text-sm leading-7 text-foreground/85">
              <p>
                <strong>1. Driver Responsibilities:</strong> Renter affirms that
                they hold a valid Philippine driver's license and are at least
                18 years of age. Renter exclusively operates the vehicle.
              </p>
              <p>
                <strong>2. Condition & Return:</strong> The vehicle must be
                returned with identical fuel levels and no supplementary
                exterior or interior damage. Unreported damages incur severe
                legal penalties.
              </p>
              <p>
                <strong>3. Payment:</strong> Once the owner accepts the booking,
                the renter may either settle the required reservation
                downpayment or pay the full booking amount immediately through
                the platform. Any remaining balance must be completed before the
                rental starts.
              </p>
              <p>
                <strong>4. Insurance & Liability:</strong> Any accidents,
                impoundments, or traffic violations processed during the booking
                period (the booked dates) transfer direct financial and legal
                liability to the acting Renter.
              </p>
            </div>

            {agreementUrl && (
              <div className="mb-4 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold text-sm">
                    Owner's Official Rental Document
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Please review the specific conditions set by this lister.
                  </p>
                </div>
                <a
                  href={agreementUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setPdfViewed(true)}
                >
                  <Button size="sm" variant="outline" className="gap-2 border-border/70 bg-background/60 hover:bg-muted">
                    <Eye className="w-4 h-4" /> View PDF
                  </Button>
                </a>
              </div>
            )}
            {agreementUrl && !pdfViewed && (
              <p className="mb-4 -mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                Open and review the lister's PDF above - it sets this vehicle's
                specific conditions and differs from the summary below.
              </p>
            )}

            {!agreementUrl && (
              <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
                {agreementLoading
                  ? "Loading the lister's approved rental agreement..."
                  : agreementError ||
                    "The lister's approved rental agreement is unavailable. Booking cannot continue until it is restored and approved."}
              </div>
            )}

            <nav
              aria-label="Rental policies"
              className="flex min-w-0 gap-1 overflow-x-auto rounded-lg border border-border/70 bg-background/40 p-1"
            >
              <Link
                to="/privacy-policy"
                state={{ returnTo: legalReturnTo }}
                className="min-w-max flex-1"
              >
                <Button variant="ghost" className="w-full whitespace-nowrap text-blue-600 hover:bg-muted dark:text-blue-400" type="button">
                  Privacy Policy
                </Button>
              </Link>
              <Link
                to="/terms"
                state={{ returnTo: legalReturnTo }}
                className="min-w-max flex-1"
              >
                <Button variant="ghost" className="w-full whitespace-nowrap text-blue-600 hover:bg-muted dark:text-blue-400" type="button">
                  Terms and Conditions
                </Button>
              </Link>
              <Link
                to="/platform-agreement"
                state={{ returnTo: legalReturnTo }}
                className="min-w-max flex-1"
              >
                <Button variant="ghost" className="w-full whitespace-nowrap text-blue-600 hover:bg-muted dark:text-blue-400" type="button">
                  Platform Agreement
                </Button>
              </Link>
            </nav>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                className="h-11"
                onClick={handleAgreementDecline}
              >
                I Do Not Agree
              </Button>
              <Button
                className="h-11 shadow-lg shadow-primary/20"
                onClick={handleAgreementAccept}
                disabled={!agreementAccess || agreementLoading || !pdfViewed}
                title={!pdfViewed ? "Open the lister's PDF first" : undefined}
              >
                Yes, I Agree and Continue
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showInquiry &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!sendingInquiry) setShowInquiry(false);
            }}
          >
            <div
              className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Ask the lister</h2>
                <p className="text-sm text-muted-foreground">
                  Send a question about this car before booking. The lister can reply in Support.
                </p>
              </div>

              <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  {car.car_models.car_brands.name} {car.car_models.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  Plate: {car.plate_number}
                </p>
              </div>

              <label className="mt-4 block space-y-1.5 text-sm">
                <span className="font-medium">Question</span>
                <textarea
                  value={inquiryMessage}
                  onChange={(event) => setInquiryMessage(event.target.value)}
                  rows={5}
                  placeholder="Example: Is pickup possible near the mall entrance? Is there a child seat available?"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={sendingInquiry}
                  onClick={() => setShowInquiry(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={sendingInquiry || !inquiryMessage.trim()}
                  onClick={() => void handleSendInquiry()}
                  className="gap-2"
                >
                  {sendingInquiry ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MessageSquare className="h-4 w-4" />
                  )}
                  Send Inquiry
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

