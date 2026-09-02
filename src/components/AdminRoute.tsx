import { useEffect } from "react";
import { Navigate, Outlet } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminAuthPending } from "@/lib/authPending";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminRoute() {
  const { user, profile, loading, profileError, signOut } = useAuth();
  const pendingSecondFactor = isAdminAuthPending();

  useEffect(() => {
    if (user && pendingSecondFactor) {
      void signOut();
    }
  }, [pendingSecondFactor, signOut, user]);

  if (loading || (user && !profile && !profileError)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (user && !profile && profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Admin Profile Missing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Your admin login worked, but the matching `public.profiles` row
              is missing or blocked by RLS. Use Chapter 16 of
              `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` to diagnose the
              live profile and grants. Assign only the admin role this account
              actually requires, then sign in again.
            </p>
            <p className="break-words text-xs">{profileError}</p>
            <Button
              className="w-full"
              onClick={async () => {
                await signOut();
                window.location.href = "/Safedriveadminlogin";
              }}
            >
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user || (profile?.role !== "admin" && profile?.role !== "super_admin")) {
    return <Navigate to="/Safedriveadminlogin" replace />;
  }

  if (pendingSecondFactor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Admin Sign-In Incomplete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              The admin password step finished, but the security code step did not.
              We signed that partial session out for safety.
            </p>
            <Button className="w-full" onClick={() => (window.location.href = "/Safedriveadminlogin")}>
              Return to Admin Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Browser navigation gate: the server and database remain authoritative for
  // every privileged action. This marker only confirms the admin portal flow.
  if (!sessionStorage.getItem("admin_auth_portal")) {
    return <Navigate to="/Safedriveadminlogin" replace />;
  }

  return <Outlet />;
}
