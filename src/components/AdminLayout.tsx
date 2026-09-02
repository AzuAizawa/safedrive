import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { loadAdminAttentionItems, type AdminAttentionItem } from "@/lib/adminAttention";
import { getQueueTiming } from "@/lib/queueAge";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { recordSecurityEvent } from "@/lib/securityLog";
import {
  LayoutDashboard,
  Users,
  Car,
  CarFront,
  CreditCard,
  LogOut,
  Shield,
  Headset,
  Sun,
  Moon,
  ShieldCheck,
  Bell,
  Settings2,
  ClipboardList,
  MessageSquare,
  Menu,
  X,
  CheckCheck,
  Clock3,
  UserCheck,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import type { Notification } from "@/types/database";

type AdminNavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
};

const operationalNavItems: AdminNavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/car-catalog", label: "Car Catalog", icon: CarFront },
  { to: "/admin/vehicle-approval", label: "Vehicle Approval", icon: Car },
  { to: "/admin/support", label: "Support Tickets", icon: Headset },
  { to: "/admin/guest-inquiries", label: "User Inquiries", icon: MessageSquare },
  { to: "/admin/audit-trail", label: "Audit Trail", icon: ClipboardList },
  { to: "/admin/security-logs", label: "Security Logs", icon: ShieldCheck },
  { to: "/admin/platform-settings", label: "Platform Settings", icon: Settings2 },
];

const superAdminNavItems: AdminNavItem[] = [
  { to: "/admin/financial-reviews", label: "Financial Reviews", icon: CreditCard },
  { to: "/admin/financial-ledger", label: "Financial Ledger", icon: ClipboardList },
  { to: "/admin/reconciliation", label: "Reconciliation", icon: ShieldCheck },
  { to: "/admin/retention-requests", label: "Retention Requests", icon: Settings2 },
];

export default function AdminLayout() {
  const { user, signOut, profile } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin";
  const navItems = isSuperAdmin
    ? [...operationalNavItems, ...superAdminNavItems]
    : operationalNavItems;
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [attentionCount, setAttentionCount] = useState(0);
  const [attentionItems, setAttentionItems] = useState<AdminAttentionItem[]>([]);
  const [systemNotifications, setSystemNotifications] = useState<Notification[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const notificationPanelRef = useRef<HTMLDivElement>(null);

  const handleSignOut = async () => {
    await recordSecurityEvent(
      "admin_logout",
      { email: profile?.email, portal: "admin" },
      user?.id,
    );
    await signOut();
    toast.success("Signed out");
    navigate("/Safedriveadminlogin");
  };

  const loadNotifications = useCallback(async () => {
    if (!user?.id) {
      setAttentionCount(0);
      setAttentionItems([]);
      setSystemNotifications([]);
      return;
    }
    setNotificationLoading(true);
    try {
      const [items, notificationResult] = await Promise.all([
        loadAdminAttentionItems(isSuperAdmin),
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (notificationResult.error) throw notificationResult.error;
      setAttentionItems(items);
      setAttentionCount(items.length);
      setSystemNotifications((notificationResult.data ?? []) as Notification[]);
    } catch (error) {
      console.error("Failed to fetch admin notifications:", error);
    } finally {
      setNotificationLoading(false);
    }
  }, [isSuperAdmin, user?.id]);

  useEffect(() => {

    void loadNotifications();
    const pollId = window.setInterval(() => void loadNotifications(), 60_000);
    const channel = supabase
      .channel(`admin-notification-count-${user?.id ?? "none"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: user?.id ? `user_id=eq.${user.id}` : undefined,
        },
        () => void loadNotifications(),
      )
      .subscribe();

    return () => {
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [loadNotifications, user?.id]);

  useEffect(() => {
    if (!notificationOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!notificationPanelRef.current?.contains(event.target as Node)) {
        setNotificationOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationOpen]);

  const markAllNotificationsRead = async () => {
    if (!user?.id) return;
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    if (error) toast.error("Notifications were not updated", { description: error.message });
    else await loadNotifications();
  };

  const openSystemNotification = async (notification: Notification) => {
    if (!notification.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", notification.id);
    }
    setNotificationOpen(false);
    if (notification.link?.startsWith("/admin/")) navigate(notification.link);
    else await loadNotifications();
  };

  const attentionIcon = (kind: AdminAttentionItem["kind"]) => {
    if (kind === "guest") return MessageSquare;
    if (kind === "support") return Headset;
    if (kind === "profile") return UserCheck;
    if (kind === "vehicle") return Car;
    if (kind === "refund" || kind === "payout") return CreditCard;
    return ShieldCheck;
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Background decoration */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(239,68,68,0.03),transparent_50%)] pointer-events-none" />

      {/* Sidebar */}
      {mobileMenuOpen && (
        <button
          type="button"
          aria-label="Close admin navigation"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-66 flex-col border-r border-border/40 bg-background/95 shadow-2xl backdrop-blur-xl transition-transform lg:sticky lg:top-0 lg:z-20 lg:translate-x-0 lg:bg-background/70 lg:shadow-none ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-6 border-b border-border/40 bg-background/20">
          <div className="flex items-center justify-between gap-3">
          <NavLink to="/admin" className="flex items-center gap-3 group" onClick={() => setMobileMenuOpen(false)}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shadow-lg shadow-red-500/20 group-hover:shadow-red-500/40 transition-all duration-300">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight block leading-tight">
                SafeDrive
              </span>
              <span className="text-[10px] text-red-500/80 font-bold uppercase tracking-[0.2em]">
                Admin Portal
              </span>
            </div>
          </NavLink>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close admin navigation"
          >
            <X className="h-5 w-5" />
          </Button>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          <div className="px-3 mb-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
              Management
            </p>
          </div>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-red-500/10 text-red-500 shadow-[inset_0_1px_1px_rgba(239,68,68,0.1)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`
              }
            >
              <item.icon
                className={`w-4 h-4 ${navItems.indexOf(item) === 0 ? "" : "opacity-80"}`}
              />
              {item.label}
            </NavLink>
          ))}

          <div className="pt-8 px-3 mb-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
              Shortcuts
            </p>
          </div>
        </nav>

        <div className="p-4 border-t border-border/40 bg-muted/20 space-y-1.5">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 opacity-80" />
            ) : (
              <Moon className="w-4 h-4 opacity-80" />
            )}
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-500/5 transition-colors"
            onClick={handleSignOut}
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative z-10 min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/40 bg-background/80 px-4 backdrop-blur-sm sm:px-8">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mr-1 lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open admin navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 sm:inline">
              Admin Console
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div ref={notificationPanelRef} className="relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setNotificationOpen((open) => !open);
                  if (!notificationOpen) void loadNotifications();
                }}
                className="relative rounded-xl hover:bg-muted/50"
                title={`${attentionCount} staff items need attention`}
                aria-label={`Open staff notifications, ${attentionCount} items need attention`}
                aria-expanded={notificationOpen}
                aria-haspopup="dialog"
              >
                <Bell className="h-4 w-4" />
                {attentionCount > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-5 rounded-full border-2 border-background bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
                    {attentionCount > 99 ? "99+" : attentionCount}
                  </span>
                )}
              </Button>

              {notificationOpen ? (
                <div
                  role="dialog"
                  aria-label="Staff notifications"
                  className="fixed left-3 right-3 top-17 z-50 max-h-[min(680px,calc(100vh-5rem))] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[430px]"
                >
                  <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                    <div>
                      <h2 className="font-semibold">Staff notifications</h2>
                      <p className="text-xs text-muted-foreground">
                        {attentionCount} item{attentionCount === 1 ? "" : "s"} need action
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => void markAllNotificationsRead()}
                      disabled={!systemNotifications.some((item) => !item.read)}
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> Mark read
                    </Button>
                  </div>

                  <div className="max-h-[min(580px,calc(100vh-10rem))] overflow-y-auto p-2">
                    {notificationLoading && attentionItems.length === 0 ? (
                      <p className="p-6 text-center text-sm text-muted-foreground">Refreshing staff queues…</p>
                    ) : attentionItems.length === 0 && systemNotifications.length === 0 ? (
                      <div className="p-8 text-center">
                        <CheckCheck className="mx-auto h-8 w-8 text-green-500" />
                        <p className="mt-2 font-medium">You are all caught up</p>
                        <p className="mt-1 text-xs text-muted-foreground">No staff work is waiting.</p>
                      </div>
                    ) : (
                      <>
                        {attentionItems.length > 0 ? (
                          <section aria-labelledby="attention-items-heading">
                            <h3 id="attention-items-heading" className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Needs action
                            </h3>
                            {attentionItems.slice(0, 8).map((item) => {
                              const ItemIcon = attentionIcon(item.kind);
                              const timing = getQueueTiming(item.createdAt, item.kind);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => {
                                    setNotificationOpen(false);
                                    navigate(item.link);
                                  }}
                                  className="flex w-full gap-3 rounded-xl p-3 text-left transition-colors hover:bg-muted/60"
                                >
                                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                    <ItemIcon className="h-4 w-4" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{item.title}</span>
                                    <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{item.detail}</span>
                                    <span className="mt-1 flex items-center gap-1 text-[11px] text-primary">
                                      <Clock3 className="h-3 w-3" /> {timing.label}
                                    </span>
                                  </span>
                                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                                </button>
                              );
                            })}
                          </section>
                        ) : null}

                        {systemNotifications.length > 0 ? (
                          <section aria-labelledby="recent-notifications-heading" className="mt-2 border-t border-border/60 pt-2">
                            <h3 id="recent-notifications-heading" className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Recent updates
                            </h3>
                            {systemNotifications.slice(0, 5).map((notification) => (
                              <button
                                key={notification.id}
                                type="button"
                                onClick={() => void openSystemNotification(notification)}
                                className="flex w-full gap-3 rounded-xl p-3 text-left transition-colors hover:bg-muted/60"
                              >
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                  <Bell className="h-4 w-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{notification.title}</span>
                                  <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{notification.message}</span>
                                </span>
                                {!notification.read ? <span className="mt-2 h-2 w-2 rounded-full bg-blue-500" aria-label="Unread" /> : null}
                              </button>
                            ))}
                          </section>
                        ) : null}
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setNotificationOpen(false);
                      navigate("/admin/notifications");
                    }}
                    className="w-full border-t border-border/70 px-4 py-3 text-center text-sm font-medium text-primary hover:bg-muted/40"
                  >
                    Open full work center
                  </button>
                </div>
              ) : null}
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${
              isSuperAdmin
                ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                : "bg-muted text-muted-foreground border-border"
            }`}>
              <Shield className="w-3 h-3" />
              {isSuperAdmin ? "Super Admin" : "Admin"}
            </div>
            <span className="hidden max-w-48 truncate text-xs text-muted-foreground md:inline">{profile?.email}</span>
          </div>
        </header>
        <div className="p-4 sm:p-8">
          <div className="max-w-6xl mx-auto animate-fade-in">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
