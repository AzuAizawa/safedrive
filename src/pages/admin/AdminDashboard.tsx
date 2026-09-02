import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, Car, CreditCard, Headset, MessageSquare, ShieldCheck, UserCheck } from "lucide-react";
import { useNavigate } from "react-router";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { loadSupportTicketsNeedingAdminReply } from "@/lib/adminWorkQueue";
import { formatElapsed } from "@/lib/queueAge";
import { supabase } from "@/lib/supabase";
import type { AuditLog } from "@/types/database";

type QueueCard = { label: string; count: number; oldest: string | null; to: string; icon: typeof Car; finance?: boolean };

export default function AdminDashboard() {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin";
  const navigate = useNavigate();
  const [queues, setQueues] = useState<QueueCard[]>([]);
  const [activities, setActivities] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setLoadError(null);
      const [profiles, vehicles, support, guests, payouts, refunds, deposits, retention, reconciliation, activity] = await Promise.all([
        supabase.from("profiles").select("id, updated_at").eq("verified_status", "pending").order("updated_at", { ascending: true }),
        supabase.from("cars").select("id, created_at").eq("status", "pending").order("created_at", { ascending: true }),
        loadSupportTicketsNeedingAdminReply().catch((error: unknown) => {
          console.error("Failed to load support reply queue:", error);
          return [];
        }),
        supabase.from("guest_inquiries").select("id, created_at").in("status", ["open", "in_progress"]).order("created_at", { ascending: true }),
        isSuperAdmin ? supabase.from("payments").select("id, created_at").eq("payment_type", "payout").in("status", ["pending", "failed"]).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
        isSuperAdmin ? supabase.from("payments").select("id, created_at").eq("payment_type", "refund").in("status", ["pending", "failed"]).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
        isSuperAdmin ? supabase.from("security_deposits").select("id, updated_at").in("status", ["return_review", "claim_open", "no_claim", "deduction_approved", "refund_pending", "failed"]).order("updated_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
        isSuperAdmin ? supabase.from("data_retention_requests").select("id, created_at").in("status", ["submitted", "identity_check", "under_review", "approved"]).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
        isSuperAdmin ? supabase.from("reconciliation_items").select("id, created_at").in("status", ["open", "investigating"]).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
        supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(6),
      ]);
      const firstError = [profiles, vehicles, guests, payouts, refunds, deposits, retention, reconciliation, activity].find(
        (result) => result.error,
      )?.error;
      if (firstError) setLoadError(firstError.message);
      const operational: QueueCard[] = [
        { label: "Profiles to verify", count: profiles.data?.length ?? 0, oldest: profiles.data?.[0]?.updated_at ?? null, to: "/admin/users", icon: UserCheck },
        { label: "Vehicles to approve", count: vehicles.data?.length ?? 0, oldest: vehicles.data?.[0]?.created_at ?? null, to: "/admin/vehicle-approval?tab=pending", icon: Car },
        { label: "Support needing reply", count: support.length, oldest: support[0]?.waiting_since ?? null, to: "/admin/support", icon: Headset },
        { label: "Guest inquiries", count: guests.data?.length ?? 0, oldest: guests.data?.[0]?.created_at ?? null, to: "/admin/guest-inquiries", icon: MessageSquare },
      ];
      if (isSuperAdmin) operational.push(
        { label: "Payout attention", count: payouts.data?.length ?? 0, oldest: payouts.data?.[0]?.created_at ?? null, to: "/admin/financial-reviews?view=payouts", icon: CreditCard, finance: true },
        { label: "Refund attention", count: refunds.data?.length ?? 0, oldest: refunds.data?.[0]?.created_at ?? null, to: "/admin/financial-reviews?view=refunds", icon: CreditCard, finance: true },
        { label: "Deposit review", count: deposits.data?.length ?? 0, oldest: deposits.data?.[0]?.updated_at ?? null, to: "/admin/financial-reviews?view=deposits", icon: ShieldCheck, finance: true },
        { label: "Privacy requests", count: retention.data?.length ?? 0, oldest: retention.data?.[0]?.created_at ?? null, to: "/admin/retention-requests", icon: ShieldCheck, finance: true },
        { label: "Reconciliation issues", count: reconciliation.data?.length ?? 0, oldest: reconciliation.data?.[0]?.created_at ?? null, to: "/admin/reconciliation", icon: ShieldCheck, finance: true },
      );
      setQueues(operational);
      setActivities((activity.data ?? []) as AuditLog[]);
      setLoading(false);
    })();
  }, [isSuperAdmin]);

  const humanize = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-3xl font-bold">Admin Work Center</h1><p className="mt-1 text-muted-foreground">Start with the oldest queues. The notification bell contains individual reminders and deep links.</p></div><Button variant="outline" onClick={() => navigate("/admin/notifications")}>Open notifications</Button></div>
      {loadError && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          Some admin queues could not be loaded. Counts may be incomplete. {loadError}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading ? Array.from({ length: isSuperAdmin ? 9 : 4 }).map((_, index) => <Card key={index}><CardContent className="space-y-3 p-5"><Skeleton className="h-5 w-32" /><Skeleton className="h-9 w-16" /><Skeleton className="h-4 w-40" /></CardContent></Card>) : queues.map((queue) => <Card key={queue.label} className={`cursor-pointer transition hover:border-primary/40 hover:shadow-md ${queue.finance ? "border-amber-500/20" : ""}`} onClick={() => navigate(queue.to)}><CardContent className="p-5"><div className="flex items-start justify-between"><queue.icon className={`h-5 w-5 ${queue.finance ? "text-amber-500" : "text-primary"}`} /><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></div><p className="mt-4 text-sm font-medium text-muted-foreground">{queue.label}</p><p className="mt-1 text-3xl font-bold">{queue.count}</p><p className="mt-2 text-xs text-muted-foreground">{queue.oldest ? `Oldest waiting ${formatElapsed(queue.oldest)}` : "Nothing waiting"}</p></CardContent></Card>)}
      </div>
      <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Recent activity</CardTitle><p className="mt-1 text-sm text-muted-foreground">A short operational summary; the complete evidence stays in Audit Trail.</p></div><Button size="sm" variant="outline" onClick={() => navigate("/admin/audit-trail")}>Audit Trail</Button></CardHeader><CardContent>{loading ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div> : activities.length === 0 ? <p className="py-8 text-center text-muted-foreground">No recent activity.</p> : <div className="divide-y">{activities.map((item) => <div key={item.id} className="flex flex-col justify-between gap-1 py-3 sm:flex-row sm:items-center"><div><p className="text-sm font-medium">{humanize(item.action)}</p><p className="text-xs text-muted-foreground">{item.entity_type ? humanize(item.entity_type) : "System event"}</p></div><time className="text-xs text-muted-foreground">{format(new Date(item.created_at || new Date()), "MMM d, yyyy h:mm a")}</time></div>)}</div>}</CardContent></Card>
    </div>
  );
}
