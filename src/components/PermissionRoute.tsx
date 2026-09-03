import { Navigate, Outlet } from "react-router";

import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminPermissionKey } from "@/types/database";

/**
 * Gate a group of admin routes behind one or more permission keys. Sits inside
 * <AdminRoute> (which already proved the person is staff with a valid portal
 * session), so here we only check the checklist. A super_admin passes every
 * key. Someone lacking all of `anyOf` is bounced to the admin dashboard.
 *
 * The server (RLS + /api) remains the real authority - this just avoids showing
 * a page the person cannot use.
 */
export default function PermissionRoute({
  anyOf,
}: {
  anyOf: AdminPermissionKey[];
}) {
  const { can, permissionsReady } = useAuth();

  // Wait for the grant set to resolve so a permitted admin is never bounced on
  // a cold load / refresh before their permissions have arrived.
  if (!permissionsReady) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Skeleton className="h-10 w-40" />
      </div>
    );
  }

  return anyOf.some((key) => can(key)) ? (
    <Outlet />
  ) : (
    <Navigate to="/admin" replace />
  );
}
