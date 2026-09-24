import { createClient } from "@supabase/supabase-js";
import { GUEST_INQUIRY_TOKEN_PATTERN, hashGuestInquiryToken } from "../server/guestInquiryToken.js";

export const config = { runtime: "edge" };

type Payload = { items?: unknown };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 20;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * The inquiries a browser sent without an account, and their threads
 * (CHAPTER 107). There is no email to reply to, so this is where the visitor
 * reads SafeDrive's answer. Each inquiry is returned only against the secret
 * that browser was handed when it asked; the id alone gets nothing.
 */
export default async function handler(req: Request) {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error("Inquiry service is not configured");

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const items = (Array.isArray(payload.items) ? payload.items : [])
      .filter(
        (item): item is { id: string; token: string } =>
          typeof item?.id === "string" &&
          typeof item?.token === "string" &&
          UUID_PATTERN.test(item.id) &&
          GUEST_INQUIRY_TOKEN_PATTERN.test(item.token),
      )
      .slice(0, MAX_ITEMS);
    if (items.length === 0) return jsonResponse({ inquiries: [] });

    const hashById = new Map(
      await Promise.all(items.map(async (item) => [item.id, await hashGuestInquiryToken(item.token)] as const)),
    );

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: rows, error } = await supabase
      .from("guest_inquiries")
      .select("id, subject, topics, status, created_at, updated_at, guest_token_hash")
      .in("id", [...hashById.keys()])
      .is("submitted_by_user_id", null);
    if (error) throw error;

    const owned = (rows ?? []).filter(
      (row) => row.guest_token_hash && row.guest_token_hash === hashById.get(row.id),
    );
    if (owned.length === 0) return jsonResponse({ inquiries: [] });

    const { data: messages, error: messagesError } = await supabase
      .from("guest_inquiry_messages")
      .select("id, inquiry_id, sender_role, message, created_at")
      .in("inquiry_id", owned.map((row) => row.id))
      .order("created_at", { ascending: true });
    if (messagesError) throw messagesError;

    const inquiries = owned
      .map(({ guest_token_hash: _hash, ...row }) => ({
        ...row,
        messages: (messages ?? []).filter((message) => message.inquiry_id === row.id),
      }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    return jsonResponse({ inquiries });
  } catch (error) {
    console.error("Guest inquiry thread lookup failed", error);
    return jsonResponse({ error: "Unable to load your inquiries right now" }, 500);
  }
}
