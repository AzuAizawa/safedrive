export const COMPLIANCE_DOCUMENTS = [
  { type: "or", label: "LTO registration / OR", expires: true },
  { type: "cr", label: "Certificate of Registration (CR)", expires: false },
  { type: "ctpl", label: "CTPL insurance", expires: true },
  { type: "comprehensive_insurance", label: "Comprehensive insurance (rental use)", expires: true },
  { type: "dti", label: "DTI business name registration", expires: true },
  { type: "sec", label: "SEC registration", expires: false },
  { type: "mayors_permit", label: "Business / Mayor's Permit", expires: true },
  { type: "bir", label: "BIR Certificate of Registration (Form 2303)", expires: false },
  { type: "cpc", label: "LTFRB authority / CPC covering this vehicle", expires: true },
  { type: "ltfrb_clarification", label: "Written LTFRB clarification", expires: false },
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
