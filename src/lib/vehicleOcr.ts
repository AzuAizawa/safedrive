export type VehicleOcrCheckId = "plateNumber" | "ownerName" | "brand" | "model";

export type VehicleOcrCheckStatus = "match" | "mismatch";

export interface VehicleOcrExpectedFields {
  plateNumber: string;
  ownerName: string;
  brand: string;
  model: string;
}

export interface VehicleOcrDocument {
  type: string;
  url: string;
}

export interface VehicleOcrProgress {
  documentType: string;
  status: string;
  progress: number;
}

export interface VehicleOcrDocumentResult {
  type: string;
  status: "read" | "failed";
  confidence: number | null;
  textLength: number;
  error?: string;
}

export interface VehicleOcrCheck {
  id: VehicleOcrCheckId;
  label: string;
  expected: string;
  status: VehicleOcrCheckStatus;
}

export interface VehicleOcrVerificationResult {
  passed: boolean;
  checkedAt: string;
  rawText: string;
  checks: VehicleOcrCheck[];
  documents: VehicleOcrDocumentResult[];
}

type TesseractWorker = Awaited<
  ReturnType<(typeof import("tesseract.js"))["createWorker"]>
>;

interface RunVehicleOcrVerificationArgs {
  documents: VehicleOcrDocument[];
  expected: VehicleOcrExpectedFields;
  onProgress?: (progress: VehicleOcrProgress) => void;
}

const CHECK_LABELS: Record<VehicleOcrCheckId, string> = {
  plateNumber: "Plate Number",
  ownerName: "Registered Owner",
  brand: "Brand",
  model: "Model",
};

// Tesseract loads a WebAssembly engine and language data. Reusing one worker
// avoids repeating that expensive initialization when an admin opens another
// vehicle or selects "Run Again" during the same browser session.
let vehicleOcrWorkerPromise: Promise<TesseractWorker> | null = null;
let queuedOcrWork: Promise<void> = Promise.resolve();
let activeProgressListener: ((progress: VehicleOcrProgress) => void) | undefined;

const reportProgress = (documentType: string, status: string, progress: number) => {
  activeProgressListener?.({ documentType, status, progress });
};

const getVehicleOcrWorker = () => {
  if (!vehicleOcrWorkerPromise) {
    vehicleOcrWorkerPromise = (async () => {
      const tesseract = await import("tesseract.js");
      const worker = await tesseract.createWorker("eng", undefined, {
        logger: (message) => {
          reportProgress("Vehicle documents", message.status, message.progress);
        },
      });

      await worker.setParameters({
        preserve_interword_spaces: "1",
      });

      return worker;
    })();

    void vehicleOcrWorkerPromise.catch(() => {
      vehicleOcrWorkerPromise = null;
    });
  }

  return vehicleOcrWorkerPromise;
};

const queueOcrWork = <Result>(work: () => Promise<Result>) => {
  const result = queuedOcrWork.then(work);
  queuedOcrWork = result.then(
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
    .trim()
    .replace(/\s+/g, " ");

const compactText = (value: string) => normalizeText(value).replace(/\s/g, "");

const tokenize = (value: string) =>
  normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1);

const levenshteinDistance = (a: string, b: string) => {
  const matrix = Array.from({ length: a.length + 1 }, (_, row) =>
    Array.from({ length: b.length + 1 }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)),
  );

  for (let row = 1; row <= a.length; row += 1) {
    for (let col = 1; col <= b.length; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
};

const tokenMatches = (expectedToken: string, ocrTokens: string[]) =>
  ocrTokens.some((ocrToken) => {
    if (ocrToken === expectedToken) return true;
    if (ocrToken.includes(expectedToken) || expectedToken.includes(ocrToken)) return true;

    const allowedDistance = expectedToken.length >= 6 ? 2 : 1;
    return levenshteinDistance(expectedToken, ocrToken) <= allowedDistance;
  });

const hasExpectedValue = (rawText: string, expected: string) => {
  const normalizedExpected = normalizeText(expected);
  if (!normalizedExpected) return false;

  const normalizedRaw = normalizeText(rawText);
  if (normalizedRaw.includes(normalizedExpected)) return true;
  if (compactText(rawText).includes(compactText(expected))) return true;

  const expectedTokens = tokenize(expected);
  if (expectedTokens.length === 0) return false;

  const ocrTokens = tokenize(rawText);
  const matchedTokens = expectedTokens.filter((token) => tokenMatches(token, ocrTokens));
  const requiredMatches = expectedTokens.length <= 2 ? expectedTokens.length : Math.ceil(expectedTokens.length * 0.7);

  return matchedTokens.length >= requiredMatches;
};

const hasExpectedPlate = (rawText: string, expectedPlate: string) => {
  const expected = compactText(expectedPlate);
  if (!expected) return false;

  const compactRaw = compactText(rawText);
  if (compactRaw.includes(expected)) return true;

  const likelyPlateMatches = compactRaw.match(/[A-Z0-9]{3}[A-Z0-9]{3,4}/g) ?? [];
  return likelyPlateMatches.some((candidate) => levenshteinDistance(candidate, expected) <= 1);
};

const buildChecks = (rawText: string, expected: VehicleOcrExpectedFields): VehicleOcrCheck[] => [
  {
    id: "plateNumber",
    label: CHECK_LABELS.plateNumber,
    expected: expected.plateNumber,
    status: hasExpectedPlate(rawText, expected.plateNumber) ? "match" : "mismatch",
  },
  {
    id: "ownerName",
    label: CHECK_LABELS.ownerName,
    expected: expected.ownerName,
    status: hasExpectedValue(rawText, expected.ownerName) ? "match" : "mismatch",
  },
  {
    id: "brand",
    label: CHECK_LABELS.brand,
    expected: expected.brand,
    status: hasExpectedValue(rawText, expected.brand) ? "match" : "mismatch",
  },
  {
    id: "model",
    label: CHECK_LABELS.model,
    expected: expected.model,
    status: hasExpectedValue(rawText, expected.model) ? "match" : "mismatch",
  },
];

export const runVehicleOcrVerification = async ({
  documents,
  expected,
  onProgress,
}: RunVehicleOcrVerificationArgs): Promise<VehicleOcrVerificationResult> => {
  if (documents.length === 0) {
    const checks = buildChecks("", expected);

    return {
      passed: false,
      checkedAt: new Date().toISOString(),
      rawText: "",
      checks,
      documents: [],
    };
  }

  return queueOcrWork(async () => {
    activeProgressListener = onProgress;
    let currentDocumentType = documents[0]?.type ?? "Vehicle documents";
    reportProgress(currentDocumentType, "starting OCR engine", 0);

    try {
      const worker = await getVehicleOcrWorker();
      const rawTextParts: string[] = [];
      const documentResults: VehicleOcrDocumentResult[] = [];

      for (const document of documents) {
        currentDocumentType = document.type;

        try {
          reportProgress(document.type, "recognizing text", 0);

          const result = await worker.recognize(document.url, { rotateAuto: true });
          const text = result.data.text || "";
          rawTextParts.push(text);
          documentResults.push({
            type: document.type,
            status: "read",
            confidence: result.data.confidence,
            textLength: text.trim().length,
          });
        } catch (error) {
          documentResults.push({
            type: document.type,
            status: "failed",
            confidence: null,
            textLength: 0,
            error: error instanceof Error ? error.message : "OCR failed",
          });
        }
      }

      const rawText = rawTextParts.join("\n\n");
      const checks = buildChecks(rawText, expected);

      return {
        passed: checks.every((check) => check.status === "match"),
        checkedAt: new Date().toISOString(),
        rawText,
        checks,
        documents: documentResults,
      };
    } finally {
      activeProgressListener = undefined;
    }
  });
};
