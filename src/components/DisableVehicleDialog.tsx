import { createPortal } from "react-dom";
import { useState } from "react";
import { Ban, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

const DISABLE_REASON_MIN_LENGTH = 10;

type DisableType = "clearance" | "other";

/**
 * Disable a car (CHAPTER 131), from Vehicle Management or straight from a
 * vehicle report. Two kinds:
 *   For clearance - the lister submits dated photos and staff approve them;
 *                   the reason says what to submit.
 *   Other reason  - nothing to submit; staff enable it again.
 * The server disables the car first, then cancels and refunds every booking
 * that has not started; a trip under way runs to its end.
 */
export default function DisableVehicleDialog({
  carId,
  vehicleLabel,
  reportId = null,
  onClose,
  onDisabled,
}: {
  carId: string;
  vehicleLabel: string;
  reportId?: string | null;
  onClose: () => void;
  onDisabled: () => void;
}) {
  const [type, setType] = useState<DisableType>("clearance");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const trimmed = reason.trim();

  const submit = async () => {
    if (trimmed.length < DISABLE_REASON_MIN_LENGTH || saving) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/vehicle-moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ action: "disable", carId, type, reason: trimmed, reportId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        cancelledBookings?: number;
        cancelError?: string | null;
        emailState?: string;
      };
      if (!response.ok) {
        toast.error("The vehicle was not disabled", { description: body.error });
        return;
      }
      const cancelled = body.cancelledBookings
        ? ` ${body.cancelledBookings} booking(s) that had not started were cancelled and the renters refunded in full.`
        : "";
      toast.success("Vehicle disabled", {
        description: `${vehicleLabel} is off Browse.${cancelled} The lister was told why.`,
      });
      if (body.cancelError) {
        toast.warning("A booking still needs attention", { description: body.cancelError });
      }
      if (body.emailState && body.emailState !== "sent") {
        toast.warning("The lister was notified in the app, but the email was not delivered.");
      }
      onDisabled();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-6 backdrop-blur-sm sm:items-center"
      onClick={() => !saving && onClose()}
    >
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Disable {vehicleLabel}</CardTitle>
            <CardDescription>
              The car leaves Browse and cannot be booked. Bookings that have not started are cancelled and the
              renters refunded in full. A trip under way runs to its scheduled end, without extension. The lister is
              notified and emailed with the reason.
            </CardDescription>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Disable</legend>
            {(
              [
                ["clearance", "For clearance", "The lister submits dated photos showing the car is fit to rent; you approve them to bring it back."],
                ["other", "Other reason", "Nothing to submit. The car stays disabled until you enable it."],
              ] as Array<[DisableType, string, string]>
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                  type === value ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name={`disable-type-${carId}`}
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                  className="mt-1"
                  disabled={saving}
                />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor={`disable-reason-${carId}`}>
              {type === "clearance" ? "What must the lister submit? *" : "Reason *"}
            </Label>
            <textarea
              id={`disable-reason-${carId}`}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              placeholder={
                type === "clearance"
                  ? "Example: Photo of the repaired left rear door, with the date visible."
                  : "Say specifically why - the lister reads this."
              }
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              At least {DISABLE_REASON_MIN_LENGTH} characters ({trimmed.length} so far).
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => void submit()}
              disabled={saving || trimmed.length < DISABLE_REASON_MIN_LENGTH}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              Disable vehicle
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}
