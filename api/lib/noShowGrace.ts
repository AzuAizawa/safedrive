import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";

/**
 * How long someone waits at the meetup, past the agreed time, before they may
 * report the other side and claim a refund (CHAPTER 68).
 *
 * This number used to be typed out five separate times - here on the server in
 * three different handlers, once on the client, and once more in words inside
 * the help article. Two of those copies even carried a comment saying they
 * "mirrored" the client one, which is an admission that nothing enforced it.
 *
 * The dangerous pair is the client gate and api/booking-incident-action.ts:
 * one decides when the button APPEARS, the other decides whether the click is
 * ACCEPTED. Let those drift and you ship a button that is visible and rejects
 * every press - the same failure already seen twice in this codebase (the dead
 * "Car Returned" button, and the arrival gate). So every server path now goes
 * through this one function, and the client reads the same column through
 * fetchPlatformPolicyTimings().
 *
 * Read live, never snapshotted per booking - same treatment as
 * arrival_checkin_lead_hours and lister_completion_timeout_hours.
 */
export const DEFAULT_NO_SHOW_GRACE_MINUTES = 30;
export const NO_SHOW_GRACE_MINUTES_MIN = 15;
export const NO_SHOW_GRACE_MINUTES_MAX = 180;

export const fetchNoShowGraceMinutes = async (
  supabase: ServiceRoleSupabaseClient,
): Promise<number> => {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("no_show_grace_minutes")
      .eq("id", "default")
      .maybeSingle();

    // A missing column (before CHAPTER 68 is run) or any lookup failure falls
    // back to the shipped default rather than taking the handler down. The
    // client falls back to the same number, so a failed read leaves the two
    // sides agreeing on 30 instead of disagreeing.
    if (error) return DEFAULT_NO_SHOW_GRACE_MINUTES;

    const parsed = Number(data?.no_show_grace_minutes);
    if (
      !Number.isFinite(parsed) ||
      parsed < NO_SHOW_GRACE_MINUTES_MIN ||
      parsed > NO_SHOW_GRACE_MINUTES_MAX
    ) {
      return DEFAULT_NO_SHOW_GRACE_MINUTES;
    }
    return Math.round(parsed);
  } catch {
    return DEFAULT_NO_SHOW_GRACE_MINUTES;
  }
};
