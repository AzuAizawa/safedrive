import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { ArrowRight, CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type VerificationState = "checking" | "confirmed" | "delayed";
type BookingPaymentStage =
  | "downpayment"
  | "full"
  | "balance"
  | "extension"
  | "security_deposit";

const PAYMENT_CONFIRMATION_POLL_MS = 2500;
const MAX_PAYMENT_CONFIRMATION_ATTEMPTS = 12;

const downpaymentConfirmedStatuses = new Set([
  "downpayment_paid",
  "fully_paid",
  "active",
  "completed",
]);

const fullyPaidStatuses = new Set(["fully_paid", "active", "completed"]);

const normalizePaymentStage = (stage: string | null): BookingPaymentStage => {
  if (
    stage === "full" ||
    stage === "balance" ||
    stage === "extension" ||
    stage === "security_deposit"
  ) {
    return stage;
  }
  return "downpayment";
};

const checkBookingPaymentConfirmation = async (
  bookingId: string,
  stage: BookingPaymentStage,
  extensionId: string | null,
) => {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) throw bookingError;
  const bookingStatus = booking?.status ?? "";

  if (stage === "full" || stage === "balance") {
    return fullyPaidStatuses.has(bookingStatus);
  }

  if (stage === "extension") {
    if (extensionId) {
      const { data: extension, error: extensionError } = await supabase
        .from("booking_extensions")
        .select("id")
        .eq("id", extensionId)
        .eq("booking_id", bookingId)
        .eq("status", "paid")
        .maybeSingle();

      if (extensionError) throw extensionError;
      return Boolean(extension?.id);
    }

    const { data: extensionPayment, error: extensionPaymentError } =
      await supabase
        .from("payments")
        .select("id")
        .eq("booking_id", bookingId)
        .eq("payment_type", "extension")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (extensionPaymentError) throw extensionPaymentError;
    return Boolean(extensionPayment?.id);
  }

  if (stage === "security_deposit") {
    const { data: deposit, error: depositError } = await supabase
      .from("security_deposits")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("status", "paid")
      .maybeSingle();

    if (depositError) throw depositError;
    return Boolean(deposit?.id);
  }

  return downpaymentConfirmedStatuses.has(bookingStatus);
};

const checkSubscriptionConfirmation = async (planId: string | null) => {
  if (!planId) return false;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) return false;

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", user.id)
    .eq("plan_type", planId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) throw subscriptionError;
  return Boolean(subscription?.id);
};

const getConfirmedMessage = (
  isSubscription: boolean,
  planId: string | null,
  stage: BookingPaymentStage,
) => {
  if (isSubscription) {
    return `Your ${planId || "selected"} subscription payment is confirmed and the plan is active.`;
  }

  if (stage === "full") {
    return "Your full booking payment is confirmed. The trip is now fully paid.";
  }

  if (stage === "extension") {
    return "Your extension payment is confirmed. SafeDrive has updated the booking extension record.";
  }

  if (stage === "security_deposit") {
    return "Your refundable security deposit is confirmed. SafeDrive has updated the deposit record.";
  }

  if (stage === "balance") {
    return "Your remaining balance is confirmed. The booking is now fully paid.";
  }

  return "Your downpayment is confirmed. The booking is now reserved in SafeDrive.";
};

const getDelayedMessage = (
  isSubscription: boolean,
  planId: string | null,
  stage: BookingPaymentStage,
) => {
  if (isSubscription) {
    return `PayMongo sent you back to SafeDrive, but the signed webhook has not activated the ${planId || "selected"} plan yet. Return to subscriptions and refresh in a moment.`;
  }

  if (stage === "full") {
    return "PayMongo sent you back to SafeDrive, but the full-payment webhook is still processing. Return to My Bookings and refresh in a moment.";
  }

  if (stage === "extension") {
    return "PayMongo sent you back to SafeDrive, but the extension payment webhook is still processing. Return to My Bookings and refresh in a moment.";
  }

  if (stage === "security_deposit") {
    return "PayMongo sent you back to SafeDrive, but the security-deposit webhook is still processing. Return to My Bookings and refresh in a moment.";
  }

  if (stage === "balance") {
    return "PayMongo sent you back to SafeDrive, but the balance-payment webhook is still processing. Return to My Bookings and refresh in a moment.";
  }

  return "PayMongo sent you back to SafeDrive, but the downpayment webhook is still processing. Return to My Bookings and refresh in a moment.";
};

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookingId = searchParams.get("booking_id");
  const isSubscription = searchParams.get("subscription") === "1";
  const planId = searchParams.get("plan");
  const paymentStage = searchParams.get("payment");
  const extensionId = searchParams.get("extension_id");
  const bookingPaymentStage = normalizePaymentStage(paymentStage);
  const [verificationState, setVerificationState] =
    useState<VerificationState>("checking");

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    setVerificationState("checking");

    if (!bookingId && !isSubscription) {
      setVerificationState("delayed");
      return;
    }

    const pollForConfirmation = async (attempt = 1) => {
      try {
        const confirmed = isSubscription
          ? await checkSubscriptionConfirmation(planId)
          : bookingId
            ? await checkBookingPaymentConfirmation(
                bookingId,
                bookingPaymentStage,
                extensionId,
              )
            : false;

        if (cancelled) return;

        if (confirmed) {
          setVerificationState("confirmed");
          return;
        }
      } catch (error) {
        console.warn("Payment confirmation polling failed", error);
      }

      if (cancelled) return;

      if (attempt >= MAX_PAYMENT_CONFIRMATION_ATTEMPTS) {
        setVerificationState("delayed");
        return;
      }

      retryTimer = setTimeout(() => {
        void pollForConfirmation(attempt + 1);
      }, PAYMENT_CONFIRMATION_POLL_MS);
    };

    void pollForConfirmation();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [bookingId, bookingPaymentStage, extensionId, isSubscription, planId]);

  const isChecking = verificationState === "checking";
  const isConfirmed = verificationState === "confirmed";
  const resultMessage = isConfirmed
    ? getConfirmedMessage(isSubscription, planId, bookingPaymentStage)
    : getDelayedMessage(isSubscription, planId, bookingPaymentStage);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 animate-fade-in relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,197,94,0.1),transparent_50%)] pointer-events-none" />
      
      <div className="max-w-md w-full bg-card p-6 sm:p-8 rounded-lg border border-border shadow-2xl text-center relative z-10 glass">
        {isChecking ? (
          <div className="space-y-6 flex flex-col items-center">
            <div className="relative">
              <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center animate-pulse">
                <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
              </div>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">Verifying Payment...</h1>
              <p className="text-muted-foreground text-sm">
                Securely confirming your transaction with the provider. Please do not close this window.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-8 flex flex-col items-center animate-scale-in">
            <div className="relative">
              <div
                className={`absolute inset-0 blur-xl opacity-20 rounded-full ${
                  isConfirmed ? "bg-green-500" : "bg-amber-500"
                }`}
              />
              <div
                className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg relative text-white ${
                  isConfirmed
                    ? "bg-gradient-to-br from-green-400 to-green-600"
                    : "bg-gradient-to-br from-amber-400 to-orange-600"
                }`}
              >
                {isConfirmed ? (
                  <CheckCircle2 className="w-12 h-12" />
                ) : (
                  <Clock3 className="w-12 h-12" />
                )}
              </div>
            </div>
            
            <div className="space-y-2">
               <h1 className="text-3xl font-bold tracking-tight">
                 {isConfirmed ? "Payment Confirmed!" : "Payment Still Confirming"}
               </h1>
               <p className="text-muted-foreground text-sm">
                 {resultMessage}
               </p>
            </div>

            <Button 
               onClick={() => navigate(isSubscription ? "/subscriptions" : "/my-bookings")} 
               className={`w-full h-12 mt-4 gap-2 font-bold text-white shadow-lg ${
                 isConfirmed
                   ? "bg-green-600 hover:bg-green-700"
                   : "bg-amber-600 hover:bg-amber-700"
               }`}
            >
               {isSubscription ? "Return to Subscriptions" : "Return to My Bookings"}
               <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
