import { supabase } from "@/lib/supabase";

/**
 * Return the account to renter (default) mode.
 *
 * Lister mode is a deliberate, in-session choice made through the "Switch to
 * Lister" control. Airbnb-style, it does not survive leaving the session: this
 * runs on every sign-out AND at the end of every fresh sign-in, so opening the
 * app by logging in always lands in the renter UI. A plain page refresh (the
 * Supabase session is resumed, not re-created) does not call this, so a lister
 * who reloads stays in lister mode.
 *
 * The `is_lister = true` filter makes it a no-op when already in renter mode.
 * Returns true only when it actually flipped a row, so callers can decide
 * whether a state refresh is needed. Any error is logged, never thrown.
 */
export async function resetToRenterMode(
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ is_lister: false })
      .eq("id", userId)
      .eq("is_lister", true)
      .select("id");
    if (error) {
      console.warn("Could not reset lister mode:", error.message);
      return false;
    }
    return (data ?? []).length > 0;
  } catch (error) {
    console.warn("Could not reset lister mode:", error);
    return false;
  }
}
