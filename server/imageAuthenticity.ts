// AI-image check for every uploaded identity photo, vehicle photo and vehicle
// document (CHAPTER 108), through the Walter Writes image detector:
// https://docs.walterwrites.ai/api-reference/image-detector
//
// The verdict is a guide for the admin reviewer and never a decision. Every
// way the detector can fail - trial expired, no credits, rate limit, a PDF it
// cannot read - becomes a status the reviewer can see, never an error that
// stops an upload or a review.

export const WALTER_IMAGE_DETECTOR_URL = "https://developer-portal.walterwrites.ai/api/image-detector/predict/";

/** What the detector accepts: images up to 10 MB. PDFs are not read. */
export const DETECTABLE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff"];
export const MAX_DETECTABLE_BYTES = 10 * 1024 * 1024;

export type CheckStatus = "checked" | "unsupported" | "pending" | "unavailable";
export type Verdict = "real" | "fake" | "inpainting";

export type CheckOutcome = {
  status: CheckStatus;
  reason: string | null;
  verdict: Verdict | null;
  confidence: number | null;
  prob_real: number | null;
  prob_fake: number | null;
  prob_inpainting: number | null;
  credits_charged: number | null;
  /** Stop checking the rest of this batch: the next call would fail the same way. */
  stop: boolean;
};

const outcome = (status: CheckStatus, reason: string | null, stop = false): CheckOutcome => ({
  status,
  reason,
  verdict: null,
  confidence: null,
  prob_real: null,
  prob_fake: null,
  prob_inpainting: null,
  credits_charged: null,
  stop,
});

const probability = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

const guessTypeFromPath = (path: string) => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (["png", "webp", "gif", "bmp", "tiff"].includes(ext)) return `image/${ext}`;
  return "";
};

/**
 * Whether a stored file can be sent at all. Decided before any call, so a PDF
 * or an oversized file never spends a credit.
 */
export const classifyFile = (path: string, contentType: string, size: number): CheckOutcome | null => {
  const type = (contentType || "").split(";")[0].trim().toLowerCase() || guessTypeFromPath(path);
  if (type === "application/pdf") return outcome("unsupported", "pdf");
  if (!DETECTABLE_TYPES.includes(type)) return outcome("unsupported", "file_type");
  if (size > MAX_DETECTABLE_BYTES) return outcome("unsupported", "too_large");
  return null;
};

/** Turn one detector response into what is stored. */
export const interpretDetectorResponse = (httpStatus: number, body: unknown): CheckOutcome => {
  const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const code = typeof data.code === "string" ? data.code : "";
  // A 403 that is not the detector's own JSON is a firewall page in front of
  // the API refusing this server, not a problem with the key.
  const answeredAsApi = Boolean(body && typeof body === "object");

  if (httpStatus === 200) {
    const verdict = data.prediction;
    if (verdict !== "real" && verdict !== "fake" && verdict !== "inpainting") {
      return outcome("unavailable", "unexpected_response");
    }
    const probabilities = (data.probabilities ?? {}) as Record<string, unknown>;
    return {
      status: "checked",
      reason: null,
      verdict,
      confidence: probability(data.confidence),
      prob_real: probability(probabilities.real),
      prob_fake: probability(probabilities.fake),
      prob_inpainting: probability(probabilities.inpainting),
      credits_charged: typeof data.credits_charged === "number" ? data.credits_charged : null,
      stop: false,
    };
  }
  if (httpStatus === 400) return outcome("unsupported", code === "invalid_image" ? "invalid_image" : "rejected_file");
  if (httpStatus === 401) return outcome("unavailable", "key_invalid", true);
  if (httpStatus === 403 && !answeredAsApi) return outcome("unavailable", "blocked_by_provider", true);
  if (httpStatus === 403) {
    const known = ["trial_expired", "insufficient_credits", "credits_exhausted"];
    return outcome("unavailable", known.includes(code) ? code : "key_missing_scope", true);
  }
  // The per-minute limit (5 on the trial). Left pending and picked up again.
  if (httpStatus === 429) return outcome("pending", "rate_limited", true);
  if (httpStatus === 409) return outcome("pending", "busy", true);
  return outcome("unavailable", "service_unavailable", true);
};

export const callWalterImageDetector = async (
  apiKey: string,
  file: Blob,
  filename: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckOutcome> => {
  const form = new FormData();
  form.append("file", file, filename);
  try {
    const response = await fetchImpl(WALTER_IMAGE_DETECTOR_URL, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: an HTML error or firewall page.
    }
    if (response.status !== 200) {
      console.warn("Walter image detector refused the request", response.status, text.slice(0, 300));
    }
    return interpretDetectorResponse(response.status, body);
  } catch {
    return outcome("unavailable", "service_unavailable", true);
  }
};

/**
 * Whether a file needs a (new) check. `force` is the reviewer's "Check again":
 * it retries anything without a verdict, but never re-spends a credit on one
 * that has an answer for the current file.
 */
export const needsCheck = (
  existing: { status: CheckStatus; checked_at: string } | undefined,
  sourceCreatedAt: string | null,
  force: boolean,
) => {
  if (!existing) return true;
  // The file under this path was replaced after it was checked.
  if (sourceCreatedAt && new Date(existing.checked_at).getTime() < new Date(sourceCreatedAt).getTime()) return true;
  if (existing.status === "checked" || existing.status === "unsupported") return false;
  if (existing.status === "pending") return true;
  return force;
};
