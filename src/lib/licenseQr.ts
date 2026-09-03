import jsQR from "jsqr";

/**
 * Reads the QR code from the "LTO Digital License (QR Code)" screenshot the user
 * uploads and cross-checks whatever it contains against the submitted name and
 * license number. Runs entirely in the reviewer's browser - no network calls,
 * no third-party service. It is an assist only: it never approves or rejects,
 * and an unreadable QR just falls back to a manual scan.
 */

export type LicenseQrCheckStatus = "match" | "mismatch" | "info" | "unreadable";

export type LicenseQrCheck = {
  label: string;
  status: LicenseQrCheckStatus;
  summary: string;
};

export type LicenseQrResult = {
  decoded: boolean;
  /** Only surfaced when the QR content is a URL (safe to show); never a raw PII blob. */
  linkHost: string | null;
  isOfficialLtoHost: boolean;
  checks: LicenseQrCheck[];
};

// LTO / LTMS domains an official digital-licence QR should point at.
const OFFICIAL_LTO_HOSTS = [
  "lto.gov.ph",
  "portal.lto.gov.ph",
  "ltms.lto.gov.ph",
  "lmvir.lto.gov.ph",
];

const MAX_DIMENSION = 1600;

async function imageDataFromUrl(url: string): Promise<ImageData | null> {
  if (typeof document === "undefined") return null;
  const image = new Image();
  image.crossOrigin = "anonymous";
  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
  if (!loaded || !image.naturalWidth) return null;

  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

const unreadable = (reason: string): LicenseQrResult => ({
  decoded: false,
  linkHost: null,
  isOfficialLtoHost: false,
  checks: [{ label: "Digital licence QR", status: "unreadable", summary: reason }],
});

export async function decodeLicenseQr(params: {
  imageUrl: string;
  expected: { fullName?: string | null; driverLicense?: string | null };
}): Promise<LicenseQrResult> {
  const imageData = await imageDataFromUrl(params.imageUrl);
  if (!imageData) {
    return unreadable(
      "The QR screenshot could not be opened. Scan the original in the LTMS app.",
    );
  }

  const found = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  if (!found?.data?.trim()) {
    return unreadable(
      "No QR code could be read from this screenshot (blurry, cropped, or low resolution). Scan the original manually.",
    );
  }

  const raw = found.data.trim();
  let linkHost: string | null = null;
  let urlText = "";
  try {
    const url = new URL(raw);
    linkHost = url.hostname.toLowerCase();
    urlText = decodeURIComponent(`${url.pathname} ${url.search}`);
  } catch {
    // Not a URL - an opaque LTMS payload. Still searchable as text below.
  }
  const isOfficialLtoHost = linkHost
    ? OFFICIAL_LTO_HOSTS.some(
        (host) => linkHost === host || linkHost.endsWith(`.${host}`),
      )
    : false;

  const checks: LicenseQrCheck[] = [
    {
      label: "Digital licence QR",
      status: "info",
      summary: linkHost
        ? isOfficialLtoHost
          ? `Decoded. Links to an official LTO domain (${linkHost}).`
          : `Decoded, but links to "${linkHost}" - not a known LTO domain. Inspect closely.`
        : "Decoded to a data payload (not a link). Many LTMS payloads are opaque; confirm details by scanning the original.",
    },
  ];

  const haystack = `${raw} ${urlText}`.toUpperCase().replace(/[\s-]/g, "");

  const expectedLicense = (params.expected.driverLicense ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  if (expectedLicense.length >= 6) {
    checks.push(
      haystack.includes(expectedLicense)
        ? {
            label: "License number in QR",
            status: "match",
            summary: "The submitted license number appears in the QR contents.",
          }
        : {
            label: "License number in QR",
            status: "mismatch",
            summary:
              "The submitted license number was NOT found in the QR contents. Confirm by scanning the original.",
          },
    );
  }

  const nameTokens = (params.expected.fullName ?? "")
    .toUpperCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Z]/g, ""))
    .filter((token) => token.length >= 3);
  if (nameTokens.length > 0) {
    const matched = nameTokens.filter((token) => haystack.includes(token));
    checks.push(
      matched.length >= Math.ceil(nameTokens.length / 2)
        ? {
            label: "Name in QR",
            status: "match",
            summary: `${matched.length} of ${nameTokens.length} submitted name parts appear in the QR contents.`,
          }
        : {
            label: "Name in QR",
            status: "info",
            summary:
              "The submitted name was not clearly found in the QR contents. This is common for opaque LTMS payloads - confirm by scanning the original.",
          },
    );
  }

  return { decoded: true, linkHost, isOfficialLtoHost, checks };
}
