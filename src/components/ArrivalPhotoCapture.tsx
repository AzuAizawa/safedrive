import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
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
}

export function ArrivalPhotoCapture({
  disabled,
  loading,
  onConfirmArrival,
}: ArrivalPhotoCaptureProps) {
  const [locationLoading, setLocationLoading] = useState(false);

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

  const isBusy = Boolean(disabled || loading || locationLoading);

  return (
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
    </div>
  );
}
