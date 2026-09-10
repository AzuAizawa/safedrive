export const COMPLIANCE_DOCUMENTS = [
  { type: "or", label: "LTO registration / OR", short: "Registration", expires: true, optional: false },
  { type: "cr", label: "Certificate of Registration (CR)", short: "CR", expires: false, optional: false },
  { type: "ctpl", label: "CTPL insurance", short: "CTPL", expires: true, optional: false },
  { type: "comprehensive_insurance", label: "Comprehensive insurance (rental use)", short: "Comprehensive", expires: true, optional: true },
  { type: "dti", label: "DTI business name registration", short: "DTI", expires: true, optional: false },
  { type: "mayors_permit", label: "Business / Mayor's Permit", short: "Permit", expires: true, optional: false },
  { type: "bir", label: "BIR Certificate of Registration (Form 2303)", short: "BIR", expires: false, optional: false },
] as const;

export type ComplianceDocumentType = typeof COMPLIANCE_DOCUMENTS[number]["type"];
export type ComplianceSummary = {
  eligible: boolean;
  valid_until: string | null;
  reasons: string[];
};
export type ComplianceDocument = {
  id: string; car_id: string; document_type: string; storage_path: string;
  storage_bucket: string; compliance_status: string; valid_from: string | null;
  valid_until: string | null; superseded_at: string | null; rental_use_verified: boolean;
  review_reason: string | null; renewal_id: string | null; created_at: string;
};

export const documentLabel = (type: string) => COMPLIANCE_DOCUMENTS.find(d => d.type === type)?.label ?? type;
export const requiresExpiry = (type: string) => COMPLIANCE_DOCUMENTS.some(d => d.type === type && d.expires);

// datetime-local values are entered in Manila time, independent of browser timezone.
export function manilaInputToIso(value: string): string | null {
  if (!value) return null;
  const normalized = value.length === 10 ? `${value}T00:00:00` : value;
  const date = new Date(`${normalized}+08:00`);
  if (!Number.isFinite(date.getTime())) throw new Error("Enter a valid Manila date and time.");
  return date.toISOString();
}
export function isoToManilaInput(value: string | null): string {
  if (!value) return "";
  return new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16);
}
export function expiryDateToIso(value: string, time = "23:59:59.999"): string | null {
  return value ? manilaInputToIso(`${value}T${time}`) : null;
}
export function complianceReason(summary: ComplianceSummary): string {
  if (summary.eligible) return "Documents cover the selected rental period.";
  return "This vehicle's approved documents do not cover these rental dates. Choose earlier dates or another vehicle.";
}

// A legacy combined OR/CR row satisfies both the OR and the CR requirement -
// vehicle_compliance_summary treats it that way, so every reader has to agree or
// the CR reads as missing for every vehicle listed before the two were split.
export const matchesDocumentType = (documentType: string, required: string) =>
  documentType === required ||
  (documentType === "orcr" && (required === "or" || required === "cr"));

export type ExpiryChipState =
  | "valid"
  | "soon"
  | "expired"
  | "pending"
  | "undated"
  | "missing";
export type ExpiryChip = {
  type: string;
  label: string;
  state: ExpiryChipState;
  date: string | null;
};
type ExpiryChipRow = {
  document_type: string;
  compliance_status: string;
  valid_until: string | null;
  superseded_at: string | null;
};

// The expiry dates a lister needs to watch, read from the documents themselves
// rather than from the three columns on cars - those cannot describe the DTI or
// the Mayor's Permit, whose dates only ever existed on car_documents.
export function documentExpiryChips(
  rows: ExpiryChipRow[],
  now = Date.now(),
): ExpiryChip[] {
  const chips: ExpiryChip[] = [];
  for (const document of COMPLIANCE_DOCUMENTS) {
    if (!document.expires) continue;
    // A superseded row described a file that has already been replaced; its
    // expiry is history, not a warning.
    const live = rows.filter(
      (row) =>
        matchesDocumentType(row.document_type, document.type) &&
        (!row.superseded_at || new Date(row.superseded_at).getTime() > now),
    );
    const approved = live.filter((row) => row.compliance_status === "approved");
    const chip = (state: ExpiryChipState, date: string | null = null) =>
      chips.push({ type: document.type, label: document.short, state, date });

    if (!approved.length) {
      if (live.some((row) => row.compliance_status === "pending")) chip("pending");
      else if (!document.optional) chip("missing");
      continue;
    }
    // More than one approved row can be in force at once - a renewal filed early
    // overlaps the document it replaces. The later date is the one that matters.
    const latest = approved.reduce<string | null>(
      (best, row) =>
        row.valid_until && (!best || row.valid_until > best) ? row.valid_until : best,
      null,
    );
    if (!latest) {
      chip("undated");
      continue;
    }
    const days = Math.floor((new Date(latest).getTime() - now) / 86_400_000);
    const date = isoToManilaInput(latest).slice(0, 10);
    chip(days < 0 ? "expired" : days <= 30 ? "soon" : "valid", date);
  }
  return chips;
}

export function expiryChipText(chip: ExpiryChip): string {
  switch (chip.state) {
    case "valid":
      return `${chip.label}: Valid to ${chip.date}`;
    case "soon":
      return `${chip.label}: Expires ${chip.date}`;
    case "expired":
      return `${chip.label}: Expired ${chip.date}`;
    case "pending":
      return `${chip.label}: Awaiting review`;
    case "undated":
      return `${chip.label}: No expiry on file`;
    default:
      return `${chip.label}: Missing`;
  }
}

export function expiryChipTone(chip: ExpiryChip): string {
  if (chip.state === "valid") return "border-emerald-500/30 bg-emerald-500/5 text-emerald-600";
  if (chip.state === "expired" || chip.state === "missing")
    return "border-red-500/30 bg-red-500/5 text-red-600";
  return "border-amber-500/30 bg-amber-500/5 text-amber-600";
}
