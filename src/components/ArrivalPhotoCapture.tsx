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
  onConfirmArrival: (location?: ArrivalLocationEvidence | null) => void;
}

export function ArrivalPhotoCapture({
  disabled,
  loading,
  onConfirmArrival,
}: ArrivalPhotoCaptureProps) {
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => onConfirmArrival()}
      disabled={Boolean(disabled || loading)}
      className="gap-1.5"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5" />
      )}
      Confirm Arrival Now
    </Button>
  );
}
