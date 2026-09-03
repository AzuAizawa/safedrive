import { decodeLicenseQr, type LicenseQrResult } from "@/lib/licenseQr";

export type KycOcrDocument = {
  type: string;
  url: string;
};

export type KycOcrProgress = {
  documentType: string;
  status: string;
  progress: number;
};

export type KycOcrDocumentResult = {
  type: string;
  status: "read" | "failed";
  confidence: number | null;
  textLength: number;
  error?: string;
};

export type KycFieldCheckStatus = "match" | "not_found" | "unreadable" | "manual_review";

export type KycFieldCheck = {
  id: "full_name" | "driver_license";
  label: string;
  status: KycFieldCheckStatus;
  summary: string;
};

export type KycOcrReview = {
  checkedAt: string;
  documents: KycOcrDocumentResult[];
  checks: KycFieldCheck[];
  qr?: LicenseQrResult;
};

type TesseractWorker = Awaited<
  ReturnType<(typeof import("tesseract.js"))["createWorker"]>
>;

type KycExpectedFields = {
  fullName: string | null;
  driverLicense: string | null;
};

let workerPromise: Promise<TesseractWorker> | null = null;
let queuedWork: Promise<void> = Promise.resolve();
let activeProgressListener: ((progress: KycOcrProgress) => void) | undefined;

const reportProgress = (documentType: string, status: string, progress: number) => {
  activeProgressListener?.({ documentType, status, progress });
};

const getWorker = () => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract = await import("tesseract.js");
      const worker = await tesseract.createWorker("eng", undefined, {
        logger: (message) => reportProgress("Identity document", message.status, message.progress),
      });
      await worker.setParameters({ preserve_interword_spaces: "1" });
      return worker;
    })();

    void workerPromise.catch(() => {
      workerPromise = null;
    });
  }

  return workerPromise;
};

const queueWork = <Result>(work: () => Promise<Result>) => {
  const result = queuedWork.then(work);
  queuedWork = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

const normalizedCompact = (value: string) => normalizeText(value).replace(/\s/g, "");

const significantNameTokens = (value: string) =>
  normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3);

export const buildKycFieldChecks = (
  rawText: string,
  expected: KycExpectedFields,
  documents: KycOcrDocumentResult[],
): KycFieldCheck[] => {
  const readableText = rawText.trim().length >= 12 && documents.some((document) => document.status === "read");
  if (!readableText) {
    return [
      {
        id: "full_name",
        label: "Submitted name",
        status: "unreadable",
        summary: "OCR could not read enough text to compare this document. Check the image manually.",
      },
      {
        id: "driver_license",
        label: "Driver's license number",
        status: "unreadable",
        summary: "OCR could not read enough text to compare this document. Check the image manually.",
      },
    ];
  }

  const normalizedDocumentText = normalizeText(rawText);
  const compactDocumentText = normalizedCompact(rawText);
  const nameTokens = expected.fullName ? significantNameTokens(expected.fullName) : [];
  const matchedNameTokens = nameTokens.filter((token) => normalizedDocumentText.includes(token));
  const nameRequiredMatches = nameTokens.length >= 2 ? 2 : 1;
  const nameCheck: KycFieldCheck = nameTokens.length === 0
    ? {
        id: "full_name",
        label: "Submitted name",
        status: "manual_review",
        summary: "No submitted name is available for an automated comparison.",
      }
    : matchedNameTokens.length >= nameRequiredMatches
      ? {
          id: "full_name",
          label: "Submitted name",
          status: "match",
          summary: `${matchedNameTokens.length} submitted name part(s) were found in the OCR text. Confirm visually before approval.`,
        }
      : {
          id: "full_name",
          label: "Submitted name",
          status: "not_found",
          summary: "The submitted name was not confidently found in OCR text. This can be an OCR limitation; compare the image manually.",
        };

  const expectedLicense = expected.driverLicense ? normalizedCompact(expected.driverLicense) : "";
  const licenseCheck: KycFieldCheck = !expectedLicense
    ? {
        id: "driver_license",
        label: "Driver's license number",
        status: "manual_review",
        summary: "No submitted license number is available for an automated comparison.",
      }
    : compactDocumentText.includes(expectedLicense)
      ? {
          id: "driver_license",
          label: "Driver's license number",
          status: "match",
          summary: "The submitted license number was found in OCR text. Confirm visually before approval.",
        }
      : {
          id: "driver_license",
          label: "Driver's license number",
          status: "not_found",
          summary: "The submitted license number was not found in OCR text. This can be an OCR limitation; compare the image manually.",
        };

  return [nameCheck, licenseCheck];
};

export const runKycOcrReview = async ({
  documents,
  expected,
  qrImageUrl,
  onProgress,
}: {
  documents: KycOcrDocument[];
  expected: KycExpectedFields;
  /** URL of the uploaded "LTO Digital License (QR Code)" screenshot, if any. */
  qrImageUrl?: string | null;
  onProgress?: (progress: KycOcrProgress) => void;
}): Promise<KycOcrReview> => {
  const qr = qrImageUrl
    ? await decodeLicenseQr({ imageUrl: qrImageUrl, expected }).catch(() => undefined)
    : undefined;

  if (documents.length === 0) {
    return {
      checkedAt: new Date().toISOString(),
      documents: [],
      checks: buildKycFieldChecks("", expected, []),
      qr,
    };
  }

  return queueWork(async () => {
    activeProgressListener = onProgress;
    reportProgress(documents[0]?.type || "Identity document", "starting OCR engine", 0);

    try {
      const worker = await getWorker();
      const results: KycOcrDocumentResult[] = [];
      const textParts: string[] = [];

      for (const document of documents) {
        try {
          reportProgress(document.type, "recognizing text", 0);
          const result = await worker.recognize(document.url, { rotateAuto: true });
          const text = result.data.text || "";
          textParts.push(text);
          results.push({
            type: document.type,
            status: "read",
            confidence: result.data.confidence,
            textLength: text.trim().length,
          });
        } catch (error) {
          results.push({
            type: document.type,
            status: "failed",
            confidence: null,
            textLength: 0,
            error: error instanceof Error ? error.message : "OCR failed",
          });
        }
      }

      const rawText = textParts.join("\n\n");
      return {
        checkedAt: new Date().toISOString(),
        documents: results,
        checks: buildKycFieldChecks(rawText, expected, results),
        qr,
      };
    } finally {
      activeProgressListener = undefined;
    }
  });
};
