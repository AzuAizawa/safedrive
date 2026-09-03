import { useCallback, useEffect, useMemo, useState } from "react";
import { CarFront, FileWarning, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { createPrivateStorageUrl } from "@/lib/privateStorage";
import type { CarRenewal } from "@/types/database";

const RENEWAL_DOCS: { key: keyof CarRenewal; label: string }[] = [
  { key: "orcr_document_path", label: "Updated OR/CR" },
  { key: "lto_receipt_path", label: "Latest LTO receipt" },
  { key: "mvir_path", label: "MVIR" },
  { key: "emission_test_path", label: "Emission test result" },
  { key: "updated_car_photos_path", label: "Updated car photos" },
];

type CarInfo = {
  id: string;
  plate_number: string;
  status: string;
  owner_id: string;
  label: string;
};

type RenewalRow = CarRenewal & {
  car?: CarInfo;
  listerName?: string;
  listerEmail?: string;
};

export default function AdminVehicleRenewalsPage() {
  const { user } = useAuth();
  const [renewals, setRenewals] = useState<RenewalRow[]>([]);
  const [flaggableCars, setFlaggableCars] = useState<CarInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [flagCarId, setFlagCarId] = useState("");
  const [flagReason, setFlagReason] = useState("");
  const [flagging, setFlagging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [renewalResult, carResult] = await Promise.all([
      supabase
        .from("car_renewals")
        .select("*")
        .eq("status", "pending")
        .order("submitted_at", { ascending: true }),
      supabase
        .from("cars")
        .select(
          "id, plate_number, status, owner_id, car_models(name, car_brands(name))",
        )
        .in("status", ["approved", "active"])
        .order("plate_number"),
    ]);

    if (renewalResult.error || carResult.error) {
      toast.error("Renewal queue could not be loaded", {
        description: (renewalResult.error ?? carResult.error)?.message,
      });
      setLoading(false);
      return;
    }

    const toLabel = (car: {
      plate_number: string;
      car_models?: { name: string; car_brands: { name: string } } | null;
    }) =>
      car.car_models
        ? `${car.car_models.car_brands.name} ${car.car_models.name} (${car.plate_number})`
        : car.plate_number;

    setFlaggableCars(
      (carResult.data ?? []).map((car) => ({
        id: car.id,
        plate_number: car.plate_number,
        status: car.status,
        owner_id: car.owner_id,
        label: toLabel(car as never),
      })),
    );

    const rows = (renewalResult.data ?? []) as CarRenewal[];
    const carIds = [...new Set(rows.map((row) => row.car_id))];
    const listerIds = [...new Set(rows.map((row) => row.lister_id))];

    const [renewalCarResult, listerResult] = await Promise.all([
      carIds.length
        ? supabase
            .from("cars")
            .select(
              "id, plate_number, status, owner_id, car_models(name, car_brands(name))",
            )
            .in("id", carIds)
        : Promise.resolve({ data: [], error: null }),
      listerIds.length
        ? supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", listerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const carMap = new Map(
      (renewalCarResult.data ?? []).map((car) => [
        car.id,
        {
          id: car.id,
          plate_number: car.plate_number,
          status: car.status,
          owner_id: car.owner_id,
          label: toLabel(car as never),
        },
      ]),
    );
    const listerMap = new Map(
      (listerResult.data ?? []).map((profile) => [profile.id, profile]),
    );

    setRenewals(
      rows.map((row) => ({
        ...row,
        car: carMap.get(row.car_id),
        listerName: listerMap.get(row.lister_id)?.full_name ?? undefined,
        listerEmail: listerMap.get(row.lister_id)?.email ?? undefined,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDoc = async (path: string | null) => {
    if (!path) {
      toast.error("That document was not uploaded");
      return;
    }
    const url = await createPrivateStorageUrl("car-documents", path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.error("Could not open the document");
  };

  const flagVehicle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id || flagging) return;
    const car = flaggableCars.find((item) => item.id === flagCarId);
    if (!car) {
      toast.error("Choose a vehicle to flag");
      return;
    }
    if (flagReason.trim().length < 5) {
      toast.error("Give a short reason the lister will see");
      return;
    }
    setFlagging(true);
    try {
      const { error } = await supabase
        .from("cars")
        .update({ status: "renewal_required" })
        .eq("id", car.id)
        .in("status", ["approved", "active"]);
      if (error) throw error;

      await supabase.from("notifications").insert({
        user_id: car.owner_id,
        title: "Vehicle renewal required",
        message: `${car.label} needs updated compliance documents before it can stay listed. Reason: ${flagReason.trim()}`,
        type: "vehicle",
        link: "/car-renewals",
      });
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "vehicle_renewal_required",
        entity_type: "car",
        entity_id: car.id,
        details: { reason: flagReason.trim(), auto: false },
      });

      toast.success("Vehicle flagged for renewal", {
        description: "The lister was notified to submit updated documents.",
      });
      setFlagCarId("");
      setFlagReason("");
      await load();
    } catch (error) {
      toast.error("Vehicle was not flagged", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setFlagging(false);
    }
  };

  const rejectRenewal = async (row: RenewalRow) => {
    if (!user?.id || busyId) return;
    const reason = window.prompt(
      "Explain what the lister needs to fix. They will see this note.",
    );
    if (!reason?.trim() || reason.trim().length < 5) return;
    setBusyId(row.id);
    try {
      const { error } = await supabase
        .from("car_renewals")
        .update({
          status: "rejected",
          admin_notes: reason.trim(),
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "pending");
      if (error) throw error;

      await supabase.from("notifications").insert({
        user_id: row.lister_id,
        title: "Renewal needs changes",
        message: `Your renewal for ${row.car?.label ?? "a vehicle"} was returned: ${reason.trim()}`,
        type: "vehicle",
        link: "/car-renewals",
      });
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "vehicle_renewal_rejected",
        entity_type: "car",
        entity_id: row.car_id,
        details: { renewal_id: row.id, reason: reason.trim() },
      });

      toast.success("Renewal returned to the lister");
      await load();
    } catch (error) {
      toast.error("Renewal was not updated", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setBusyId(null);
    }
  };

  const approveRenewal = async (row: RenewalRow) => {
    if (!user?.id || busyId) return;
    const registration = window.prompt(
      "New REGISTRATION expiry date (YYYY-MM-DD), from the updated OR/CR:",
    );
    if (!registration) return;
    const ctpl = window.prompt(
      "New CTPL expiry date (YYYY-MM-DD), from the updated CTPL:",
    );
    if (!ctpl) return;
    const insurance = window.prompt(
      "New comprehensive-insurance expiry (YYYY-MM-DD). Leave blank if none.",
    );

    const isValidFutureDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00`);
      return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
    };
    if (!isValidFutureDate(registration) || !isValidFutureDate(ctpl)) {
      toast.error("Registration and CTPL dates must be valid future dates");
      return;
    }
    if (insurance && insurance.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(insurance.trim())) {
      toast.error("Insurance date must be YYYY-MM-DD or blank");
      return;
    }

    setBusyId(row.id);
    try {
      const { error: carError } = await supabase
        .from("cars")
        .update({
          status: "approved",
          registration_expiry: registration,
          ctpl_expiry: ctpl,
          comprehensive_insurance_expiry: insurance?.trim() || null,
        })
        .eq("id", row.car_id);
      if (carError) throw carError;

      const { error: renewalError } = await supabase
        .from("car_renewals")
        .update({
          status: "approved",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "pending");
      if (renewalError) throw renewalError;

      await supabase.from("notifications").insert({
        user_id: row.lister_id,
        title: "Renewal approved",
        message: `${row.car?.label ?? "Your vehicle"} is cleared and can be listed again.`,
        type: "vehicle",
        link: "/my-vehicles",
      });
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "vehicle_renewal_approved",
        entity_type: "car",
        entity_id: row.car_id,
        details: {
          renewal_id: row.id,
          registration_expiry: registration,
          ctpl_expiry: ctpl,
          comprehensive_insurance_expiry: insurance?.trim() || null,
        },
      });

      toast.success("Renewal approved", {
        description: "The vehicle is back to approved status.",
      });
      await load();
    } catch (error) {
      toast.error("Renewal was not approved", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setBusyId(null);
    }
  };

  const selectedFlagCar = useMemo(
    () => flaggableCars.find((car) => car.id === flagCarId),
    [flaggableCars, flagCarId],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <FileWarning className="h-7 w-7" /> Vehicle Renewals
        </h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          When a vehicle&apos;s registration, CTPL, or insurance expires it is
          moved to <strong>renewal required</strong> and taken off the market
          until the lister submits updated documents and an admin clears them.
        </p>
      </div>

      <form
        onSubmit={flagVehicle}
        className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold md:col-span-2">
          <CarFront className="h-5 w-5" /> Flag a vehicle for renewal
        </h2>
        <p className="text-xs text-muted-foreground md:col-span-2">
          Use this when you already know a document has lapsed. The daily job
          flags expired vehicles automatically.
        </p>
        <label className="space-y-2">
          <Label>Vehicle</Label>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={flagCarId}
            onChange={(event) => setFlagCarId(event.target.value)}
          >
            <option value="">Choose an active vehicle</option>
            {flaggableCars.map((car) => (
              <option key={car.id} value={car.id}>
                {car.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <Label>Reason (shown to the lister)</Label>
          <Input
            value={flagReason}
            onChange={(event) => setFlagReason(event.target.value)}
            placeholder="e.g. CTPL expired on 1 Aug 2026"
          />
        </label>
        <Button
          className="md:col-span-2"
          disabled={flagging || !selectedFlagCar}
        >
          {flagging ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Move to renewal required
        </Button>
      </form>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          Pending submissions{renewals.length ? ` (${renewals.length})` : ""}
        </h2>
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : renewals.length === 0 ? (
          <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
            No renewal submissions are waiting for review.
          </p>
        ) : (
          <div className="space-y-4">
            {renewals.map((row) => (
              <article key={row.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <h3 className="font-semibold">
                      {row.car?.label ?? "Vehicle"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {row.listerName || row.listerEmail || "Lister"} · odometer{" "}
                      {row.current_mileage.toLocaleString()} km · submitted{" "}
                      {new Date(row.submitted_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => void approveRenewal(row)}
                    >
                      Approve &amp; relist
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === row.id}
                      onClick={() => void rejectRenewal(row)}
                    >
                      Return for changes
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {RENEWAL_DOCS.map((doc) => (
                    <Button
                      key={doc.key}
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() =>
                        void openDoc(row[doc.key] as string | null)
                      }
                    >
                      {doc.label}
                    </Button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
