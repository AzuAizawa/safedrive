import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  clearAdminAuthPending,
  getAdminAuthPendingState,
  markAdminAuthPending,
  setAdminAuthPendingState,
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
} from "@/components/ui/card";
import { Shield, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

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
const SESSION_TIMEOUT_NOTICE_KEY = "session_timeout_notice";

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

export default function AdminLoginPage() {
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
  const [, setLockoutTick] = useState(() => Date.now());
  const {
    signIn,
    signOut,
    profile,
    user,
    sendOtp,
    verifyOtpCode,
    getAuthenticatorFactor,
    startAuthenticatorEnrollment,
    startAuthenticatorChallenge,
    verifyAuthenticatorCode,
    cancelAuthenticatorEnrollment,
  } = useAuth();
  const navigate = useNavigate();
  const lockoutState = getAuthLockoutState("admin", email);
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
      if (parsed.reason === "inactivity" && parsed.portal === "admin") {
        toast.info("Admin session expired", {
          description:
            "You were signed out after 10 minutes of inactivity. Please sign in again.",
        });
      }
    } catch {
      // Ignore malformed timeout notices.
    }
  }, []);

  useEffect(() => {
    if (
      user &&
      (profile?.role === "admin" || profile?.role === "super_admin") &&
      window.sessionStorage.getItem("admin_auth_portal") === "verified"
    ) {
      navigate("/admin", { replace: true });
    }
  }, [navigate, profile?.role, user]);

  useEffect(() => {
    const pendingState = getAdminAuthPendingState();
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
    setAdminAuthPendingState({
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

  const startEmailCode = async () => {
    await signOut();
    clearAdminAuthPending();
    const { error } = await sendOtp(normalizedEmail, "/auth/confirm?next=admin");
    if (error) {
      toast.error("Failed to dispatch security code", {
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
    toast.success("Security protocol initialized. 6-digit code dispatched.");
    return true;
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutState.isLocked) {
      toast.error("Too many failed admin sign-in attempts", {
        description: `Try again in ${formatLockoutRemaining(lockoutState.remainingMs)}.`,
      });
      return;
    }
    setIsLoading(true);

    try {
      const { error } = await signIn(normalizedEmail, password);

      if (error) {
        const failureState = registerAuthFailure("admin", normalizedEmail);
        await recordSecurityEvent("admin_login_failed", {
          email: normalizedEmail,
          method: "password",
          reason: error.message,
        });
        if (failureState.isLocked) {
          await recordSecurityEvent("lockout_started", {
            email: normalizedEmail,
            portal: "admin",
            reason: "Too many failed admin login attempts",
            failed_attempts: failureState.failedAttempts,
            locked_until: new Date(failureState.lockedUntil).toISOString(),
          });
        }
        toast.error("Authentication failed", { description: error.message });
        if (failureState.isLocked) {
          toast.error("Too many failed admin sign-in attempts", {
            description: `Admin access is locked for ${failureState.lockoutMinutes} minutes.`,
          });
        }
        setIsLoading(false);
        return;
      }

      clearAuthFailures("admin", normalizedEmail);

      const {
        data: { user: signedInUser },
        error: signedInUserError,
      } = await supabase.auth.getUser();

      if (signedInUserError || !signedInUser) {
        await signOut();
        clearAdminAuthPending();
        toast.error("Admin session could not be verified", {
          description:
            signedInUserError?.message ??
            "Supabase Auth did not return the signed-in user.",
        });
        setIsLoading(false);
        return;
      }

      const { data: userProfile, error: profileError } = await supabase
        .from("profiles")
        .select("role, deleted_at, login_blocked_until, login_block_reason")
        .eq("id", signedInUser.id)
        .maybeSingle();

      if (profileError) {
        await signOut();
        clearAdminAuthPending();
        toast.error("Admin profile check failed", {
          description: profileError.message,
        });
        setIsLoading(false);
        return;
      }

      if (
        !userProfile ||
        (userProfile.role !== "admin" && userProfile.role !== "super_admin")
      ) {
        await signOut();
        clearAdminAuthPending();
        toast.error("This account is not an admin in the database", {
          description: userProfile
            ? `Current role: ${userProfile.role}`
            : "No public.profiles row exists for this Supabase Auth user.",
        });
        navigate("/login");
        setIsLoading(false);
        return;
      }

      if (userProfile.deleted_at) {
        await signOut();
        clearAdminAuthPending();
        toast.error("Admin account suspended", {
          description: "This admin account is currently inaccessible.",
        });
        setIsLoading(false);
        return;
      }

      if (
        userProfile.login_blocked_until &&
        new Date(userProfile.login_blocked_until).getTime() > Date.now()
      ) {
        await signOut();
        clearAdminAuthPending();
        toast.error("Admin sign-in blocked", {
          description:
            userProfile.login_block_reason ||
            "An administrator temporarily blocked access to this account.",
        });
        setIsLoading(false);
        return;
      }

      const { factorId, error: factorError } = await getAuthenticatorFactor();
      markAdminAuthPending();
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
            description:
              challengeError?.message ??
              "Could not start the authenticator challenge.",
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
        toast.success("Set up Authenticator app for admin security.");
        setIsLoading(false);
        return;
      }

      if (enrollmentError) {
        toast.error("Authenticator setup unavailable", {
          description: `${enrollmentError.message}. Falling back to email code.`,
        });
      }

      await startEmailCode();
    } catch (err: unknown) {
      toast.error("Error", { description: (err as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutState.isLocked) {
      toast.error("Too many failed admin sign-in attempts", {
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

        const failureState = registerAuthFailure("admin", normalizedEmail);
        if (failureState.isLocked) {
          await recordSecurityEvent("lockout_started", {
            email: normalizedEmail,
            portal: "admin",
            method: "authenticator",
            reason: "Too many failed authenticator attempts",
            failed_attempts: failureState.failedAttempts,
            locked_until: new Date(failureState.lockedUntil).toISOString(),
          });
        }
        toast.error("Authenticator verification rejected", {
          description: error.message,
        });
        setIsLoading(false);
        return;
      }

      const {
        data: { user: verifiedUser },
      } = await supabase.auth.getUser();
      await recordSecurityEvent(
        "admin_login_success",
        { email: normalizedEmail, method: "authenticator" },
        verifiedUser?.id,
      );
      clearAuthFailures("admin", normalizedEmail);
      clearAdminAuthPending();
      toast.success("System Access Granted");
      sessionStorage.setItem("admin_auth_portal", "verified");
      navigate("/admin");
      setIsLoading(false);
      return;
    }

    if (emailOtpExpired) {
      toast.error("Security code expired", {
        description: "Request a new email code before continuing.",
      });
      setIsLoading(false);
      return;
    }

    const { data, error } = await verifyOtpCode(normalizedEmail, otpCode);

    if (error) {
      const failureState = registerAuthFailure("admin", normalizedEmail);
      if (failureState.isLocked) {
        await recordSecurityEvent("lockout_started", {
          email: normalizedEmail,
          portal: "admin",
          method: "email_otp",
          reason: "Too many failed One-Time Password attempts",
          failed_attempts: failureState.failedAttempts,
          locked_until: new Date(failureState.lockedUntil).toISOString(),
        });
      }
      toast.error("Code verification rejected", { description: error.message });
      setIsLoading(false);
      return;
    }

    await recordSecurityEvent(
      "admin_login_success",
      { email: normalizedEmail, method: "email_otp" },
      data.user?.id,
    );
    clearAuthFailures("admin", normalizedEmail);
    clearAdminAuthPending();
    sessionStorage.setItem("admin_auth_portal", "verified");

    const { factorId: staleFactorId } = await getAuthenticatorFactor();
    if (staleFactorId) {
      setOfferReenroll(true);
      setIsLoading(false);
      return;
    }

    toast.success("System Access Granted");
    // We let the useEffect navigate them when profile syncs, or we can force navigate.
    navigate("/admin");
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
    toast.success("System Access Granted");
    navigate("/admin");
  };

  const handleAuthenticatorSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { challengeId, error: challengeError } =
      await startAuthenticatorChallenge(setupFactorId);
    if (challengeError || !challengeId) {
      toast.error("Authenticator setup failed", {
        description:
          challengeError?.message ??
          "Could not create an authenticator challenge.",
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
    await recordSecurityEvent(
      "admin_mfa_enrolled",
      { email: normalizedEmail, method: "authenticator" },
      verifiedUser?.id,
    );
    clearAdminAuthPending();
    toast.success("Authenticator connected. System Access Granted.");
    sessionStorage.setItem("admin_auth_portal", "verified");
    navigate("/admin");
    setIsLoading(false);
  };

  const handleResendOtp = async () => {
    if (!normalizedEmail) return;
    setIsLoading(true);

    if (codeMethod === "authenticator" && authFactorId) {
      const { challengeId, error } =
        await startAuthenticatorChallenge(authFactorId);
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

    const { error } = await sendOtp(normalizedEmail, "/auth/confirm?next=admin");
    if (error) {
      toast.error("Failed to resend security code", {
        description: error.message,
      });
    } else {
      const expiresAt = Date.now() + EMAIL_OTP_LIFETIME_MS;
      setOtpExpiresAt(expiresAt);
      persistPendingOtpState("email", undefined, undefined, expiresAt);
      toast.success("New security code dispatched", {
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
    <div className="min-h-screen flex items-center justify-center bg-[#020202] relative overflow-hidden p-4">
      {/* Background decoration - Advanced Tech Feel */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(239,68,68,0.05),transparent_70%)]" />
      <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-red-600/5 rounded-full blur-[120px] translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-red-600/5 rounded-full blur-[100px] -translate-x-1/3 translate-y-1/3 pointer-events-none" />

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        {/* Logo Section */}
        <div className="flex items-center justify-center gap-3 mb-10 group">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.3)] group-hover:shadow-[0_0_50px_rgba(239,68,68,0.5)] transition-all duration-500 border border-white/10">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-black tracking-tighter text-white uppercase italic">
              SafeDrive
            </span>
            <span className="text-[10px] font-bold text-red-500 tracking-[0.4em] uppercase">
              Security Operations
            </span>
          </div>
        </div>

        <Card className="bg-[#0a0a0a]/80 backdrop-blur-xl border-white/5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-transparent via-red-500 to-transparent opacity-50" />

          <CardHeader className="text-center pb-2 pt-8">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Admin Authentication
            </h1>
            <CardDescription className="text-muted-foreground/60 text-xs uppercase tracking-widest font-semibold mt-1">
              restricted access area
            </CardDescription>
          </CardHeader>

          {step === "password" && !showAuthenticatorSetup ? (
            <form onSubmit={handlePasswordSubmit}>
              <CardContent className="space-y-5 pt-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="email"
                    className="text-zinc-400 text-xs font-bold uppercase tracking-wider"
                  >
                    System Identifier
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@safedrive.sys"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setLockoutTick(Date.now());
                    }}
                    required
                    autoComplete="off"
                    className="bg-black/40 border-white/5 focus:border-red-500/50 focus:ring-red-500/20 h-12 rounded-xl text-white transition-all duration-300"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label
                      htmlFor="password"
                      className="text-zinc-400 text-xs font-bold uppercase tracking-wider"
                    >
                      Security Key
                    </Label>
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
                      className="bg-black/40 border-white/5 focus:border-red-500/50 focus:ring-red-500/20 h-12 rounded-xl text-white pr-12 transition-all duration-300"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-red-500 transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                {profile &&
                  user &&
                  profile.role !== "admin" &&
                  profile.role !== "super_admin" && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 animate-shake">
                      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-400 leading-relaxed font-medium">
                        Access Denied. Your account does not have sufficient
                        clearance to access the Command Center.
                      </p>
                    </div>
                  )}
              </CardContent>

              <CardFooter className="flex-col gap-6 p-8 pt-2">
                {lockoutState.isLocked && (
                  <p className="w-full rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-center text-xs text-red-400">
                    Too many failed admin sign-in attempts. Try again in{" "}
                    <span className="font-semibold">
                      {formatLockoutRemaining(lockoutState.remainingMs)}
                    </span>
                    .
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full h-12 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold rounded-xl shadow-[0_10px_30px_rgba(220,38,38,0.2)] hover:shadow-[0_15px_40px_rgba(220,38,38,0.4)] transition-all duration-300 border-t border-white/10 uppercase tracking-widest text-xs"
                  disabled={isLoading || lockoutState.isLocked}
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying...</span>
                    </div>
                  ) : (
                    <span>Continue</span>
                  )}
                </Button>

                <div className="flex items-center justify-center gap-6 w-full opacity-40">
                  <div className="h-px bg-white/20 flex-1" />
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em]">
                    Authorized Only
                  </span>
                  <div className="h-px bg-white/20 flex-1" />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/login")}
                  className="w-full h-12 bg-transparent border-white/10 hover:bg-white/5 text-zinc-400 hover:text-white rounded-xl transition-all duration-300"
                >
                  Return to User Portal
                </Button>
              </CardFooter>
            </form>
          ) : showAuthenticatorSetup ? (
            <form onSubmit={handleAuthenticatorSetupSubmit}>
              <CardContent className="space-y-5 pt-8 text-center border-t border-white/5">
                <Shield className="w-12 h-12 text-red-500 mx-auto opacity-50 mb-2" />
                <p className="text-sm text-zinc-400">
                  Scan this QR code in Google Authenticator, Authy, Microsoft
                  Authenticator, or 1Password.
                </p>
                <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-xl border border-white/10 bg-white p-3">
                  {setupQrCode && (
                    <img
                      src={qrCodeSrc(setupQrCode)}
                      alt="Authenticator QR code"
                      className="h-full w-full [image-rendering:pixelated]"
                    />
                  )}
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Manual Setup Key
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-zinc-200">
                    {setupSecret}
                  </p>
                </div>
                {setupUri && (
                  <a
                    href={setupUri}
                    className="inline-flex text-sm font-medium text-red-400 hover:text-red-300 hover:underline"
                  >
                    Open in authenticator app
                  </a>
                )}
                <div className="space-y-2 pt-2">
                  <Label
                    htmlFor="setupCode"
                    className="text-zinc-400 text-xs font-bold uppercase tracking-wider"
                  >
                    Authenticator Code
                  </Label>
                  <Input
                    id="setupCode"
                    type="text"
                    inputMode="numeric"
                    placeholder="------"
                    value={setupCode}
                    onChange={(e) =>
                      setSetupCode(normalizeAuthenticatorCode(e.target.value))
                    }
                    required
                    maxLength={6}
                    className="bg-black/60 border-white/10 focus:border-red-500 h-16 rounded-xl text-red-500 transition-all duration-300 text-center text-2xl sm:text-3xl tracking-[0.25em] sm:tracking-[0.7em] font-mono shadow-inner"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex-col gap-4 p-8 pt-4">
                <Button
                  type="submit"
                  className="w-full h-12 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold rounded-xl shadow-[0_10px_30px_rgba(220,38,38,0.2)] hover:shadow-[0_15px_40px_rgba(220,38,38,0.4)] transition-all duration-300 border-t border-white/10 uppercase tracking-widest text-xs"
                  disabled={isLoading || setupCode.length < 6}
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Connecting...</span>
                    </div>
                  ) : (
                    <span>Connect Authenticator</span>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleUseEmailInstead}
                  disabled={isLoading}
                  className="w-full h-10 bg-transparent border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg text-xs font-bold transition-all duration-300"
                >
                  Use Email Code Instead
                </Button>
              </CardFooter>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit}>
              <CardContent className="space-y-5 pt-8 text-center border-t border-white/5">
                <Shield className="w-12 h-12 text-red-500 mx-auto opacity-50 mb-4 animate-pulse" />
                <p className="text-sm text-zinc-400">
                  {codeMethod === "authenticator" ? (
                    <>
                      Security protocol active. Enter the current 6-digit code
                      from your Authenticator app.
                    </>
                  ) : (
                    <>
                      Security protocol active. System dispatched a verification
                      code to{" "}
                      <span className="text-white font-bold">
                        {maskEmail(email)}
                      </span>.
                    </>
                  )}
                </p>
                {codeMethod === "email" && otpExpiresAt && (
                  <p
                    className={`text-xs ${
                      emailOtpExpired ? "text-red-400" : "text-zinc-500"
                    }`}
                  >
                    {emailOtpExpired
                      ? "This security code expired. Request a new code to continue."
                      : `This code expires in ${formatOtpRemaining(emailOtpRemainingMs)}.`}
                  </p>
                )}
                <div className="space-y-2 pt-4">
                  <Label
                    htmlFor="otp"
                    className="text-zinc-400 text-xs font-bold uppercase tracking-wider"
                  >
                    {codeMethod === "authenticator"
                      ? "Authenticator Code"
                      : "Security Code"}
                  </Label>
                  <Input
                    id="otp"
                    type="text"
                    inputMode={codeMethod === "authenticator" ? "numeric" : "text"}
                    placeholder={codeMethod === "authenticator" ? "------" : "Enter email code"}
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
                    className="bg-black/60 border-white/10 focus:border-red-500 h-16 rounded-xl text-red-500 transition-all duration-300 text-center text-2xl sm:text-3xl tracking-[0.25em] sm:tracking-[0.7em] font-mono shadow-inner"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex-col gap-6 p-8 pt-4">
                {lockoutState.isLocked && (
                  <p className="w-full rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-center text-xs text-red-400">
                    Too many failed admin sign-in attempts. Try again in{" "}
                    <span className="font-semibold">
                      {formatLockoutRemaining(lockoutState.remainingMs)}
                    </span>
                    .
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full h-12 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold rounded-xl shadow-[0_10px_30px_rgba(220,38,38,0.2)] hover:shadow-[0_15px_40px_rgba(220,38,38,0.4)] transition-all duration-300 border-t border-white/10 uppercase tracking-widest text-xs"
                  disabled={
                    isLoading ||
                    lockoutState.isLocked ||
                    emailOtpExpired ||
                    (codeMethod === "authenticator"
                      ? otpCode.length !== 6
                      : otpCode.length < 4)
                  }
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Authenticating...</span>
                    </div>
                  ) : (
                    <span>Verify & Sign In</span>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResendOtp}
                  disabled={isLoading}
                  className="w-full h-10 bg-transparent border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg text-xs font-bold transition-all duration-300"
                >
                  {codeMethod === "authenticator"
                    ? "Refresh Authenticator Check"
                    : "Resend Security Code"}
                </Button>

                {codeMethod === "authenticator" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleUseEmailInstead}
                    disabled={isLoading}
                    className="w-full h-10 bg-transparent border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg text-xs font-bold transition-all duration-300"
                  >
                    Use Email Code Instead
                  </Button>
                )}

                <Button
                  type="button"
                  onClick={async () => {
                    if (codeMethod === "authenticator") {
                      await signOut();
                    }
                    clearAdminAuthPending();
                    setOtpExpiresAt(null);
                    setStep("password");
                    setShowAuthenticatorSetup(false);
                    setOtpCode("");
                  }}
                  className="w-full h-10 bg-transparent text-zinc-500 hover:text-white hover:bg-white/5 rounded-lg text-xs font-bold transition-all duration-300"
                >
                  Back to login
                </Button>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>

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
