import { useCallback, useEffect, useState } from "react";
import { CalendarOff, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { Car, Database } from "@/types/database";

type Blackout = Database["public"]["Tables"]["vehicle_unavailability"]["Row"];

export default function VehicleAvailabilityPage() {
  const { user } = useAuth();
  const [cars, setCars] = useState<Car[]>([]);
  const [blackouts, setBlackouts] = useState<Blackout[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ carId: "", startDate: "", endDate: "", category: "maintenance", reason: "" });

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [carsResult, blackoutResult] = await Promise.all([
      supabase.from("cars").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }),
      supabase.from("vehicle_unavailability").select("*").eq("owner_id", user.id).order("start_date"),
    ]);
    if (carsResult.error || blackoutResult.error) {
      toast.error("Vehicle availability could not be loaded", { description: (carsResult.error || blackoutResult.error)?.message });
    } else {
      setCars((carsResult.data ?? []) as Car[]);
      setBlackouts((blackoutResult.data ?? []) as Blackout[]);
      setForm((current) => ({ ...current, carId: current.carId || carsResult.data?.[0]?.id || "" }));
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const addBlackout = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id || saving) return;
    if (!form.carId || !form.startDate || !form.endDate || form.reason.trim().length < 3) {
      toast.error("Complete the vehicle, dates, and reason.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.from("vehicle_unavailability").insert({
      car_id: form.carId,
      owner_id: user.id,
      start_date: form.startDate,
      end_date: form.endDate,
      category: form.category,
      reason: form.reason.trim(),
    }).select("id").single();
    if (error) {
      toast.error("Dates were not blocked", { description: error.message });
    } else {
      await supabase.from("audit_log").insert({ user_id: user.id, action: "vehicle_blackout_created", entity_type: "vehicle_unavailability", entity_id: data.id, details: { car_id: form.carId, start_date: form.startDate, end_date: form.endDate, category: form.category, reason: form.reason.trim() } });
      toast.success("Vehicle dates blocked");
      setForm((current) => ({ ...current, startDate: "", endDate: "", reason: "" }));
      await load();
    }
    setSaving(false);
  };

  const removeBlackout = async (item: Blackout) => {
    if (!user?.id || !window.confirm("Remove this vehicle blackout?")) return;
    const { error } = await supabase.from("vehicle_unavailability").delete().eq("id", item.id).eq("owner_id", user.id);
    if (error) toast.error("Blackout was not removed", { description: error.message });
    else {
      await supabase.from("audit_log").insert({ user_id: user.id, action: "vehicle_blackout_deleted", entity_type: "vehicle_unavailability", entity_id: item.id, details: { car_id: item.car_id, start_date: item.start_date, end_date: item.end_date, reason: item.reason } });
      await load();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><CalendarOff className="h-7 w-7" /> Vehicle Availability</h1>
        <p className="mt-1 text-muted-foreground">Block dates for maintenance, repairs, inspections, or personal use. SafeDrive refuses conflicts with active or paid bookings.</p>
      </div>

      <form onSubmit={addBlackout} className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
        <label className="space-y-2"><Label>Vehicle</Label><select className="h-10 w-full rounded-md border bg-background px-3" value={form.carId} onChange={(e) => setForm({ ...form, carId: e.target.value })} required>{cars.map((car) => <option key={car.id} value={car.id}>{car.plate_number}</option>)}</select></label>
        <label className="space-y-2"><Label>Reason type</Label><select className="h-10 w-full rounded-md border bg-background px-3" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="maintenance">Maintenance</option><option value="repair">Repair</option><option value="inspection">Inspection</option><option value="personal_use">Personal use</option><option value="other">Other</option></select></label>
        <label className="space-y-2"><Label>Start date</Label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></label>
        <label className="space-y-2"><Label>End date</Label><Input type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required /></label>
        <label className="space-y-2 md:col-span-2"><Label>Reason</Label><Input maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Example: scheduled brake inspection" required /></label>
        <Button type="submit" className="md:col-span-2" disabled={saving || cars.length === 0}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Block these dates</Button>
      </form>

      {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : blackouts.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">No dates are blocked.</div> : (
        <div className="grid gap-3">
          {blackouts.map((item) => <div key={item.id} className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center"><div><p className="font-medium">{cars.find((car) => car.id === item.car_id)?.plate_number || item.car_id.slice(0, 8)} · {item.category.replace("_", " ")}</p><p className="text-sm text-muted-foreground">{item.start_date} through {item.end_date}</p><p className="mt-1 text-sm">{item.reason}</p></div><Button variant="outline" size="sm" className="gap-2 text-red-500" onClick={() => void removeBlackout(item)}><Trash2 className="h-4 w-4" />Remove</Button></div>)}
        </div>
      )}
    </div>
  );
}
