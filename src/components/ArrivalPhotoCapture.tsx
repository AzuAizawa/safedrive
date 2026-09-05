import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";

export type ArrivalLocationEvidence = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: string;
};

interface ArrivalPhotoCaptureProps {
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  onConfirmArrival: (location?: ArrivalLocationEvidence | null) => void;
}

// Silently requests a device location fix on click (one-time browser
// permission prompt, same category as the camera permission already
// required for trip photos) and passes it along as optional evidence. On
// denial, timeout, or an unsupported browser, falls back to confirming with
// no location - the tap itself is never blocked by this.
const captureLocationEvidence = () =>
  new Promise<ArrivalLocationEvidence | null>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters:
            typeof position.coords.accuracy === "number"
              ? Math.round(position.coords.accuracy)
              : null,
          capturedAt: new Date().toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });

export function ArrivalPhotoCapture({
  disabled,
  loading,
  label,
  onConfirmArrival,
}: ArrivalPhotoCaptureProps) {
  return (
    <Button
      type="button"
      size="sm"
      onClick={async () => {
        const location = await captureLocationEvidence();
        onConfirmArrival(location);
      }}
      disabled={Boolean(disabled || loading)}
      className="gap-1.5"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5" />
      )}
      {label ?? "Confirm Arrival Now"}
    </Button>
  );
}
