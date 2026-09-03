import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarRange,
  RotateCcw,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import type { SecurityLog as SecurityLogRow } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type SecurityLog = SecurityLogRow & {
  profiles: { full_name: string | null; email: string } | null;
};

const LOGS_PER_PAGE = 25;

const eventLabels: Record<string, string> = {
  login_success: "Sign in",
  login_failed: "Failed sign in",
  logout: "Sign out",
  otp_sent: "OTP sent",
  otp_verified: "OTP verified",
  otp_failed: "OTP failed",
  authenticator_challenge_started: "Authenticator challenge",
  authenticator_verified: "Authenticator verified",
  authenticator_failed: "Authenticator failed",
  password_reset_requested: "Password reset requested",
  password_reset_completed: "Password reset completed",
  session_timeout: "Session timeout",
  suspicious_activity: "Security event",
};

const methodLabels: Record<string, string> = {
  password: "Password",
  email_otp: "Email OTP",
  authenticator: "Authenticator",
  recovery_code: "Recovery code",
  support_recovery: "Support recovery",
};

// Best-effort user-agent -> "Browser on OS (device)" for the table. The raw
// string is still stored and shown on hover.
const parseUserAgent = (ua: string | null | undefined) => {
  if (!ua) return { label: "Unknown device", raw: "" };
  const raw = ua;
  let browser = "Unknown browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && /version\//i.test(ua)) browser = "Safari";

  let os = "Unknown OS";
  if (/windows nt 10/i.test(ua)) os = "Windows";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  const isMobile = /mobile|android|iphone|ipad|ipod/i.test(ua);
  return {
    label: `${browser} on ${os} · ${isMobile ? "Mobile" : "Desktop"}`,
    raw,
  };
};

const getRoleLabel = (log: {
  actor_role: string | null;
  actor_is_lister: boolean | null;
  details: unknown;
}) => {
  const details = (log.details ?? {}) as Record<string, unknown>;
  const role = log.actor_role ?? null;
  if (role === "super_admin") return { label: "Super admin", tone: "admin" as const };
  if (role === "admin") return { label: "Admin", tone: "admin" as const };
  if (role === "user") {
    return {
      label: log.actor_is_lister ? "Lister" : "Renter",
      tone: "user" as const,
    };
  }
  // Older rows (before Phase 9) only have the portal hint, and failed logins
  // never had a role at all.
  const portal = String(details.portal ?? "");
  if (portal === "admin") return { label: "Admin portal", tone: "muted" as const };
  if (portal === "user") return { label: "User portal", tone: "muted" as const };
  return { label: "—", tone: "muted" as const };
};

const ROLE_FILTERS = [
  { value: "all", label: "All roles" },
  { value: "super_admin", label: "Super admin" },
  { value: "admin", label: "Admin" },
  { value: "lister", label: "Lister" },
  { value: "renter", label: "Renter" },
] as const;

const toLocalDateTimeValue = (value: Date) => {
  const offset = value.getTimezoneOffset();
  const local = new Date(value.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

const buildSummary = (log: SecurityLog) => {
  const details = (log.details ?? {}) as Record<string, unknown>;
  const action = String(details.action ?? "");
  const portal = String(details.portal ?? "");
  const reason = String(log.failure_reason ?? details.reason ?? "");
  const method = String(log.auth_method ?? details.method ?? "").replace(/_/g, " ");

  if (log.event_type === "login_success") {
    return `${portal === "admin" ? "Admin" : "User"} sign-in completed${method ? ` using ${method}` : ""}.`;
  }

  if (log.event_type === "login_failed") {
    return `${portal === "admin" ? "Admin" : "User"} sign-in failed${method ? ` using ${method}` : ""}${reason ? `: ${reason}` : "."}`;
  }

  if (log.event_type === "logout") {
    return `${portal === "admin" ? "Admin" : "User"} signed out${method ? ` after ${method}` : ""}.`;
  }

  if (log.event_type === "session_timeout") {
    return `${portal === "admin" ? "Admin" : "User"} was signed out after 10 minutes without activity.`;
  }

  if (action === "user_mfa_enrolled" || action === "admin_mfa_enrolled") {
    return `${portal === "admin" ? "Admin" : "User"} connected an authenticator app.`;
  }

  if (log.event_type === "password_reset_requested") {
    return "Password reset email was requested.";
  }

  if (log.event_type === "password_reset_completed") {
    return "Password was updated through the recovery flow.";
  }

  if (reason) return reason;
  if (action) return action.replace(/_/g, " ");
  return "Recorded security event";
};

const getActorName = (log: SecurityLog) => {
  const details = (log.details ?? {}) as Record<string, unknown>;
  return (
    log.profiles?.full_name ||
    log.profiles?.email ||
    String(details.email ?? "").trim() ||
    "System / Unknown"
  );
};

const getActorEmail = (log: SecurityLog) => {
  const details = (log.details ?? {}) as Record<string, unknown>;
  return (
    log.profiles?.email ||
    log.target_email ||
    String(details.email ?? "No user email")
  );
};

export default function AdminSecurityLogsPage() {
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<(typeof ROLE_FILTERS)[number]["value"]>("all");
  const [fromDateTime, setFromDateTime] = useState(
    toLocalDateTimeValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [toDateTime, setToDateTime] = useState(toLocalDateTimeValue(new Date()));
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const { data: rawLogs, error } = await supabase
          .from("security_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500);

        if (error) throw error;

        const userIds = [
          ...new Set(
            (rawLogs ?? [])
              .map((log) => log.user_id)
              .filter((id): id is string => Boolean(id)),
          ),
        ];

        const profileMap: Record<string, { full_name: string | null; email: string }> = {};

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", userIds);

          profiles?.forEach((profile) => {
            profileMap[profile.id] = {
              full_name: profile.full_name,
              email: profile.email,
            };
          });
        }

        setLogs(
          (rawLogs ?? []).map((log) => ({
            ...log,
            profiles: log.user_id ? profileMap[log.user_id] ?? null : null,
          })),
        );
      } catch (error) {
        toast.error("Failed to load security logs", {
          description: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  const filteredLogs = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const fromMs = fromDateTime ? new Date(fromDateTime).getTime() : Number.NEGATIVE_INFINITY;
    const toMs = toDateTime ? new Date(toDateTime).getTime() : Number.POSITIVE_INFINITY;

    return logs.filter((log) => {
      const createdAtMs = new Date(log.created_at).getTime();
      if (Number.isNaN(createdAtMs) || createdAtMs < fromMs || createdAtMs > toMs) {
        return false;
      }

      if (roleFilter !== "all") {
        if (roleFilter === "lister" && !(log.actor_role === "user" && log.actor_is_lister)) {
          return false;
        }
        if (roleFilter === "renter" && !(log.actor_role === "user" && !log.actor_is_lister)) {
          return false;
        }
        if (
          (roleFilter === "admin" || roleFilter === "super_admin") &&
          log.actor_role !== roleFilter
        ) {
          return false;
        }
      }

      if (!search) return true;

      const details = (log.details ?? {}) as Record<string, unknown>;
      const summary = buildSummary(log).toLowerCase();
      const formattedTime = format(new Date(log.created_at), "yyyy-MM-dd h:mm:ss a").toLowerCase();

      return (
        (eventLabels[log.event_type] ?? log.event_type).toLowerCase().includes(search) ||
        log.status.toLowerCase().includes(search) ||
        (methodLabels[log.auth_method ?? ""] ?? log.auth_method ?? "").toLowerCase().includes(search) ||
        (log.profiles?.email ?? "").toLowerCase().includes(search) ||
        (log.profiles?.full_name ?? "").toLowerCase().includes(search) ||
        (log.target_email ?? "").toLowerCase().includes(search) ||
        (log.ip_address ?? "").toLowerCase().includes(search) ||
        (log.session_id ?? "").toLowerCase().includes(search) ||
        getRoleLabel(log).label.toLowerCase().includes(search) ||
        parseUserAgent(log.user_agent).label.toLowerCase().includes(search) ||
        String(details.email ?? "").toLowerCase().includes(search) ||
        String(details.portal ?? "").toLowerCase().includes(search) ||
        String(log.failure_reason ?? details.reason ?? "").toLowerCase().includes(search) ||
        summary.includes(search) ||
        formattedTime.includes(search)
      );
    });
  }, [fromDateTime, logs, roleFilter, searchTerm, toDateTime]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filteredLogs.length, fromDateTime, roleFilter, toDateTime, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / LOGS_PER_PAGE));
  const pageStart = (currentPage - 1) * LOGS_PER_PAGE;
  const pagedLogs = filteredLogs.slice(pageStart, pageStart + LOGS_PER_PAGE);

  const clearFilters = () => {
    setSearchTerm("");
    setRoleFilter("all");
    setFromDateTime(toLocalDateTimeValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
    setToDateTime(toLocalDateTimeValue(new Date()));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Security Logs</h1>
        <p className="text-muted-foreground mt-1">
          Authentication activity, password recovery, and MFA events - with the
          actor's role, source IP, device, and failure reason. Append-only;
          admin-readable.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>Authentication Activity</CardTitle>
                <CardDescription>
                  Latest 500 security events. Filter by role, date, or search
                  event / user / IP / device / reason.
                </CardDescription>
              </div>
              <div className="relative w-full lg:w-[320px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search event, user, IP, device, reason..."
                  className="pl-8"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Role
                </label>
                <Select
                  value={roleFilter}
                  onValueChange={(value) =>
                    setRoleFilter(value as (typeof ROLE_FILTERS)[number]["value"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_FILTERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  From
                </label>
                <Input
                  type="datetime-local"
                  value={fromDateTime}
                  onChange={(event) => setFromDateTime(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  To
                </label>
                <Input
                  type="datetime-local"
                  value={toDateTime}
                  onChange={(event) => setToDateTime(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  className="w-full gap-2 md:w-auto"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset Filters
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="rounded-lg border bg-muted/20 py-12 text-center text-muted-foreground">
              <ShieldCheck className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
              <p className="font-medium">No security logs found</p>
              <p className="mt-1 text-sm">
                Try widening the date range or clearing the search terms.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px]">Time</TableHead>
                      <TableHead className="min-w-[210px]">User</TableHead>
                      <TableHead className="min-w-[110px]">Role</TableHead>
                      <TableHead className="min-w-[120px]">Event</TableHead>
                      <TableHead className="min-w-[110px]">Method</TableHead>
                      <TableHead className="min-w-[130px]">IP address</TableHead>
                      <TableHead className="min-w-[200px]">Device</TableHead>
                      <TableHead className="min-w-[280px]">Summary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedLogs.map((log) => {
                      const details = (log.details ?? {}) as Record<string, unknown>;
                      const isFailure = log.status === "failed";
                      const role = getRoleLabel(log);
                      const device = parseUserAgent(log.user_agent);
                      const reasonText = String(log.failure_reason ?? details.reason ?? "");

                      return (
                        <TableRow key={log.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {format(new Date(log.created_at), "yyyy-MM-dd h:mm:ss a")}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">
                                {getActorName(log)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {getActorEmail(log)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${
                                role.tone === "admin"
                                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : role.tone === "user"
                                    ? "border-primary/20 bg-primary/10 text-primary"
                                    : "border-border bg-muted text-muted-foreground"
                              }`}
                            >
                              {role.label}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${
                                isFailure
                                  ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400"
                                  : "border-primary/20 bg-primary/10 text-primary"
                              }`}
                            >
                              {eventLabels[log.event_type] ?? log.event_type.replace(/_/g, " ")}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            {methodLabels[log.auth_method ?? ""] ??
                              String(log.auth_method ?? details.method ?? "System")}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                            {log.ip_address ?? "—"}
                          </TableCell>
                          <TableCell
                            className="text-xs text-muted-foreground"
                            title={device.raw || undefined}
                          >
                            {device.label}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="text-sm">{buildSummary(log)}</p>
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                {Boolean(details.portal) && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                                    <CalendarRange className="h-3 w-3" />
                                    {String(details.portal) === "admin" ? "Admin portal" : "User portal"}
                                  </span>
                                )}
                                {isFailure && reasonText && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-red-600 dark:text-red-400">
                                    <TriangleAlert className="h-3 w-3" />
                                    {reasonText}
                                  </span>
                                )}
                                {log.session_id && (
                                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono">
                                    session {log.session_id.slice(0, 8)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-3 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {pageStart + 1}-
                  {Math.min(pageStart + LOGS_PER_PAGE, filteredLogs.length)} of {filteredLogs.length}
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
        </CardContent>
      </Card>
    </div>
  );
}
