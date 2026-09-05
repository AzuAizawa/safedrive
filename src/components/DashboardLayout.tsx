import { useState, useCallback, useEffect } from "react";
import { Outlet, NavLink, Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { recordSecurityEvent } from "@/lib/securityLog";
import { portalModeForPath } from "@/lib/listerMode";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Car,
  User,
  LogOut,
  Menu,
  X,
  LayoutDashboard,
  CalendarDays,
  CarFront,
  Sun,
  Moon,
  Bell,
  ArrowLeftRight,
  Headset,
  FileWarning,
  ChevronDown,
  CreditCard,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

export default function DashboardLayout() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  const isVerified = profile?.verified_status === "verified";
  // The persisted account flag - authoritative for the toggle action itself
  // (what clicking "Switch to X" actually writes), never for display.
  const profileIsLister = Boolean(profile?.is_lister);
  // Everything else (badge, nav, colors, logo target) prefers the CURRENT
  // ROUTE's implied mode over the persisted flag. Direct URL / bookmarked /
  // email-link entry into the other mode's space renders its page
  // immediately (ModeRoute never blocks) and flips the flag in the
  // background - without this, the chrome would show the stale mode for
  // that whole async round-trip, mismatched against the page already on
  // screen (e.g. the "Lister Mode" badge over a renter-only page).
  const routeMode = portalModeForPath(location.pathname);
  const isLister = routeMode ? routeMode === "lister" : profileIsLister;
  const logoTarget = isLister ? "/lister-bookings" : "/browse";
  const legalReturnTo =
    `${location.pathname}${location.search}${location.hash}` || logoTarget;

  const handleSignOut = async () => {
    await recordSecurityEvent(
      "user_logout",
      { email: profile?.email, portal: "user" },
      user?.id,
    );
    await signOut();
    toast.success("Signed out successfully");
    navigate("/login");
  };

  const handleToggleMode = useCallback(async () => {
    if (!user || !profile) return;

    // Acts on the persisted flag, not the route-derived display value above -
    // this writes the account's actual stored mode, so it must flip away
    // from what is actually stored, not from whichever mode the current
    // page happens to imply.
    if (!isVerified && !profileIsLister) {
      toast.error("Identity Verification Required", {
        description:
          "Please complete your verification to unlock Lister features.",
      });
      navigate("/verify");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ is_lister: !profileIsLister })
      .eq("id", user.id);
    if (!error) {
      await refreshProfile();
      // Hard redirect to clear all react states and avoid routing missing pages (404/blank)
      if (!profileIsLister) {
        window.location.href = "/lister-bookings";
      } else {
        window.location.href = "/browse";
      }
    } else {
      toast.error("Failed to switch modes", {
        description: error.message || "Database error",
      });
    }
  }, [user, profile, profileIsLister, isVerified, refreshProfile, navigate]);

  const handleUnlockListerMode = useCallback(() => {
    toast.info("How to unlock Lister Mode", {
      description:
        "Complete identity verification first. Most reviews finish within 24 hours, while more complex checks may take 1 to 3 business days. After approval, return to your account menu, switch to Lister Mode, then add payout details and your first vehicle.",
    });
    navigate("/verify");
  }, [navigate]);

  const primaryNavItems = [
    ...(isLister
      ? []
      : [
          { to: "/browse", label: "Browse Cars", icon: CarFront },
          { to: "/my-bookings", label: "My Bookings", icon: CalendarDays },
          { to: "/support", label: "Support", icon: Headset },
        ]),
    ...(isLister
      ? [
          { to: "/lister-bookings", label: "Bookings", icon: LayoutDashboard },
          { to: "/support", label: "Support", icon: Headset },
        ]
      : []),
  ];

  const vehicleNavItems = [
    { to: "/my-vehicles", label: "My Vehicles", description: "Listings and vehicle details", icon: Car },
    { to: "/vehicle-availability", label: "Availability", description: "Maintenance and blocked dates", icon: CalendarDays },
    { to: "/car-renewals", label: "Renewals", description: "Documents due for renewal", icon: FileWarning },
  ];

  const isVehicleSectionActive = vehicleNavItems.some(
    (item) => location.pathname === item.to,
  );

  const fetchUnreadCount = useCallback(async () => {
    if (!user?.id) {
      setUnreadNotificationCount(0);
      return;
    }

    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (error) {
      console.error("Failed to fetch unread notifications:", error);
      return;
    }

    setUnreadNotificationCount(count ?? 0);
  }, [user?.id]);

  // Re-check on every navigation so the badge clears right after the user
  // reads notifications and moves to another page.
  useEffect(() => {
    void fetchUnreadCount();
  }, [fetchUnreadCount, location.pathname]);

  // Keep the badge live while the user stays on one page: a light poll plus a
  // realtime subscription on this user's notification rows (mirrors AdminLayout).
  useEffect(() => {
    if (!user?.id) return;

    const pollId = window.setInterval(() => void fetchUnreadCount(), 60_000);
    const channel = supabase
      .channel(`notification-count-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => void fetchUnreadCount(),
      )
      .subscribe();

    return () => {
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [fetchUnreadCount, user?.id]);

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-500 flex flex-col">
      {/* Dynamic Background Glow */}
      <div
        className={`fixed inset-0 pointer-events-none opacity-40 transition-colors duration-1000 ${
          isLister
            ? "bg-[radial-gradient(circle_at_100%_0%,rgba(139,92,246,0.08),transparent_50%)]"
            : "bg-[radial-gradient(circle_at_100%_0%,rgba(59,130,246,0.08),transparent_50%)]"
        }`}
      />

      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-border/40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-6">
              <NavLink to={logoTarget} className="flex items-center gap-2.5 group">
                <div
                  className={`w-9 h-9 rounded-xl bg-gradient-to-br ${isLister ? "from-primary to-primary/70" : "from-blue-500 to-blue-600"} flex items-center justify-center shadow-lg transition-all duration-500 group-hover:scale-105`}
                >
                  <Car className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-black tracking-tight hidden sm:block">
                  SafeDrive
                </span>
              </NavLink>

              {/* Desktop Navigation */}
              <div
                role="navigation"
                aria-label={isLister ? "Lister navigation" : "Renter navigation"}
                className="ml-4 hidden items-center gap-1 md:flex"
                style={{ background: "transparent", border: 0, boxShadow: "none", padding: 0 }}
              >
                {isLister && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold outline-none transition-all duration-300 ${
                        isVehicleSectionActive
                          ? "border-primary/25 bg-primary/10 text-primary"
                          : "border-transparent text-muted-foreground hover:border-border/50 hover:bg-muted/40 hover:text-foreground"
                      }`}
                    >
                      <Car className="h-4 w-4" />
                      Vehicles
                      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="w-72 rounded-xl border-border/40 bg-background/95 p-2 backdrop-blur-md"
                    >
                      {vehicleNavItems.map((item) => (
                        <DropdownMenuItem
                          key={item.to}
                          onClick={() => navigate(item.to)}
                          className="items-start gap-3 rounded-lg p-3"
                        >
                          <item.icon className="mt-0.5 h-4 w-4 text-primary" />
                          <div>
                            <p className="text-sm font-semibold">{item.label}</p>
                            <p className="text-xs text-muted-foreground">{item.description}</p>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {primaryNavItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => {
                      const baseClass =
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-all duration-300";
                      const activeColor = isLister
                        ? "text-primary"
                        : "text-blue-500";
                      return isActive
                        ? `${baseClass} border-primary/25 bg-primary/10 ${activeColor}`
                        : `${baseClass} border-transparent text-muted-foreground hover:border-border/50 hover:text-foreground hover:bg-muted/40`;
                    }}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>

            {/* Right Side */}
            <div className="flex items-center gap-3">
              {/* Mode indicator */}
              <div className="hidden lg:flex items-center mr-2">
                <div
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all duration-500 ${
                    isLister
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-blue-500/10 text-blue-500 border-blue-500/20"
                  }`}
                >
                  {isLister ? "Lister Mode" : "Renter Mode"}
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="rounded-xl hover:bg-muted/50"
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/notifications")}
                className="rounded-xl hover:bg-muted/50 relative"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationCount > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-background" />
                )}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger className="outline-none">
                  <div
                    className={`w-9 h-9 rounded-xl bg-gradient-to-br ${isLister ? "from-primary/80 to-primary" : "from-blue-500/80 to-blue-500"} flex items-center justify-center cursor-pointer hover:shadow-lg transition-all border border-white/10`}
                  >
                    <User className="w-4 h-4 text-white" />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-64 max-w-[calc(100vw-1rem)] p-2 rounded-lg border-border/40 bg-background/95 backdrop-blur-md"
                >
                  <div className="font-normal p-3">
                    <div className="flex flex-col gap-1.5">
                      <p className="text-sm font-bold truncate">
                        {profile?.full_name || profile?.email || user?.email}
                      </p>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-[0.1em] px-2 py-0.5 rounded-md ${
                            profile?.verified_status === "verified"
                              ? "bg-green-500/10 text-green-500"
                              : profile?.verified_status === "pending"
                                ? "bg-amber-500/10 text-amber-500"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {profile?.verified_status || "Unverified"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <DropdownMenuSeparator className="opacity-50" />
                  <DropdownMenuGroup className="space-y-1">
                    <DropdownMenuItem
                      onClick={() => navigate("/verify")}
                      className="rounded-xl p-2.5"
                    >
                      <User className="mr-2 h-4 w-4 opacity-70" />
                      {profile?.verified_status === "verified"
                        ? "Account & Identity"
                        : "Get Verified"}
                    </DropdownMenuItem>

                    {isLister && (
                      <DropdownMenuItem
                        onClick={() => navigate("/subscriptions")}
                        className="rounded-xl p-2.5"
                      >
                        <CreditCard className="mr-2 h-4 w-4 opacity-70" />
                        Subscription & Billing
                      </DropdownMenuItem>
                    )}

                    {isVerified ? (
                      <DropdownMenuItem
                        onClick={handleToggleMode}
                        className="rounded-xl p-2.5 bg-primary/5 text-primary focus:text-primary"
                      >
                        <ArrowLeftRight className="mr-2 h-4 w-4" />
                        {profileIsLister ? "Switch to Renter" : "Switch to Lister"}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={handleUnlockListerMode}
                        className="rounded-xl p-2.5 bg-amber-500/10 text-amber-600 focus:text-amber-600"
                      >
                        <ArrowLeftRight className="mr-2 h-4 w-4" />
                        Unlock Lister Mode
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator className="opacity-50" />
                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="rounded-xl p-2.5 text-red-500 focus:text-red-500"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Mobile menu button */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden rounded-xl"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border/40 bg-background/50 backdrop-blur-xl animate-scale-in">
            <nav className="p-4 space-y-2">
              <div className="px-2 mb-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Navigation
                </p>
              </div>
              {isLister && (
                <>
                  <div className="px-2 pb-1 pt-2">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Vehicles
                    </p>
                  </div>
                  {vehicleNavItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) => {
                        const baseClass =
                          "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all";
                        return isActive
                          ? `${baseClass} bg-primary/10 text-primary`
                          : `${baseClass} text-muted-foreground hover:text-foreground hover:bg-muted/50`;
                      }}
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </NavLink>
                  ))}
                  <div className="px-2 pb-1 pt-3">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Work
                    </p>
                  </div>
                </>
              )}
              {primaryNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) => {
                    const baseClass =
                      "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all";
                    const activeStyle = isLister
                      ? "bg-primary/10 text-primary"
                      : "bg-blue-500/10 text-blue-500";
                    return isActive
                      ? `${baseClass} ${activeStyle}`
                      : `${baseClass} text-muted-foreground hover:text-foreground hover:bg-muted/50`;
                  }}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </NavLink>
              ))}
              <div className="px-2 pb-1 pt-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Account
                </p>
              </div>
              {isLister && (
                <NavLink
                  to="/subscriptions"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`
                  }
                >
                  <CreditCard className="h-4 w-4" />
                  Subscription & Billing
                </NavLink>
              )}
              {isVerified ? (
                <div className="pt-4 px-2 border-t border-border/40 mt-4">
                  <Button
                    className="w-full justify-start gap-3 rounded-xl bg-primary/5 text-primary"
                    variant="ghost"
                    onClick={() => {
                      handleToggleMode();
                      setMobileMenuOpen(false);
                    }}
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                    {profileIsLister ? "Switch to Renter" : "Switch to Lister"}
                  </Button>
                </div>
              ) : (
                <div className="pt-4 px-2 border-t border-border/40 mt-4 space-y-2">
                  <Button
                    className="w-full justify-start gap-3 rounded-xl bg-amber-500/10 text-amber-600"
                    variant="ghost"
                    onClick={() => {
                      handleUnlockListerMode();
                      setMobileMenuOpen(false);
                    }}
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                    Unlock Lister Mode
                  </Button>
                  <p className="px-3 text-xs text-muted-foreground">
                    Finish verification first, wait for admin approval, then switch modes here.
                  </p>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl w-full flex-1 mx-auto px-4 sm:px-6 py-8 relative z-10 transition-all duration-500">
        <div className="animate-fade-in">
          <Outlet />
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-border/40 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/50 text-center sm:text-left">
              SafeDrive - Peer-to-Peer Car Rental Platform
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-xs text-muted-foreground text-center">
              <Link
                to="/privacy-policy"
                state={{ returnTo: legalReturnTo }}
                className="text-blue-600 dark:text-blue-400 hover:underline transition-colors duration-200"
              >
                Privacy Policy
              </Link>
              <span className="hidden sm:inline opacity-30">·</span>
              <Link
                to="/terms"
                state={{ returnTo: legalReturnTo }}
                className="text-blue-600 dark:text-blue-400 hover:underline transition-colors duration-200"
              >
                Terms and Conditions
              </Link>
              <span className="hidden sm:inline opacity-30">·</span>
              <Link
                to="/platform-agreement"
                state={{ returnTo: legalReturnTo }}
                className="text-blue-600 dark:text-blue-400 hover:underline transition-colors duration-200"
              >
                Platform Agreement
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
