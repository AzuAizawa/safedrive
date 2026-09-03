import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { portalModeForPath, setPortalMode } from "@/lib/listerMode";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, CheckCircle, AlertCircle, Info, XCircle } from "lucide-react";
import { useNavigate } from "react-router";
import { format } from "date-fns";

const NOTIFICATIONS_PER_PAGE = 10;

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean | null;
  link: string | null;
  created_at: string | null;
}

const iconMap: Record<string, React.ElementType> = {
  success: CheckCircle,
  warning: AlertCircle,
  error: XCircle,
  info: Info,
};
const colorMap: Record<string, string> = {
  success: "text-green-500",
  warning: "text-amber-500",
  error: "text-red-500",
  info: "text-blue-500",
};

export default function NotificationsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [totalNotifications, setTotalNotifications] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(
          (currentPage - 1) * NOTIFICATIONS_PER_PAGE,
          currentPage * NOTIFICATIONS_PER_PAGE - 1,
        );
      if (error) throw error;
      if (data) setNotifications(data as Notification[]);

      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      setTotalNotifications(count ?? 0);
    } catch (err) {
      console.error("Error fetching notifications:", err);
    } finally {
      setLoading(false);
    }
  }, [user, currentPage]);

  useEffect(() => {
    if (user) fetchNotifications();
  }, [user, fetchNotifications]);

  const markAllRead = async () => {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    fetchNotifications();
  };

  const totalPages = Math.max(
    1,
    Math.ceil(totalNotifications / NOTIFICATIONS_PER_PAGE),
  );

  const handleClick = async (notif: Notification) => {
    if (!notif.read) {
      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", notif.id);
    }
    if (!notif.link) return;

    // Follow the notification into the right portal space (Airbnb-style):
    // a booking-request notification opens in lister mode, a trip notification
    // in renter mode. Neutral links (support, verification, ...) never switch.
    const targetMode = portalModeForPath(notif.link);
    const currentMode = profile?.is_lister ? "lister" : "renter";
    const canSwitch =
      targetMode !== null &&
      targetMode !== currentMode &&
      !(targetMode === "lister" && profile?.verified_status !== "verified");

    if (canSwitch) {
      const changed = await setPortalMode(user?.id, targetMode);
      if (changed) {
        await refreshProfile();
        // Hard navigation so the layout loads already in the right mode with
        // no flash of the mismatched navigation.
        window.location.href = notif.link;
        return;
      }
    }
    navigate(notif.link);
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1">
            {notifications.filter((n) => !n.read).length} unread
          </p>
        </div>
        {notifications.some((n) => !n.read) && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            Mark all read
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : totalNotifications === 0 ? (
        <div className="text-center py-20">
          <Bell className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold">No notifications</h3>
          <p className="text-muted-foreground text-sm mt-1">
            You're all caught up!
          </p>
        </div>
      ) : (
        <>
          <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
            {notifications.map((n) => {
              const Icon = iconMap[n.type] || Info;
              const color = colorMap[n.type] || colorMap.info;
              return (
                <Card
                  key={n.id}
                  className={`cursor-pointer hover:shadow-md transition-all ${!n.read ? "border-primary/30 bg-primary/5" : ""}`}
                  onClick={() => handleClick(n)}
                >
                  <CardContent className="p-4 flex items-start gap-3">
                    <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium ${!n.read ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {n.message}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {n.created_at
                          ? format(new Date(n.created_at), "MMM d, yyyy h:mm a")
                          : "Recently"}
                      </p>
                    </div>
                    {!n.read && (
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Showing {(currentPage - 1) * NOTIFICATIONS_PER_PAGE + 1}-
              {Math.min(currentPage * NOTIFICATIONS_PER_PAGE, totalNotifications)} of {totalNotifications}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm font-medium">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
