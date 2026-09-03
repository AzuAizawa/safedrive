import type { AdminPermissionKey } from "@/types/database";

/**
 * Front-end side of the admin RBAC (see project_docs/RBAC_DESIGN.md).
 *
 * The database is authoritative — every privileged action is gated by RLS and
 * the /api handlers. These helpers only decide what to *show*: nav items,
 * routes, and action buttons. Hiding a control is never a security boundary.
 *
 * A `super_admin` implicitly passes every check. A plain `admin` passes a key
 * only if it is in their granted set (`public.admin_permissions`).
 */

/** True if this role + grant set is allowed the given permission key. */
export function hasPermission(
  role: string | null | undefined,
  grantedKeys: readonly string[],
  key: AdminPermissionKey,
): boolean {
  if (role === "super_admin") return true;
  if (role !== "admin") return false;
  return grantedKeys.includes(key);
}

/** True if the role + grants pass ANY of the given keys (used for nav groups). */
export function hasAnyPermission(
  role: string | null | undefined,
  grantedKeys: readonly string[],
  keys: readonly AdminPermissionKey[],
): boolean {
  if (role === "super_admin") return true;
  if (role !== "admin") return false;
  return keys.some((key) => grantedKeys.includes(key));
}
