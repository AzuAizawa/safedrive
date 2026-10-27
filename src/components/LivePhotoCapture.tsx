import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * Live-camera photos only - no photo library - for evidence that has to show
 * the car as it is now (CHAPTER 131's "Report an issue"). The same capture the
 * trip condition report uses: rear camera, JPEG, up to `max` photos, previews
 * with Remove. The parent owns the files.
 */
export default function LivePhotoCapture({
  photos,
  onChange,
  max,
  disabled = false,
}: {
  photos: File[];
  onChange: (photos: File[]) => void;
  max: number;
  disabled?: boolean;
}) {
  // One object URL per photo, released when the photo goes.
  const previews = useMemo(() => photos.map((photo) => URL.createObjectURL(photo)), [photos]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    void videoRef.current.play();
  }, [cameraOpen, stream]);

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
    setCameraError("");
  };

  const openCamera = async () => {
    if (photos.length >= max) {
      toast.error(`You can add up to ${max} photos.`);
      return;
    }
    setCameraOpen(true);
    setCameraError("");
    setIsStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera capture is not supported by this browser. Open SafeDrive on a phone with a camera.");
      }
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = media;
      setStream(media);
    } catch (error) {
      // Same guidance as the trip report: a blocked camera shows no prompt.
      const name = error instanceof Error ? error.name : "";
      setCameraError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Camera access is blocked for this site, so no prompt appears. Tap the lock or settings icon beside the web address, set Camera to Allow, then try again."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "No usable camera was found on this device."
            : name === "NotReadableError"
              ? "The camera is already in use by another app. Close that app, then try again."
              : error instanceof Error && error.message
                ? error.message
                : "Unable to start the camera.",
      );
    } finally {
      setIsStarting(false);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (!video.videoWidth || !video.videoHeight) {
      toast.error("Camera is still loading. Please try again.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      toast.error("Failed to capture photo. Please try again.");
      return;
    }
    if (blob.size > MAX_PHOTO_BYTES) {
      toast.error("Photo is larger than 8 MB. Please try again.");
      return;
    }
    const file = new File([blob], `issue_live_${Date.now()}_${photos.length + 1}.jpg`, { type: "image/jpeg" });
    onChange([...photos, file].slice(0, max));
    closeCamera();
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {previews.map((url, index) => (
          <div key={url} className="space-y-1.5 rounded-lg border bg-card p-2">
            <img src={url} alt={`Issue photo ${index + 1}`} className="aspect-video w-full rounded object-cover" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={disabled}
              onClick={() => onChange(photos.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void openCamera()}
            className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed bg-card p-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            <Camera className="h-5 w-5" />
            Take live photo
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {photos.length}/{max} photos. Taken live with your camera - photo library uploads are not accepted.
      </p>

      {cameraOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/80 p-4 py-6 backdrop-blur-sm"
            onClick={closeCamera}
          >
            <Card className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Live Photo</CardTitle>
                  <CardDescription>Point the rear camera at the issue and capture it.</CardDescription>
                </div>
                <Button type="button" size="icon" variant="ghost" onClick={closeCamera}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 overflow-y-auto">
                <div className="relative aspect-video overflow-hidden rounded-lg border bg-black">
                  {isStarting && (
                    <div className="absolute inset-0 flex items-center justify-center text-white">
                      <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                      Starting camera...
                    </div>
                  )}
                  {cameraError ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-200">
                      {cameraError}
                    </div>
                  ) : (
                    <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
                  )}
                </div>
                <canvas ref={canvasRef} className="hidden" />
                <Button
                  type="button"
                  className="w-full gap-2"
                  onClick={() => void capture()}
                  disabled={isStarting || Boolean(cameraError) || !stream}
                >
                  <Camera className="h-4 w-4" />
                  Capture Photo
                </Button>
              </CardContent>
            </Card>
          </div>,
          document.body,
        )}
    </div>
  );
}
