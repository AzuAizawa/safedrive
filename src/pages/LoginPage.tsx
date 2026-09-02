import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  clearUserAuthPending,
  getUserAuthPendingState,
  markUserAuthPending,
  setUserAuthPendingState,
} from "@/lib/authPending";
import {
  clearAuthFailures,
  formatLockoutRemaining,
  getAuthLockoutState,
  registerAuthFailure,
} from "@/lib/authLockout";
import { recordSecurityEvent } from "@/lib/securityLog";
import { qrCodeSrc } from "@/lib/qrCode";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Car, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

const SUPPORT_EMAIL = "admin.no.reply.360@gmail.com";
const SUPPORT_SUBJECT = "SafeDrive MFA Recovery Request";
const SUPPORT_GMAIL_URL = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
  SUPPORT_EMAIL,
)}&su=${encodeURIComponent(SUPPORT_SUBJECT)}`;
const SESSION_TIMEOUT_NOTICE_KEY = "session_timeout_notice";

const getFriendlyLoginError = (message: string) => {
  if (/invalid login credentials|invalid credentials/i.test(message)) {
    return "No SafeDrive account was found for this email, or the password is incorrect. Please check the email address, create an account, or use Forgot password.";
  }

  if (/email not confirmed/i.test(message)) {
    return "This email is registered but not confirmed yet. Please check your inbox for the verification email.";
  }

  if (/jwt issued at future/i.test(message)) {
    return "Your device clock is out of sync with the login service. Turn on automatic date and time, then try again.";
  }

  return message;
};

const maskEmail = (value: string) => {
  const [name, domain] = value.split("@");
  if (!name || !domain) return value;
  const visible = name.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(name.length - 1, 4))}@${domain}`;
};

const normalizeEmailCode = (value: string) =>
  value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 10);

const normalizeAuthenticatorCode = (value: string) =>
  value.replace(/\D/g, "").slice(0, 6);

const EMAIL_OTP_LIFETIME_MS = 10 * 60 * 1000;

const formatOtpRemaining = (remainingMs: number) => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const isStaleAuthenticatorChallengeError = (message: string) =>
  /challenge id.*not found|challenge.*not found|challenge expired/i.test(
    message.toLowerCase(),
  );

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<"password" | "otp">("password");
  const [codeMethod, setCodeMethod] = useState<"email" | "authenticator">("email");
  const [otpCode, setOtpCode] = useState("");
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [authFactorId, setAuthFactorId] = useState("");
  const [authChallengeId, setAuthChallengeId] = useState("");
  const [setupFactorId, setSetupFactorId] = useState("");
  const [setupQrCode, setSetupQrCode] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [setupUri, setSetupUri] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [showAuthenticatorSetup, setShowAuthenticatorSetup] = useState(false);
  const [offerReenroll, setOfferReenroll] = useState(false);
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [, setLockoutTick] = useState(() => Date.now());
  const {
    signIn,
    signOut,
    sendOtp,
    verifyOtpCode,
    getAuthenticatorFactor,
    startAuthenticatorEnrollment,
    startAuthenticatorChallenge,
    verifyAuthenticatorCode,
    cancelAuthenticatorEnrollment,
  } = useAuth();
  const navigate = useNavigate();
  const lockoutState = getAuthLockoutState("user", email);
  const emailOtpRemainingMs =
    codeMethod === "email" && otpExpiresAt
      ? Math.max(0, otpExpiresAt - Date.now())
      : 0;
  const emailOtpExpired =
    codeMethod === "email" && otpExpiresAt !== null && emailOtpRemainingMs <= 0;
  const normalizedEmail = email.trim().toLowerCase();

  useEffect(() => {
    const interval = window.setInterval(() => setLockoutTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const rawNotice = window.sessionStorage.getItem(SESSION_TIMEOUT_NOTICE_KEY);
    if (!rawNotice) return;

    window.sessionStorage.removeItem(SESSION_TIMEOUT_NOTICE_KEY);

    try {
      const parsed = JSON.parse(rawNotice) as { portal?: string; reason?: string };
      if (parsed.reason === "inactivity" && parsed.portal === "user") {
        toast.info("Session expired", {
          description:
            "You were signed out after 10 minutes of inactivity. Please sign in again.",
        });
      }
    } catch {
      // Ignore malformed timeout notices.
    }
  }, []);

  useEffect(() => {
    const pendingState = getUserAuthPendingState();
    if (!pendingState || pendingState.step !== "otp") return;

    setEmail((currentEmail) => currentEmail || pendingState.email);
    setStep("otp");
    setCodeMethod(pendingState.codeMethod);
    setAuthFactorId(pendingState.authFactorId || "");
    setAuthChallengeId(pendingState.authChallengeId || "");
    setOtpExpiresAt(
      pendingState.codeMethod === "email"
        ? pendingState.otpExpiresAt ??
            (pendingState.otpSentAt
              ? pendingState.otpSentAt + EMAIL_OTP_LIFETIME_MS
              : Date.now() + EMAIL_OTP_LIFETIME_MS)
        : null,
    );
    setShowAuthenticatorSetup(false);
  }, []);

  const persistPendingOtpState = (
    method: "email" | "authenticator",
    factorId?: string,
    challengeId?: string,
    expiresAt?: number | null,
  ) => {
    setUserAuthPendingState({
      email: normalizedEmail,
      step: "otp",
      codeMethod: method,
      authFactorId: factorId,
      authChallengeId: challengeId,
      otpSentAt: method === "email" ? Date.now() : undefined,
      otpExpiresAt:
        method === "email"
          ? expiresAt ?? Date.now() + EMAIL_OTP_LIFETIME_MS
          : undefined,
    });
  };

  const redirectAdminAwayFromUserPortal = async (userId: string) => {
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (
      userProfile?.role === "admin" ||
      userProfile?.role === "super_admin"
    ) {
      await signOut();
      toast.error("Use the admin portal for this account.");
      navigate("/Safedriveadminlogin");
      return true;
    }

    return false;
  };

  const startEmailCode = async () => {
    await signOut();
    clearUserAuthPending();
    const { error } = await sendOtp(normalizedEmail, "/auth/confirm?next=user");
    if (error) {
      toast.error("Failed to send verification code", {
        description: error.message,
      });
      return false;
    }

    setCodeMethod("email");
    setOtpCode("");
    const expiresAt = Date.now() + EMAIL_OTP_LIFETIME_MS;
    setOtpExpiresAt(expiresAt);
    setStep("otp");
    persistPendingOtpState("email", undefined, undefined, expiresAt);
    toast.success("Verification code sent to your email!");
    return true;
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutState.isLocked) {
      toast.error("Too many failed sign-in attempts", {
        description: `Try again in ${formatLockoutRemaining(lockoutState.remainingMs)}.`,
      });
      return;
    }
    setIsLoading(true);
    const { error } = await signIn(normalizedEmail, password);
    if (error) {
      const failureState = registerAuthFailure("user", normalizedEmail);
      await recordSecurityEvent("user_login_failed", {
        email: normalizedEmail,
        method: "password",
        reason: error.message,
      });
      if (failureState.isLocked) {
        await recordSecurityEvent("lockout_started", {
          email: normalizedEmail,
          portal: "user",
          reason: "Too many failed login attempts",
          failed_attempts: failureState.failedAttempts,
          locked_until: new Date(failureState.lockedUntil).toISOString(),
        });
      }
      toast.error("Login failed", { description: getFriendlyLoginError(error.message) });
      if (failureState.isLocked) {
        toast.error("Too many failed sign-in attempts", {
          description: `SafeDrive locked this login for ${failureState.lockoutMinutes} minutes.`,
        });
      }
      setIsLoading(false);
      return;
    }

    const {
      data: { user: signedInUser },
      error: signedInUserError,
    } = await supabase.auth.getUser();

    if (signedInUserError || !signedInUser) {
      await signOut();
      clearUserAuthPending();
      toast.error("Login failed", {
        description:
          signedInUserError?.message ??
          "Your session could not be verified after sign-in.",
      });
      setIsLoading(false);
      return;
    }

    clearAuthFailures("user", normalizedEmail);

    // Check role and status before proceeding to OTP
    const { data: userProfile, error: profileError } = await supabase
      .from("profiles")
      .select("role, deleted_at, login_blocked_until, login_block_reason")
      .eq("id", signedInUser.id)
      .maybeSingle();

    if (profileError) {
      await signOut();
      clearUserAuthPending();
      toast.error("Login failed", {
        description: profileError.message,
      });
      setIsLoading(false);
      return;
    }

    if (userProfile && (userProfile.role === "admin" || userProfile.role === "super_admin")) {
      await signOut();
      clearUserAuthPending();
      toast.error("Login failed", {
        description:
          "This email belongs to an admin account. Please use the SafeDrive admin portal.",
      });
      setIsLoading(false);
      return;
    }

    if (userProfile?.deleted_at) {
      await signOut();
      clearUserAuthPending();
      toast.error("Account Suspended", { 
        description: "Your account is queued for deletion and is currently inaccessible during the 30-day grace period." 
      });
      setIsLoading(false);
      return;
    }

    if (
      userProfile?.login_blocked_until &&
      new Date(userProfile.login_blocked_until).getTime() > Date.now()
    ) {
      await signOut();
      clearUserAuthPending();
      toast.error("Sign-in temporarily blocked", {
        description:
          userProfile.login_block_reason ||
          "An administrator temporarily blocked access to this account.",
      });
      setIsLoading(false);
      return;
    }

    markUserAuthPending();

    const { factorId, error: factorError } = await getAuthenticatorFactor();
    if (factorError) {
      toast.error("Authenticator check failed", {
        description: factorError.message,
      });
      await startEmailCode();
      setIsLoading(false);
      return;
    }

    if (factorId) {
      const { challengeId, error: challengeError } =
        await startAuthenticatorChallenge(factorId);
      if (challengeError || !challengeId) {
        toast.error("Authenticator code is unavailable", {
          description: challengeError?.message ?? "Could not start the authenticator challenge.",
        });
        await startEmailCode();
        setIsLoading(false);
        return;
      }

      setAuthFactorId(factorId);
      setAuthChallengeId(challengeId);
      setCodeMethod("authenticator");
      setOtpCode("");
      setOtpExpiresAt(null);
      setStep("otp");
      persistPendingOtpState("authenticator", factorId, challengeId);
      toast.success("Enter the code from your Authenticator app.");
      setIsLoading(false);
      return;
    }

    const { enrollment, error: enrollmentError } =
      await startAuthenticatorEnrollment();
    if (enrollment) {
      setSetupFactorId(enrollment.factorId);
      setSetupQrCode(enrollment.qrCode);
      setSetupSecret(enrollment.secret);
      setSetupUri(enrollment.uri);
      setSetupCode("");
      setShowAuthenticatorSetup(true);
      toast.success("Set up Authenticator app for future codes.");
      setIsLoading(false);
      return;
    }

    if (enrollmentError) {
      toast.error("Authenticator setup unavailable", {
        description: `${enrollmentError.message}. Falling back to email code.`,
      });
    }

    await startEmailCode();
    setIsLoading(false);
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutState.isLocked) {
      toast.error("Too many failed sign-in attempts", {
        description: `Try again in ${formatLockoutRemaining(lockoutState.remainingMs)}.`,
      });
      return;
    }
    setIsLoading(true);

    if (codeMethod === "authenticator") {
      const { error } = await verifyAuthenticatorCode(
        authFactorId,
        authChallengeId,
        otpCode,
      );
      if (error) {
        if (
          authFactorId &&
          isStaleAuthenticatorChallengeError(error.message)
        ) {
          const { challengeId, error: refreshError } =
            await startAuthenticatorChallenge(authFactorId);

          if (!refreshError && challengeId) {
            setAuthChallengeId(challengeId);
            setOtpCode("");
            setOtpExpiresAt(null);
            persistPendingOtpState("authenticator", authFactorId, challengeId);
            toast.error("Authenticator check expired", {
              description:
                "We refreshed the challenge. Enter the newest 6-digit code from your authenticator app and try again.",
            });
            setIsLoading(false);
            return;
          }

          toast.error("Authenticator check expired", {
            description:
              refreshError?.message ??
              "Refresh the authenticator check and try again.",
          });
          setIsLoading(false);
          return;
        }

        const failureState = registerAuthFailure("user", normalizedEmail);
        if (failureState.isLocked) {
          await recordSecurityEvent("lockout_started", {
            email: normalizedEmail,
            portal: "user",
            method: "authenticator",
            reason: "Too many failed authenticator attempts",
            failed_attempts: failureState.failedAttempts,
            locked_until: new Date(failureState.lockedUntil).toISOString(),
          });
        }
        toast.error("Authenticator verification failed", {
          description: error.message,
        });
        setIsLoading(false);
        return;
      }

      const {
        data: { user: verifiedUser },
      } = await supabase.auth.getUser();

      if (
        verifiedUser &&
        (await redirectAdminAwayFromUserPortal(verifiedUser.id))
      ) {
        setIsLoading(false);
        return;
      }

      await recordSecurityEvent(
        "user_login_success",
        { email: normalizedEmail, method: "authenticator" },
        verifiedUser?.id,
      );
      clearAuthFailures("user", normalizedEmail);
      clearUserAuthPending();
      toast.success("Welcome back!");
      navigate("/browse");
      setIsLoading(false);
      return;
    }

    if (emailOtpExpired) {
      toast.error("Verification code expired", {
        description: "Please request a new email code to continue signing in.",
      });
      setIsLoading(false);
      return;
    }

    const { data, error } = await verifyOtpCode(normalizedEmail, otpCode);
    if (error) {
      const failureState = registerAuthFailure("user", normalizedEmail);
      if (failureState.isLocked) {
        await recordSecurityEvent("lockout_started", {
          email: normalizedEmail,
          portal: "user",
          method: "email_otp",
          reason: "Too many failed One-Time Password attempts",
          failed_attempts: failureState.failedAttempts,
          locked_until: new Date(failureState.lockedUntil).toISOString(),
        });
      }
      toast.error("Verification failed", { description: error.message });
      setIsLoading(false);
      return;
    }

    if (data.user && (await redirectAdminAwayFromUserPortal(data.user.id))) {
      setIsLoading(false);
      return;
    }

    await recordSecurityEvent(
      "user_login_success",
      { email: normalizedEmail, method: "email_otp" },
      data.user?.id,
    );
    clearAuthFailures("user", normalizedEmail);
    clearUserAuthPending();

    // Signed in with the email-code fallback while an authenticator is still
    // enrolled - most likely the device was lost. Offer a fresh QR.
    const { factorId: staleFactorId } = await getAuthenticatorFactor();
    if (staleFactorId) {
      setOfferReenroll(true);
      setIsLoading(false);
      return;
    }

    toast.success("Welcome back!");
    navigate("/browse");
    setIsLoading(false);
  };

  const handleReenrollAuthenticator = async () => {
    setIsLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Your session expired. Sign in again.");
      }

      const response = await fetch("/api/reset-my-authenticator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not reset the authenticator");
      }

      const { enrollment, error: enrollmentError } =
        await startAuthenticatorEnrollment();
      if (!enrollment) {
        throw new Error(
          enrollmentError?.message ?? "Could not start a new enrollment",
        );
      }

      setSetupFactorId(enrollment.factorId);
      setSetupQrCode(enrollment.qrCode);
      setSetupSecret(enrollment.secret);
      setSetupUri(enrollment.uri);
      setSetupCode("");
      setOfferReenroll(false);
      setShowAuthenticatorSetup(true);
      toast.success("Scan the new QR code with your authenticator app.");
    } catch (error) {
      toast.error("Could not set up a new authenticator", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkipReenroll = () => {
    setOfferReenroll(false);
    toast.success("Welcome back!");
    navigate("/browse");
  };

  const handleAuthenticatorSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { challengeId, error: challengeError } =
      await startAuthenticatorChallenge(setupFactorId);
    if (challengeError || !challengeId) {
      toast.error("Authenticator setup failed", {
        description: challengeError?.message ?? "Could not create an authenticator challenge.",
      });
      setIsLoading(false);
      return;
    }

    const { error } = await verifyAuthenticatorCode(
      setupFactorId,
      challengeId,
      setupCode,
    );
    if (error) {
      toast.error("Authenticator code rejected", { description: error.message });
      setIsLoading(false);
      return;
    }

    const {
      data: { user: verifiedUser },
    } = await supabase.auth.getUser();

    if (
      verifiedUser &&
      (await redirectAdminAwayFromUserPortal(verifiedUser.id))
    ) {
      setIsLoading(false);
      return;
    }

    await recordSecurityEvent(
      "user_mfa_enrolled",
      { email: normalizedEmail, method: "authenticator" },
      verifiedUser?.id,
    );
    clearUserAuthPending();
    toast.success("Authenticator app connected. Welcome back!");
    navigate("/browse");
    setIsLoading(false);
  };

  const handleResendOtp = async () => {
    if (!normalizedEmail) return;
    setIsLoading(true);

    if (codeMethod === "authenticator" && authFactorId) {
      const { challengeId, error } = await startAuthenticatorChallenge(authFactorId);
      if (error || !challengeId) {
        toast.error("Failed to refresh authenticator challenge", {
          description: error?.message ?? "Please try again.",
        });
      } else {
        setAuthChallengeId(challengeId);
        setOtpExpiresAt(null);
        persistPendingOtpState("authenticator", authFactorId, challengeId);
        toast.success("Authenticator challenge refreshed", {
          description: "Use the newest 6-digit code in your app.",
        });
      }
      setIsLoading(false);
      return;
    }

    const { error } = await sendOtp(normalizedEmail, "/auth/confirm?next=user");
    if (error) {
      toast.error("Failed to resend verification code", {
        description: error.message,
      });
    } else {
      const expiresAt = Date.now() + EMAIL_OTP_LIFETIME_MS;
      setOtpExpiresAt(expiresAt);
      persistPendingOtpState("email", undefined, undefined, expiresAt);
      toast.success("New verification code sent", {
        description: `Check ${maskEmail(normalizedEmail)} for the latest code.`,
      });
    }
    setIsLoading(false);
  };

  const handleUseEmailInstead = async () => {
    setIsLoading(true);
    if (showAuthenticatorSetup && setupFactorId) {
      await cancelAuthenticatorEnrollment(setupFactorId);
      setSetupFactorId("");
    }
    setSetupUri("");
    setShowAuthenticatorSetup(false);
    setOtpExpiresAt(null);
    await startEmailCode();
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background via-background to-primary/3">
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl -translate-x-1/3 -translate-y-1/3 pointer-events-none" />

      <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/25">
            <Car className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold tracking-tight">SafeDrive</span>
        </div>

        <Card className="shadow-2xl border-border/50">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>Enter your credentials to sign in</CardDescription>
          </CardHeader>
          {step === "password" && !showAuthenticatorSetup ? (
            <form onSubmit={handlePasswordSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setLockoutTick(Date.now());
                    }}
                    required
                    autoComplete="off"
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button type="button" className="text-xs text-primary hover:underline font-medium" onClick={() => {
                      setForgotEmail(email);
                      setIsForgotModalOpen(true);
                    }}>
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="h-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-4 border-none bg-transparent pt-2">
                {lockoutState.isLocked && (
                  <p className="w-full rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-center text-xs text-red-500">
                    Too many failed sign-in attempts. Try again in{" "}
                    <span className="font-semibold">
                      {formatLockoutRemaining(lockoutState.remainingMs)}
                    </span>
                    .
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full h-10 shadow-lg shadow-primary/20"
                  disabled={isLoading || lockoutState.isLocked}
                >
                  {isLoading && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Sign In
                </Button>
                <p className="text-sm text-muted-foreground">
                  Don't have an account?{" "}
                  <Link
                    to="/signup"
                    className="text-primary font-medium hover:underline"
                  >
                    Sign up
                  </Link>
                </p>
              </CardFooter>
            </form>
          ) : showAuthenticatorSetup ? (
            <form onSubmit={handleAuthenticatorSetupSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    Scan this QR code in Google Authenticator, Authy, Microsoft
                    Authenticator, or 1Password.
                  </p>
                  <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-lg border bg-white p-3">
                    {setupQrCode && (
                      <img
                        src={qrCodeSrc(setupQrCode)}
                        alt="Authenticator QR code"
                        className="h-full w-full [image-rendering:pixelated]"
                      />
                    )}
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3 text-left">
                    <p className="text-xs font-medium text-muted-foreground">
                      Manual setup key
                    </p>
                    <p className="mt-1 break-all font-mono text-sm">
                      {setupSecret}
                    </p>
                  </div>
                  {setupUri && (
                    <a
                      href={setupUri}
                      className="inline-flex text-sm font-medium text-primary hover:underline"
                    >
                      Open in authenticator app
                    </a>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="setupCode">Authenticator Code</Label>
                    <Input
                      id="setupCode"
                      type="text"
                      inputMode="numeric"
                      placeholder="Enter 6-digit code"
                      value={setupCode}
                      onChange={(e) =>
                        setSetupCode(normalizeAuthenticatorCode(e.target.value))
                      }
                      required
                      maxLength={6}
                      className="h-12 text-center tracking-[0.25em] sm:tracking-[0.5em] text-xl sm:text-2xl font-mono"
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-3 border-none bg-transparent pt-2">
                <Button
                  type="submit"
                  className="w-full h-10 shadow-lg shadow-primary/20"
                  disabled={isLoading || setupCode.length < 6}
                >
                  {isLoading && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Connect Authenticator
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={handleUseEmailInstead}
                  disabled={isLoading}
                  className="w-full"
                >
                  Use Email Code Instead
                </Button>
              </CardFooter>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    {codeMethod === "authenticator" ? (
                      <>
                        Open your authenticator app and enter the current
                        6-digit SafeDrive code.
                      </>
                    ) : (
                      <>
                        We sent a verification code to{" "}
                        <strong>{maskEmail(email)}</strong>
                      </>
                    )}
                  </p>
                  {codeMethod === "email" && otpExpiresAt && (
                    <p
                      className={`text-xs ${
                        emailOtpExpired
                          ? "text-red-500"
                          : "text-muted-foreground"
                      }`}
                    >
                      {emailOtpExpired
                        ? "This verification code expired. Request a new code to continue."
                        : `This code expires in ${formatOtpRemaining(emailOtpRemainingMs)}.`}
                    </p>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="otp">
                      {codeMethod === "authenticator"
                        ? "Authenticator Code"
                        : "Verification Code"}
                    </Label>
                    <Input
                      id="otp"
                      type="text"
                      inputMode={codeMethod === "authenticator" ? "numeric" : "text"}
                      placeholder={
                        codeMethod === "authenticator"
                          ? "Enter 6-digit code"
                          : "Enter email code"
                      }
                    value={otpCode}
                    onChange={(e) =>
                        setOtpCode(
                          codeMethod === "authenticator"
                            ? normalizeAuthenticatorCode(e.target.value)
                            : normalizeEmailCode(e.target.value),
                        )
                      }
                      required
                      maxLength={codeMethod === "authenticator" ? 6 : 10}
                      className="h-12 text-center tracking-[0.2em] sm:tracking-[0.4em] text-xl sm:text-2xl font-mono"
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-4 border-none bg-transparent pt-2">
                {lockoutState.isLocked && (
                  <p className="w-full rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-center text-xs text-red-500">
                    Too many failed sign-in attempts. Try again in{" "}
                    <span className="font-semibold">
                      {formatLockoutRemaining(lockoutState.remainingMs)}
                    </span>
                    .
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full h-10 shadow-lg shadow-primary/20"
                  disabled={
                    isLoading ||
                    lockoutState.isLocked ||
                    emailOtpExpired ||
                    (codeMethod === "authenticator"
                      ? otpCode.length !== 6
                      : otpCode.length < 4)
                  }
                >
                  {isLoading && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Verify & Sign In
                </Button>
                <div className="grid grid-cols-1 gap-2 w-full">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={handleResendOtp}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {codeMethod === "authenticator"
                      ? "Refresh Authenticator Check"
                      : "Resend Code"}
                  </Button>
                  {codeMethod === "authenticator" && (
                    <Button
                      variant="outline"
                      type="button"
                      onClick={handleUseEmailInstead}
                      disabled={isLoading}
                      className="w-full"
                    >
                      Use Email Code Instead
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setForgotEmail(email);
                      setIsForgotModalOpen(true);
                    }}
                    className="text-sm text-muted-foreground w-full"
                  >
                    Use password reset instead
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  type="button"
                    onClick={async () => {
                      if (codeMethod === "authenticator") {
                        await signOut();
                      }
                      clearUserAuthPending();
                      setOtpExpiresAt(null);
                      setStep("password");
                      setShowAuthenticatorSetup(false);
                      setOtpCode("");
                  }}
                  className="text-sm text-muted-foreground w-full"
                >
                  Back to login
                </Button>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
      </div>

      {/* Legal Links pinned to the bottom */}
      <div className="flex items-center justify-center gap-4 py-5 text-xs text-muted-foreground border-t border-border/30">
        <Link to="/privacy-policy" className="text-blue-600 dark:text-blue-400 hover:underline transition-colors duration-200">
          Privacy Policy
        </Link>
        <span className="opacity-30">&middot;</span>
        <Link to="/terms" className="text-blue-600 dark:text-blue-400 hover:underline transition-colors duration-200">
          Terms and Conditions
        </Link>
        <span className="opacity-30">&middot;</span>
        <Link to="/platform-agreement" className="text-blue-600 dark:text-blue-400 hover:underline transition-colors duration-200">
          Platform Agreement
        </Link>
      </div>

      {isForgotModalOpen &&
        createPortal(
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto p-4 py-6 bg-black/80 backdrop-blur-sm animate-fade-in" onClick={() => setIsForgotModalOpen(false)}>
          <Card className="max-w-sm w-full shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>Reset Password</CardTitle>
              <CardDescription>Enter your email address and we'll send you a link to reset your password.</CardDescription>
            </CardHeader>
            <form onSubmit={async (e) => {
               e.preventDefault();
               setIsLoading(true);
               const normalizedForgotEmail = forgotEmail.trim().toLowerCase();
               const { error } = await supabase.auth.resetPasswordForEmail(normalizedForgotEmail, {
                 redirectTo: `${window.location.origin}/update-password`,
               });
               if (error) {
                 toast.error(error.message);
               } else {
                 toast.success("Password reset link sent!");
                 setIsForgotModalOpen(false);
               }
               setIsLoading(false);
            }}>
               <CardContent className="space-y-4">
                 <div className="space-y-2">
                   <Label>Email address</Label>
                   <Input type="email" required value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} />
                 </div>
                 <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                   <p className="font-medium text-amber-700 dark:text-amber-300">
                     If your account uses Google Authenticator
                   </p>
                   <p className="mt-1">
                     The reset email link will still work, but you may be asked for your current authenticator code before the new password can be saved.
                   </p>
                   <p className="mt-1">
                     Lost access to your authenticator? Contact support at{" "}
                     <a
                       href={SUPPORT_GMAIL_URL}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="text-blue-600 underline dark:text-blue-400"
                     >
                       {SUPPORT_EMAIL}
                     </a>.
                   </p>
                   <p className="mt-1">
                     If Gmail compose does not open, manually email{" "}
                     <span className="font-medium text-foreground">{SUPPORT_EMAIL}</span>{" "}
                     with the subject{" "}
                     <span className="font-medium text-foreground">{SUPPORT_SUBJECT}</span>.
                   </p>
                 </div>
               </CardContent>
               <CardFooter className="flex gap-2 justify-end">
                 <Button type="button" variant="outline" onClick={() => setIsForgotModalOpen(false)}>Cancel</Button>
                 <Button type="submit" disabled={isLoading}>
                   {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                   Send Link
                 </Button>
               </CardFooter>
            </form>
          </Card>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={offerReenroll}
        title="Set up a new authenticator?"
        description="You signed in with an email code, but an authenticator app is still connected to this account. If you lost access to it, set up a new one now. Otherwise you can keep using your existing authenticator."
        confirmText="Set up new authenticator"
        cancelText="Keep current"
        isLoading={isLoading}
        onConfirm={handleReenrollAuthenticator}
        onCancel={handleSkipReenroll}
      />
    </div>
  );
}
