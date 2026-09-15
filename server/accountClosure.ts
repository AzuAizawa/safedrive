import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";

// About 100 years: Supabase Auth's ban has no "forever".
const PERMANENT_BAN = "876000h";

/**
 * Closes the sign-in of an account whose profile has already been erased
 * (anonymize_user, CHAPTER 26/96). The profile keeps its id for the bookings
 * and payments it explains, so the auth user cannot be deleted - that would
 * cascade to the profile. Instead its email is replaced, which frees the
 * address for a new account, and sign-in is banned. profiles.login_closed_at
 * records that it happened, so the daily job can retry any that failed.
 */
export const closeDeletedAccountLogin = async (
  supabase: ServiceRoleSupabaseClient,
  userId: string,
): Promise<boolean> => {
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    email: `deleted+${userId}@safedrive.invalid`,
    email_confirm: true,
    ban_duration: PERMANENT_BAN,
  });
  if (error) {
    console.error("Closing a deleted account's login failed", { userId, reason: error.message });
    return false;
  }

  const { error: stampError } = await supabase
    .from("profiles")
    .update({ login_closed_at: new Date().toISOString() })
    .eq("id", userId)
    .not("deleted_at", "is", null);
  if (stampError) {
    console.error("Recording a closed login failed", { userId, reason: stampError.message });
    return false;
  }
  return true;
};
