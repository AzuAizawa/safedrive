import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, CheckCircle2, ImageIcon, Loader2, MapPin, X } from "lucide-react";
import { toast } from "sonner";

export type ArrivalLocationEvidence = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: string;
};

interface ArrivalPhotoCaptureProps {
  disabled?: boolean;
  loading?: boolean;
  onConfirmArrival: (location?: ArrivalLocationEvidence | null) => void;
  onPhotoReady: (file: File) => void;
}

export function ArrivalPhotoCapture({
  disabled,
  loading,
  onConfirmArrival,
  onPhotoReady,
}: ArrivalPhotoCaptureProps) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Camera is not supported by this browser.");
      return;
    }

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      setStream(nextStream);
      setCameraOpen(true);
    } catch (error) {
      toast.error("Camera access denied", {
        description:
          error instanceof Error ? error.message : "Please allow camera access.",
      });
    }
  };

  const closeCamera = () => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setCameraOpen(false);
  };

  const confirmWithLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Location is not supported by this browser.");
      return;
    }

    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onConfirmArrival({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        });
        setLocationLoading(false);
      },
      (error) => {
        toast.error("Location check was not recorded", {
          description:
            error.message || "You can still confirm arrival without location.",
        });
        setLocationLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 30_000,
      },
    );
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error("Camera is not ready yet.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error("Failed to capture photo.");
          return;
        }
        const file = new File([blob], `arrival_${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        onPhotoReady(file);
        closeCamera();
      },
      "image/jpeg",
      0.9,
    );
  };

  const isBusy = Boolean(disabled || loading || locationLoading);

  return (
    <>
      <div className="space-y-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onConfirmArrival()}
          disabled={isBusy}
          className="gap-1.5"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Confirm Arrival Now
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={confirmWithLocation}
          disabled={isBusy}
          className="gap-1.5"
        >
          {locationLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MapPin className="h-3.5 w-3.5" />
          )}
          Confirm With Location
        </Button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCamera}
            disabled={isBusy}
            className="gap-1.5"
          >
            <Camera className="h-3.5 w-3.5" />
            Take Optional Photo
          </Button>
          <label
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors ${
              isBusy
                ? "pointer-events-none cursor-not-allowed opacity-50"
                : "cursor-pointer hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Upload Optional Photo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPhotoReady(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {cameraOpen && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/80 p-4 py-6 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <h3 className="font-semibold">Arrival Camera</h3>
                <p className="text-xs text-muted-foreground">
                  Optional evidence if you want extra proof of the meetup.
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={closeCamera}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="aspect-video w-full object-cover"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 p-4">
              <Button type="button" variant="outline" onClick={closeCamera}>
                Cancel
              </Button>
              <Button type="button" onClick={capturePhoto}>
                Take Photo
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
