import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { createPrivateStorageUrl, createPrivateStorageUrlMap } from "@/lib/privateStorage";
import { useAuth } from "@/contexts/AuthContext";
import { hashFileSha256, inspectContentProvenance } from "@/lib/contentProvenance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  COMPLIANCE_DOCUMENTS,
  documentLabel,
  matchesDocumentType,
  requiresExpiry,
  expiryDateToIso,
  isoToManilaInput,
  type ComplianceDocument,
  type ComplianceSummary,
} from "@/lib/vehicleCompliance";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export function validateComplianceUpload(file: File): boolean {
  if (!ALLOWED_TYPES.includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) {
    toast.error("Upload a PDF, JPG, PNG or WebP, up to 10 MB.");
    return false;
  }
  return true;
}

// Shows the file the lister just picked, before it is sent. An image gets a real
// thumbnail so a wrong page or an upside-down scan is caught here rather than by
// an admin a day later; anything else shows its name and size.
function ChosenFilePreview({ file, onRemove }: { file: File | null; onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!file) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-secondary p-2">
      {preview ? (
        <img src={preview} alt="" className="h-16 w-16 rounded object-cover" />
      ) : (
        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <p className="max-w-[180px] truncate text-xs font-medium">{file.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {(file.size / 1024 / 1024).toFixed(2)} MB
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// What the lister needs to see at a glance: whether the file they sent is
// still waiting, already accepted, or was sent back. The bare status word was
// easy to miss inside a collapsed row - "Resubmission" in particular never
// said "pending" anywhere.
const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending review", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  approved: { label: "Approved", className: "bg-green-500/15 text-green-700 dark:text-green-400" },
  rejected: { label: "Needs correction", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
  revoked: { label: "Approval revoked", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
};

const isImagePath = (path: string) => /\.(jpe?g|png|webp|gif)$/i.test(path.split("?")[0]);

function DocumentReview({
  document,
  onReviewed,
}: {
  document: ComplianceDocument;
  onReviewed: () => Promise<void>;
}) {
  const expires = requiresExpiry(document.document_type) || document.document_type === "orcr";
  const stated = isoToManilaInput(document.valid_until).slice(0, 10);
  // A document that needs an expiry but arrived without one cannot be approved:
  // the reviewer's job is to agree with the date the lister read off the file,
  // and there is nothing to agree with. It is sent back instead. This only
  // affects submissions made before listers supplied their own dates.
  const missingExpiry = expires && !stated;
  // Deliberately not seeded from review_reason: that column also carries the
  // blanket note the approval page stamps on every document, and pre-filling it
  // would put someone else's words into a rejection.
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const review = async (status: string) => {
    if (status === "approved" && missingExpiry) {
      toast.error("This document arrived without an expiry date.", {
        description: "Send it back and ask the lister to resubmit it with the date shown on it.",
      });
      return;
    }
    if (status !== "approved" && !reason.trim()) {
      toast.error("Say what is wrong, so the lister knows what to resubmit.");
      return;
    }
    setBusy(true);
    try {
      // The lister stated the expiry when they uploaded the file. The review is
      // a comparison, not a transcription: agree with what they wrote, or send
      // it back with a reason. Nothing about the date is sent from here.
      const { error } = await supabase.rpc("review_vehicle_documents", {
        p_car_id: document.car_id,
        p_reviews: [{ id: document.id, status, reason }],
      });
      if (error) throw error;
      toast.success("Document review saved");
      await onReviewed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Document review failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      {expires &&
        (stated ? (
          <p className="text-sm">
            Expiry stated by the lister: <strong>{stated}</strong>
            <span className="ml-2 text-xs text-muted-foreground">
              Approve only if this matches the document above.
            </span>
          </p>
        ) : (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            No expiry date was submitted with this document, so it cannot be approved. Send it
            back and ask for it again with the date shown on the file.
          </p>
        ))}
      <label className="block text-xs">
        Reason (required when sending it back)
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. the expiry on the permit reads 2027-06-30"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || missingExpiry} onClick={() => void review("approved")}>
          Approve document
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void review(document.compliance_status === "approved" ? "revoked" : "rejected")}
        >
          {document.compliance_status === "approved" ? "Revoke approval" : "Needs correction"}
        </Button>
      </div>
    </div>
  );
}

export default function VehicleCompliancePanel({
  carId,
  admin = false,
  onChange,
}: {
  carId: string;
  admin?: boolean;
  onChange?: () => void;
}) {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<ComplianceDocument[]>([]);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  // The expiry the lister reads off each replacement, sent with it.
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // Resolved once per load so a submitted document can be shown in place,
  // instead of only behind a button that opens a new tab.
  const [documentUrls, setDocumentUrls] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError("");
    const results = await Promise.all([
      supabase.from("car_documents").select("*").eq("car_id", carId).order("created_at", { ascending: false }),
      supabase.rpc("vehicle_compliance_summary", { p_car_id: carId }),
    ]);
    const failure = results.find((r) => r.error)?.error;
    if (failure) {
      setError(failure.message);
      return;
    }
    const rows = (results[0].data ?? []) as unknown as ComplianceDocument[];
    setDocuments(rows);
    setSummary(results[1].data as unknown as ComplianceSummary);
    setDocumentUrls(
      await createPrivateStorageUrlMap(
        "vehicle-private-documents",
        rows.map((row) => row.storage_path),
        "vehicle-documents",
      ),
    );
  }, [carId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reviewed = async () => {
    await load();
    onChange?.();
  };

  const open = async (d: ComplianceDocument) => {
    const url = await createPrivateStorageUrl(d.storage_bucket, d.storage_path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.error("Could not open this document. It may have been moved or removed.");
  };

  const submit = async () => {
    if (!user) return;
    const updates = Object.entries(files).filter((entry): entry is [string, File] => Boolean(entry[1]));
    if (!updates.length) {
      toast.error("Choose at least one document to update.");
      return;
    }
    const undated = updates.find(([type]) => requiresExpiry(type) && !expiries[type]);
    if (undated) {
      toast.error("Enter the expiry date", {
        description: `${documentLabel(undated[0])} shows an expiry date - type it in before submitting.`,
      });
      return;
    }
    setBusy(true);
    const uploaded: string[] = [];
    let submitted = false;
    try {
      const payload = [];
      for (const [type, file] of updates) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
        const path = `${user.id}/${carId}/${type}_${crypto.randomUUID()}.${ext}`;
        // The same authenticity evidence the add-vehicle path records. A
        // replacement is the likeliest place a doctored document is substituted,
        // so it must not be the path that is checked least.
        const provenance = await inspectContentProvenance(file);
        const contentSha256 = await hashFileSha256(file);
        const { error: uploadError } = await supabase.storage
          .from("vehicle-private-documents")
          .upload(path, file);
        if (uploadError) throw uploadError;
        uploaded.push(path);
        payload.push({
          document_type: type,
          storage_path: path,
          valid_until: expiries[type] ? expiryDateToIso(expiries[type]) : null,
          content_sha256: contentSha256,
          provenance_status: provenance.provenance_status,
          provenance_source: provenance.provenance_source,
          provenance_summary: provenance.provenance_summary,
          ai_suspicion_score: provenance.ai_suspicion_score,
          ai_detector_name: provenance.ai_detector_name,
          ai_detector_version: provenance.ai_detector_version,
          review_flag: provenance.review_flag,
        });
      }
      const { error: submitError } = await supabase.rpc("submit_vehicle_document_update", {
        p_car_id: carId,
        p_documents: payload,
      });
      if (submitError) throw submitError;
      submitted = true;
      setFiles({});
      setExpiries({});
      setRevision((v) => v + 1);
      toast.success("Resubmission sent for admin review");
      await reviewed();
    } catch (e) {
      // Once the RPC has returned without error the documents ARE filed, so a
      // failure after that point is only a refresh problem. Calling it a failed
      // resubmission sent the lister into a retry the server answers with
      // "A replacement for X is already awaiting review" - a dead end.
      if (submitted) {
        toast.message("Documents filed. Refresh to see the updated status.");
      } else {
        // Referenced evidence is protected by Storage policy, including a submission
        // that committed but whose response was lost. Only orphan uploads can be removed.
        if (uploaded.length) await supabase.storage.from("vehicle-private-documents").remove(uploaded);
        toast.error("Resubmission failed", {
          description: e instanceof Error ? e.message : "Please retry.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">
        {admin ? "Document verification & resubmissions" : "Document Renewal & Updates"}
      </h2>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Document verification is unavailable: {error}. Booking remains disabled until verification is
          available.
        </p>
      ) : (
        <>
          {summary && (
            <div
              className={`rounded-lg p-3 text-sm ${summary.eligible ? "bg-green-500/10" : "bg-amber-500/10"}`}
            >
              {summary.eligible
                ? "Approved documents are currently valid."
                : "Missing, expired or unreviewed documents prevent new bookings."}
              {summary.valid_until && summary.eligible && (
                <p>
                  Approved coverage runs through{" "}
                  {new Date(summary.valid_until).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}{" "}
                  (Manila).
                </p>
              )}
              {!summary.eligible && (
                <p className="mt-1">
                  {summary.reasons
                    .map((r) => documentLabel(r.replace("_coverage_required", "")))
                    .join(" · ")}
                </p>
              )}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Only upload documents you need to replace. CR and BIR have no regular expiry. Pending
            replacements do not extend approved coverage.
          </p>
          {COMPLIANCE_DOCUMENTS.map((type) => {
            const matching = documents.filter((d) => matchesDocumentType(d.document_type, type.type));
            const pending = matching.some((d) => d.compliance_status === "pending" && d.renewal_id);
            const needs = summary?.reasons.includes(`${type.type}_coverage_required`);
            return (
              <div key={type.type} className="space-y-2 rounded-lg border p-3">
                <h3 className="font-medium">
                  {type.label}{" "}
                  {needs && <span className="text-xs text-amber-700">— required before booking</span>}
                </h3>
                {!matching.length && <p className="text-xs text-muted-foreground">No document uploaded.</p>}
                {matching.map((d, index) => (
                  <details
                    key={d.id}
                    open={admin ? d.compliance_status === "pending" : index === 0}
                    className={index === 0 ? "pt-1" : "border-t pt-3"}
                  >
                    <summary className="cursor-pointer text-sm">
                      <span
                        className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          STATUS_BADGES[d.compliance_status]?.className ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {STATUS_BADGES[d.compliance_status]?.label ?? d.compliance_status}
                      </span>
                      {d.renewal_id && d.compliance_status === "pending" ? "Replacement you sent · " : ""}
                      {new Date(d.created_at).toLocaleDateString()}
                      {d.valid_until
                        ? ` · expiry ${new Date(d.valid_until).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}`
                        : ""}
                    </summary>
                    <div className="mt-2 flex flex-wrap items-start gap-3">
                      {documentUrls[d.storage_path] && isImagePath(d.storage_path) ? (
                        <img
                          src={documentUrls[d.storage_path]}
                          alt={`${documentLabel(d.document_type)} preview`}
                          className="h-28 w-28 rounded border object-cover"
                        />
                      ) : (
                        <div className="flex h-28 w-28 items-center justify-center rounded border bg-muted/30">
                          <FileText className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void open(d)}
                      >
                        View full document
                      </Button>
                    </div>
                    {d.review_reason && (
                      <p className="mt-2 text-xs text-muted-foreground">Review note: {d.review_reason}</p>
                    )}
                    {d.superseded_at && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Historical version: replaced from{" "}
                        {new Date(new Date(d.superseded_at).getTime() + 1).toLocaleString("en-PH", {
                          timeZone: "Asia/Manila",
                        })}{" "}
                        (Manila).
                      </p>
                    )}
                    {admin && (
                      <DocumentReview
                        key={`${d.id}:${d.valid_until}:${d.compliance_status}`}
                        document={d}
                        onReviewed={reviewed}
                      />
                    )}
                  </details>
                ))}
                {!admin && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {pending
                        ? "Replacement awaiting admin review"
                        : "Update document (leave empty to retain approved version)"}
                    </p>
                    <div className="flex flex-wrap items-start gap-4">
                      <label
                        className={`flex h-24 w-[150px] shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border text-xs text-muted-foreground transition-colors ${
                          busy || pending
                            ? "cursor-not-allowed opacity-50"
                            : "cursor-pointer hover:border-primary/50"
                        }`}
                      >
                        <Upload className="mb-1 h-5 w-5" />
                        <span className="px-1 text-center">
                          {files[type.type] ? "Change file" : "Upload replacement"}
                        </span>
                        <input
                          key={`${type.type}:${revision}`}
                          type="file"
                          className="hidden"
                          disabled={busy || pending}
                          accept=".pdf,.jpg,.jpeg,.png,.webp"
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            if (!file || validateComplianceUpload(file))
                              setFiles((old) => ({ ...old, [type.type]: file }));
                            else e.target.value = "";
                          }}
                        />
                      </label>
                      <ChosenFilePreview
                        file={files[type.type] ?? null}
                        onRemove={() => {
                          setFiles((old) => ({ ...old, [type.type]: null }));
                          setRevision((v) => v + 1);
                        }}
                      />
                      {requiresExpiry(type.type) && (
                        <div className="space-y-1">
                          <span className="block text-xs text-muted-foreground">
                            Expiry date on the new document *
                          </span>
                          <Input
                            type="date"
                            className="w-[190px]"
                            disabled={busy || pending}
                            min={new Date().toISOString().slice(0, 10)}
                            value={expiries[type.type] ?? ""}
                            onChange={(e) =>
                              setExpiries((old) => ({ ...old, [type.type]: e.target.value }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!admin && (
            <Button type="button" disabled={busy} onClick={() => void submit()}>
              {busy ? "Submitting…" : "Submit updated documents"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
