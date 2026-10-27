import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertTriangle, Ban, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import AdminSectionTabs from "@/components/AdminSectionTabs";
import BookingPagination from "@/components/BookingPagination";
import DisableVehicleDialog from "@/components/DisableVehicleDialog";
import {
  ImageAuthenticityBadge,
  ImageAuthenticitySummary,
  useImageAuthenticity,
} from "@/components/ImageAuthenticity";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { createPrivateStorageUrlMap } from "@/lib/privateStorage";
import { supabase } from "@/lib/supabase";
import { usePagedItems } from "@/lib/usePagedItems";
import { describeReportCount } from "@/lib/vehicleReports";

type ReportStatus = "open" | "reviewed" | "dismissed";

type VehicleReport = {
  id: string;
  booking_id: string;
  car_id: string;
  reporter_role: "renter" | "lister";
  phase: "pickup" | "return";
  message: string;
  status: ReportStatus;
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  cars: {
    plate_number: string;
    status: string;
    disabled_type: string | null;
    car_models: { name: string; car_brands: { name: string } } | null;
  } | null;
  reporter: { full_name: string | null; email: string | null } | null;
  bookings: { start_date: string; end_date: string } | null;
  vehicle_report_photos: Array<{ storage_path: string }>;
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open",
  reviewed: "Reviewed",
  dismissed: "Dismissed",
};

const STATUS_CLASSES: Record<ReportStatus, string> = {
  open: "bg-amber-500/10 text-amber-600",
  reviewed: "bg-blue-500/10 text-blue-600",
  dismissed: "bg-muted text-muted-foreground",
};

const manila = (value: string) =>
  new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

const vehicleOf = (report: VehicleReport) =>
  report.cars?.car_models
    ? `${report.cars.car_models.car_brands.name} ${report.cars.car_models.name} (${report.cars.plate_number})`
    : report.cars?.plate_number ?? "Vehicle";

/**
 * Vehicle Reports (CHAPTER 131): what renters saw at the handover and listers
 * at the return. Staff mark each one reviewed (it was real) or dismissed, and
 * may disable the car from here. A car's confirmed (reviewed) reports are
 * counted for repeated damage; nothing happens to a car automatically.
 */
export default function AdminVehicleReportsPage() {
  const { can } = useAuth();
  const canReview = can("vehicles.review");
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<"all" | ReportStatus>("open");
  const [reports, setReports] = useState<VehicleReport[]>([]);
  const [confirmedByCar, setConfirmedByCar] = useState<Record<string, number>>({});
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("report"));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [disableFor, setDisableFor] = useState<VehicleReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("vehicle_reports")
      .select(
        "id, booking_id, car_id, reporter_role, phase, message, status, admin_note, reviewed_at, created_at, cars!vehicle_reports_car_id_fkey(plate_number, status, disabled_type, car_models(name, car_brands(name))), reporter:profiles!vehicle_reports_reporter_id_fkey(full_name, email), bookings(start_date, end_date), vehicle_report_photos(storage_path)",
      )
      .order("created_at", { ascending: false });
    if (filter !== "all") query = query.eq("status", filter);
    const { data, error } = await query;
    if (error) {
      toast.error("Vehicle reports could not be loaded", { description: error.message });
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as unknown as VehicleReport[];
    setReports(rows);

    // Repeated damage: every confirmed report on each car shown.
    const carIds = [...new Set(rows.map((row) => row.car_id))];
    if (carIds.length) {
      const { data: confirmed } = await supabase
        .from("vehicle_reports")
        .select("car_id")
        .eq("status", "reviewed")
        .in("car_id", carIds);
      const counts: Record<string, number> = {};
      for (const row of confirmed ?? []) counts[row.car_id] = (counts[row.car_id] ?? 0) + 1;
      setConfirmedByCar(counts);
    } else {
      setConfirmedByCar({});
    }
    setPhotoUrls(
      await createPrivateStorageUrlMap(
        "trip-condition-evidence",
        rows.flatMap((row) => row.vehicle_report_photos.map((photo) => photo.storage_path)),
      ),
    );
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = usePagedItems(reports, filter);
  const selected = useMemo(() => reports.find((report) => report.id === selectedId) ?? null, [reports, selectedId]);
  const authenticity = useImageAuthenticity(selected ? { scope: "report", reportId: selected.id } : null);

  const select = (report: VehicleReport) => {
    setSelectedId(report.id);
    setNote(report.admin_note ?? "");
    setSearchParams({ report: report.id }, { replace: true });
  };

  const decide = async (status: "reviewed" | "dismissed") => {
    if (!selected) return;
    setSaving(true);
    const { error } = await supabase.rpc("review_vehicle_report", {
      p_report_id: selected.id,
      p_status: status,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error("The report was not updated", { description: error.message });
      return;
    }
    toast.success(status === "reviewed" ? "Marked reviewed" : "Report dismissed");
    await load();
  };

  const carTab = (report: VehicleReport) =>
    report.cars?.status === "disabled"
      ? report.cars.disabled_type === "clearance"
        ? "clearance"
        : "disabled"
      : "active";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Vehicle Reports</h1>
        <p className="mt-1 text-muted-foreground">
          Issues renters reported at the handover and listers at the return. Mark each one reviewed if it was real, or
          dismiss it. A report never holds up a booking or a payout; you decide whether the car is disabled.
        </p>
      </div>

      <AdminSectionTabs
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setSelectedId(null);
        }}
        ariaLabel="Vehicle report status"
        tabs={[
          { value: "open", label: "Open" },
          { value: "reviewed", label: "Reviewed" },
          { value: "dismissed", label: "Dismissed" },
          { value: "all", label: "All" },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-2 lg:col-span-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-lg" />)
          ) : reports.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              No {filter === "all" ? "" : STATUS_LABELS[filter].toLowerCase() + " "}reports.
            </p>
          ) : (
            <>
              {pages.items.map((report) => {
                const confirmed = confirmedByCar[report.car_id] ?? 0;
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => select(report)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selectedId === report.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{report.cars?.plate_number ?? "Vehicle"}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_CLASSES[report.status]}`}>
                        {STATUS_LABELS[report.status]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {report.reporter_role === "renter" ? "Renter, at the handover" : "Lister, at the return"} ·{" "}
                      {manila(report.created_at)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm">{report.message}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {confirmed > 0 && (
                        <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                          {describeReportCount(confirmed)} on this car
                        </span>
                      )}
                      {report.cars?.status === "disabled" && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          Car disabled
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              <BookingPagination {...pages.paginationProps} noun="reports" />
            </>
          )}
        </div>

        <div className="lg:col-span-3">
          {!selected ? (
            <div className="flex h-full min-h-60 flex-col items-center justify-center rounded-xl border border-dashed text-muted-foreground">
              <AlertTriangle className="mb-2 h-8 w-8 opacity-50" />
              <p className="text-sm">Select a report to review it.</p>
            </div>
          ) : (
            <div className="space-y-5 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{vehicleOf(selected)}</h2>
                  <p className="text-sm text-muted-foreground">
                    Reported by the {selected.reporter_role} ({selected.reporter?.full_name || selected.reporter?.email || "member"}),{" "}
                    {selected.phase === "pickup" ? "at the handover" : "at the return"}, {manila(selected.created_at)}
                  </p>
                  {selected.bookings && (
                    <p className="text-xs text-muted-foreground">
                      Booking {selected.booking_id.slice(0, 8)} · {selected.bookings.start_date} to {selected.bookings.end_date}
                    </p>
                  )}
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${STATUS_CLASSES[selected.status]}`}>
                  {STATUS_LABELS[selected.status]}
                </span>
              </div>

              <p className="whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-sm">{selected.message}</p>

              <div className="space-y-2">
                <ImageAuthenticitySummary
                  state={authenticity}
                  paths={selected.vehicle_report_photos.map((photo) => photo.storage_path)}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  {selected.vehicle_report_photos.map((photo, index) => (
                    <div key={photo.storage_path} className="space-y-1">
                      {photoUrls[photo.storage_path] ? (
                        <a href={photoUrls[photo.storage_path]} target="_blank" rel="noreferrer">
                          <img
                            src={photoUrls[photo.storage_path]}
                            alt={`Report photo ${index + 1}`}
                            className="aspect-video w-full rounded-lg border object-cover"
                          />
                        </a>
                      ) : (
                        <div className="flex aspect-video items-center justify-center rounded-lg border text-xs text-muted-foreground">
                          Photo unavailable
                        </div>
                      )}
                      <ImageAuthenticityBadge state={authenticity} path={photo.storage_path} />
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-sm">
                <span className="font-medium">{describeReportCount(confirmedByCar[selected.car_id] ?? 0)}</span>{" "}
                <span className="text-muted-foreground">on this car so far.</span>{" "}
                <Link
                  to={`/admin/vehicle-approval?tab=${carTab(selected)}&vehicle=${selected.car_id}`}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Open the car in Vehicle Management
                </Link>
              </p>

              {canReview && (
                <div className="space-y-3 border-t pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="report-note">Note (optional)</Label>
                    <textarea
                      id="report-note"
                      rows={2}
                      maxLength={1000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      disabled={saving}
                      placeholder="What you found - kept with the report."
                      className="w-full rounded-md border bg-background p-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                    <Button variant="outline" className="gap-2" disabled={saving} onClick={() => void decide("dismissed")}>
                      <XCircle className="h-4 w-4" /> Dismiss
                    </Button>
                    <Button variant="outline" className="gap-2" disabled={saving} onClick={() => void decide("reviewed")}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Mark reviewed
                    </Button>
                    {selected.cars && selected.cars.status !== "disabled" && (
                      <Button variant="destructive" className="gap-2" disabled={saving} onClick={() => setDisableFor(selected)}>
                        <Ban className="h-4 w-4" /> Disable car
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {disableFor && (
        <DisableVehicleDialog
          carId={disableFor.car_id}
          vehicleLabel={vehicleOf(disableFor)}
          reportId={disableFor.id}
          onClose={() => setDisableFor(null)}
          onDisabled={() => {
            setDisableFor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
