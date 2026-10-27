import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, Clock, ImagePlus, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { queueImageChecks } from "@/lib/imageAuthenticity";
import { supabase } from "@/lib/supabase";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

type Clearance = { id: string; status: string; rejection_reason: string | null; created_at: string };

/**
 * A car SafeDrive disabled (CHAPTER 131), on the lister's Document Renewal &
 * Updates page. For clearance: what SafeDrive asked for, the latest
 * clearance's status, and the upload (1-4 images, AI-checked). For another
 * reason: the reason, and that only SafeDrive can enable it.
 */
export default function VehicleClearancePanel({
  carId,
  disabledType,
  disabledReason,
  onSubmitted,
}: {
  carId: string;
  disabledType: string | null;
  disabledReason: string | null;
  onSubmitted?: () => void;
}) {
  const { user } = useAuth();
  const [latest, setLatest] = useState<Clearance | null | undefined>(undefined);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("vehicle_clearances")
      .select("id, status, rejection_reason, created_at")
      .eq("car_id", carId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLatest((data as Clearance | null) ?? null);
  }, [carId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (disabledType !== "clearance") {
    return (
      <section className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300">
          <Ban className="h-4 w-4" /> Disabled by SafeDrive
        </p>
        <p className="text-muted-foreground">Reason: {disabledReason ?? "Not given"}</p>
        <p className="text-muted-foreground">
          Renters cannot see or book this car. There is nothing to submit - only SafeDrive can enable it again.
          Contact Support if you have questions.
        </p>
      </section>
    );
  }

  const waiting = latest?.status === "submitted";

  const pickFiles = (picked: FileList | null) => {
    const next = [...files];
    for (const file of Array.from(picked ?? [])) {
      if (!ACCEPTED_TYPES[file.type]) {
        toast.error(`${file.name} is not a JPG, PNG or WebP image.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name} is larger than 8 MB.`);
        continue;
      }
      next.push(file);
    }
    if (next.length > MAX_IMAGES) toast.error(`Attach up to ${MAX_IMAGES} images.`);
    setFiles(next.slice(0, MAX_IMAGES));
  };

  const submit = async () => {
    if (!user?.id || files.length < 1 || saving) return;
    setSaving(true);
    const uploaded: string[] = [];
    try {
      const folder = `${user.id}/${carId}/clearance-${crypto.randomUUID()}`;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const path = `${folder}/${index + 1}.${ACCEPTED_TYPES[file.type]}`;
        const { error } = await supabase.storage
          .from("vehicle-private-documents")
          .upload(path, file, { upsert: false, contentType: file.type });
        if (error) throw error;
        uploaded.push(path);
      }
      const { data: clearanceId, error } = await supabase.rpc("submit_vehicle_clearance", {
        p_car_id: carId,
        p_note: note.trim() || null,
        p_paths: uploaded,
      });
      if (error) throw error;
      if (clearanceId) queueImageChecks({ scope: "clearance", clearanceId });
      toast.success("Clearance submitted", { description: "SafeDrive will review it. You'll be notified of the decision." });
      setFiles([]);
      setNote("");
      await load();
      onSubmitted?.();
    } catch (error) {
      if (uploaded.length) await supabase.storage.from("vehicle-private-documents").remove(uploaded);
      toast.error("The clearance was not submitted", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-sm">
      <div>
        <p className="flex items-center gap-2 font-semibold text-orange-700 dark:text-orange-300">
          <Ban className="h-4 w-4" /> Disabled by SafeDrive - clearance needed
        </p>
        <p className="mt-1 text-muted-foreground">
          What SafeDrive asked for: <span className="font-medium text-foreground">{disabledReason ?? "Not given"}</span>
        </p>
        <p className="mt-1 text-muted-foreground">
          Renters cannot see or book this car until you submit a clearance - dated photos showing it is fit to rent -
          and SafeDrive approves it.
        </p>
      </div>

      {latest === undefined ? null : waiting ? (
        <p className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
          <Clock className="h-4 w-4" /> Clearance sent · waiting for SafeDrive's review.
        </p>
      ) : (
        <>
          {latest?.status === "rejected" && (
            <p className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Your last clearance was not accepted: {latest.rejection_reason}. Submit a new one below.</span>
            </p>
          )}
          {latest?.status === "approved" && (
            <p className="flex items-center gap-2 text-green-700 dark:text-green-300">
              <CheckCircle2 className="h-4 w-4" /> A previous clearance was approved.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor={`clearance-files-${carId}`}>Clearance photos * (1 to {MAX_IMAGES}, JPG/PNG/WebP, up to 8 MB each)</Label>
            <label
              htmlFor={`clearance-files-${carId}`}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-background p-4 text-muted-foreground hover:bg-muted/50"
            >
              <ImagePlus className="h-5 w-5" /> Choose photos ({files.length}/{MAX_IMAGES})
            </label>
            <input
              id={`clearance-files-${carId}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              disabled={saving || files.length >= MAX_IMAGES}
              onChange={(e) => {
                pickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1 text-xs">
                    <span className="truncate">{file.name}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2"
                      disabled={saving}
                      onClick={() => setFiles(files.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`clearance-note-${carId}`}>Note to SafeDrive (optional)</Label>
            <textarea
              id={`clearance-note-${carId}`}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
              placeholder="Example: Door repaired at the casa on Oct 20; receipt in photo 2."
              className="w-full rounded-md border bg-background p-2 text-sm"
            />
          </div>
          <Button onClick={() => void submit()} disabled={saving || files.length < 1} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit clearance
          </Button>
        </>
      )}
    </section>
  );
}
