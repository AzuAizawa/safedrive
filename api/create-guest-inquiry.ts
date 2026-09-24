import { createClient } from "@supabase/supabase-js";
import { getClientIp } from "../server/ipBlock.js";
import { sendInquiryReceivedEmail } from "../server/email.js";
import { createGuestInquiryToken, hashGuestInquiryToken } from "../server/guestInquiryToken.js";

export const config = {
  runtime: "edge",
};

type GuestInquiryPayload = {
  name?: string;
  email?: string;
  phone?: string;
  topics?: unknown;
  message?: string;
  company?: string;
};

const allowedTopics = new Set([
  "What is SafeDrive / how it works",
  "Renting a vehicle",
  "Booking availability",
  "Cancellation or rescheduling",
  "Driver requirements",
  "Listing a vehicle / vehicle eligibility",
  "Vehicle requirements",
  "Account registration or verification",
  "Payments, fees, or refunds",
  "Locations or service area",
  "Safety or insurance",
  "Complaint or safety concern",
  "Privacy or personal data",
  "Business or partnership",
  "Technical problem",
  "Other",
]);

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const normalizeSingleLine = (value: unknown, maxLength: number) =>
  typeof value === "string"
    ? value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";

const normalizeMessage = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/\r\n/g, "\n").trim().slice(0, 3000)
    : "";

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;

export const isMissingTopicsColumn = (error: { code?: string; message?: string } | null) =>
  Boolean(
    error &&
      ["42703", "PGRST204"].includes(error.code || "") &&
      (error.message || "").includes("topics"),
  );

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const createFingerprint = async (req: Request, secret: string) => {
  // Right-most hop, not left-most - the caller controls the left end of
  // x-forwarded-for, so reading it let a spammer rotate their own
  // fingerprint at will and walk past the rate limit. See getClientIp.
  const address = getClientIp(req) || "unknown";
  const userAgent = req.headers.get("user-agent") || "unknown";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${address}|${userAgent}`),
    ),
  );
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse({ error: "JSON request body required" }, 415);
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const fingerprintSalt = process.env.GUEST_INQUIRY_HASH_SALT;
    const supabaseKey = serviceRoleKey || anonKey;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Guest inquiry service is not configured");
    }

    const payload = (await req.json()) as GuestInquiryPayload;
    if (payload.company?.trim()) {
      return jsonResponse({ success: true });
    }

    // Name and email are optional (CHAPTER 107): a one-letter name is dropped
    // rather than refused, and a typed email must still be usable.
    const typedName = normalizeSingleLine(payload.name, 120);
    const name = typedName.length >= 2 ? typedName : "";
    const email = normalizeSingleLine(payload.email, 320).toLowerCase();
    const phone = normalizeSingleLine(payload.phone, 40);
    const topics = Array.isArray(payload.topics)
      ? [...new Set(payload.topics.map((topic) => normalizeSingleLine(topic, 100)))]
          .filter((topic) => allowedTopics.has(topic))
      : [];
    const subject = topics.join(", ").slice(0, 160);
    const message = normalizeMessage(payload.message);

    if (topics.length < 1 || message.length < 5 || (email && !isValidEmail(email))) {
      return jsonResponse(
        { error: "Select at least one topic, write a message of at least 5 characters, and check the email if you gave one" },
        400,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // A signed-in person's inquiry is linked to their account so it becomes a
    // threaded conversation they can follow up on in /inquiries. Anonymous
    // visitors have no token and stay a one-email exchange.
    let submittedByUserId: string | null = null;
    const bearer = req.headers.get("authorization")?.startsWith("Bearer ")
      ? req.headers.get("authorization")!.slice("Bearer ".length).trim()
      : null;
    if (bearer && serviceRoleKey) {
      const { data: authData } = await supabase.auth.getUser(bearer);
      submittedByUserId = authData.user?.id ?? null;
    }
    const fingerprintSecret = fingerprintSalt || serviceRoleKey;
    const fingerprint = fingerprintSecret
      ? await createFingerprint(req, fingerprintSecret)
      : `anonymous-${crypto.randomUUID()}`;

    if (!serviceRoleKey) {
      // This fallback predates CHAPTER 107 and still needs both. Without the
      // service role there is also no way to hand the browser its thread.
      if (!name || !email) {
        return jsonResponse({ error: "Enter your name and email to send an inquiry" }, 400);
      }
      const { error } = await supabase.rpc("submit_guest_inquiry", {
        p_name: name,
        p_email: email,
        p_phone: phone || null,
        p_topics: topics,
        p_message: message,
        p_request_fingerprint: fingerprint,
      });
      if (error) throw error;
      return jsonResponse({ success: true }, 201);
    }

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Without an email the fingerprint limit is the one that holds.
    const [{ count: fingerprintCount, error: fingerprintError }, { count: emailCount, error: emailError }] =
      await Promise.all([
        supabase
          .from("guest_inquiries")
          .select("id", { count: "exact", head: true })
          .eq("request_fingerprint", fingerprint)
          .gte("created_at", fifteenMinutesAgo),
        email
          ? supabase
              .from("guest_inquiries")
              .select("id", { count: "exact", head: true })
              .eq("email", email)
              .gte("created_at", oneHourAgo)
          : Promise.resolve({ count: 0, error: null }),
      ]);

    if (fingerprintError || emailError) {
      throw fingerprintError || emailError;
    }
    if ((fingerprintCount ?? 0) >= 3 || (emailCount ?? 0) >= 5) {
      return jsonResponse(
        { error: "Too many inquiries were submitted. Please wait before trying again." },
        429,
      );
    }

    // No account: the browser that asked keeps the thread, by a secret it
    // alone holds. Only the hash is stored.
    const guestToken = submittedByUserId ? null : createGuestInquiryToken();
    const inquiryRecord = {
      name: name || null,
      email: email || null,
      phone: phone || null,
      subject,
      topics,
      message,
      request_fingerprint: fingerprint,
      source: "public_contact",
      ...(submittedByUserId ? { submitted_by_user_id: submittedByUserId } : {}),
      ...(guestToken ? { guest_token_hash: await hashGuestInquiryToken(guestToken) } : {}),
    };
    let inserted: { id: string } | null = null;
    let { data, error } = await supabase.from("guest_inquiries").insert(inquiryRecord).select("id").single();
    inserted = data;

    // Compatibility for a live database that has not yet applied the Chapter
    // 10 multi-topic ALTER. The complete selected topic list remains in the
    // legacy subject field until the additive migration is applied.
    if (isMissingTopicsColumn(error)) {
      const { topics: _topics, ...legacyInquiryRecord } = inquiryRecord;
      ({ data, error } = await supabase.from("guest_inquiries").insert(legacyInquiryRecord).select("id").single());
      inserted = data;
    }

    if (error) throw error;

    // Seed the first thread message so a linked inquiry renders as a
    // conversation from the start. Best-effort - the table may not exist yet
    // on a live DB awaiting the migration.
    if (inserted?.id) {
      await supabase
        .from("guest_inquiry_messages")
        .insert({
          inquiry_id: inserted.id,
          sender_id: submittedByUserId,
          sender_role: "inquirer",
          message,
        })
        .then(({ error: msgError }) => {
          if (msgError && !["42P01", "PGRST205"].includes(msgError.code || "")) {
            console.warn("Inquiry seed message failed", msgError.code);
          }
        });
    }

    // Acknowledge with the reference number. Best-effort: the inquiry is saved,
    // so a mail hiccup must not turn a received question into an error. The
    // rate limits above also bound how often this can email one address.
    if (inserted?.id && email) {
      const receipt = await sendInquiryReceivedEmail({
        to: email,
        name: name || null,
        subject,
        inquiryId: inserted.id,
        linked: Boolean(submittedByUserId),
        baseOrigin: new URL(req.url).origin,
      });
      if (receipt.state !== "sent" && receipt.state !== "not_configured") {
        console.warn("Inquiry acknowledgement email was not delivered", receipt.state);
      }
    }

    return jsonResponse(
      { success: true, id: inserted?.id ?? null, linked: Boolean(submittedByUserId), guestToken },
      201,
    );
  } catch (error) {
    console.error("Guest inquiry creation failed", error);
    return jsonResponse({ error: "Unable to submit your inquiry right now" }, 500);
  }
}
