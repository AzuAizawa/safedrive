import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  clearAdminAuthPending,
  clearUserAuthPending,
} from "@/lib/authPending";
import { recordSecurityEvent } from "@/lib/securityLog";
import { resetToRenterMode } from "@/lib/listerMode";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, ShieldAlert } from "lucide-react";

const isEmailOtpType = (value: string | null): value is EmailOtpType =>
  value === "email" ||
  value === "recovery" ||
  value === "invite" ||
  value === "email_change" ||
  value === "signup";

const ensureProfile = async (userId: string, email: string | undefined) => {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (profile) {
    return profile;
  }

  const { data: newProfile, error: insertError } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      email: email || "",
      role: "user",
      verified_status: "unverified",
    })
    .select("role")
    .single();

  if (insertError) {
    const duplicateProfile =
      insertError.code === "23505" ||
      /duplicate key value/i.test(insertError.message);

    if (duplicateProfile) {
      const { data: existingProfile, error: existingProfileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      if (existingProfileError) {
        throw existingProfileError;
      }

      if (existingProfile) {
        return existingProfile;
      }
    }

    throw new Error(
      `Signed in, but profile creation failed. Run final_schema_alignment.sql in Supabase, then try again. ${insertError.message}`,
    );
  }

  return newProfile;
};

export default function AuthConfirmPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(true);
  const hasHandledLink = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const finishSignIn = async () => {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const next = searchParams.get("next") ?? hashParams.get("next");
      const tokenHash = searchParams.get("token_hash") ?? hashParams.get("token_hash");
      const type = searchParams.get("type") ?? hashParams.get("type");
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      try {
        if (
          accessToken &&
          refreshToken &&
          !hasHandledLink.current
        ) {
          hasHandledLink.current = true;
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            throw error;
          }

          window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
        } else if (tokenHash && isEmailOtpType(type) && !hasHandledLink.current) {
          hasHandledLink.current = true;
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });

          if (error) {
            throw error;
          }
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        if (!user) {
          throw new Error("This email link is invalid, expired, or already used.");
        }

        if (next === "recovery" || type === "recovery") {
          clearUserAuthPending();
          clearAdminAuthPending();
          navigate("/update-password", { replace: true });
          return;
        }

        const profile = await ensureProfile(user.id, user.email);

        const isAdmin =
          next === "admin" ||
          profile?.role === "admin" ||
          profile?.role === "super_admin";

        if (isAdmin) {
          clearAdminAuthPending();
          sessionStorage.setItem("admin_auth_portal", "verified");
          await recordSecurityEvent(
            "admin_login_success",
            { email: user.email, method: "magic_link" },
            user.id,
          );
          navigate("/admin", { replace: true });
          return;
        }

        clearUserAuthPending();
        const listerModeCleared = await resetToRenterMode(user.id);
        await recordSecurityEvent(
          "user_login_success",
          { email: user.email, method: "magic_link" },
          user.id,
        );
        if (listerModeCleared) {
          window.location.href = "/browse";
        } else {
          navigate("/browse", { replace: true });
        }
      } catch (error) {
        if (cancelled) return;
        const description =
          error instanceof Error
            ? error.message
            : "We could not complete the email link sign-in.";
        setErrorMessage(description);
        setIsWorking(false);
        return;
      }

      if (!cancelled) {
        setIsWorking(false);
      }
    };

    void finishSignIn();

    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams]);

  if (errorMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">
              <ShieldAlert className="h-7 w-7 text-red-500" />
            </div>
            <CardTitle>Email Link Failed</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate("/login", { replace: true })}>
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <CardTitle>Finishing Sign-In</CardTitle>
          <CardDescription>
            We&apos;re validating your email link and sending you to the right page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-8">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {isWorking ? "Verifying link..." : "Redirecting..."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
