// The inquiries this browser sent without an account (CHAPTER 107), and the
// secret for each. A visitor need not give an email, so this browser is where
// SafeDrive's reply is read - like a site chat widget remembering a visitor.
// Clearing site data or switching devices loses them; an email, if given,
// still receives every reply.
import type { GuestInquiry, GuestInquiryMessage } from "@/types/database";

const STORAGE_KEY = "safedrive.guest-inquiries";
const MAX_KEPT = 20;

export type GuestInquiryKey = { id: string; token: string };

export type GuestInquirySummary = Pick<
  GuestInquiry,
  "id" | "subject" | "topics" | "status" | "created_at" | "updated_at"
> & {
  messages: Pick<GuestInquiryMessage, "id" | "inquiry_id" | "sender_role" | "message" | "created_at">[];
};

export const readGuestInquiryKeys = (): GuestInquiryKey[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is GuestInquiryKey => typeof item?.id === "string" && typeof item?.token === "string",
        )
      : [];
  } catch {
    return [];
  }
};

export const rememberGuestInquiry = (key: GuestInquiryKey) => {
  try {
    const kept = readGuestInquiryKeys().filter((item) => item.id !== key.id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([key, ...kept].slice(0, MAX_KEPT)));
  } catch {
    // Storage blocked (private window, site data off): the thread cannot be
    // kept, and the confirmation says so.
  }
};

export const guestInquiryToken = (inquiryId: string) =>
  readGuestInquiryKeys().find((item) => item.id === inquiryId)?.token ?? null;

/** This browser's inquiries with their threads, newest activity first. */
export const fetchGuestInquiries = async (keys = readGuestInquiryKeys()): Promise<GuestInquirySummary[]> => {
  if (keys.length === 0) return [];
  const response = await fetch("/api/guest-inquiry-thread", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: keys }),
  });
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => ({}))) as { inquiries?: GuestInquirySummary[] };
  return payload.inquiries ?? [];
};
