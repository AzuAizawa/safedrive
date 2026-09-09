import { supabase } from "@/lib/supabase";

const SIGNED_URL_TTL_SECONDS = 10 * 60;

// Rows listed before the private bucket existed stored the whole public URL in
// storage_path, and their files still sit in the public `vehicle-documents`
// bucket. CHAPTER 70 then stamped storage_bucket = 'vehicle-private-documents'
// onto every pre-existing row, so those rows now name a bucket their file is not
// in. Signing such a path answers "Object not found".
//
// AdminVehicleApprovalPage had to hand-roll both workarounds; keeping them here
// means every caller gets them.
const LEGACY_PUBLIC_BUCKET = "vehicle-documents";

export const createPrivateStorageUrl = async (
  bucket: string,
  storagePath?: string | null,
) => {
  if (!storagePath) return null;

  // A stored full URL is already the address of the file - signing it as if it
  // were a key can only fail.
  if (storagePath.startsWith("http")) return storagePath;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (!error) return data.signedUrl;

  // Silence here is what turned a five-minute diagnosis into a hunt: the helper
  // returned null and the reason ("Object not found") was never seen by anyone.
  console.warn("Private storage URL failed", {
    bucket,
    storagePath,
    reason: error.message,
  });

  if (bucket === LEGACY_PUBLIC_BUCKET) return null;

  const legacy = await supabase.storage
    .from(LEGACY_PUBLIC_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (!legacy.error) return legacy.data.signedUrl;

  return supabase.storage.from(LEGACY_PUBLIC_BUCKET).getPublicUrl(storagePath).data.publicUrl || null;
};

export const createPrivateStorageUrlMap = async (
  bucket: string,
  storagePaths: Array<string | null | undefined>,
  legacyPublicBucket?: string,
) => {
  const uniquePaths = Array.from(new Set(storagePaths.filter((path): path is string => Boolean(path))));
  const entries = await Promise.all(
    uniquePaths.map(async (path) => {
      const privateUrl = await createPrivateStorageUrl(bucket, path);
      if (privateUrl || !legacyPublicBucket) return [path, privateUrl] as const;

      const legacySignedUrl = await createPrivateStorageUrl(legacyPublicBucket, path);
      if (legacySignedUrl) return [path, legacySignedUrl] as const;

      return [
        path,
        supabase.storage.from(legacyPublicBucket).getPublicUrl(path).data.publicUrl,
      ] as const;
    }),
  );

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
};
