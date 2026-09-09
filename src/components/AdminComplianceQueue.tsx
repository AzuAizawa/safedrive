import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import VehicleCompliancePanel from "@/components/VehicleCompliancePanel";

type CarRow = { id: string; plate_number: string; status: string };

// This panel used to load every car with no limit and no filter, so PostgREST's
// 1,000-row cap silently truncated the dropdown - taking pending resubmissions
// and held bookings with it, without an error. The queue's job is exactly those
// two sets, so they are what it loads; anything else is reached by searching for
// a plate.
const SEARCH_LIMIT = 50;

export default function AdminComplianceQueue() {
  const [attention, setAttention] = useState<CarRow[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [holds, setHolds] = useState<
    Array<{ id: string; car_id: string; start_date: string; end_date: string; status: string }>
  >([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CarRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [d, b] = await Promise.all([
      supabase
        .from("car_documents")
        .select("car_id")
        .eq("compliance_status", "pending")
        .not("renewal_id", "is", null),
      supabase
        .from("bookings")
        .select("id,car_id,start_date,end_date,status")
        .eq("compliance_hold", true)
        .in("status", [
          "pending",
          "confirmed",
          "awaiting_payment",
          "downpayment_paid",
          "fully_paid",
          "active",
        ]),
    ]);
    if (d.error || b.error) {
      setError(d.error?.message || b.error?.message || "");
      return;
    }
    const pendingIds = new Set((d.data ?? []).map((row) => row.car_id));
    const holdRows = b.data ?? [];
    setPending(pendingIds);
    setHolds(holdRows);

    const ids = Array.from(new Set([...pendingIds, ...holdRows.map((row) => row.car_id)]));
    if (!ids.length) {
      setAttention([]);
      setError("");
      return;
    }
    const c = await supabase
      .from("cars")
      .select("id,plate_number,status")
      .in("id", ids)
      .order("created_at", { ascending: false });
    setError(c.error?.message ?? "");
    setAttention(c.data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Searching is on demand rather than on every keystroke, so a broad prefix
  // cannot fan out into a query per character.
  const runSearch = useCallback(async () => {
    const term = query.trim();
    if (!term) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const { data, error: searchError } = await supabase
      .from("cars")
      .select("id,plate_number,status")
      .ilike("plate_number", `%${term}%`)
      .order("created_at", { ascending: false })
      .limit(SEARCH_LIMIT);
    setSearching(false);
    setError(searchError?.message ?? "");
    setSearchResults(data ?? []);
  }, [query]);

  const options = useMemo(() => {
    const merged = new Map<string, CarRow>();
    for (const car of attention) merged.set(car.id, car);
    for (const car of searchResults) merged.set(car.id, car);
    return Array.from(merged.values());
  }, [attention, searchResults]);

  const describe = (car: CarRow) => {
    const flags = [
      pending.has(car.id) ? "Resubmission" : car.status.replaceAll("_", " "),
      holds.some((b) => b.car_id === car.id) ? "bookings need review" : null,
    ].filter(Boolean);
    return `${car.plate_number} — ${flags.join(" — ")}`;
  };

  return (
    <section className="space-y-4 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">Document resubmissions &amp; booking review</h2>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block flex-1 text-sm">
          Find another vehicle by plate
          <input
            className="mt-1 w-full rounded border bg-background p-2"
            value={query}
            placeholder="Plate number"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runSearch();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          disabled={searching}
          onClick={() => void runSearch()}
        >
          {searching ? "Searching…" : "Search"}
        </button>
        {searchResults.length > 0 && (
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm"
            onClick={() => {
              setQuery("");
              setSearchResults([]);
            }}
          >
            Clear
          </button>
        )}
      </div>
      {query.trim() && !searching && searchResults.length === 0 && (
        <p className="text-sm text-muted-foreground">No vehicle matched that plate.</p>
      )}

      <label className="block text-sm">
        Vehicle
        <select
          className="mt-1 w-full rounded border bg-background p-2"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">
            {options.length
              ? "Select a vehicle"
              : "Nothing awaiting review — search for a plate to open any vehicle"}
          </option>
          {options.map((car) => (
            <option key={car.id} value={car.id}>
              {describe(car)}
            </option>
          ))}
        </select>
      </label>

      {holds.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 p-3 text-sm">
          <p className="font-semibold">{holds.length} booking(s) need document review</p>
          <p>
            Preserve the booking while renewal is reviewed. Handover is blocked. If unresolved
            before pickup, use the booking cancellation/refund workflow; do not mark the renter as a
            no-show.
          </p>
          <ul className="mt-2 space-y-1">
            {holds.map((b) => (
              <li key={b.id}>
                <button type="button" className="underline" onClick={() => setSelected(b.car_id)}>
                  {options.find((c) => c.id === b.car_id)?.plate_number ?? "Vehicle"}: {b.start_date}{" "}
                  to {b.end_date} ({b.status})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected && (
        <VehicleCompliancePanel key={selected} carId={selected} admin onChange={() => void load()} />
      )}
    </section>
  );
}
