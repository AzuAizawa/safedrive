import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import VehicleCompliancePanel from "@/components/VehicleCompliancePanel";
import { Button } from "@/components/ui/button";
import {
  documentExpiryChips,
  expiryChipText,
  expiryChipTone,
} from "@/lib/vehicleCompliance";

type Vehicle = { id: string; plate_number: string; status: string };
type ExpiryRow = {
  car_id: string;
  document_type: string;
  compliance_status: string;
  valid_until: string | null;
  superseded_at: string | null;
};

export default function ListerCarRenewalPage() {
  const {user}=useAuth();
  const [params,setParams]=useSearchParams();
  const [cars,setCars]=useState<Vehicle[]>([]);
  const [expiries,setExpiries]=useState<ExpiryRow[]>([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const selected=cars.find(c=>c.id===params.get("car"));
  const load=useCallback(async()=>{
    if(!user) return;
    const {data,error:e}=await supabase.from("cars").select("id,plate_number,status").eq("owner_id",user.id).order("created_at",{ascending:false});
    setError(e?.message ?? "");setCars(data ?? []);setLoading(false);
    // The expiry dates live on the documents, not on cars - that is the only
    // place the DTI and the Mayor's Permit dates have ever been recorded.
    const ids=(data ?? []).map(c=>c.id);
    if(!ids.length){setExpiries([]);return;}
    const {data:documents}=await supabase
      .from("car_documents")
      .select("car_id,document_type,compliance_status,valid_until,superseded_at")
      .in("car_id",ids);
    setExpiries((documents ?? []) as ExpiryRow[]);
  },[user]);
  useEffect(()=>{void load();},[load]);
  return <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
    <h1 className="text-3xl font-bold">Document Renewal & Updates</h1>
    <p className="text-muted-foreground">Choose a vehicle to renew expired documents or optionally update business and vehicle documents. Every vehicle has its own uploads and admin review.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p>Loading vehicles…</p> : selected ? <>
      <Button variant="outline" onClick={()=>setParams({})}>Back to vehicles</Button>
      <h2 className="text-xl font-semibold">{selected.plate_number}</h2>
      <VehicleCompliancePanel key={selected.id} carId={selected.id} onChange={()=>void load()} />
    </> : <div className="grid gap-3 sm:grid-cols-2">
      {cars.map(car=>{
        const chips=documentExpiryChips(expiries.filter(row=>row.car_id===car.id));
        return <button key={car.id} type="button" className="rounded-xl border p-4 text-left hover:bg-muted" onClick={()=>setParams({car:car.id})}>
          <span className="block font-semibold">{car.plate_number}</span><span className="text-sm text-muted-foreground">{car.status.replaceAll("_"," ")}</span>
          {chips.length>0&&<span className="mt-3 flex flex-wrap gap-1.5">
            {chips.map(chip=><span key={chip.type} className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${expiryChipTone(chip)}`}>
              {expiryChipText(chip)}
            </span>)}
          </span>}
          <span className="mt-3 block text-sm text-primary">Renew / update documents</span>
        </button>;
      })}
      {!cars.length && <p>You have no vehicles yet.</p>}
    </div>}
  </main>;
}
