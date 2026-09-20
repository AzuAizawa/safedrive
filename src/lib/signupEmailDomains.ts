import { supabase } from "@/lib/supabase";

/**
 * The email domains registration accepts (CHAPTER 102).
 *
 * The list lives in platform_settings so a super admin can add a domain
 * without a deploy. `signup_email_domains()` is readable before sign-in
 * because the registration form has no session yet and still has to say which
 * addresses it will take.
 *
 * This is the form's copy of the rule, for a clear message before anyone waits
 * on a confirmation email that will never be useful. The rule itself is
 * enforced by the `require_allowed_signup_email` trigger on profiles, against
 * the authenticated address rather than whatever the browser submits.
 */

/** A leading dot means "any domain ending here": '.edu.ph' covers up.edu.ph. */
export const isAllowedSignupEmail = (email: string, domains: string[]) => {
  const address = email.trim().toLowerCase();
  const at = address.indexOf("@");
  if (at < 0) return false;
  const domain = address.slice(at + 1);
  if (!domain) return false;

  // Matches the database: an empty list is "no rule configured", never
  // "refuse everyone". A setting cleared by accident must not close signup.
  const entries = domains.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (entries.length === 0) return true;

  return entries.some((entry) =>
    entry.startsWith(".")
      ? domain === entry.slice(1) || domain.endsWith(entry)
      : domain === entry,
  );
};

export const fetchSignupEmailDomains = async (): Promise<string[]> => {
  try {
    const { data, error } = await supabase.rpc("signup_email_domains");
    if (error || !Array.isArray(data)) return [];
    return (data as unknown[]).filter((entry): entry is string => typeof entry === "string");
  } catch {
    // Unreachable settings must not block registration. The trigger is still
    // there, so the worst case is the rejection arriving a step later.
    return [];
  }
};

/** "Gmail, Yahoo, Outlook, or any .edu.ph address" - for the message shown. */
export const describeSignupEmailDomains = (domains: string[]) => {
  const entries = domains.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (entries.length === 0) return "";
  const named = entries.map((entry) =>
    entry.startsWith(".") ? `any ${entry} address` : entry,
  );
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(", ")} or ${named[named.length - 1]}`;
};
