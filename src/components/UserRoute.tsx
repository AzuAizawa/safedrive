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
            <CardTitle>We could not open your account</CardTitle>
          </CardHeader>
          {/* Written for the person looking at it, not for us. This screen used
              to tell a renter to open Chapter 16 of the master SQL file and
              inspect RLS grants - a developer instruction shown to whoever
              happened to hit it. The diagnostic detail stays for support, but
              it no longer reads like a database console. */}
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              You are signed in, but we could not load your account details.
              Signing out and back in usually fixes this. If it keeps happening,
              send SafeDrive support the line below.
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
