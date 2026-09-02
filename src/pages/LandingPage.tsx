import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router";
import {
  ArrowRight,
  Calendar,
  Car,
  CarFront,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  CreditCard,
  MapPin,
  Shield,
  Star,
  Users,
  Zap,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { CarWithDetails } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const FEATURED_CAR_LIMIT = 8;

const getCarImageUrl = (car: CarWithDetails) => {
  const primary = car.car_images?.find((image) => image.is_primary);
  const path = primary?.storage_path || car.car_images?.[0]?.storage_path;
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return supabase.storage.from("vehicle-documents").getPublicUrl(path).data.publicUrl;
};

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [featuredCars, setFeaturedCars] = useState<CarWithDetails[]>([]);
  const [loadingCars, setLoadingCars] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fetchFeaturedCars = async () => {
      setLoadingCars(true);
      try {
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
            profiles!cars_owner_id_fkey (full_name, phone, email)
          `,
          )
          .in("status", ["approved", "active"])
          .order("created_at", { ascending: false })
          .limit(FEATURED_CAR_LIMIT);

        if (error) throw error;
        setFeaturedCars((data ?? []) as unknown as CarWithDetails[]);
      } catch (error) {
        console.error("Failed to load featured cars", error);
      } finally {
        setLoadingCars(false);
      }
    };

    fetchFeaturedCars();
  }, []);

  const stats = useMemo(
    () => [
      { label: "Available listings", value: loadingCars ? "..." : String(featuredCars.length) },
      { label: "Verification required", value: "Yes" },
      { label: "Payment handling", value: "PayMongo" },
    ],
    [featuredCars.length, loadingCars],
  );

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const scrollCars = (direction: "left" | "right") => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const amount = Math.max(container.clientWidth * 0.85, 320);
    container.scrollBy({
      left: direction === "right" ? amount : -amount,
      behavior: "smooth",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.10),transparent_45%),radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_30%)] pointer-events-none" />

      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/20">
              <Car className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold tracking-tight">SafeDrive</p>
              <p className="hidden truncate text-xs text-muted-foreground min-[430px]:block">
                Peer-to-peer car rental platform
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {user ? (
              <>
                <Button variant="ghost" size="sm" onClick={handleSignOut}>
                  Log Out
                </Button>
                <Button size="sm" onClick={() => navigate("/browse")} className="gap-2">
                  <span className="hidden sm:inline">Open Dashboard</span>
                  <span className="sm:hidden">Open</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>
                  Log In
                </Button>
                <Button size="sm" onClick={() => navigate("/signup")} className="gap-2">
                  <span className="hidden sm:inline">Create Account</span>
                  <span className="sm:hidden">Sign Up</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-border/50">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400">
                <Zap className="h-3.5 w-3.5" />
                Verified rentals and listings
              </div>
              <h1 className="max-w-3xl text-5xl font-extrabold tracking-tight sm:text-6xl">
                Rent real cars from real people, with verification built in.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
                SafeDrive is a peer-to-peer car rental platform for renters and car owners in the Philippines.
                We verify users, review listings, and keep booking, payment, and audit activity inside one system.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  size="lg"
                  onClick={() => navigate(user ? "/browse" : "/signup")}
                  className="gap-2"
                >
                  {user ? "Browse Cars" : "Start Renting"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => navigate(user ? "/my-vehicles" : "/signup")}
                >
                  List Your Car
                </Button>
                <Button size="lg" variant="ghost" onClick={() => navigate("/contact")}>
                  Ask a Question
                </Button>
              </div>
              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {stats.map((item) => (
                  <div key={item.label} className="rounded-xl border border-border/50 bg-background/80 p-4 shadow-sm">
                    <p className="text-2xl font-bold">{item.value}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-muted/20 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    Platform Snapshot
                  </p>
                  <p className="mt-1 text-2xl font-bold">What SafeDrive handles</p>
                </div>
                <Shield className="h-10 w-10 text-blue-500" />
              </div>
              <div className="space-y-3">
                {[
                  "Identity verification for renters and listers",
                  "Admin review for listed vehicles before public visibility",
                  "Hosted checkout through PayMongo",
                  "Security logs, audit trails, and account access records",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-xl border border-border/40 bg-background p-4">
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    <p className="text-sm text-muted-foreground">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border/50 py-16">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Available Cars
                </p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight">
                  Browse a few of the current listings
                </h2>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  This section surfaces real approved and active cars already in SafeDrive. Open the dashboard to see the full catalog and filters.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => scrollCars("left")} aria-label="Scroll cars left">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => scrollCars("right")} aria-label="Scroll cars right">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div
              ref={scrollContainerRef}
              className="flex gap-4 overflow-x-auto pb-4 [scrollbar-width:thin] snap-x snap-mandatory"
            >
              {loadingCars
                ? Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="min-w-[300px] max-w-[300px] flex-none rounded-2xl border border-border/50 bg-background shadow-sm"
                    >
                      <Skeleton className="h-44 w-full rounded-b-none rounded-t-2xl" />
                      <div className="space-y-3 p-4">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-9 w-full" />
                      </div>
                    </div>
                  ))
                : featuredCars.map((car) => {
                    const imageUrl = getCarImageUrl(car);
                    return (
                      <article
                        key={car.id}
                        className="min-w-[300px] max-w-[300px] flex-none snap-start overflow-hidden rounded-2xl border border-border/50 bg-background shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                      >
                        <div className="relative h-44 bg-muted">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={`${car.car_models.car_brands.name} ${car.car_models.name}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <CarFront className="h-14 w-14 text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="absolute right-3 top-3 rounded-full bg-background/95 px-3 py-1 text-xs font-semibold shadow-sm">
                            ₱{Number(car.price_per_day).toLocaleString()}/day
                          </div>
                        </div>
                        <div className="space-y-3 p-4">
                          <div>
                            <h3 className="text-lg font-semibold">
                              {car.car_models.car_brands.name} {car.car_models.name}
                            </h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Plate {car.plate_number}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span className="rounded-full bg-muted px-2.5 py-1">
                              {car.car_models.body_type}
                            </span>
                            <span className="rounded-full bg-muted px-2.5 py-1">
                              {car.car_models.seats} seats
                            </span>
                          </div>
                          {car.location && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <MapPin className="h-4 w-4" />
                              <span className="truncate">{car.location}</span>
                            </div>
                          )}
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => navigate(user ? `/cars/${car.id}` : "/login")}
                          >
                            {user ? "View Car" : "Log in to view"}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
            </div>
          </div>
        </section>

        <section className="border-b border-border/50 py-16">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-10">
              <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                What the Website Is About
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                A platform for booking and listing cars with stricter controls
              </h2>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  icon: Shield,
                  title: "Verified accounts",
                  description:
                    "Users submit identity details and supporting images before core platform features are unlocked.",
                },
                {
                  icon: Calendar,
                  title: "Structured booking flow",
                  description:
                    "Renters request dates, owners approve, and the booking timeline stays visible inside the app.",
                },
                {
                  icon: CreditCard,
                  title: "Hosted payment flow",
                  description:
                    "SafeDrive sends checkout to PayMongo rather than storing raw card details inside the app.",
                },
                {
                  icon: Users,
                  title: "Admin oversight",
                  description:
                    "Admin users review verification requests, vehicle approvals, support issues, and security activity.",
                },
              ].map((feature) => (
                <div key={feature.title} className="rounded-2xl border border-border/50 bg-background p-5 shadow-sm">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <h2 className="text-3xl font-bold tracking-tight">Ready to use SafeDrive?</h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Create an account to book cars, complete verification, or start listing your own vehicle.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" onClick={() => navigate(user ? "/browse" : "/signup")}>
                {user ? "Open Dashboard" : "Create Account"}
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/privacy-policy")}>
                Review Privacy Policy
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
              {["Verified community", "Hosted payments", "Admin-reviewed listings"].map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-amber-500" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 bg-muted/20 py-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-semibold">SafeDrive</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Car rental marketplace with verification, listing review, and security-aware workflows.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <Link to="/terms" className="text-blue-600 dark:text-blue-400 hover:underline transition-colors">
              Terms and Conditions
            </Link>
            <Link to="/privacy-policy" className="text-blue-600 dark:text-blue-400 hover:underline transition-colors">
              Privacy Policy
            </Link>
            <Link to="/platform-agreement" className="text-blue-600 dark:text-blue-400 hover:underline transition-colors">
              Platform Agreement
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
