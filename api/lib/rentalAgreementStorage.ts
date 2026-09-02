export const PRIVATE_VEHICLE_DOCUMENT_BUCKET = "vehicle-private-documents";
export const LEGACY_VEHICLE_DOCUMENT_BUCKET = "vehicle-documents";

export type RentalAgreementStorageLocation = {
  bucket: typeof PRIVATE_VEHICLE_DOCUMENT_BUCKET | typeof LEGACY_VEHICLE_DOCUMENT_BUCKET;
  path: string;
  legacy: boolean;
};

const allowedBuckets = new Set([
  PRIVATE_VEHICLE_DOCUMENT_BUCKET,
  LEGACY_VEHICLE_DOCUMENT_BUCKET,
]);

const decodePath = (value: string) => {
  try {
    return value
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
};

/**
 * Resolve current private paths and legacy Supabase public URLs without ever
 * returning an arbitrary external URL. A valid agreement object must use the
 * historical/current <owner-id>/<car-id>/<filename> layout.
 */
export const resolveRentalAgreementStorageLocation = (
  storagePath: unknown,
  carId: string,
  supabaseUrl: string,
): RentalAgreementStorageLocation | null => {
  if (typeof storagePath !== "string" || !storagePath.trim()) return null;

  let bucket: string = PRIVATE_VEHICLE_DOCUMENT_BUCKET;
  let path = storagePath.trim();
  let legacy = false;

  if (/^https?:\/\//i.test(path)) {
    let storedUrl: URL;
    let configuredUrl: URL;
    try {
      storedUrl = new URL(path);
      configuredUrl = new URL(supabaseUrl);
    } catch {
      return null;
    }

    if (storedUrl.origin !== configuredUrl.origin) return null;

    const match = storedUrl.pathname.match(
      /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
    );
    if (!match) return null;

    bucket = decodeURIComponent(match[1]);
    const decodedPath = decodePath(match[2]);
    if (!decodedPath) return null;
    path = decodedPath;
    legacy = true;
  }

  if (!allowedBuckets.has(bucket)) return null;

  path = path.replace(/^\/+/, "");
  const parts = path.split("/");
  if (
    parts.length < 3 ||
    parts.some((part) => !part || part === "." || part === "..") ||
    parts[1] !== carId
  ) {
    return null;
  }

  if (bucket === LEGACY_VEHICLE_DOCUMENT_BUCKET) legacy = true;

  return {
    bucket: bucket as RentalAgreementStorageLocation["bucket"],
    path,
    legacy,
  };
};
