import { supabase } from "./supabase";

/**
 * Uploads a file to Supabase Storage with validation
 * @param file - The file to upload
 * @param bucket - The storage bucket to upload to
 * @param path - The storage path within the bucket
 * @returns Object with success status, URL, and error if any
 */
export const uploadFile = async (
  file: File,
  bucket: string,
  path: string,
): Promise<{ success: boolean; url?: string; error?: string }> => {
  // Validate file type based on bucket
  const allowedTypes: Record<string, string[]> = {
    "user-verification": ["image/jpeg", "image/png", "image/webp"],
    "support-attachments": ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    "vehicle-private-documents": ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    "vehicle-documents": ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  };

  const maxSize = 10 * 1024 * 1024; // 10MB

  // Check file size
  if (file.size > maxSize) {
    return { success: false, error: "File size must be under 10MB" };
  }

  // Check file type
  const allowed = allowedTypes[bucket];
  if (allowed && !allowed.includes(file.type)) {
    return {
      success: false,
      error: `Only ${allowed.join(", ")} files are allowed`,
    };
  }

  try {
    // Upload file
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: true });

    if (uploadError) throw uploadError;

    if (["user-verification", "support-attachments", "vehicle-private-documents"].includes(bucket)) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 10 * 60);
      if (error) throw error;
      return { success: true, url: data.signedUrl };
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return { success: true, url: data.publicUrl };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
};

/**
 * Uploads multiple files to Supabase Storage
 * @param files - Array of files to upload
 * @param bucket - The storage bucket to upload to
 * @param basePath - The base storage path within the bucket (file index will be appended)
 * @returns Array of results for each file
 */
export const uploadMultipleFiles = async (
  files: File[],
  bucket: string,
  basePath: string,
): Promise<
  Array<{ success: boolean; url?: string; error?: string; index: number }>
> => {
  const results = await Promise.all(
    files.map(async (file, index) => {
      const path = `${basePath}_${index}.${file.name.split(".").pop()}`;
      const result = await uploadFile(file, bucket, path);
      return { ...result, index };
    }),
  );
  return results;
};
