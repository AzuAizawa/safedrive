import { supabase } from "@/lib/supabase";

const SIGNED_URL_TTL_SECONDS = 10 * 60;

export const createPrivateStorageUrl = async (
  bucket: string,
  storagePath?: string | null,
) => {
  if (!storagePath) return null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (error) return null;
  return data.signedUrl;
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
