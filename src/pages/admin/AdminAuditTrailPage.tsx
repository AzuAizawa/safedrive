import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ClipboardList, ChevronDown } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { toast } from "sonner";
import type { AuditLog, Json } from "@/types/database";

interface AuditEntry extends AuditLog {
  profiles: { full_name: string | null; email: string } | null;
}

const actionLabels: Record<string, string> = {
  verification_submitted: "Submitted verification",
  admin_approved_verification: "Approved user verification",
  admin_rejected_verification: "Rejected user verification",
  admin_created_support_ticket: "Created support ticket",
  admin_replied_support_ticket: "Replied to support ticket",
  admin_reopened_support_ticket: "Reopened support ticket",
  admin_resolved_support_ticket: "Resolved support ticket",
  super_admin_updated_platform_commission: "Updated platform commission",
  vehicle_submitted: "Submitted vehicle for approval",
  admin_approved_vehicle: "Approved vehicle listing",
  admin_rejected_vehicle: "Rejected vehicle listing",
  booking_created: "Created booking request",
  payout_sent: "Sent owner payout",
  payout_sent_auto: "Automatic payout released",
  payout_auto_failed: "Automatic payout failed",
  payout_auto_pending: "Automatic payout in progress",
  payout_marked_manual: "Manual payout marked paid",
  refund_marked_manual: "Manual refund marked released",
  booking_refund_requested_auto: "Refund started",
  booking_refund_completed_auto: "Refund completed",
  booking_refund_failed_auto: "Refund needs review",
  car_inquiry_sent: "Car inquiry sent",
  return_reminder_sweep: "Return reminder sweep",
  guest_inquiry_review_started: "Started inquiry review",
  guest_inquiry_replied: "Replied to inquiry",
  guest_inquiry_resolved: "Marked inquiry resolved",
  guest_inquiry_followup: "User added an inquiry follow-up",
  super_admin_updated_pricing_settings: "Updated pricing settings",
  platform_contact_email_updated: "Updated platform contact email",
  renter_cancelled_booking: "Renter cancelled booking",
  owner_cancelled_booking: "Lister cancelled booking",
  admin_added_car_brand: "Added car brand",
  admin_added_car_model: "Added car model",
  admin_deleted_car_brand: "Deleted car brand",
  admin_deleted_vehicle: "Deleted vehicle listing",
  owner_accepted_booking: "Lister accepted booking",
  owner_rejected_booking: "Lister rejected booking",
  owner_arrived_booking: "Lister arrived at pickup",
  renter_arrived_booking: "Renter arrived at pickup",
  renter_completed_booking: "Renter marked trip complete",
  owner_completed_booking: "Lister marked trip complete",
  downpayment_paid: "Downpayment paid",
  full_payment_paid: "Full booking payment paid",
  balance_paid: "Balance paid",
};

const actionCategoryLabels: Record<string, string> = {
  all: "All",
  verification: "Verification",
  booking: "Booking",
  payout: "Payout",
  vehicle: "Vehicle",
  admin: "Admin Setup",
  support: "Support",
  system: "System Jobs",
  other: "Other",
};

const getActionCategory = (action: string) => {
  if (action.includes("verification")) return "verification";
  if (action.includes("inquiry") || action.includes("support_ticket")) return "support";
  if (action.includes("return_reminder") || action.includes("sweep") || action.includes("cron")) return "system";
  if (
    action.includes("booking") ||
    action.includes("downpayment") ||
    action.includes("full_payment") ||
    action.includes("balance") ||
    action.includes("refund") ||
    action.includes("check_in")
  ) {
    return "booking";
  }
  if (action.includes("payout")) return "payout";
  if (
    action.includes("vehicle") ||
    action.includes("car_brand") ||
    action.includes("car_model")
  ) {
    return "vehicle";
  }
  if (action.includes("admin_")) return "admin";
  return "other";
};

const detailLabels: Record<string, string> = {
  transitioned_to: "Status changed to",
  arrival_time: "Arrival time",
  payment_deadline: "Payment deadline",
  amount: "Amount",
  reason: "Reason",
  admin_email: "Admin email",
  webhook: "Webhook confirmed",
  check_in_complete: "Check-in complete",
  car_id: "Car ID",
  plate: "Plate number",
  transaction_id: "Transaction ID",
  transfer_id: "Transfer ID",
  reference_number: "Reference number",
  callback_confirmed: "Callback confirmed",
  callback_status: "Callback status",
  provider_error: "Provider error",
  payout_method: "Payout method",
  payout_account_name: "Payout account name",
  payout_account_number: "Payout account number",
  total_price: "Total price",
  refund_state: "Refund status",
  mode: "Status",
  booking_id: "Booking ID",
  entity_id: "Entity ID",
  vehicle: "Vehicle",
  checked: "Bookings checked",
  notifications_created: "Notifications created",
  email_reminders: "Emails sent",
  email_states: "Email status",
  gmail_reminders: "Gmail reminders",
  gmail_states: "Gmail status",
  refund_method: "Refund method",
};

const hiddenDetailKeys = new Set([
  "amount_in_centavos",
  "booking_id",
  "car_id",
  "checkout_id",
  "checkout_session_id",
  "entity_id",
  "lister_id",
  "payment_id",
  "refund_ids",
  "refund_payment_ids",
  "source_payment_id",
  "source_transaction_ids",
  "transfer_id",
]);

const titleCaseWords = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const humanizeKey = (key: string) => detailLabels[key] || titleCaseWords(key.replace(/_/g, " "));

const humanizeAction = (action: string) => actionLabels[action] || titleCaseWords(action.replace(/_/g, " "));

const formatStatusText = (value: string) => titleCaseWords(value.replace(/_/g, " "));

const formatReasonText = (value: string) => {
  if (value === "requested_by_customer") return "Requested by renter";
  if (value === "duplicate") return "Duplicate payment";
  if (value === "fraudulent") return "Marked as fraudulent";
  if (value === "others") return "Other reason";
  return formatStatusText(value);
};

const formatRefundStatus = (value: string) => {
  if (value === "pending") return "Waiting for provider confirmation";
  if (value === "completed" || value === "succeeded") return "Completed";
  if (value === "failed") return "Needs admin review";
  if (value === "manual_review") return "Manual refund review";
  return formatStatusText(value);
};

const formatDetailValue = (value: Json): string => {
  if (value === null) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const parsed = parseISO(value);
      if (isValid(parsed)) {
        return format(parsed, "MMM d, yyyy h:mm a");
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatDetailValue(item)).join(", ");
  }
  return Object.entries(value)
    .filter(([, nestedValue]) => nestedValue !== null && nestedValue !== "")
    .map(([key, nestedValue]) => `${humanizeKey(key)}: ${formatDetailValue(nestedValue as Json)}`)
    .join("; ");
};

const normalizeDetails = (details: Json | null) => {
  if (typeof details === "string") {
    try {
      const parsed = JSON.parse(details) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, Json>)
        : { note: details };
    } catch {
      return { note: details };
    }
  }

  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, Json>)
    : null;
};

const formatDetailEntries = (action: string, details: Json | null) => {
  const normalizedDetails = normalizeDetails(details);
  if (!normalizedDetails) {
    return [] as Array<{ label: string; value: string }>;
  }

  return Object.entries(normalizedDetails)
    .filter(([key, value]) => !hiddenDetailKeys.has(key) && value !== null && value !== "")
    .map(([key, value]) => {
      let formattedValue = formatDetailValue(value as Json);
      let label = humanizeKey(key);

      if ((key === "amount" || key === "total_price") && typeof value === "number") {
        formattedValue = `PHP ${Number(value).toLocaleString()}`;
      }
      if (key === "amount" && action.includes("refund") && typeof value === "number") {
        formattedValue = `PHP ${Math.abs(Number(value)).toLocaleString()}`;
      }
      if (key === "transitioned_to" && typeof value === "string") {
        formattedValue = formatStatusText(value);
      }
      if ((key === "refund_state" || key === "mode") && typeof value === "string") {
        label = "Refund status";
        formattedValue = formatRefundStatus(value);
      }
      if (key === "reason" && typeof value === "string") {
        formattedValue = formatReasonText(value);
      }
      if (key === "webhook" && typeof value === "boolean") {
        label = "Payment confirmation";
        formattedValue = value ? "Received from PayMongo" : "Not confirmed yet";
      }
      if (key === "reference_number") {
        label = "Reference number";
      }
      return {
        label,
        value: formattedValue,
      };
    })
    .filter((detail) => detail.value !== "-" && detail.value.trim().length > 0);
};

const isRoutineAutomationEntry = (entry: AuditEntry) => {
  if (entry.action !== "return_reminder_sweep") return false;
  const details = normalizeDetails(entry.details);
  if (!details) return true;
  const checked = Number(details.checked ?? details.bookings_checked ?? 0);
  const reminders = Number(details.email_reminders ?? details.gmail_reminders ?? 0);
  const notifications = Number(details.notifications_created ?? 0);
  return checked === 0 && reminders === 0 && notifications === 0;
};

export default function AdminAuditTrailPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showRoutineAutomation, setShowRoutineAutomation] = useState(false);

  useEffect(() => {
    void fetchEntries();
  }, []);

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const { data: rawEntries, error } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!rawEntries || rawEntries.length === 0) {
        setEntries([]);
        return;
      }

      const auditRows = rawEntries as AuditLog[];
      const userIds = [...new Set(auditRows.map((entry) => entry.user_id).filter(Boolean))] as string[];

      let profileMap: Record<string, { full_name: string | null; email: string }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);

        if (profiles) {
          profileMap = profiles.reduce<Record<string, { full_name: string | null; email: string }>>(
            (accumulator, profile) => {
              accumulator[profile.id] = {
                full_name: profile.full_name,
                email: profile.email,
              };
              return accumulator;
            },
            {},
          );
        }
      }

      setEntries(
        auditRows.map((entry) => ({
          ...entry,
          profiles: entry.user_id ? profileMap[entry.user_id] ?? null : null,
        })),
      );
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to load audit trail", { description: message });
    } finally {
      setLoading(false);
    }
  };

  const uniqueActions = [...new Set(entries.map((entry) => entry.action))];

  const usefulEntries = entries.filter((entry) => !isRoutineAutomationEntry(entry));
  const routineAutomationCount = entries.length - usefulEntries.length;

  const categoryOptions = Object.entries(actionCategoryLabels)
    .map(([value, label]) => ({
      value,
      label,
      count:
        value === "all"
          ? usefulEntries.length
          : usefulEntries.filter((entry) => getActionCategory(entry.action) === value).length,
    }))
    .filter((option) => option.value === "all" || option.count > 0);

  const filtered = entries.filter((entry) => {
    const matchesAction = actionFilter === "all" || entry.action === actionFilter;
    const matchesCategory =
      categoryFilter === "all" || getActionCategory(entry.action) === categoryFilter;
    const matchesRoutineVisibility = showRoutineAutomation || !isRoutineAutomationEntry(entry);
    const matchesSearch =
      search === "" ||
      (entry.profiles?.full_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (entry.profiles?.email || "").toLowerCase().includes(search.toLowerCase()) ||
      humanizeAction(entry.action).toLowerCase().includes(search.toLowerCase());
    return matchesAction && matchesCategory && matchesSearch && matchesRoutineVisibility;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Trail</h1>
        <p className="mt-1 text-muted-foreground">
          Important staff, booking, payment, verification, and vehicle changes. Repetitive no-result system jobs are hidden by default.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by user or action..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-9"
          />
        </div>
        <Select value={actionFilter} onValueChange={(value) => value && setActionFilter(value)}>
          <SelectTrigger className="h-10 w-full sm:w-56">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {uniqueActions.map((action) => (
              <SelectItem key={action} value={action}>
                {humanizeAction(action)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        {categoryOptions.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={categoryFilter === option.value ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setCategoryFilter(option.value)}
          >
            {option.label}
            <span className="ml-1 text-[11px] opacity-80">{option.count}</span>
          </Button>
        ))}
        {routineAutomationCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-full text-muted-foreground"
            onClick={() => setShowRoutineAutomation((visible) => !visible)}
          >
            {showRoutineAutomation ? "Hide" : "Show"} {routineAutomationCount} routine system job{routineAutomationCount === 1 ? "" : "s"}
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <ClipboardList className="mx-auto mb-4 h-16 w-16 text-muted-foreground/30" />
          <h3 className="text-lg font-semibold">No audit entries</h3>
        </div>
      ) : (
        <Card className="divide-y divide-border/60 overflow-hidden">
          {filtered.map((entry) => {
            const detailEntries = formatDetailEntries(entry.action, entry.details);
            const actionCategory = getActionCategory(entry.action);
            // A null actor is either genuine automation or a staff member who
            // has since been deleted (audit_log.user_id -> NULL). Use the action
            // to guess which so a person's past work is not mislabelled "system".
            const actor =
              entry.profiles?.full_name ||
              entry.profiles?.email ||
              (actionCategory === "system" || isRoutineAutomationEntry(entry)
                ? "SafeDrive system"
                : "Former staff");
            return (
              <article key={entry.id} className="p-4 transition-colors hover:bg-muted/20 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{humanizeAction(entry.action)}</h2>
                      <span className="rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {actionCategoryLabels[actionCategory]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {actor}
                      {entry.entity_type ? ` · ${titleCaseWords(entry.entity_type.replace(/_/g, " "))}` : ""}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {format(new Date(entry.created_at), "MMM d, yyyy h:mm a")}
                  </time>
                </div>

                {detailEntries.length > 0 ? (
                  <details className="group mt-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>View recorded details ({detailEntries.length})</span>
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <dl className="mt-3 grid gap-2 border-t border-border/50 pt-3 sm:grid-cols-2">
                      {detailEntries.map((detail) => (
                        <div key={`${entry.id}-${detail.label}`} className="min-w-0 text-xs">
                          <dt className="font-medium text-foreground/80">{detail.label}</dt>
                          <dd className="mt-0.5 break-words text-muted-foreground">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </article>
            );
          })}
        </Card>
      )}
    </div>
  );
}

