// The AI-image check on every uploaded identity photo, vehicle photo and
// vehicle document (CHAPTER 108). The server runs it (api/image-authenticity);
// this is how the app asks for it and how a reviewer reads the answer.
import { supabase } from "@/lib/supabase";
import type { AuthenticityCheck } from "@/lib/imageAuthenticityLabels";

export * from "@/lib/imageAuthenticityLabels";

export type AuthenticitySubject = { scope: "user"; userId?: string } | { scope: "car"; carId: string };

export type AuthenticityResponse = {
  checks: AuthenticityCheck[];
  remaining: number;
  stopReason: string | null;
  configured: boolean;
};

const post = async (subject: AuthenticitySubject, mode: "run" | "force" | "peek" = "run", keepalive = false) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return fetch("/api/image-authenticity", {
    method: "POST",
    keepalive,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ ...subject, force: mode === "force", peek: mode === "peek" }),
  });
};

/**
 * Right after an upload: ask the server to check what was just filed. Fire and
 * forget - an upload never waits on, or fails because of, the detector. The
 * uploader gets no score back; whatever is not reached now is checked when a
 * reviewer opens it.
 */
export const queueImageChecks = (subject: AuthenticitySubject) => {
  void post(subject, "run", true).catch(() => undefined);
};

/**
 * A reviewer's view of every check for the subject. "peek" only reads - opening
 * a review spends no credits; "run" checks files still missing; "force" also
 * retries ones the detector could not do (expired trial, no credits).
 */
export const fetchImageChecks = async (subject: AuthenticitySubject, mode: "run" | "force" | "peek" = "peek") => {
  const response = await post(subject, mode);
  if (!response) throw new Error("Sign in again to check images.");
  const payload = (await response.json().catch(() => ({}))) as Partial<AuthenticityResponse> & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Image check is unavailable.");
  return {
    checks: payload.checks ?? [],
    remaining: payload.remaining ?? 0,
    stopReason: payload.stopReason ?? null,
    configured: payload.configured ?? true,
  } satisfies AuthenticityResponse;
};
