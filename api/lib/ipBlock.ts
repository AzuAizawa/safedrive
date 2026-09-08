import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";

/**
 * The caller's real IP address.
 *
 * Takes `x-real-ip` first, then the RIGHT-most `x-forwarded-for` entry. That
 * ordering matters: `x-forwarded-for` is a chain the client can start, and
 * proxies APPEND to it - so the left-most value is whatever the caller typed
 * and the right-most is what the edge actually saw. Reading the left-most
 * (which api/record-security-event.ts and api/create-guest-inquiry.ts both
 * used to do) lets anyone pick their own IP with one header, which would make
 * both this block and the failed-login counter behind it meaningless.
 */
export const getClientIp = (req: Request): string | null => {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return null;

  const hops = forwarded
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  return hops.length ? hops[hops.length - 1] : null;
};

/**
 * True when this address is currently blocked. An expired row counts as not
 * blocked - the sweep is lazy rather than a scheduled job, since the table is
 * tiny and every read already filters on it.
 */
export const isIpBlocked = async (
  supabase: ServiceRoleSupabaseClient,
  ip: string | null,
): Promise<boolean> => {
  if (!ip) return false;

  try {
    const { data, error } = await supabase
      .from("blocked_ips")
      .select("ip_address, expires_at")
      .eq("ip_address", ip)
      .maybeSingle();

    if (error) {
      // A missing table (before CHAPTER 67 is run) or any lookup failure must
      // not take the whole endpoint down - fail OPEN. A blocklist that breaks
      // the site when it breaks is worse than one that briefly lets someone
      // through.
      return false;
    }
    if (!data) return false;
    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Drop-in guard for a handler. Returns a 403 Response to return immediately,
 * or null to carry on.
 *
 *   const blocked = await blockedIpResponse(supabase, req);
 *   if (blocked) return blocked;
 */
export const blockedIpResponse = async (
  supabase: ServiceRoleSupabaseClient,
  req: Request,
): Promise<Response | null> => {
  const blocked = await isIpBlocked(supabase, getClientIp(req));
  if (!blocked) return null;

  return new Response(
    JSON.stringify({
      error:
        "This network is blocked from SafeDrive. If you think this is a mistake, contact support.",
    }),
    {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
};

/** Failed logins from one address within this window before it auto-blocks. */
export const AUTO_BLOCK_FAILED_ATTEMPTS = 10;
export const AUTO_BLOCK_WINDOW_MINUTES = 15;
export const AUTO_BLOCK_DURATION_HOURS = 24;
