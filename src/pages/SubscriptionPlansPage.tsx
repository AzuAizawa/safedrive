import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Check, Sparkles, Star, Zap, Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrentSubscription } from "@/lib/subscriptions";
import { toast } from "sonner";

interface Subscription {
  id: string;
  plan_type: string;
  additional_slots: number;
  status: string;
  start_date: string;
  end_date: string | null;
}

const plans = [
  {
    id: "free",
    label: "Free",
    priceLabel: "PHP 0",
    period: "forever",
    tagline: "Start listing with the default vehicle slots.",
    icon: Shield,
    iconColor: "text-muted-foreground",
    cardClass: "border-2 hover:border-primary/30 transition-colors",
    additional_slots: 0,
    features: [
      "List up to 5 vehicles",
    ],
    cta: "Current Plan",
    ctaVariant: "outline" as const,
  },
  {
    id: "pro",
    label: "Pro",
    priceLabel: "PHP 199",
    period: "/ month",
    tagline: "Add more vehicle slots.",
    icon: Zap,
    iconColor: "text-blue-500",
    cardClass: "border-2 hover:border-blue-500/50 transition-colors",
    additional_slots: 5,
    badge: "Popular",
    badgeClass: "bg-blue-500/10 text-blue-500 border-blue-500/30",
    features: [
      "10 total vehicle slots",
      "+5 slots compared with Free",
    ],
    cta: "Choose Pro",
    ctaClass:
      "bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/30",
  },
  {
    id: "premium",
    label: "Premium",
    priceLabel: "PHP 299",
    period: "/ month",
    tagline: "Maximum vehicle slots for current release.",
    icon: Star,
    iconColor: "text-amber-500",
    cardClass: "border-2 border-amber-500/40 shadow-2xl shadow-amber-500/10",
    additional_slots: 10,
    badge: "Best Value",
    badgeClass: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    features: [
      "15 total vehicle slots",
      "+5 slots compared with Pro",
      "+10 slots compared with Free",
    ],
    cta: "Choose Premium",
    ctaClass:
      "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-lg shadow-amber-500/30",
  },
];

export default function SubscriptionPlansPage() {
  const { user, session, profile, loading: authLoading } = useAuth();
  const [currentSub, setCurrentSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const data = await getCurrentSubscription(user.id);
    setCurrentSub(data ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void fetchSubscription();
  }, [fetchSubscription]);

  const currentPlanId = currentSub?.plan_type ?? "free";

  if (authLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card>
          <CardContent className="flex items-center justify-center gap-3 p-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading subscription access...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (profile && !profile.is_lister) {
    const needsVerification = profile.verified_status !== "verified";

    return (
      <div className="container mx-auto max-w-3xl animate-fade-in px-4 py-12">
        <Link to="/my-bookings">
          <Button variant="ghost" size="sm" className="-ml-2 mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to My Bookings
          </Button>
        </Link>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Subscriptions are only available in Lister Mode</CardTitle>
            <CardDescription>
              Renters do not need a listing subscription. SafeDrive only shows plans after the
              account is unlocked for vehicle listing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-blue-600 dark:text-blue-400">How to unlock it</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Complete identity verification.</li>
                <li>Wait for admin approval.</li>
                <li>Switch your account to Lister Mode.</li>
                <li>Open Subscriptions again to upgrade vehicle slots.</li>
              </ol>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => window.location.assign(needsVerification ? "/verify" : "/my-vehicles")}>
                {needsVerification ? "Verify My Account" : "Go to My Vehicles"}
              </Button>
              <Button variant="outline" onClick={() => window.location.assign("/browse")}>
                Browse Cars
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleUpgrade = async (plan: (typeof plans)[number]) => {
    if (!user || plan.id === currentPlanId) return;
    setUpgrading(plan.id);

    try {
      if (plan.id === "free") {
        const response = await fetch("/api/cancel-subscription", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token ?? ""}`,
          },
        });

        const data = (await response.json()) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "Failed to cancel subscription");
        }

        toast.success("Subscription cancelled. Your account is now on Free.");
        await fetchSubscription();
        return;
      }

      const response = await fetch("/api/create-subscription-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          planId: plan.id,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        checkoutUrl?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to create subscription checkout");
      }

      if (!data.checkoutUrl) {
        throw new Error("Checkout URL was not returned by the server");
      }

      window.location.href = data.checkoutUrl;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Upgrade failed", { description: message });
    } finally {
      setUpgrading(null);
    }
  };

  return (
    <div className="container mx-auto max-w-6xl animate-fade-in px-4 py-12">
      <div className="mb-10">
        <Link to="/my-vehicles">
          <Button variant="ghost" size="sm" className="-ml-2 mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Vehicles
          </Button>
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight md:text-5xl">
          Choose Your Plan
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
          Upgrade only the number of vehicle slots available to your lister account.
        </p>
        {!loading && currentSub && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Currently on{" "}
            <span className="font-bold capitalize">{currentSub.plan_type}</span>{" "}
            plan - {5 + currentSub.additional_slots} vehicle slots total
            {currentSub.end_date ? ` until ${currentSub.end_date}` : ""}
          </div>
        )}
      </div>

      <div className="mt-8 grid items-start gap-6 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrentPlan = plan.id === currentPlanId;
          const Icon = plan.icon;
          const buttonLabel =
            plan.id === "free" && currentPlanId !== "free"
              ? "Cancel Subscription"
              : plan.cta;

          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col overflow-visible pt-4 p-2 ${plan.cardClass} ${
                isCurrentPlan ? "ring-2 ring-primary/30" : ""
              }`}
            >
              {!isCurrentPlan && plan.badge && (
                <div className="absolute left-0 right-0 top-[-14px] flex justify-center">
                  <span
                    className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${plan.badgeClass}`}
                  >
                    {plan.badge}
                  </span>
                </div>
              )}
              {isCurrentPlan && (
                <div className="absolute left-0 right-0 top-[-14px] flex justify-center">
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                    Your Plan
                  </span>
                </div>
              )}

              <CardHeader className="mt-2 w-full">
                <div className="mb-1 flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${plan.iconColor}`} />
                  <CardTitle className="text-xl font-bold">{plan.label}</CardTitle>
                </div>
                <CardDescription className="text-sm">
                  {plan.tagline}
                </CardDescription>
              </CardHeader>

              <CardContent className="w-full flex-1">
                <div className="mb-5">
                  <span className="text-4xl font-extrabold">{plan.priceLabel}</span>
                  <span className="ml-1 font-medium text-muted-foreground">
                    {plan.period}
                  </span>
                </div>
                <ul className="space-y-2.5">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="mt-auto w-full pt-2">
                {isCurrentPlan ? (
                  <Button variant="outline" className="h-11 w-full" disabled>
                    Current Plan
                  </Button>
                ) : (
                  <Button
                    className={`h-11 w-full font-semibold ${plan.ctaClass ?? ""}`}
                    variant={plan.ctaVariant}
                    onClick={() => void handleUpgrade(plan)}
                    disabled={upgrading === plan.id || loading}
                  >
                    {upgrading === plan.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      buttonLabel
                    )}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
