import { useEffect } from "react";
import { Navigate, Outlet } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { isUserAuthPending } from "@/lib/authPending";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function UserRoute() {
  const { user, profile, loading, profileError, signOut } = useAuth();
  const pendingSecondFactor = isUserAuthPending();

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
            <CardTitle>Profile Setup Needed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Your login worked, but SafeDrive could not load your database
              profile. Use Chapter 16 of
              `database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql` to diagnose the
              live grants and profile RLS, then apply only the reviewed repair
              chapter that matches the result.
            </p>
            <p className="break-words text-xs">{profileError}</p>
            <Button
              className="w-full"
              onClick={async () => {
                await signOut();
                window.location.href = "/login";
              }}
            >
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (pendingSecondFactor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Finish Sign-In First</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Your password was accepted, but your security code was not completed.
              We signed that partial session out so your account stays safe.
            </p>
            <Button className="w-full" onClick={() => (window.location.href = "/login")}>
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (profile?.role === "admin" || profile?.role === "super_admin") {
    return <Navigate to="/Safedriveadminlogin" replace />;
  }

  return <Outlet />;
}
