import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import LivePhotoCapture from "@/components/LivePhotoCapture";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { inspectContentProvenance, type ContentProvenanceResult } from "@/lib/contentProvenance";
import { queueImageChecks } from "@/lib/imageAuthenticity";
import { supabase } from "@/lib/supabase";
import {
  MAX_REPORT_PHOTOS,
  REPORT_MESSAGE_MAX,
  REPORT_MESSAGE_MIN,
  REPORT_STATUS_LABELS,
  reportWindowProblem,
  type ReportWindowBooking,
} from "@/lib/vehicleReports";

/**
 * "Report an issue" with the car (CHAPTER 131). The renter's at the handover,
 * the lister's at the return - one per side per booking. Optional: it never
 * holds up the receipt, the completion or the payout. Once filed, the button
 * becomes the report's status.
 */
export default function VehicleReportButton({
  booking,
  role,
}: {
  booking: ReportWindowBooking & { id: string };
  role: "renter" | "lister";
}) {
  const { user, session } = useAuth();
  const [status, setStatus] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const phase = role === "renter" ? "pickup" : "return";

  const loadStatus = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("vehicle_reports")
      .select("status")
      .eq("booking_id", booking.id)
      .eq("reporter_id", user.id)
      .eq("phase", phase)
      .maybeSingle();
    setStatus(data?.status ?? null);
  }, [booking.id, phase, user?.id]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  if (status === undefined) return null;
  if (status) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {REPORT_STATUS_LABELS[status] ?? REPORT_STATUS_LABELS.open}
      </span>
    );
  }
  if (reportWindowProblem(booking, role)) return null;

  const close = () => {
    if (saving) return;
    setOpen(false);
  };

  const trimmed = message.trim();
  const canSubmit =
    trimmed.length >= REPORT_MESSAGE_MIN && trimmed.length <= REPORT_MESSAGE_MAX && photos.length >= 1 && !saving;

  const submit = async () => {
    if (!user?.id || !session?.access_token || !canSubmit) return;
    setSaving(true);
    const uploaded: Array<{ storagePath: string; provenance?: ContentProvenanceResult }> = [];
    try {
      const folder = `${booking.id}/${user.id}/issue-report-${crypto.randomUUID()}`;
      for (let index = 0; index < photos.length; index += 1) {
        const file = photos[index];
        const storagePath = `${folder}/photo_${index + 1}.jpg`;
        const provenance = await inspectContentProvenance(file);
        const { error } = await supabase.storage
          .from("trip-condition-evidence")
          .upload(storagePath, file, { upsert: false, contentType: "image/jpeg" });
        if (error) throw error;
        uploaded.push({ storagePath, provenance });
      }
      const response = await fetch("/api/submit-vehicle-report", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ bookingId: booking.id, message: trimmed, photos: uploaded }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; reportId?: string };
      if (!response.ok || !result.reportId) throw new Error(result.error || "The report was not saved");
      queueImageChecks({ scope: "report", reportId: result.reportId });
      toast.success("Issue reported", {
        description: "SafeDrive will review it. The other side was told. This does not hold up your booking.",
      });
      setOpen(false);
      setMessage("");
      setPhotos([]);
      setStatus("open");
    } catch (error) {
      await Promise.all(
        uploaded.map((item) => supabase.storage.from("trip-condition-evidence").remove([item.storagePath])),
      );
      toast.error("The report was not sent", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
        onClick={() => setOpen(true)}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Report an issue
      </Button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/80 p-4 py-6 backdrop-blur-sm sm:items-center"
            onClick={close}
          >
            <Card className="w-full max-w-lg text-left" onClick={(e) => e.stopPropagation()}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Report an issue with the car</CardTitle>
                  <CardDescription>
                    {role === "renter"
                      ? "Something wrong with the car you received - a dent, a scratch, a warning light? Report it now so it is on record that it was already there."
                      : "Something wrong with the car you got back? Report it now, with photos, so it is on record."}
                  </CardDescription>
                </div>
                <Button type="button" size="icon" variant="ghost" onClick={close} disabled={saving}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`issue-message-${booking.id}`}>What did you see? *</Label>
                  <textarea
                    id={`issue-message-${booking.id}`}
                    className="min-h-28 w-full rounded-md border bg-background p-3 text-sm"
                    maxLength={REPORT_MESSAGE_MAX}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Example: Dent on the left rear door, about the size of a palm."
                    disabled={saving}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    At least {REPORT_MESSAGE_MIN} characters ({trimmed.length} so far).
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Photos of the issue * (1 to {MAX_REPORT_PHOTOS})</Label>
                  <LivePhotoCapture photos={photos} onChange={setPhotos} max={MAX_REPORT_PHOTOS} disabled={saving} />
                </div>
                <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  SafeDrive reviews every report. Your booking carries on as normal - a report does not stop the trip,
                  the return, or any payment.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" onClick={close} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void submit()} disabled={!canSubmit} className="gap-2">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Send report
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>,
          document.body,
        )}
    </>
  );
}
