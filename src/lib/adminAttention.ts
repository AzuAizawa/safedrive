import { loadSupportTicketsNeedingAdminReply } from "@/lib/adminWorkQueue";
import type { QueueKind } from "@/lib/queueAge";
import { supabase } from "@/lib/supabase";

export type AdminAttentionItem = {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
  kind: QueueKind;
  link: string;
};

const requireSuccess = <T extends { error: { message: string } | null }>(result: T) => {
  if (result.error) throw result.error;
  return result;
};

export async function loadAdminAttentionItems(isSuperAdmin: boolean) {
  const [guestResult, supportItems, profileResult, vehicleResult] = await Promise.all([
    supabase
      .from("guest_inquiries")
      .select("id,name,topics,subject,status,created_at")
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: true }),
    loadSupportTicketsNeedingAdminReply(),
    supabase
      .from("profiles")
      .select("id,full_name,email,created_at")
      .eq("verified_status", "pending")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("cars")
      .select("id,plate_number,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  requireSuccess(guestResult);
  requireSuccess(profileResult);
  requireSuccess(vehicleResult);

  const items: AdminAttentionItem[] = [
    ...(guestResult.data ?? []).map((item) => ({
      id: `guest-${item.id}`,
      title: `Inquiry from ${item.name}`,
      detail: item.topics?.length ? item.topics.join(", ") : item.subject,
      createdAt: item.created_at,
      kind: "guest" as const,
      link: `/admin/guest-inquiries?inquiry=${item.id}`,
    })),
    ...supportItems.map((item) => ({
      id: `support-${item.id}`,
      title: item.subject,
      detail: item.tag || "Support case needs a staff reply",
      createdAt: item.waiting_since,
      kind: "support" as const,
      link: `/admin/support?ticket=${item.id}`,
    })),
    ...(profileResult.data ?? []).map((item) => ({
      id: `profile-${item.id}`,
      title: item.full_name || item.email,
      detail: "Profile verification awaiting review",
      createdAt: item.created_at,
      kind: "profile" as const,
      link: `/admin/users?profile=${item.id}`,
    })),
    ...(vehicleResult.data ?? []).map((item) => ({
      id: `vehicle-${item.id}`,
      title: `Vehicle ${item.plate_number}`,
      detail: "Vehicle approval awaiting review",
      createdAt: item.created_at,
      kind: "vehicle" as const,
      link: `/admin/vehicle-approval?vehicle=${item.id}`,
    })),
  ];

  if (isSuperAdmin) {
    const [refundResult, payoutResult, retentionResult, reconciliationResult] = await Promise.all([
      supabase.from("payments").select("id,booking_id,status,created_at").eq("payment_type", "refund").in("status", ["pending", "failed"]).order("created_at"),
      supabase.from("payments").select("id,booking_id,status,created_at").eq("payment_type", "payout").in("status", ["pending", "failed"]).order("created_at"),
      supabase.from("data_retention_requests").select("id,request_type,requester_email,status,created_at").in("status", ["submitted", "identity_check", "under_review", "approved"]).order("created_at"),
      supabase.from("reconciliation_items").select("id,issue_type,severity,status,created_at").in("status", ["open", "investigating"]).order("created_at"),
    ]);

    [refundResult, payoutResult, retentionResult, reconciliationResult].forEach(requireSuccess);

    items.push(
      ...(refundResult.data ?? []).map((item) => ({
        id: `refund-${item.id}`,
        title: `Refund for booking ${item.booking_id.slice(0, 8)}`,
        detail: `Status: ${item.status}`,
        createdAt: item.created_at,
        kind: "refund" as const,
        link: "/admin/financial-reviews?view=refunds",
      })),
      ...(payoutResult.data ?? []).map((item) => ({
        id: `payout-${item.id}`,
        title: `Payout for booking ${item.booking_id.slice(0, 8)}`,
        detail: `Status: ${item.status}`,
        createdAt: item.created_at,
        kind: "payout" as const,
        link: "/admin/financial-reviews?view=payouts",
      })),
      ...(retentionResult.data ?? []).map((item) => ({
        id: `retention-${item.id}`,
        title: `${item.request_type.replace(/_/g, " ")} request`,
        detail: `${item.requester_email} · ${item.status.replace(/_/g, " ")}`,
        createdAt: item.created_at,
        kind: "security" as const,
        link: "/admin/retention-requests",
      })),
      ...(reconciliationResult.data ?? []).map((item) => ({
        id: `reconciliation-${item.id}`,
        title: `Reconciliation: ${item.issue_type.replace(/_/g, " ")}`,
        detail: `${item.severity} · ${item.status}`,
        createdAt: item.created_at,
        kind: "security" as const,
        link: "/admin/reconciliation",
      })),
    );
  }

  return items.sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}
