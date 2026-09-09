import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { createPrivateStorageUrl } from "@/lib/privateStorage";
import { hashFileSha256, inspectContentProvenance } from "@/lib/contentProvenance";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  COMPLIANCE_DOCUMENTS, documentLabel, requiresExpiry, expiryDateToIso,
  isoToManilaInput, manilaInputToIso,
  type ComplianceDocument, type ComplianceSummary,
} from "@/lib/vehicleCompliance";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export function validateComplianceUpload(file: File): boolean {
  if (!ALLOWED_TYPES.includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) {
    toast.error("Upload a PDF, JPG, PNG or WebP, up to 10 MB.");
    return false;
  }
  return true;
}

export function BusinessDocumentFields({ files, onChange, businessType, onBusinessType }: {
  files: Record<string, File | null>; onChange: (type: string, file: File | null) => void;
  businessType: string; onBusinessType: (type: string) => void;
}) {
  return <fieldset className="space-y-4 rounded-xl border p-4">
    <legend className="px-2 font-semibold">Business documents for this vehicle</legend>
    <p className="text-sm text-muted-foreground">Upload these for every vehicle, even if the business documents are the same. An admin verifies validity from the documents.</p>
    <label className="block text-sm">Business registration
      <select className="mt-1 block w-full rounded border bg-background p-2" value={businessType} onChange={e => onBusinessType(e.target.value)}>
        <option value="dti">Sole proprietor — DTI</option><option value="sec">Corporation / partnership — SEC</option>
      </select>
    </label>
    {[businessType, "mayors_permit", "bir", "cpc", "ltfrb_clarification"].map(type => <label key={type} className="block space-y-1 text-sm">
      <span>{documentLabel(type)}{[businessType,"mayors_permit","bir"].includes(type) ? " *" : " (if available)"}</span>
      <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => {
        const f=e.target.files?.[0] ?? null;
        if (!f || validateComplianceUpload(f)) onChange(type,f); else e.target.value="";
      }} />
      {files[type] && <span className="text-xs text-muted-foreground">{files[type]?.name}</span>}
    </label>)}
    <p className="text-xs text-muted-foreground">LTFRB applicability needs admin review. A self-drive listing is not automatically exempt. If authority is required, this vehicle must be covered before booking is enabled.</p>
  </fieldset>;
}

function DocumentReview({ document, onReviewed }: { document: ComplianceDocument; onReviewed: () => Promise<void> }) {
  const expires=requiresExpiry(document.document_type) || document.document_type === "orcr";
  const existingEnd=isoToManilaInput(document.valid_until);
  const [start,setStart]=useState(isoToManilaInput(document.valid_from));
  const [end,setEnd]=useState(existingEnd.slice(0,10));
  const [time,setTime]=useState(document.valid_until && new Date(document.valid_until).toISOString().endsWith("15:59:59.999Z") ? "" : existingEnd.slice(11,16));
  const [rental,setRental]=useState(document.rental_use_verified);
  const [reason,setReason]=useState(document.review_reason ?? "");
  const [busy,setBusy]=useState(false);
  const review=async(status: string) => {
    if (status === "approved" && expires && (!start || !end)) { toast.error("Set the effective date and expiry from the document."); return; }
    if (status !== "approved" && !reason.trim()) { toast.error("Enter the reason for this decision."); return; }
    if (status === "approved" && document.document_type === "comprehensive_insurance" && !rental) { toast.error("Verify rental-use coverage first."); return; }
    setBusy(true);
    try {
      const {error}=await supabase.rpc("review_vehicle_documents", {p_car_id:document.car_id,p_reviews:[{
        id:document.id,status,reason, valid_from:manilaInputToIso(start),
        valid_until:expires ? expiryDateToIso(end,time || undefined) : null,rental_use_verified:rental,
      }]});
      if(error) throw error;
      toast.success("Document review saved"); await onReviewed();
    } catch(e) { toast.error(e instanceof Error ? e.message : "Document review failed"); }
    finally {setBusy(false);}
  };
  return <div className="mt-3 space-y-3 rounded-lg border bg-muted/20 p-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs">Effective from (Manila){expires ? " *" : " — optional"}<Input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} /></label>
      {expires && <label className="text-xs">Expiry date *<Input type="date" value={end} onChange={e=>setEnd(e.target.value)} /></label>}
      {expires && <label className="text-xs">Expiry time, only if stated (Manila)<Input type="time" value={time} onChange={e=>setTime(e.target.value)} /><span>Otherwise valid through the end of the expiry date.</span></label>}
    </div>
    {document.document_type === "comprehensive_insurance" && <label className="flex gap-2 text-sm"><input type="checkbox" checked={rental} onChange={e=>setRental(e.target.checked)} />Rental/self-drive use explicitly covered by the insurer</label>}
    <label className="block text-xs">Review note / rejection reason<Input value={reason} onChange={e=>setReason(e.target.value)} /></label>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={()=>void review("approved")}>Approve document</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={()=>void review(document.compliance_status === "approved" ? "revoked" : "rejected")}>{document.compliance_status === "approved" ? "Revoke approval" : "Needs correction"}</Button></div>
  </div>;
}

export default function VehicleCompliancePanel({ carId, admin=false, onChange }: {
  carId: string; admin?: boolean; onChange?: () => void;
}) {
  const {user}=useAuth();
  const [documents,setDocuments]=useState<ComplianceDocument[]>([]);
  const [summary,setSummary]=useState<ComplianceSummary | null>(null);
  const [business,setBusiness]=useState("dti");
  const [ltfrb,setLtfrb]=useState("pending");
  const [note,setNote]=useState("");
  const [files,setFiles]=useState<Record<string,File | null>>({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);
  const load=useCallback(async()=>{
    setError("");
    const results=await Promise.all([
      supabase.from("car_documents").select("*").eq("car_id",carId).order("created_at",{ascending:false}),
      supabase.from("cars").select("business_registration_type,ltfrb_requirement,ltfrb_review_note").eq("id",carId).single(),
      supabase.rpc("vehicle_compliance_summary",{p_car_id:carId}),
    ]);
    const failure=results.find(r=>r.error)?.error;
    if(failure) {setError(failure.message);return;}
    setDocuments((results[0].data ?? []) as unknown as ComplianceDocument[]);
    const car=results[1].data;
    if(car) {setBusiness(car.business_registration_type);setLtfrb(car.ltfrb_requirement);setNote(car.ltfrb_review_note ?? "");}
    setSummary(results[2].data as unknown as ComplianceSummary);
  },[carId]);
  useEffect(()=>{void load();},[load]);
  const reviewed=async()=>{await load();onChange?.();};
  const open=async(d:ComplianceDocument)=>{
    const url=await createPrivateStorageUrl(d.storage_bucket || "vehicle-private-documents",d.storage_path);
    if(url) window.open(url,"_blank","noopener,noreferrer"); else toast.error("Could not open this private document. Please retry.");
  };
  const submit=async()=>{
    if(!user) return;
    const updates=Object.entries(files).filter((entry): entry is [string,File]=>Boolean(entry[1]));
    if(!updates.length) {toast.error("Choose at least one document to update.");return;}
    setBusy(true);
    const uploaded: string[]=[];
    let submitted=false;
    try {
      const payload=[];
      for(const [type,file] of updates) {
        const ext=file.name.split(".").pop()?.toLowerCase() || "pdf";
        const path=`${user.id}/${carId}/${type}_${crypto.randomUUID()}.${ext}`;
        // The same authenticity evidence the add-vehicle path records. A
        // replacement is the likeliest place a doctored document is substituted,
        // so it must not be the path that is checked least. CHAPTER 74 widened
        // submit_vehicle_document_update to accept these and clamps the two
        // enumerated values to their check constraints.
        const provenance=await inspectContentProvenance(file);
        const contentSha256=await hashFileSha256(file);
        const {error:uploadError}=await supabase.storage.from("vehicle-private-documents").upload(path,file);
        if(uploadError) throw uploadError;
        uploaded.push(path);
        payload.push({
          document_type:type,storage_path:path,content_sha256:contentSha256,
          provenance_status:provenance.provenance_status,
          provenance_source:provenance.provenance_source,
          provenance_summary:provenance.provenance_summary,
          ai_suspicion_score:provenance.ai_suspicion_score,
          ai_detector_name:provenance.ai_detector_name,
          ai_detector_version:provenance.ai_detector_version,
          review_flag:provenance.review_flag,
        });
      }
      const {error:submitError}=await supabase.rpc("submit_vehicle_document_update",{p_car_id:carId,p_documents:payload});
      if(submitError) throw submitError;
      submitted=true;
      setFiles({});setRevision(v=>v+1);toast.success("Resubmission sent for admin review");await reviewed();
    } catch(e) {
      // Once the RPC has returned without error the documents ARE filed, so a
      // failure after that point is only a refresh problem. Calling it a failed
      // resubmission sent the lister into a retry the server answers with
      // "A replacement for X is already awaiting review" - a dead end.
      if(submitted) {
        toast.message("Documents filed. Refresh to see the updated status.");
      } else {
        // Referenced evidence is protected by Storage policy, including a submission
        // that committed but whose response was lost. Only orphan uploads can be removed.
        if(uploaded.length) await supabase.storage.from("vehicle-private-documents").remove(uploaded);
        toast.error("Resubmission failed",{description:e instanceof Error ? e.message : "Please retry."});
      }
    }
    finally {setBusy(false);}
  };
  const saveClassification=async()=>{
    setBusy(true);
    try {
      const {error:e}=await supabase.rpc("review_vehicle_documents",{p_car_id:carId,p_reviews:[],p_ltfrb:ltfrb,p_note:note,p_business_type:business});
      if(e) throw e;
      toast.success("Requirements reviewed");await reviewed();
    } catch(e) {toast.error(e instanceof Error ? e.message : "Could not save review");} finally {setBusy(false);}
  };
  const types=COMPLIANCE_DOCUMENTS.filter(d=>!["dti","sec"].includes(d.type) || d.type===business);
  return <section className="space-y-4 rounded-xl border p-4">
    <h2 className="text-lg font-semibold">{admin ? "Document verification & resubmissions" : "Document Renewal & Updates"}</h2>
    {error ? <p role="alert" className="text-sm text-destructive">Document verification is unavailable: {error}. Booking remains disabled until verification is available.</p> : <>
      {summary && <div className={`rounded-lg p-3 text-sm ${summary.eligible ? "bg-green-500/10" : "bg-amber-500/10"}`}>
        {summary.eligible ? "Approved documents are currently valid." : "Missing, expired or unreviewed documents prevent new bookings."}
        {summary.valid_until && summary.eligible && <p>Continuous approved coverage through {new Date(summary.valid_until).toLocaleString("en-PH",{timeZone:"Asia/Manila"})} (Manila).</p>}
        {!summary.eligible && <p className="mt-1">{summary.reasons.map(r=>r === "ltfrb_review_required" ? "LTFRB review required" : documentLabel(r.replace("_coverage_required",""))).join(" · ")}</p>}
      </div>}
      <p className="text-sm text-muted-foreground">Only upload documents you need to replace. BIR, SEC and unchanged CR have no regular expiry. Pending replacements do not extend approved coverage.</p>
      {admin && <div className="space-y-3 rounded-lg border p-3">
        <label className="block text-sm">Business registration<select className="ml-2 rounded border bg-background p-2" value={business} onChange={e=>setBusiness(e.target.value)}><option value="dti">DTI</option><option value="sec">SEC</option></select></label>
        <label className="block text-sm">LTFRB applicability<select className="ml-2 rounded border bg-background p-2" value={ltfrb} onChange={e=>setLtfrb(e.target.value)}><option value="pending">For clarification</option><option value="required">Authority required</option><option value="not_required">Not required — written clarification</option></select></label>
        <Input aria-label="Applicability review note" placeholder="Applicability review note" value={note} onChange={e=>setNote(e.target.value)} />
        <Button type="button" disabled={busy} onClick={()=>void saveClassification()}>Save requirements review</Button>
      </div>}
      {types.map(type=>{
        const matching=documents.filter(d=>d.document_type===type.type || (d.document_type==="orcr" && type.type==="or"));
        const pending=matching.some(d=>d.compliance_status==="pending" && d.renewal_id);
        const needs=summary?.reasons.includes(`${type.type}_coverage_required`);
        return <div key={type.type} className="space-y-2 rounded-lg border p-3">
          <h3 className="font-medium">{type.label} {needs && <span className="text-xs text-amber-700">— required before booking</span>}</h3>
          {!matching.length && <p className="text-xs text-muted-foreground">No document uploaded.</p>}
          {matching.map((d,index)=><details key={d.id} open={admin ? d.compliance_status==="pending" : index===0} className="rounded border p-2">
            <summary className="cursor-pointer text-sm">{d.compliance_status === "pending" && d.renewal_id ? "Resubmission" : d.compliance_status} · {new Date(d.created_at).toLocaleDateString()}{d.valid_until ? ` · expiry ${new Date(d.valid_until).toLocaleDateString("en-PH",{timeZone:"Asia/Manila"})}` : ""}</summary>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={()=>void open(d)}>View document</Button>
            {d.review_reason && <p className="mt-2 text-sm">Review: {d.review_reason}</p>}
            {d.superseded_at && <p className="mt-2 text-xs text-muted-foreground">Historical version: replaced from {new Date(new Date(d.superseded_at).getTime()+1).toLocaleString("en-PH",{timeZone:"Asia/Manila"})} (Manila).</p>}
            {admin && <DocumentReview key={`${d.id}:${d.valid_until}:${d.compliance_status}`} document={d} onReviewed={reviewed} />}
          </details>)}
          {!admin && <label className="block text-xs">{pending ? "Replacement awaiting admin review" : "Update document (leave empty to retain approved version)"}
            <Input key={`${type.type}:${revision}`} type="file" disabled={busy || pending} accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e=>{
              const file=e.target.files?.[0] ?? null;
              if(!file || validateComplianceUpload(file)) setFiles(old=>({...old,[type.type]:file})); else e.target.value="";
            }} />
          </label>}
        </div>;
      })}
      {!admin && <Button type="button" disabled={busy} onClick={()=>void submit()}>{busy ? "Submitting…" : "Submit updated documents"}</Button>}
    </>}
  </section>;
}
