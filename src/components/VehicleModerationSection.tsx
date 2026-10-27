import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle, Loader2, Power, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  ImageAuthenticityBadge,
  ImageAuthenticitySummary,
  useImageAuthenticity,
} from "@/components/ImageAuthenticity";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createPrivateStorageUrlMap } from "@/lib/privateStorage";
import { supabase } from "@/lib/supabase";

type Clearance = {
  id: string;
  status: string;
  note: string | null;
  rejection_reason: string | null;
  created_at: string;
  vehicle_clearance_images: Array<{ storage_path: string }>;
};

const manila = (value: string) =>
  new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

const moderate = async (body: Record<string, unknown>) => {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/vehicle-moderation", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string; state?: string; emailState?: string };
  if (!response.ok) throw new Error(result.error || "The change was not saved");
  if (result.emailState && result.emailState !== "sent") {
    toast.warning("The lister was notified in the app, but the email was not delivered.");
  }
  return result;
};

/**
 * A disabled car in Vehicle Management (CHAPTER 131). Clearance tab: why it
 * was disabled, the lister's latest clearance with its AI image check, and
 * Approve / Reject. Disabled tab: the reason, and Enable.
 */
export default function VehicleModerationSection({
  carId,
  disabledType,
  disabledReason,
  disabledAt,
  canReview,
  onChanged,
}: {
  carId: string;
  disabledType: string | null;
  disabledReason: string | null;
  disabledAt: string | null;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [clearance, setClearance] = useState<Clearance | null | undefined>(undefined);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [saving, setSaving] = useState(false);
  const waiting = clearance?.status === "submitted" ? clearance : null;
  const authenticity = useImageAuthenticity(waiting ? { scope: "clearance", clearanceId: waiting.id } : null);

  const load = useCallback(async () => {
    if (disabledType !== "clearance") return;
    const { data } = await supabase
      .from("vehicle_clearances")
      .select("id, status, note, rejection_reason, created_at, vehicle_clearance_images(storage_path)")
      .eq("car_id", carId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const latest = (data as unknown as Clearance | null) ?? null;
    setClearance(latest);
    setImageUrls(
      latest
        ? await createPrivateStorageUrlMap(
            "vehicle-private-documents",
            latest.vehicle_clearance_images.map((image) => image.storage_path),
          )
        : {},
    );
  }, [carId, disabledType]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (body: Record<string, unknown>, success: string) => {
    setSaving(true);
    try {
      const result = await moderate(body);
      toast.success(success, {
        description:
          result.state === "renewal_required"
            ? "Its papers expired while it was disabled, so it waits for the lister's renewal."
            : result.state === "inactive"
              ? "It is back as inactive; the lister turns it on (their plan's slots must have room)."
              : undefined,
      });
      onChanged();
    } catch (error) {
      toast.error("Not saved", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
      <div>
        <p className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300">
          <Ban className="h-4 w-4" />
          {disabledType === "clearance" ? "Disabled - waiting for a clearance" : "Disabled"}
        </p>
        <p className="mt-1 text-muted-foreground">
          {disabledType === "clearance" ? "Asked the lister for: " : "Reason: "}
          <span className="font-medium text-foreground">{disabledReason ?? "Not recorded"}</span>
          {disabledAt ? ` · since ${manila(disabledAt)}` : ""}
        </p>
      </div>

      {disabledType === "clearance" ? (
        clearance === undefined ? (
          <p className="text-muted-foreground">Loading the clearance...</p>
        ) : !waiting ? (
          <p className="text-muted-foreground">
            {clearance?.status === "rejected"
              ? `The last clearance was rejected (${clearance.rejection_reason}). Waiting for the lister to submit a new one.`
              : "Waiting for the lister to submit a clearance."}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              Clearance submitted {manila(waiting.created_at)}
              {waiting.note ? (
                <>
                  {" "}· Lister&apos;s note: <span className="text-foreground">{waiting.note}</span>
                </>
              ) : null}
            </p>
            <ImageAuthenticitySummary
              state={authenticity}
              paths={waiting.vehicle_clearance_images.map((image) => image.storage_path)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {waiting.vehicle_clearance_images.map((image, index) => (
                <div key={image.storage_path} className="space-y-1">
                  {imageUrls[image.storage_path] ? (
                    <a href={imageUrls[image.storage_path]} target="_blank" rel="noreferrer">
                      <img
                        src={imageUrls[image.storage_path]}
                        alt={`Clearance photo ${index + 1}`}
                        className="aspect-video w-full rounded-lg border object-cover"
                      />
                    </a>
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-lg border text-xs text-muted-foreground">
                      Photo unavailable
                    </div>
                  )}
                  <ImageAuthenticityBadge state={authenticity} path={image.storage_path} />
                </div>
              ))}
            </div>
            {canReview && (
              <div className="space-y-2">
                {showReject && (
                  <div className="space-y-1">
                    <Label htmlFor={`clearance-reject-${carId}`}>Why is it not accepted? *</Label>
                    <textarea
                      id={`clearance-reject-${carId}`}
                      rows={2}
                      maxLength={500}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      disabled={saving}
                      placeholder="Say what the lister should submit instead."
                      className="w-full rounded-md border bg-background p-2 text-sm"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  {!showReject ? (
                    <Button variant="outline" className="gap-2" disabled={saving} onClick={() => setShowReject(true)}>
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="gap-2 text-red-600"
                      disabled={saving || rejectReason.trim().length < 5}
                      onClick={() =>
                        void run(
                          { action: "review_clearance", clearanceId: waiting.id, approve: false, reason: rejectReason.trim() },
                          "Clearance rejected - the lister was told why",
                        )
                      }
                    >
                      <XCircle className="h-4 w-4" /> Confirm reject
                    </Button>
                  )}
                  <Button
                    className="gap-2"
                    disabled={saving}
                    onClick={() =>
                      void run(
                        { action: "review_clearance", clearanceId: waiting.id, approve: true },
                        "Clearance approved - the car is enabled",
                      )
                    }
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Approve clearance
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        canReview && (
          <div className="flex justify-end">
            <Button
              className="gap-2"
              disabled={saving}
              onClick={() => void run({ action: "enable", carId }, "Vehicle enabled")}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              Enable vehicle
            </Button>
          </div>
        )
      )}
    </div>
  );
}
