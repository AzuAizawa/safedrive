import { supabase } from "@/lib/supabase";

/**
 * `profiles.is_lister` is a UI-context flag (nav + landing page), not a
 * permission - the server always authorises by ownership. It is a deliberate
 * in-session choice made through the "Switch to Lister" control.
 *
 * Airbnb-style, it does not survive leaving the session (every sign-out and
 * every fresh sign-in resets it to renter), and following a notification into
 * the other space switches context for you rather than showing a mismatched
 * screen.
 */

export type PortalMode = "lister" | "renter";

/**
 * Set the account's portal mode. The `is_lister = <opposite>` filter makes it a
 * no-op when already in the target mode. Returns true only when it actually
 * flipped a row, so callers can decide whether to refresh state / hard-navigate.
 * Any error is logged, never thrown - the caller falls back to just navigating.
 *
 * Switching *into* lister mode requires a verified account (enforced by the
 * `protect_profile_sensitive_fields` DB trigger); callers should check that
 * first to avoid a pointless failed request.
 */
export async function setPortalMode(
  userId: string | null | undefined,
  mode: PortalMode,
): Promise<boolean> {
  if (!userId) return false;
  const enable = mode === "lister";
  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ is_lister: enable })
      .eq("id", userId)
      .eq("is_lister", !enable)
      .select("id");
    if (error) {
      console.warn("Could not change portal mode:", error.message);
      return false;
    }
    return (data ?? []).length > 0;
  } catch (error) {
    console.warn("Could not change portal mode:", error);
    return false;
  }
}

/** Back-compat helper used by the auth flows. */
export const resetToRenterMode = (userId: string | null | undefined) =>
  setPortalMode(userId, "renter");

const LISTER_PREFIXES = [
  "/lister-bookings",
  "/my-vehicles",
  "/vehicle-availability",
  "/car-renewals",
];
const RENTER_PREFIXES = ["/my-bookings", "/subscriptions"];

/**
 * Which portal mode a destination belongs to, or null when it is neutral
 * (Support, verification, Browse, ...) and should not force a switch. Query
 * strings and hashes are ignored.
 */
export function portalModeForPath(
  path: string | null | undefined,
): PortalMode | null {
  if (!path) return null;
  const clean = path.split("?")[0].split("#")[0];
  const matches = (prefix: string) =>
    clean === prefix || clean.startsWith(`${prefix}/`);
  if (LISTER_PREFIXES.some(matches)) return "lister";
  if (RENTER_PREFIXES.some(matches)) return "renter";
  return null;
}
