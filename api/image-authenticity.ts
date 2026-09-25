import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  callWalterImageDetector,
  classifyFile,
  needsCheck,
  type CheckOutcome,
  type CheckStatus,
} from "../server/imageAuthenticity.js";

export const config = { runtime: "edge" };

// Files checked per request. The trial allows 5 detector calls a minute, and
// an edge function has to answer within ~25 s; whatever is left stays pending
// and the reviewer's screen asks again.
const BATCH = 4;
const TIME_BUDGET_MS = 18_000;

// peek: a reviewer opening a user or listing reads what is stored and spends
// nothing; the check itself runs only when they press the button.
type Payload = { scope?: "user" | "car"; userId?: string; carId?: string; force?: boolean; peek?: boolean };

type SubjectKind = "identity" | "vehicle_photo" | "vehicle_document";
type SourceFile = {
  bucket: string;
  fallbackBucket?: string;
  storage_path: string;
  subject_kind: SubjectKind;
  subject_id: string;
  created_at: string | null;
  /** A superseded document is shown if it was checked, but never spends a credit. */
  historical: boolean;
};
type StoredCheck = { bucket: string; storage_path: string; status: CheckStatus; checked_at: string } & Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const identityFiles = async (supabase: SupabaseClient, userId: string): Promise<SourceFile[]> => {
  const { data, error } = await supabase
    .from("verification_images")
    .select("storage_path, created_at")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    bucket: "user-verification",
    storage_path: row.storage_path,
    subject_kind: "identity",
    subject_id: userId,
    created_at: row.created_at,
    historical: false,
  }));
};

const vehicleFiles = async (supabase: SupabaseClient, carId: string): Promise<SourceFile[]> => {
  const [images, documents] = await Promise.all([
    supabase.from("car_images").select("storage_path, created_at").eq("car_id", carId),
    supabase.from("car_documents").select("*").eq("car_id", carId),
  ]);
  if (images.error) throw images.error;
  if (documents.error) throw documents.error;
  return [
    ...(images.data ?? []).map((row) => ({
      bucket: "vehicle-documents",
      storage_path: row.storage_path,
      subject_kind: "vehicle_photo" as const,
      subject_id: carId,
      created_at: row.created_at,
      historical: false,
    })),
    ...(documents.data ?? []).map((row) => ({
      // Early listings stored documents in the public bucket.
      bucket: (row.storage_bucket as string | undefined) || "vehicle-private-documents",
      fallbackBucket: "vehicle-documents",
      storage_path: row.storage_path as string,
      subject_kind: "vehicle_document" as const,
      subject_id: carId,
      created_at: (row.created_at as string | null) ?? null,
      historical: Boolean(row.superseded_at),
    })),
  ];
};

const download = async (supabase: SupabaseClient, file: SourceFile) => {
  const first = await supabase.storage.from(file.bucket).download(file.storage_path);
  if (!first.error && first.data) return first.data;
  if (file.fallbackBucket && file.fallbackBucket !== file.bucket) {
    const second = await supabase.storage.from(file.fallbackBucket).download(file.storage_path);
    if (!second.error && second.data) return second.data;
  }
  return null;
};

/**
 * POST { scope: "user", userId? } | { scope: "car", carId }, optional force / peek.
 *
 * An uploader calls it for their own identity photos or vehicle right after
 * uploading, and gets only { ok } back - never a score, so a doctored file
 * cannot be tuned until it passes. A reviewer (users.verify / vehicles.review)
 * gets every check for the subject. Which files are checked is always read
 * from the database, never taken from the caller.
 */
export default async function handler(req: Request) {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    const walterKey = process.env.WALTER_API_KEY;
    if (!url || !serviceKey) throw new Error("Image check service is not configured");

    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const scope = payload.scope === "car" ? "car" : "user";
    const subjectId = scope === "car" ? payload.carId : payload.userId || user.id;
    if (!subjectId || !UUID.test(subjectId)) return jsonResponse({ error: "A valid subject is required" }, 400);

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const isAdmin = ["admin", "super_admin"].includes(profile?.role ?? "");
    let reviewer = false;
    if (isAdmin) {
      const { data: allowed } = await supabase.rpc("admin_can_for", {
        p_uid: user.id,
        p_key: scope === "car" ? "vehicles.review" : "users.verify",
      });
      reviewer = allowed === true;
    }

    if (!reviewer) {
      if (scope === "user" && subjectId !== user.id) return jsonResponse({ error: "Forbidden" }, 403);
      if (scope === "car") {
        const { data: car } = await supabase.from("cars").select("owner_id").eq("id", subjectId).maybeSingle();
        if (!car || car.owner_id !== user.id) return jsonResponse({ error: "Forbidden" }, 403);
      }
    }

    const files = scope === "car" ? await vehicleFiles(supabase, subjectId) : await identityFiles(supabase, subjectId);
    const paths = files.map((file) => file.storage_path);
    const { data: existingRows, error: existingError } = paths.length
      ? await supabase.from("image_authenticity_checks").select("*").in("storage_path", paths)
      : { data: [], error: null };
    if (existingError) throw existingError;
    const existing = new Map(
      ((existingRows ?? []) as StoredCheck[]).map((row) => [`${row.bucket}:${row.storage_path}`, row]),
    );
    const find = (file: SourceFile) =>
      existing.get(`${file.bucket}:${file.storage_path}`) ??
      (file.fallbackBucket ? existing.get(`${file.fallbackBucket}:${file.storage_path}`) : undefined);

    const force = reviewer && payload.force === true;
    const peek = reviewer && payload.peek === true;
    const queue = peek
      ? []
      : files.filter((file) => !file.historical && needsCheck(find(file), file.created_at, force));

    const started = Date.now();
    let processed = 0;
    let stopReason: string | null = null;
    for (const file of queue) {
      if (processed >= BATCH || Date.now() - started > TIME_BUDGET_MS) break;
      processed += 1;

      let result: CheckOutcome;
      const blob = await download(supabase, file);
      if (!blob) {
        result = { ...emptyOutcome("unavailable", "file_missing"), stop: false };
      } else {
        result =
          classifyFile(file.storage_path, blob.type, blob.size) ??
          (walterKey
            ? await callWalterImageDetector(walterKey, blob, file.storage_path.split("/").pop() || "upload")
            : emptyOutcome("unavailable", "not_configured", true));
      }

      const { stop, ...row } = result;
      const { data: saved, error: saveError } = await supabase
        .from("image_authenticity_checks")
        .upsert(
          {
            bucket: file.bucket,
            storage_path: file.storage_path,
            subject_kind: file.subject_kind,
            subject_id: file.subject_id,
            ...row,
            checked_at: new Date().toISOString(),
          },
          { onConflict: "bucket,storage_path" },
        )
        .select("*")
        .single();
      if (saveError) throw saveError;
      existing.set(`${file.bucket}:${file.storage_path}`, saved as StoredCheck);

      if (stop) {
        stopReason = result.reason;
        break;
      }
    }

    // Still waiting: files never reached this time, plus any left pending.
    const remaining = files.filter((file) => {
      if (file.historical) return false;
      const check = find(file);
      return !check || check.status === "pending" || needsCheck(check, file.created_at, false);
    }).length;

    if (!reviewer) return jsonResponse({ ok: true, remaining });

    const checks = files
      .map((file) => find(file))
      .filter((check): check is StoredCheck => Boolean(check));
    return jsonResponse({ checks, remaining, stopReason, configured: Boolean(walterKey) });
  } catch (error) {
    console.error("Image authenticity check failed", error);
    return jsonResponse({ error: "Unable to check images right now" }, 500);
  }
}

function emptyOutcome(status: CheckStatus, reason: string, stop = false): CheckOutcome {
  return {
    status,
    reason,
    verdict: null,
    confidence: null,
    prob_real: null,
    prob_fake: null,
    prob_inpainting: null,
    credits_charged: null,
    stop,
  };
}
