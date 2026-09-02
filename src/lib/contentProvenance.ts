export type ProvenanceStatus =
  | "unknown"
  | "credential_present"
  | "credential_missing"
  | "credential_invalid";

export type ReviewFlag =
  | "none"
  | "needs_admin_review"
  | "approved_after_review"
  | "rejected_after_review";

export interface ContentProvenanceResult {
  provenance_status: ProvenanceStatus;
  provenance_source: string | null;
  provenance_summary: string | null;
  ai_suspicion_score: number | null;
  ai_detector_name: string | null;
  ai_detector_version: string | null;
  review_flag: ReviewFlag;
  review_reason: string | null;
}

const C2PA_MARKERS = [
  "c2pa",
  "C2PA",
  "ContentCredentials",
  "contentcredentials",
  "contentauthenticity",
  "Content Authenticity",
];

const supportedProvenanceTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const scanText = (bytes: Uint8Array) => {
  const decoder = new TextDecoder("latin1");
  let combined = "";
  const chunkSize = 64 * 1024;

  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, bytes.length);
    combined += decoder.decode(bytes.slice(start, end));

    if (combined.length > chunkSize * 2) {
      combined = combined.slice(-chunkSize);
    }

    if (C2PA_MARKERS.some((marker) => combined.includes(marker))) {
      return true;
    }
  }

  return false;
};

export const inspectContentProvenance = async (
  file: File,
): Promise<ContentProvenanceResult> => {
  const baseResult: ContentProvenanceResult = {
    provenance_status: "unknown",
    provenance_source: null,
    provenance_summary: null,
    ai_suspicion_score: null,
    ai_detector_name: null,
    ai_detector_version: null,
    review_flag: "none",
    review_reason: null,
  };

  if (!supportedProvenanceTypes.includes(file.type)) {
    return {
      ...baseResult,
      provenance_status: "unknown",
      provenance_summary:
        "This file type is not checked for signed Content Credentials. This is neutral and does not indicate a fake file.",
    };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hasC2paMarker = scanText(bytes);

    if (hasC2paMarker) {
      return {
        ...baseResult,
        provenance_status: "credential_present",
        provenance_source: "c2pa",
        provenance_summary:
          "Unverified Content Credentials metadata signal found. SafeDrive has not cryptographically validated its origin or signer.",
      };
    }

    return {
      ...baseResult,
      provenance_status: "credential_missing",
      provenance_source: "c2pa",
      provenance_summary:
        "No signed Content Credentials metadata signal found. This is normal for many uploads and does not mean the file is fake.",
    };
  } catch (error) {
    return {
      ...baseResult,
      provenance_status: "unknown",
      provenance_source: "c2pa",
      provenance_summary:
        error instanceof Error
          ? `Content Credentials check could not run: ${error.message}`
          : "Content Credentials check could not run.",
      review_flag: "needs_admin_review",
      review_reason: "Unable to complete automated provenance scan.",
    };
  }
};

export const getProvenanceBadge = (status: ProvenanceStatus) => {
  if (status === "credential_present") {
    return {
      label: "Unverified origin metadata",
      className: "bg-muted text-muted-foreground border-border",
    };
  }

  if (status === "credential_invalid") {
    return {
      label: "Origin signal invalid",
      className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900",
    };
  }

  if (status === "credential_missing") {
    return {
      label: "No signed provenance",
      className: "bg-muted text-muted-foreground border-border",
    };
  }

  return {
    label: "Origin unknown",
    className: "bg-muted text-muted-foreground border-border",
  };
};

export const getReviewFlagBadge = (flag: ReviewFlag) => {
  if (flag === "needs_admin_review") {
    return {
      label: "Manual review",
      className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900",
    };
  }

  if (flag === "approved_after_review") {
    return {
      label: "Reviewed OK",
      className: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900",
    };
  }

  if (flag === "rejected_after_review") {
    return {
      label: "Review rejected",
      className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900",
    };
  }

  return {
    label: "Normal review",
    className: "bg-muted text-muted-foreground border-border",
  };
};
