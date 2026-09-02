import { useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, Loader2, MapPin } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const requiredPhotos = [
  ["front", "Front"], ["back", "Back"], ["left", "Left side"], ["right", "Right side"],
  ["interior", "Interior"], ["odometer", "Odometer"], ["fuel_or_battery", "Fuel or battery"],
] as const;

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

  useEffect(() => {
    if (!user?.id || !bookingId || !validPhase) return;
    void (async () => {
      const { data: booking } = await supabase.from("bookings").select("id, renter_id, owner_id").eq("id", bookingId).maybeSingle();
      setBookingAllowed(Boolean(booking && [booking.renter_id, booking.owner_id].includes(user.id)));
      const { data: report } = await supabase.from("trip_condition_reports").select("id").eq("booking_id", bookingId).eq("reporter_id", user.id).eq("phase", validPhase).maybeSingle();
      setAlreadySubmitted(Boolean(report));
    })();
  }, [bookingId, user?.id, validPhase]);

  const returnTo = profile?.is_lister ? "/lister-bookings" : "/my-bookings";
  const allFilesReady = useMemo(() => requiredPhotos.every(([category]) => files[category]), [files]);

  const captureLocation = () => {
    if (!navigator.geolocation) return toast.error("Location is not available in this browser");
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }); setLocationConsent(true); toast.success("Optional location captured"); },
      () => toast.error("Location was not captured. You can still submit without it."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id || !session?.access_token || !validPhase || saving || !allFilesReady) return;
    setSaving(true);
    const uploaded: Array<{ category: string; storagePath: string }> = [];
    try {
      const reportFolder = crypto.randomUUID();
      for (const [category] of requiredPhotos) {
        const file = files[category];
        if (!file) throw new Error(`Missing ${category} photo`);
        if (file.size > 8 * 1024 * 1024) throw new Error(`${category} photo is larger than 8 MB`);
        const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
        const path = `${bookingId}/${user.id}/${reportFolder}/${category}.${extension}`;
        const { error } = await supabase.storage.from("trip-condition-evidence").upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
        if (error) throw error;
        uploaded.push({ category, storagePath: path });
      }
      const response = await fetch("/api/submit-trip-condition-report", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ bookingId, phase: validPhase, odometerReading: Number(odometer), fuelOrBatteryLevel: Number(level), damageNotes, locationConsent, latitude: location?.latitude, longitude: location?.longitude, locationAccuracyMeters: location?.accuracy, photos: uploaded }) });
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
      <div><h1 className="text-3xl font-bold">{validPhase === "pickup" ? "Pickup" : "Return"} Condition Report</h1><p className="mt-1 text-muted-foreground">Submit your own independent evidence. The server records the timestamp; location is optional and only stored with your consent.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        {requiredPhotos.map(([category, label]) => <label key={category} className="space-y-2 rounded-xl border bg-card p-4"><Label className="flex items-center gap-2"><Camera className="h-4 w-4" />{label} photo</Label><Input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => setFiles((current) => ({ ...current, [category]: e.target.files?.[0] || null }))} required /></label>)}
      </div>
      <div className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2"><label className="space-y-2"><Label>Odometer reading</Label><Input type="number" min="0" step="1" value={odometer} onChange={(e) => setOdometer(e.target.value)} required /></label><label className="space-y-2"><Label>Fuel or battery level (%)</Label><Input type="number" min="0" max="100" step="1" value={level} onChange={(e) => setLevel(e.target.value)} required /></label><label className="space-y-2 sm:col-span-2"><Label>Damage or condition notes</Label><textarea className="min-h-28 w-full rounded-md border bg-background p-3 text-sm" maxLength={3000} value={damageNotes} onChange={(e) => setDamageNotes(e.target.value)} placeholder="Write 'No new damage observed' when appropriate." /></label></div>
      <div className="rounded-xl border bg-card p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="font-medium">Optional location evidence</p><p className="text-sm text-muted-foreground">Only capture it if you consent. You may submit without location.</p></div><Button type="button" variant="outline" className="gap-2" onClick={captureLocation}><MapPin className="h-4 w-4" />{location ? "Location captured" : "Capture location"}</Button></div>{location && <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={locationConsent} onChange={(e) => setLocationConsent(e.target.checked)} />I consent to storing this location with the trip report.</label>}</div>
      <Button type="submit" className="w-full" disabled={saving || !allFilesReady}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit condition report</Button>
    </form>
  );
}
