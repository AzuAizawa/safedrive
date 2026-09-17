/**
 * How many items are waiting behind each admin tab, keyed by the nav path.
 *
 * The sidebar shows a dot on a tab with work in it, so an admin does not have
 * to open every tab to find out. It counts the list the notification bell
 * already loaded (`loadAdminAttentionItems`) - no extra queries - and a queue
 * that empties simply stops appearing in the map, which removes the dot on the
 * next refresh.
 *
 * It lives apart from `adminAttention.ts` on purpose: that module opens a
 * Supabase client, and this arithmetic is proved on its own in
 * scripts/process-logic.test.mjs without one.
 */
export const countAttentionByNavPath = (items: Array<{ link: string }>) => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const path = item.link.split(/[?#]/)[0];
    // The dashboard (`/admin`) is skipped: it shows every queue at once, so a
    // dot there would always be lit and would mean nothing.
    if (!path.startsWith("/admin/")) continue;
    counts[path] = (counts[path] ?? 0) + 1;
  }
  return counts;
};
