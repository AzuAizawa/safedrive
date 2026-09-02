import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, CheckCheck, Clock3, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { loadAdminAttentionItems, type AdminAttentionItem } from "@/lib/adminAttention";
import { getQueueTiming, queueSeverityClasses } from "@/lib/queueAge";
import { supabase } from "@/lib/supabase";
import type { Notification } from "@/types/database";

type QueueItem = AdminAttentionItem;

export default function AdminNotificationsPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const isSuperAdmin = profile?.role === "super_admin";

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    try {
      const [notificationResult, nextQueue] = await Promise.all([
        supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
        loadAdminAttentionItems(isSuperAdmin),
      ]);
      if (notificationResult.error) throw notificationResult.error;
      setNotifications((notificationResult.data ?? []) as Notification[]);
      setQueueItems(nextQueue);
    } catch (error) {
      toast.error("Admin work center could not be refreshed", {
        description: error instanceof Error ? error.message : "Unknown queue error",
      });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, user?.id]);

  useEffect(() => {
    void load();
    const clockId = window.setInterval(() => setNow(Date.now()), 60_000);
    const pollId = window.setInterval(() => void load(), 60_000);
    const channel = supabase
      .channel(`admin-work-center-${user?.id ?? "none"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_inquiries" }, () => void load())
      .subscribe();

    return () => {
      window.clearInterval(clockId);
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [load, user?.id]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  const markAllRead = async () => {
    if (!user?.id) return;
    const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
    if (error) toast.error("Notifications were not updated", { description: error.message });
    else await load();
  };

  const openNotification = async (notification: Notification) => {
    if (!notification.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", notification.id);
    }
    if (notification.link) navigate(notification.link);
    else await load();
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Work Center</h1>
          <p className="mt-1 text-muted-foreground">Every waiting queue and system notification in one place.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>Refresh</Button>
          <Button variant="outline" className="gap-2" onClick={() => void markAllRead()} disabled={unreadCount === 0}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        </div>
      </div>

      <section aria-labelledby="work-queue-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="work-queue-heading" className="text-xl font-semibold">Waiting for action</h2>
            <p className="text-sm text-muted-foreground">{queueItems.length} open item{queueItems.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        {loading ? (
          <div className="flex min-h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : queueItems.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">No work is waiting for review.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {queueItems.map((item) => {
              const timing = getQueueTiming(item.createdAt, item.kind, now);
              return (
                <button key={item.id} type="button" onClick={() => navigate(item.link)} className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                    {timing.severity === "critical" && <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />}
                  </div>
                  <span className={`mt-3 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${queueSeverityClasses[timing.severity]}`}>
                    <Clock3 className="h-3 w-3" /> {timing.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="notifications-heading" className="space-y-3">
        <div>
          <h2 id="notifications-heading" className="text-xl font-semibold">System notifications</h2>
          <p className="text-sm text-muted-foreground">{unreadCount} unread</p>
        </div>
        {notifications.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground"><Bell className="mx-auto mb-2 h-7 w-7" />No system notifications.</div>
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => (
              <button key={notification.id} type="button" onClick={() => void openNotification(notification)} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/30 ${!notification.read ? "border-blue-500/30 bg-blue-500/5" : "bg-card"}`}>
                <Bell className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{notification.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{notification.message}</p>
                  {notification.created_at && <p className="mt-2 text-xs text-muted-foreground">{getQueueTiming(notification.created_at, notification.type === "security" ? "security" : "support", now).label}</p>}
                </div>
                {!notification.read && <span className="mt-1 h-2 w-2 rounded-full bg-blue-500" aria-label="Unread" />}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
