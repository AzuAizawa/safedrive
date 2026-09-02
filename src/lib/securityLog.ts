import { supabase } from "@/lib/supabase";

export async function recordSecurityEvent(
  action: string,
  details: Record<string, unknown>,
  _userId?: string | null,
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch("/api/record-security-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify({
        action,
        details: {
          ...details,
          path: window.location.pathname,
        },
      }),
    });
  } catch (error) {
    console.warn("Failed to record security event", error);
  }
}
