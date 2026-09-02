import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

const getErrorMessage = (error: unknown, fallback = "Please try again.") =>
  error instanceof Error ? error.message : fallback;

const SUPPORT_EMAIL = "admin.no.reply.360@gmail.com";
const SUPPORT_SUBJECT = "SafeDrive MFA Recovery Request";
const SUPPORT_GMAIL_URL = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
  SUPPORT_EMAIL,
)}&su=${encodeURIComponent(SUPPORT_SUBJECT)}`;

export default function UpdatePasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loading, user } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorProfile, setErrorProfile] = useState<string | null>(null);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [requiresMfaStep, setRequiresMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const recoveryLinkHandled = useRef(false);

  const normalizeAuthenticatorCode = (value: string) =>
    value.replace(/\D/g, "").slice(0, 6);

  useEffect(() => {
    const checkRecoveryAccess = async () => {
      if (loading) {
        return;
      }

      let activeUser = user;

      if (!user && !recoveryLinkHandled.current) {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const tokenHash = searchParams.get("token_hash") ?? hashParams.get("token_hash");
        const type = searchParams.get("type") ?? hashParams.get("type");

        try {
          if (accessToken && refreshToken) {
            recoveryLinkHandled.current = true;
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) throw error;
            const {
              data: { user: sessionUser },
              error: sessionUserError,
            } = await supabase.auth.getUser();
            if (sessionUserError) throw sessionUserError;
            activeUser = sessionUser ?? null;
            window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
          } else if (tokenHash && type === "recovery") {
            recoveryLinkHandled.current = true;
            const { error } = await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: "recovery",
            });
            if (error) throw error;
            const {
              data: { user: recoveryUser },
              error: recoveryUserError,
            } = await supabase.auth.getUser();
            if (recoveryUserError) throw recoveryUserError;
            activeUser = recoveryUser ?? null;
          }
        } catch (error) {
          setErrorProfile(getErrorMessage(error, "This password reset link is invalid, expired, or already used."));
          setIsCheckingAccess(false);
          return;
        }
      }

      if (!activeUser) {
        const {
          data: { user: currentUser },
          error: currentUserError,
        } = await supabase.auth.getUser();

        if (currentUserError) {
          setErrorProfile(getErrorMessage(currentUserError, "This password reset link is invalid, expired, or already used."));
          setIsCheckingAccess(false);
          return;
        }

        activeUser = currentUser ?? null;
      }

      if (!activeUser) {
        setErrorProfile("This password reset link is invalid, expired, or already used.");
        setIsCheckingAccess(false);
        return;
      }

      const {
        data: assuranceData,
        error: assuranceError,
      } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (assuranceError) {
        setErrorProfile(`Could not validate the recovery session. ${assuranceError.message}`);
        setIsCheckingAccess(false);
        return;
      }

      if (
        assuranceData?.currentLevel !== "aal2" &&
        assuranceData?.nextLevel === "aal2"
      ) {
        const { data: factorData, error: factorError } =
          await supabase.auth.mfa.listFactors();

        if (factorError) {
          setErrorProfile(`Could not load your authenticator setup. ${factorError.message}`);
          setIsCheckingAccess(false);
          return;
        }

        const verifiedFactor = factorData?.totp.find(
          (factor) => factor.status === "verified",
        );

        if (!verifiedFactor) {
          setErrorProfile(
            "This account requires MFA to reset the password, but no verified authenticator factor could be loaded.",
          );
          setIsCheckingAccess(false);
          return;
        }

        setMfaFactorId(verifiedFactor.id);
        setRequiresMfaStep(true);
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("verified_status, deleted_at")
        .eq("id", activeUser.id)
        .single();

      if (profile?.deleted_at) {
        setErrorProfile("This account is scheduled for deletion and cannot reset its password.");
      }

      setIsCheckingAccess(false);
    };

    void checkRecoveryAccess();
  }, [loading, navigate, searchParams, user]);

  if (loading || isCheckingAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 animate-fade-in">
        <Card className="max-w-md w-full shadow-2xl">
          <CardHeader className="text-center">
            <CardTitle>Checking Reset Link</CardTitle>
            <CardDescription>We&apos;re validating your recovery session.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (errorProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 animate-fade-in">
        <Card className="max-w-md w-full shadow-2xl border-red-500/20">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-2 border border-red-500/20">
              <ShieldAlert className="w-8 h-8 text-red-500" />
            </div>
            <CardTitle className="text-xl text-red-500">Access Denied</CardTitle>
            <CardDescription className="text-muted-foreground mt-2">{errorProfile}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline" onClick={() => navigate("/login")}>
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (requiresMfaStep) {
        if (!mfaFactorId) {
          throw new Error("Authenticator factor is missing for this recovery session.");
        }

        if (mfaCode.length !== 6) {
          toast.error("Enter the 6-digit code from your authenticator app.");
          setIsSubmitting(false);
          return;
        }

        const { error: mfaError } = await supabase.auth.mfa.challengeAndVerify({
          factorId: mfaFactorId,
          code: mfaCode,
        });

        if (mfaError) {
          throw mfaError;
        }
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      toast.success("Password updated successfully!", { description: "You can now log in securely." });
      await supabase.auth.signOut();
      navigate("/login");
    } catch (error) {
      toast.error("Failed to update password", {
        description: getErrorMessage(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 animate-fade-in">
      <Card className="max-w-md w-full shadow-2xl">
        <CardHeader>
          <CardTitle>Update Recovery Password</CardTitle>
          <CardDescription>Enter a new secure password for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  placeholder="Minimum 6 characters"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Match your new password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {requiresMfaStep && (
              <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                    MFA verification required
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This account has MFA enabled, so you have two recovery paths:
                  </p>
                  <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    <li>Use your Google Authenticator code to finish this password reset.</li>
                    <li>If you lost access to your authenticator, contact SafeDrive support first before trying again.</li>
                  </ul>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mfaCode">Authenticator Code</Label>
                  <Input
                    id="mfaCode"
                    type="text"
                    inputMode="numeric"
                    placeholder="Enter 6-digit code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(normalizeAuthenticatorCode(e.target.value))}
                    maxLength={6}
                    className="font-mono text-center tracking-[0.3em]"
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => window.open(SUPPORT_GMAIL_URL, "_blank", "noopener,noreferrer")}
                  >
                    Contact Support
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => navigate("/login")}
                  >
                    Return to Login
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  If Gmail compose does not open, manually email{" "}
                  <span className="font-medium text-foreground">{SUPPORT_EMAIL}</span>{" "}
                  with the subject{" "}
                  <span className="font-medium text-foreground">{SUPPORT_SUBJECT}</span>.
                </p>
              </div>
            )}
            
            <Button 
               type="submit" 
               className="w-full mt-4"
               disabled={
                 isSubmitting ||
                 newPassword.length < 6 ||
                 newPassword !== confirmPassword ||
                 (requiresMfaStep && mfaCode.length !== 6)
               }
            >
               {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
               Update Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
