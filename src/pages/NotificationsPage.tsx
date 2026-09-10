import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { portalModeForPath, setPortalMode } from "@/lib/listerMode";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell,
  CheckCircle,
  AlertCircle,
  Info,
  XCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { format } from "date-fns";

const NOTIFICATIONS_PER_PAGE = 10;

// How long a deleted notification stays on the shelf before the daily job
// removes it for good. The authority is the 'deleted_notification' row in
// retention_policy_rules, which public.purge_deleted_notifications() reads
// (CHAPTER 83); this copy only draws the countdown.
const RECENTLY_DELETED_DAYS = 30;

type NotificationView = "inbox" | "deleted";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean | null;
  link: string | null;
  created_at: string | null;
  deleted_at: string | null;
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

/** "in 12 days", "tomorrow", "today" - what is left of the 30-day shelf. */
const describeRemoval = (deletedAt: string | null) => {
  if (!deletedAt) return "";
  const removesAt =
    new Date(deletedAt).getTime() + RECENTLY_DELETED_DAYS * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((removesAt - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft <= 0) return "Deletes for good today";
  if (daysLeft === 1) return "Deletes for good tomorrow";
  return `Deletes for good in ${daysLeft} days`;
};

export default function NotificationsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [totalNotifications, setTotalNotifications] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [view, setView] = useState<NotificationView>("inbox");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const deletedScope = view === "deleted";
      // Deleting is a soft delete (CHAPTER 83): the row stays, carrying the
      // moment it was deleted, until the daily purge passes the retention
      // window. The two views are the two sides of that one column.
      const listQuery = supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id);
      const { data, error } = await (deletedScope
        ? listQuery.not("deleted_at", "is", null)
        : listQuery.is("deleted_at", null))
        .order(deletedScope ? "deleted_at" : "created_at", { ascending: false })
        .range(
          (currentPage - 1) * NOTIFICATIONS_PER_PAGE,
          currentPage * NOTIFICATIONS_PER_PAGE - 1,
        );
      if (error) throw error;
      if (data) setNotifications(data as Notification[]);

      const countQuery = supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      const { count } = await (deletedScope
        ? countQuery.not("deleted_at", "is", null)
        : countQuery.is("deleted_at", null));
      setTotalNotifications(count ?? 0);
    } catch (err) {
      console.error("Error fetching notifications:", err);
    } finally {
      setLoading(false);
    }
  }, [user, currentPage, view]);

  useEffect(() => {
    if (user) fetchNotifications();
  }, [user, fetchNotifications]);

  const showView = (next: NotificationView) => {
    if (next === view) return;
    setView(next);
    setCurrentPage(1);
  };

  const markAllRead = async () => {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .eq("read", false);
    fetchNotifications();
  };

  const deleteNotification = async (notif: Notification) => {
    setBusyId(notif.id);
    const { error } = await supabase
      .from("notifications")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", notif.id);
    setBusyId(null);
    if (error) {
      toast.error("Notification was not deleted", { description: error.message });
      return;
    }
    toast.success("Moved to Recently deleted", {
      description: `You can put it back for ${RECENTLY_DELETED_DAYS} days.`,
    });
    await fetchNotifications();
  };

  const restoreNotification = async (notif: Notification) => {
    setBusyId(notif.id);
    const { error } = await supabase
      .from("notifications")
      .update({ deleted_at: null })
      .eq("id", notif.id);
    setBusyId(null);
    if (error) {
      toast.error("Notification was not restored", { description: error.message });
      return;
    }
    toast.success("Restored to your notifications");
    await fetchNotifications();
  };

  const totalPages = Math.max(
    1,
    Math.ceil(totalNotifications / NOTIFICATIONS_PER_PAGE),
  );

  const handleClick = async (notif: Notification) => {
    // A notification on the deleted shelf is not a link any more - the only
    // thing to do with it is put it back.
    if (view === "deleted") return;

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

  const deletedView = view === "deleted";

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1">
            {deletedView
              ? `Kept for ${RECENTLY_DELETED_DAYS} days, then deleted for good`
              : `${notifications.filter((n) => !n.read).length} unread`}
          </p>
        </div>
        {!deletedView && notifications.some((n) => !n.read) && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant={deletedView ? "outline" : "default"}
          size="sm"
          onClick={() => showView("inbox")}
        >
          <Bell className="mr-2 h-4 w-4" /> Notifications
        </Button>
        <Button
          variant={deletedView ? "default" : "outline"}
          size="sm"
          onClick={() => showView("deleted")}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Recently deleted
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : totalNotifications === 0 ? (
        <div className="text-center py-20">
          {deletedView ? (
            <Trash2 className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          ) : (
            <Bell className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          )}
          <h3 className="text-lg font-semibold">
            {deletedView ? "Nothing recently deleted" : "No notifications"}
          </h3>
          <p className="text-muted-foreground text-sm mt-1">
            {deletedView
              ? `Anything you delete waits here for ${RECENTLY_DELETED_DAYS} days.`
              : "You're all caught up!"}
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
                  className={`transition-all ${
                    deletedView
                      ? "opacity-75"
                      : `cursor-pointer hover:shadow-md ${!n.read ? "border-primary/30 bg-primary/5" : ""}`
                  }`}
                  onClick={() => handleClick(n)}
                >
                  <CardContent className="p-4 flex items-start gap-3">
                    <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium ${!n.read && !deletedView ? "text-foreground" : "text-muted-foreground"}`}
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
                      {deletedView && (
                        <p className="mt-1 text-[10px] font-semibold text-amber-500">
                          {describeRemoval(n.deleted_at)}
                        </p>
                      )}
                    </div>
                    {deletedView ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === n.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void restoreNotification(n);
                        }}
                      >
                        <RotateCcw className="mr-2 h-3.5 w-3.5" /> Restore
                      </Button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        {!n.read && (
                          <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-500"
                          aria-label="Delete notification"
                          disabled={busyId === n.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteNotification(n);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
