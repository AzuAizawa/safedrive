import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";

// This used to request a device location fix on click and pass it along as
// optional arrival evidence. It was removed: the only thing that could act on
// that reading was isReporterLocationVerified(), which compared it against
// the car's listed pickup pin - and that pin was retired, so the comparison
// could never succeed for any newly listed car. The app was asking for a
// location permission to feed an automation that no longer existed.
//
// The button keeps its name so every call site reads the same; it simply
// confirms the arrival now.
interface ArrivalPhotoCaptureProps {
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  onConfirmArrival: () => void;
}

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
      onClick={() => onConfirmArrival()}
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
