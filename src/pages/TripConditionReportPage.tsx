import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, MapPin, X } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  inspectContentProvenance,
  type ContentProvenanceResult,
} from "@/lib/contentProvenance";

const requiredPhotos = [
  ["front", "Front"], ["back", "Back"], ["odometer", "Odometer"], ["fuel_or_battery", "Fuel or battery"],
] as const;

const optionalPhotos = [
  ["left", "Left side"], ["right", "Right side"], ["interior", "Interior"],
] as const;

const allPhotoSlots = [...requiredPhotos, ...optionalPhotos];

// The lister's required pickup report uses free-form live-camera photos
// instead of the fixed categories above - see MAX_LIVE_PHOTOS usage below.
// Return reports (either party) and the renter's own optional pickup report
// are unaffected and keep the fixed-category file-upload flow.
const MAX_LIVE_PHOTOS = 4;

export default function TripConditionReportPage() {
  const { bookingId = "", phase = "" } = useParams();
  const { user, session, profile } = useAuth();
  const validPhase = phase === "pickup" || phase === "return" ? phase : null;
  const [bookingAllowed, setBookingAllowed] = useState<boolean | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [odometer, setOdometer] = useState("");
  const [level, setLevel] = useState("");
  const [damageNotes, setDamageNotes] = useState("");
  const [location, setLocation] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [locationConsent, setLocationConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reporterRole, setReporterRole] = useState<"renter" | "lister" | null>(null);

  // Free-form live-camera pickup photos (lister's required pickup report only).
  const [livePhotos, setLivePhotos] = useState<File[]>([]);
  const [livePhotoPreviews, setLivePhotoPreviews] = useState<string[]>([]);
  const livePhotoPreviewsRef = useRef<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!user?.id || !bookingId || !validPhase) return;
    void (async () => {
      const { data: booking } = await supabase.from("bookings").select("id, renter_id, owner_id").eq("id", bookingId).maybeSingle();
      setBookingAllowed(Boolean(booking && [booking.renter_id, booking.owner_id].includes(user.id)));
      setReporterRole(
        booking?.renter_id === user.id ? "renter" : booking?.owner_id === user.id ? "lister" : null,
      );
      const { data: report } = await supabase.from("trip_condition_reports").select("id").eq("booking_id", bookingId).eq("reporter_id", user.id).eq("phase", validPhase).maybeSingle();
      setAlreadySubmitted(Boolean(report));
    })();
  }, [bookingId, user?.id, validPhase]);

  useEffect(() => {
    livePhotoPreviewsRef.current = livePhotoPreviews;
  }, [livePhotoPreviews]);

  useEffect(
    () => () => {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      livePhotoPreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  useEffect(() => {
    if (!cameraStream || !videoRef.current) return;
    videoRef.current.srcObject = cameraStream;
    void videoRef.current.play();
  }, [cameraOpen, cameraStream]);

  const returnTo = profile?.is_lister ? "/lister-bookings" : "/my-bookings";
  // The lister's required pickup report is the only one that uses free-form
  // live-camera photos. Everything else (return, either role; the renter's
  // optional pickup report) keeps the fixed-category file-upload flow below.
  const isLiveLisPickup = validPhase === "pickup" && reporterRole === "lister";
  // Photos are required only for the party that owns the evidence at this phase:
  // the lister at pickup, the renter at return. The other side is optional.
  const photosRequired =
    (validPhase === "pickup" && reporterRole === "lister") ||
    (validPhase === "return" && reporterRole === "renter");
  const allFilesReady = useMemo(
    () =>
      isLiveLisPickup
        ? livePhotos.length >= 1
        : requiredPhotos.every(([category]) => files[category]),
    [isLiveLisPickup, livePhotos, files],
  );
  const anyFile = useMemo(
    () =>
      isLiveLisPickup
        ? livePhotos.length > 0
        : allPhotoSlots.some(([category]) => files[category]),
    [isLiveLisPickup, livePhotos, files],
  );
  const missingRequired = useMemo(
    () => requiredPhotos.filter(([category]) => !files[category]).map(([, label]) => label),
    [files],
  );
  const canSubmitNormally = photosRequired ? allFilesReady : true;

  const captureLocation = () => {
    if (!navigator.geolocation) return toast.error("Location is not available in this browser");
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }); setLocationConsent(true); toast.success("Optional location captured"); },
      () => toast.error("Location was not captured. You can still submit without it."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const stopCameraStream = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const closeCamera = () => {
    stopCameraStream();
    setCameraOpen(false);
    setCameraError("");
  };

  const openCamera = async () => {
    if (livePhotos.length >= MAX_LIVE_PHOTOS) {
      toast.error(`You can add up to ${MAX_LIVE_PHOTOS} photos.`);
      return;
    }
    setCameraOpen(true);
    setCameraError("");
    setIsStartingCamera(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera capture is not supported by this browser. Use the waiver option below if you have no other device with a camera.",
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraStream(stream);
    } catch (error) {
      setCameraError(
        error instanceof Error
          ? error.message
          : "Unable to start the camera.",
      );
    } finally {
      setIsStartingCamera(false);
    }
  };

  const capturePickupPhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      toast.error("Camera is still loading. Please try again.");
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    // No mirror flip here - this is a rear-camera shot of the vehicle, not a
    // selfie, so the captured frame should match what the camera actually saw.
    context.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );

    if (!blob) {
      toast.error("Failed to capture photo. Please try again.");
      return;
    }
    if (blob.size > 8 * 1024 * 1024) {
      toast.error("Photo is larger than 8 MB. Please try again.");
      return;
    }

    const file = new File(
      [blob],
      `pickup_live_${Date.now()}_${livePhotos.length + 1}.jpg`,
      { type: "image/jpeg" },
    );

    setLivePhotos((current) => [...current, file].slice(0, MAX_LIVE_PHOTOS));
    setLivePhotoPreviews((current) =>
      [...current, URL.createObjectURL(blob)].slice(0, MAX_LIVE_PHOTOS),
    );
    toast.success("Photo captured");
    closeCamera();
  };

  const removeLivePhoto = (index: number) => {
    setLivePhotoPreviews((current) => {
      const url = current[index];
      if (url) URL.revokeObjectURL(url);
      return current.filter((_, i) => i !== index);
    });
    setLivePhotos((current) => current.filter((_, i) => i !== index));
  };

  const submit = async (event: React.FormEvent, evidenceWaived = false) => {
    event.preventDefault();
    if (!user?.id || !session?.access_token || !validPhase || saving) return;
    if (!evidenceWaived && !canSubmitNormally) return;
    if (
      evidenceWaived &&
      !window.confirm(
        isLiveLisPickup
          ? "Submit without any vehicle photos? This is recorded on the report and cannot be undone; the missing evidence counts against you in any dispute."
          : `Submit without the ${missingRequired.join(", ")} photo${missingRequired.length === 1 ? "" : "s"}? This is recorded on the report and cannot be undone; the missing evidence counts against you in any dispute.`,
      )
    )
      return;
    setSaving(true);
    const uploaded: Array<{
      category: string;
      storagePath: string;
      provenance?: ContentProvenanceResult;
    }> = [];
    try {
      const reportFolder = crypto.randomUUID();
      if (isLiveLisPickup) {
        for (let index = 0; index < livePhotos.length; index += 1) {
          const file = livePhotos[index];
          if (file.size > 8 * 1024 * 1024) throw new Error("A captured photo is larger than 8 MB");
          const category = `live_photo_${index + 1}`;
          const path = `${bookingId}/${user.id}/${reportFolder}/${category}.jpg`;
          const provenance = await inspectContentProvenance(file);
          const { error } = await supabase.storage.from("trip-condition-evidence").upload(path, file, { upsert: false, contentType: "image/jpeg" });
          if (error) throw error;
          uploaded.push({ category, storagePath: path, provenance });
        }
      } else {
        for (const [category] of allPhotoSlots) {
          const file = files[category];
          if (!file) continue;
          if (file.size > 8 * 1024 * 1024) throw new Error(`${category} photo is larger than 8 MB`);
          const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
          const path = `${bookingId}/${user.id}/${reportFolder}/${category}.${extension}`;
          const { error } = await supabase.storage.from("trip-condition-evidence").upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
          if (error) throw error;
          uploaded.push({ category, storagePath: path });
        }
      }
      const response = await fetch("/api/submit-trip-condition-report", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ bookingId, phase: validPhase, odometerReading: odometer.trim() === "" ? null : Number(odometer), fuelOrBatteryLevel: level.trim() === "" ? null : Number(level), damageNotes, evidenceWaived, locationConsent, latitude: location?.latitude, longitude: location?.longitude, locationAccuracyMeters: location?.accuracy, photos: uploaded }) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Report was not saved");
      setAlreadySubmitted(true);
      toast.success(`${validPhase === "pickup" ? "Pickup" : "Return"} condition report submitted`);
    } catch (error) {
      await Promise.all(uploaded.map((item) => supabase.storage.from("trip-condition-evidence").remove([item.storagePath])));
      toast.error("Report was not submitted", { description: error instanceof Error ? error.message : "Please try again" });
    } finally { setSaving(false); }
  };

  if (!validPhase) return <div className="rounded-xl border p-8">Invalid report phase.</div>;
  if (bookingAllowed === false) return <div className="rounded-xl border p-8">You are not a participant in this booking.</div>;
  if (alreadySubmitted) return <div className="mx-auto max-w-xl rounded-xl border border-green-500/30 bg-green-500/10 p-8 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-green-500" /><h1 className="mt-3 text-xl font-semibold">Report already submitted</h1><p className="mt-2 text-sm text-muted-foreground">The server timestamp and evidence are stored with this booking.</p><Link className={cn(buttonVariants(), "mt-5")} to={returnTo}>Return to bookings</Link></div>;

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{validPhase === "pickup" ? "Pickup" : "Return"} Condition Report</h1>
        <p className="mt-1 text-muted-foreground">Submit your own independent evidence. The server records the timestamp; location is optional and only stored with your consent.</p>
        <p className="mt-2 text-sm">
          {photosRequired ? (
            <span className="font-medium text-foreground">
              {isLiveLisPickup
                ? `This report is required for you as the lister (the “before” state) - take at least 1, and up to ${MAX_LIVE_PHOTOS}, live photos of the vehicle using your device camera below. Photo library uploads are not accepted here.`
                : 'This report is required for you as the renter (the “after” state) - the 4 photos below are required.'}
            </span>
          ) : (
            <span className="text-muted-foreground">
              This report is optional for you - the other party files the required {validPhase === "pickup" ? '"before"' : '"after"'} report. Add photos if you want your own record.
            </span>
          )}
        </p>
      </div>
      {!isLiveLisPickup && (
        <>
          <div>
            <p className="mb-2 text-sm font-medium">{photosRequired ? "Required photos (4)" : "Photos (4 recommended)"}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {requiredPhotos.map(([category, label]) => <label key={category} className="space-y-2 rounded-xl border bg-card p-4"><Label className="flex items-center gap-2"><Camera className="h-4 w-4" />{label} photo</Label><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles((current) => ({ ...current, [category]: e.target.files?.[0] || null }))} /></label>)}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Optional photos</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {optionalPhotos.map(([category, label]) => <label key={category} className="space-y-2 rounded-xl border bg-card p-4"><Label className="flex items-center gap-2"><Camera className="h-4 w-4" />{label}</Label><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles((current) => ({ ...current, [category]: e.target.files?.[0] || null }))} /></label>)}
            </div>
          </div>
        </>
      )}
      {isLiveLisPickup && (
        <div>
          <p className="mb-2 text-sm font-medium">Vehicle photos ({livePhotos.length}/{MAX_LIVE_PHOTOS}, live camera)</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {livePhotoPreviews.map((url, index) => (
              <div key={url} className="space-y-2 rounded-xl border bg-card p-4">
                <img src={url} alt={`Vehicle photo ${index + 1}`} className="aspect-video w-full rounded-lg object-cover" />
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => removeLivePhoto(index)}>
                  Remove
                </Button>
              </div>
            ))}
            {livePhotos.length < MAX_LIVE_PHOTOS && (
              <button
                type="button"
                onClick={() => void openCamera()}
                className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
              >
                <Camera className="h-6 w-6" />
                Add live photo
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Photos are taken live through your device camera - photo library uploads are not accepted for this report.
          </p>
        </div>
      )}
      <div className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2"><label className="space-y-2"><Label>Odometer reading <span className="text-xs text-muted-foreground">(optional)</span></Label><Input type="number" min="0" step="1" value={odometer} onChange={(e) => setOdometer(e.target.value)} /></label><label className="space-y-2"><Label>Fuel or battery level (%) <span className="text-xs text-muted-foreground">(optional)</span></Label><Input type="number" min="0" max="100" step="1" value={level} onChange={(e) => setLevel(e.target.value)} /></label><label className="space-y-2 sm:col-span-2"><Label>Damage or condition notes</Label><textarea className="min-h-28 w-full rounded-md border bg-background p-3 text-sm" maxLength={3000} value={damageNotes} onChange={(e) => setDamageNotes(e.target.value)} placeholder="Write 'No new damage observed' when appropriate." /></label></div>
      <div className="rounded-xl border bg-card p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="font-medium">Optional location evidence</p><p className="text-sm text-muted-foreground">Only capture it if you consent. You may submit without location.</p></div><Button type="button" variant="outline" className="gap-2" onClick={captureLocation}><MapPin className="h-4 w-4" />{location ? "Location captured" : "Capture location"}</Button></div>{location && <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={locationConsent} onChange={(e) => setLocationConsent(e.target.checked)} />I consent to storing this location with the trip report.</label>}</div>
      <div className="space-y-2">
        <Button type="submit" className="w-full" disabled={saving || !canSubmitNormally || (!photosRequired && !anyFile && odometer.trim() === "" && level.trim() === "" && damageNotes.trim() === "")}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit condition report</Button>
        {photosRequired && !allFilesReady && (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full text-amber-600"
              disabled={saving}
              onClick={(e) => submit(e as unknown as React.FormEvent, true)}
            >
              {isLiveLisPickup
                ? "Submit without a vehicle photo"
                : `Submit without the ${missingRequired.join(", ")} photo${missingRequired.length === 1 ? "" : "s"}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              Submitting with missing photos is recorded on the report, and the missing evidence counts
              against the party that skipped it in any dispute.
            </p>
          </>
        )}
        {!photosRequired && (
          <p className="text-xs text-muted-foreground">
            Optional report. Skip it entirely, or add at least one photo / a reading / a note to submit.
          </p>
        )}
      </div>

      {cameraOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4 py-6 animate-fade-in"
            onClick={closeCamera}
          >
            <Card
              className="w-full max-w-xl overflow-hidden animate-scale-in max-h-[calc(100vh-2rem)]"
              onClick={(e) => e.stopPropagation()}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Live Vehicle Photo</CardTitle>
                  <CardDescription>
                    Use your device's rear camera to capture a live photo of the vehicle. Photo library uploads are not accepted here.
                  </CardDescription>
                </div>
                <Button type="button" size="icon" variant="ghost" onClick={closeCamera}>
                  <X className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 overflow-y-auto">
                <div className="relative aspect-video overflow-hidden rounded-lg bg-black border">
                  {isStartingCamera && (
                    <div className="absolute inset-0 flex items-center justify-center text-white">
                      <Loader2 className="w-6 h-6 animate-spin mr-2" />
                      Starting camera...
                    </div>
                  )}
                  {cameraError ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-200">
                      {cameraError} Close this and use the waiver button below if this device has no working camera.
                    </div>
                  ) : (
                    <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
                  )}
                </div>

                <canvas ref={canvasRef} className="hidden" />
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    type="button"
                    className="flex-1 gap-2"
                    onClick={() => void capturePickupPhoto()}
                    disabled={isStartingCamera || Boolean(cameraError) || !cameraStream}
                  >
                    <Camera className="w-4 h-4" />
                    Capture Photo
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>,
          document.body,
        )}
    </form>
  );
}
