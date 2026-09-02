import { createClient } from "@supabase/supabase-js";

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
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwardedFor || req.headers.get("x-real-ip") || "unknown";
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

    const name = normalizeSingleLine(payload.name, 120);
    const email = normalizeSingleLine(payload.email, 320).toLowerCase();
    const phone = normalizeSingleLine(payload.phone, 40);
    const topics = Array.isArray(payload.topics)
      ? [...new Set(payload.topics.map((topic) => normalizeSingleLine(topic, 100)))]
          .filter((topic) => allowedTopics.has(topic))
      : [];
    const subject = topics.join(", ").slice(0, 160);
    const message = normalizeMessage(payload.message);

    if (name.length < 2 || topics.length < 1 || message.length < 10 || !isValidEmail(email)) {
      return jsonResponse(
        { error: "Enter a valid name and email, select at least one topic, and write a message of at least 10 characters" },
        400,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const fingerprintSecret = fingerprintSalt || serviceRoleKey;
    const fingerprint = fingerprintSecret
      ? await createFingerprint(req, fingerprintSecret)
      : `anonymous-${crypto.randomUUID()}`;

    if (!serviceRoleKey) {
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

    const [{ count: fingerprintCount, error: fingerprintError }, { count: emailCount, error: emailError }] =
      await Promise.all([
        supabase
          .from("guest_inquiries")
          .select("id", { count: "exact", head: true })
          .eq("request_fingerprint", fingerprint)
          .gte("created_at", fifteenMinutesAgo),
        supabase
          .from("guest_inquiries")
          .select("id", { count: "exact", head: true })
          .eq("email", email)
          .gte("created_at", oneHourAgo),
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

    const inquiryRecord = {
      name,
      email,
      phone: phone || null,
      subject,
      topics,
      message,
      request_fingerprint: fingerprint,
      source: "public_contact",
    };
    let { error } = await supabase.from("guest_inquiries").insert(inquiryRecord);

    // Compatibility for a live database that has not yet applied the Chapter
    // 10 multi-topic ALTER. The complete selected topic list remains in the
    // legacy subject field until the additive migration is applied.
    if (isMissingTopicsColumn(error)) {
      const { topics: _topics, ...legacyInquiryRecord } = inquiryRecord;
      ({ error } = await supabase.from("guest_inquiries").insert(legacyInquiryRecord));
    }

    if (error) throw error;

    return jsonResponse({ success: true }, 201);
  } catch (error) {
    console.error("Guest inquiry creation failed", error);
    return jsonResponse({ error: "Unable to submit your inquiry right now" }, 500);
  }
}
