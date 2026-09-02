import { createClient } from "@supabase/supabase-js";
import { resolveRentalAgreementStorageLocation } from "./lib/rentalAgreementStorage.js";

export const config = {
  runtime: "edge",
};

const SIGNED_URL_LIFETIME_SECONDS = 5 * 60;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, private",
    },
  });

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
};

export default async function handler(req: Request) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Approved agreement service is missing its Supabase server configuration");
      return jsonResponse(
        { error: "The agreement service is not configured on this deployment" },
        503,
      );
    }

    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

    const requestUrl = new URL(req.url);
    const carId = requestUrl.searchParams.get("carId")?.trim();
    if (!carId) return jsonResponse({ error: "Missing car ID" }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized request" }, 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("verified_status, deleted_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.deleted_at) return jsonResponse({ error: "Account unavailable" }, 403);
    if (profile.verified_status !== "verified") {
      return jsonResponse(
        { error: "Complete identity verification before reviewing a bookable agreement" },
        403,
      );
    }

    const { data: car, error: carError } = await supabase
      .from("cars")
      .select("id, owner_id, status")
      .eq("id", carId)
      .maybeSingle();
    if (carError) throw carError;
    if (!car) return jsonResponse({ error: "Car not found" }, 404);
    if (!["approved", "active"].includes(car.status ?? "")) {
      return jsonResponse({ error: "This car is not currently available for booking" }, 409);
    }
    if (car.owner_id === user.id) {
      return jsonResponse({ error: "Owners cannot book their own car" }, 403);
    }

    const { data: agreement, error: agreementError } = await supabase
      .from("car_agreement_versions")
      .select("id, version_number, storage_path, content_sha256")
      .eq("car_id", carId)
      .eq("status", "approved")
      .maybeSingle();
    if (agreementError) throw agreementError;
    if (!agreement) {
      return jsonResponse(
        { error: "This vehicle does not have an approved rental agreement" },
        409,
      );
    }

    const storageLocation = resolveRentalAgreementStorageLocation(
      agreement.storage_path,
      carId,
      supabaseUrl,
    );
    if (!storageLocation) {
      console.error("Approved agreement has an invalid storage path", agreement.id);
      return jsonResponse({ error: "The approved rental agreement is unavailable" }, 409);
    }

    const { data: signedAgreement, error: signedUrlError } = await supabase.storage
      .from(storageLocation.bucket)
      .createSignedUrl(storageLocation.path, SIGNED_URL_LIFETIME_SECONDS);
    if (signedUrlError || !signedAgreement?.signedUrl) {
      console.error("Unable to sign approved agreement", signedUrlError?.message);
      return jsonResponse({ error: "The approved rental agreement is unavailable" }, 409);
    }

    return jsonResponse({
      agreementVersionId: agreement.id,
      versionNumber: agreement.version_number,
      contentSha256: agreement.content_sha256,
      url: signedAgreement.signedUrl,
      expiresInSeconds: SIGNED_URL_LIFETIME_SECONDS,
    });
  } catch (error) {
    console.error("Approved agreement access error", error);
    return jsonResponse({ error: "Unable to load the approved rental agreement" }, 500);
  }
}
