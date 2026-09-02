import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Search } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { AuditLog } from "@/types/database";

type ProfileSummary = { email: string; full_name: string | null };
type AuditLogWithProfile = AuditLog & { profiles: ProfileSummary | null };

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAction, setFilterAction] = useState("all");

  useEffect(() => {
    void fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data: rawLogs, error } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!rawLogs || rawLogs.length === 0) {
        setLogs([]);
        return;
      }

      const auditLogs = rawLogs as AuditLog[];
      const userIds = [...new Set(auditLogs.map((entry) => entry.user_id).filter(Boolean))] as string[];

      let profileMap: Record<string, ProfileSummary> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);

        if (profiles) {
          profileMap = profiles.reduce<Record<string, ProfileSummary>>(
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

      setLogs(
        auditLogs.map((entry) => ({
          ...entry,
          profiles: entry.user_id ? profileMap[entry.user_id] ?? null : null,
        })),
      );
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to load audit logs", { description: message });
    } finally {
      setLoading(false);
    }
  };

  const actions = Array.from(new Set(logs.map((log) => log.action)));

  const filteredLogs = logs.filter((log) => {
    const searchMatch =
      (log.profiles?.email || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.profiles?.full_name || "")
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.entity_id || "").toLowerCase().includes(searchTerm.toLowerCase());

    const actionMatch = filterAction === "all" || log.action === filterAction;

    return searchMatch && actionMatch;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Audit Logs</h1>
        <p className="mt-1 text-muted-foreground">
          Review all system activities, PII access, and state transitions.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div>
              <CardTitle>Recent Activity Tracker</CardTitle>
              <CardDescription>Max 200 recent rows shown</CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search user, id or action..."
                  className="pl-8 sm:w-[250px]"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={filterAction} onValueChange={(value) => setFilterAction(value || "all")}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {actions.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="rounded-lg border bg-muted/20 py-12 text-center text-muted-foreground">
              <FileText className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
              <p>No audit logs matching query found</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Entity ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {format(new Date(log.created_at), "yyyy-MM-dd h:mm:ss a")}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {log.profiles?.full_name || "System / Unknown"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {log.profiles?.email}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          {log.action}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {log.entity_type || "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-xs">
                            {log.entity_id ? `${log.entity_id.split("-")[0]}...` : "-"}
                          </span>
                          {log.details && Object.keys(log.details).length > 0 && (
                            <pre className="mt-1 whitespace-pre-wrap rounded border bg-muted p-1.5 text-[10px] text-muted-foreground">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
