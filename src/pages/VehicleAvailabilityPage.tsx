import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarOff, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { Car, Database } from "@/types/database";

type Blackout = Database["public"]["Tables"]["vehicle_unavailability"]["Row"];
type BookingRow = { car_id: string; start_date: string; end_date: string; status: string };

// Blackouts carry a reason/category column for legacy records, but the lister no
// longer sees or picks them - an unavailable date is simply unavailable.
const AUTO_REASON = "Blocked by owner";
const AUTO_CATEGORY = "other";

// A pending request also holds the date - the lister must accept or reject it
// first. Everything from "confirmed" onward is a committed / paid booking.
const REQUESTED_STATUSES = ["pending"];
const COMMITTED_STATUSES = [
  "confirmed",
  "awaiting_payment",
  "downpayment_paid",
  "fully_paid",
  "active",
];
const BOOKING_BLOCKING_STATUSES = [...REQUESTED_STATUSES, ...COMMITTED_STATUSES];

const toDate = (iso: string) => new Date(`${iso}T00:00:00`);
const toISODate = (value: Date) => format(value, "yyyy-MM-dd");
const startOfToday = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
};

export default function VehicleAvailabilityPage() {
  const { user } = useAuth();
  const [cars, setCars] = useState<Car[]>([]);
  const [blackouts, setBlackouts] = useState<Blackout[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [carId, setCarId] = useState("");
  const [range, setRange] = useState<DateRange | undefined>();

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [carsResult, blackoutResult, bookingResult] = await Promise.all([
      supabase
        .from("cars")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("vehicle_unavailability")
        .select("*")
        .eq("owner_id", user.id)
        .order("start_date"),
      supabase
        .from("bookings")
        .select("car_id, start_date, end_date, status")
        .eq("owner_id", user.id)
        .in("status", BOOKING_BLOCKING_STATUSES),
    ]);

    const anyError = carsResult.error || blackoutResult.error || bookingResult.error;
    if (anyError) {
      toast.error("Vehicle availability could not be loaded", {
        description: anyError.message,
      });
    } else {
      const loadedCars = (carsResult.data ?? []) as Car[];
      setCars(loadedCars);
      setBlackouts((blackoutResult.data ?? []) as Blackout[]);
      setBookings((bookingResult.data ?? []) as BookingRow[]);
      setCarId((current) => current || loadedCars[0]?.id || "");
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const carBlackouts = useMemo(
    () => blackouts.filter((item) => item.car_id === carId),
    [blackouts, carId],
  );

  const bookedRanges = useMemo(
    () =>
      bookings
        .filter(
          (booking) =>
            booking.car_id === carId && COMMITTED_STATUSES.includes(booking.status),
        )
        .map((booking) => ({ from: toDate(booking.start_date), to: toDate(booking.end_date) })),
    [bookings, carId],
  );

  const requestedRanges = useMemo(
    () =>
      bookings
        .filter(
          (booking) =>
            booking.car_id === carId && REQUESTED_STATUSES.includes(booking.status),
        )
        .map((booking) => ({ from: toDate(booking.start_date), to: toDate(booking.end_date) })),
    [bookings, carId],
  );

  const blockedRanges = useMemo(
    () =>
      carBlackouts.map((item) => ({
        from: toDate(item.start_date),
        to: toDate(item.end_date),
      })),
    [carBlackouts],
  );

  const disabledDays = useMemo(
    () => [{ before: startOfToday() }, ...bookedRanges, ...requestedRanges, ...blockedRanges],
    [bookedRanges, requestedRanges, blockedRanges],
  );

  const blockDates = async () => {
    if (!user?.id || saving) return;
    if (!carId || !range?.from) {
      toast.error("Pick a vehicle and at least one date on the calendar.");
      return;
    }
    const start = toISODate(range.from);
    const end = toISODate(range.to ?? range.from);

    setSaving(true);
    const { data, error } = await supabase
      .from("vehicle_unavailability")
      .insert({
        car_id: carId,
        owner_id: user.id,
        start_date: start,
        end_date: end,
        category: AUTO_CATEGORY,
        reason: AUTO_REASON,
      })
      .select("id")
      .single();

    if (error) {
      toast.error("Dates were not blocked", {
        description: error.message.includes("conflicts")
          ? "Those dates overlap a booking or an existing block."
          : error.message,
      });
    } else {
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "vehicle_blackout_created",
        entity_type: "vehicle_unavailability",
        entity_id: data.id,
        details: { car_id: carId, start_date: start, end_date: end },
      });
      toast.success(start === end ? "Date blocked" : "Dates blocked");
      setRange(undefined);
      await load();
    }
    setSaving(false);
  };

  const removeBlackout = async (item: Blackout) => {
    if (!user?.id || !window.confirm("Unblock these dates?")) return;
    const { error } = await supabase
      .from("vehicle_unavailability")
      .delete()
      .eq("id", item.id)
      .eq("owner_id", user.id);
    if (error) {
      toast.error("Block was not removed", { description: error.message });
    } else {
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "vehicle_blackout_deleted",
        entity_type: "vehicle_unavailability",
        entity_id: item.id,
        details: { car_id: item.car_id, start_date: item.start_date, end_date: item.end_date },
      });
      await load();
    }
  };

  const selectedCount =
    range?.from && range?.to
      ? Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1
      : range?.from
        ? 1
        : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <CalendarOff className="h-7 w-7" /> Vehicle Availability
        </h1>
        <p className="mt-1 text-muted-foreground">
          Tap dates on the calendar to block them for maintenance, repairs, or personal use.
          Booked dates (red) and dates with a pending request (orange) cannot be blocked -
          accept or reject the request first.
        </p>
      </div>

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : cars.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          You have no vehicles yet.
        </div>
      ) : (
        <>
          <div className="grid gap-4 rounded-xl border bg-card p-5">
            <label className="space-y-2 sm:max-w-xs">
              <Label>Vehicle</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={carId}
                onChange={(event) => {
                  setCarId(event.target.value);
                  setRange(undefined);
                }}
              >
                {cars.map((car) => (
                  <option key={car.id} value={car.id}>
                    {car.plate_number}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-red-500/20 ring-1 ring-red-500/40" /> Booked
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-orange-500/20 ring-1 ring-orange-500/40" /> Pending request
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-amber-500/20 ring-1 ring-amber-500/40" /> Already blocked
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-primary/20 ring-1 ring-primary/40" /> Your selection
              </span>
            </div>

            <div className="flex justify-center overflow-x-auto rounded-xl border border-border/60 bg-card/70 p-3">
              <DayPicker
                mode="range"
                selected={range}
                onSelect={setRange}
                disabled={disabledDays}
                modifiers={{
                  booked: bookedRanges,
                  requested: requestedRanges,
                  blocked: blockedRanges,
                }}
                modifiersStyles={{
                  booked: {
                    backgroundColor: "rgb(239 68 68 / 0.15)",
                    color: "rgb(239 68 68)",
                    textDecoration: "line-through",
                  },
                  requested: {
                    backgroundColor: "rgb(249 115 22 / 0.15)",
                    color: "rgb(234 88 12)",
                  },
                  blocked: {
                    backgroundColor: "rgb(245 158 11 / 0.15)",
                    color: "rgb(217 119 6)",
                    textDecoration: "line-through",
                  },
                }}
                className="font-sans"
                styles={{ caption: { color: "inherit" }, day: { borderRadius: "8px" } }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {selectedCount > 0
                  ? `${selectedCount} day${selectedCount === 1 ? "" : "s"} selected`
                  : "No dates selected"}
              </p>
              <div className="flex gap-2">
                {selectedCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setRange(undefined)}>
                    Clear
                  </Button>
                )}
                <Button onClick={() => void blockDates()} disabled={saving || selectedCount === 0}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Block selected dates
                </Button>
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-lg font-semibold">Blocked dates for this vehicle</h2>
            {carBlackouts.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                No dates are blocked for this vehicle.
              </div>
            ) : (
              <div className="grid gap-3">
                {carBlackouts.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center"
                  >
                    <p className="text-sm font-medium">
                      {format(toDate(item.start_date), "MMM d, yyyy")}
                      {item.start_date !== item.end_date
                        ? ` – ${format(toDate(item.end_date), "MMM d, yyyy")}`
                        : ""}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-red-500"
                      onClick={() => void removeBlackout(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Unblock
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
