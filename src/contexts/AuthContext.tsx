import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { clearAllAuthPending } from "@/lib/authPending";
import { signInWithTransientJwtRetry } from "@/lib/authRetry";
import { recordSecurityEvent } from "@/lib/securityLog";
import { hasPermission } from "@/lib/permissions";
import { resetToRenterMode } from "@/lib/listerMode";
import type { User, Session, AuthResponse } from "@supabase/supabase-js";
import type { Profile, AdminPermissionKey } from "@/types/database";
import { ADMIN_PERMISSION_KEYS } from "@/types/database";
import { toast } from "sonner";

interface AuthenticatorEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  profileError: string | null;
  /**
   * Granted admin permission keys for the signed-in staff member. A
   * `super_admin` is reported as holding every key; a non-staff user gets `[]`.
   */
  permissions: string[];
  /** True if the current staff member may perform `key` (super_admin => always). */
  can: (key: AdminPermissionKey) => boolean;
  /** False until the permission set has been resolved for a signed-in admin. */
  permissionsReady: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  sendOtp: (
    email: string,
    redirectPath?: string,
  ) => Promise<{ error: Error | null }>;
  verifyOtpCode: (
    email: string,
    token: string,
  ) => Promise<{ data: AuthResponse["data"]; error: Error | null }>;
  getAuthenticatorFactor: () => Promise<{
    factorId: string | null;
    error: Error | null;
  }>;
  startAuthenticatorEnrollment: () => Promise<{
    enrollment: AuthenticatorEnrollment | null;
    error: Error | null;
  }>;
  startAuthenticatorChallenge: (
    factorId: string,
  ) => Promise<{ challengeId: string | null; error: Error | null }>;
  verifyAuthenticatorCode: (
    factorId: string,
    challengeId: string,
    code: string,
  ) => Promise<{ error: Error | null }>;
  cancelAuthenticatorEnrollment: (
    factorId: string,
  ) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PROFILE_LOAD_TIMEOUT_MS = 8000;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_TIMEOUT_NOTICE_KEY = "session_timeout_notice";
const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const details = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    return [
      typeof details.message === "string" ? details.message : null,
      typeof details.details === "string" ? details.details : null,
      typeof details.hint === "string" ? details.hint : null,
      typeof details.code === "string" ? `Code: ${details.code}` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return "Profile could not be loaded. Please check the profiles RLS policies.";
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const inactivityTimeoutRef = useRef<number | null>(null);
  const sessionTimeoutInFlightRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string, email?: string) => {
    let completed = false;
    const timeoutId = window.setTimeout(() => {
      if (!completed) {
        setProfile(null);
        setProfileError(
          "Profile loading timed out. Confirm the matching public.profiles row exists and can be read by this authenticated user.",
        );
      }
    }, PROFILE_LOAD_TIMEOUT_MS);

    try {
      setProfileError(null);
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        // PGRST116 means zero rows returned. Let's auto-create the profile!
        if (error.code === "PGRST116") {
          const { data: newProfile, error: insertError } = await supabase
            .from("profiles")
            .insert([
              {
                id: userId,
                email: email || "",
                role: "user",
                verified_status: "unverified",
              },
            ])
            .select()
            .single();

          if (!insertError && newProfile) {
            setProfile(newProfile);
            return;
          }

          throw insertError;
        }
        throw error;
      }
      
      if (data && data.deleted_at) {
        await supabase.auth.signOut();
        setProfile(null);
        setUser(null);
        setSession(null);
        throw new Error("Your account is scheduled for deletion and cannot be accessed.");
      }

      if (
        data?.login_blocked_until &&
        new Date(data.login_blocked_until).getTime() > Date.now()
      ) {
        await supabase.auth.signOut();
        setProfile(null);
        setUser(null);
        setSession(null);
        throw new Error(
          data.login_block_reason
            ? `Account sign-in is temporarily blocked. Reason: ${data.login_block_reason}`
            : "Account sign-in is temporarily blocked. Please contact SafeDrive support.",
        );
      }

      if (data && data.verified_status === "inactive") {
        await supabase.auth.signOut();
        setProfile(null);
        setUser(null);
        setSession(null);
        throw new Error("Account has been deactivated.");
      }

      if (data && data.role === "admin" && data.admin_disabled_at) {
        await supabase.auth.signOut();
        setProfile(null);
        setUser(null);
        setSession(null);
        throw new Error(
          "This admin account has been disabled by a super administrator.",
        );
      }

      setProfile((prev) => {
        if (!prev || JSON.stringify(prev) !== JSON.stringify(data)) {
          return data;
        }
        return prev;
      });
    } catch (error) {
      console.error("Error fetching/creating profile:", error);
      setProfile(null);
      setProfileError(getErrorMessage(error));
    } finally {
      completed = true;
      window.clearTimeout(timeoutId);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id, user.email);
    }
  }, [user, fetchProfile]);

  // Load (and keep live) the admin permission checklist. The database is
  // authoritative for every action; this only feeds nav/route/button visibility.
  const profileId = profile?.id ?? null;
  const profileRole = profile?.role ?? null;
  useEffect(() => {
    if (!profileId || (profileRole !== "admin" && profileRole !== "super_admin")) {
      setPermissions([]);
      setPermissionsReady(true);
      return;
    }
    if (profileRole === "super_admin") {
      setPermissions([...ADMIN_PERMISSION_KEYS]);
      setPermissionsReady(true);
      return;
    }

    let cancelled = false;
    setPermissionsReady(false);
    const loadGrants = async () => {
      const [grantResult, statusResult] = await Promise.all([
        supabase
          .from("admin_permissions")
          .select("permission_key")
          .eq("admin_id", profileId),
        supabase
          .from("profiles")
          .select("admin_disabled_at, deleted_at")
          .eq("id", profileId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      // Caught a mid-session disable / deletion - drop the session.
      if (statusResult.data?.admin_disabled_at || statusResult.data?.deleted_at) {
        void supabase.auth.signOut();
        return;
      }
      if (grantResult.error) {
        console.error(
          "Failed to load admin permissions:",
          grantResult.error.message,
        );
        setPermissions([]);
      } else {
        setPermissions((grantResult.data ?? []).map((row) => row.permission_key));
      }
      setPermissionsReady(true);
    };

    void loadGrants();
    // Realtime is the fast path; the 45s poll is the guaranteed one in case the
    // admin_permissions table is not in the realtime publication.
    const pollId = window.setInterval(() => void loadGrants(), 45_000);
    const channel = supabase
      .channel(`admin-permissions-${profileId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "admin_permissions",
          filter: `admin_id=eq.${profileId}`,
        },
        () => void loadGrants(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [profileId, profileRole]);

  const can = useCallback(
    (key: AdminPermissionKey) => hasPermission(profileRole, permissions, key),
    [profileRole, permissions],
  );

  const clearInactivityTimeout = useCallback(() => {
    if (inactivityTimeoutRef.current !== null) {
      window.clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }
  }, []);

  const handleSessionTimeout = useCallback(async () => {
    if (sessionTimeoutInFlightRef.current) return;
    sessionTimeoutInFlightRef.current = true;

    const isAdminSession =
      profile?.role === "admin" ||
      profile?.role === "super_admin" ||
      sessionStorage.getItem("admin_auth_portal") === "verified" ||
      window.location.pathname.startsWith("/admin");

    clearAllAuthPending();
    sessionStorage.removeItem("admin_auth_portal");
    sessionStorage.setItem(
      SESSION_TIMEOUT_NOTICE_KEY,
      JSON.stringify({
        portal: isAdminSession ? "admin" : "user",
        reason: "inactivity",
      }),
    );

    try {
      await recordSecurityEvent(
        "session_timeout",
        {
          email: session?.user.email,
          method: "system",
          portal: isAdminSession ? "admin" : "user",
          reason: "Signed out after 10 minutes without activity.",
        },
        session?.user.id ?? user?.id ?? null,
      );
      await resetToRenterMode(session?.user.id ?? user?.id);
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error during session timeout sign out:", error);
    } finally {
      setUser(null);
      setProfile(null);
      setSession(null);
      setLoading(false);
      sessionTimeoutInFlightRef.current = false;
      window.location.replace(
        isAdminSession ? "/Safedriveadminlogin" : "/login",
      );
    }
  }, [profile?.role, session?.user.email, session?.user.id, user?.id]);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    async function init() {
      try {
        // 1. Get initial session
        const {
          data: { session: s },
        } = await supabase.auth.getSession();
        if (!mounted) return;

        setSession(s);
        setUser((prev) => prev?.id === s?.user?.id ? prev : (s?.user ?? null));

        // 2. Set up listener
        const { data } = supabase.auth.onAuthStateChange(
          (_event, newSession) => {
            if (!mounted) return;
            setSession((prev) => prev?.access_token === newSession?.access_token ? prev : newSession);
            setUser((prev) => prev?.id === newSession?.user?.id ? prev : (newSession?.user ?? null));
            if (newSession?.user) {
              // Avoid awaiting Supabase calls inside the auth callback; it can block auth state propagation.
              if (_event === "SIGNED_IN" || _event === "USER_UPDATED") {
                window.setTimeout(() => {
                  void fetchProfile(newSession.user.id, newSession.user.email);
                }, 0);
              }
            } else {
              setProfile((prev) => prev ? null : null);
              setProfileError(null);
            }
          },
        );
        subscription = data.subscription;

        // 3. Resolve profile in background if user exists
        if (s?.user) {
          await fetchProfile(s.user.id, s.user.email);
        }
      } catch (err) {
        console.error("Auth init error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();

    return () => {
      mounted = false;
      if (subscription) subscription.unsubscribe();
    };
  }, [fetchProfile]);

  useEffect(() => {
    if (!session?.user) {
      clearInactivityTimeout();
      return;
    }

    const resetInactivityTimeout = () => {
      clearInactivityTimeout();
      inactivityTimeoutRef.current = window.setTimeout(() => {
        toast.info("Session expired", {
          description:
            "You were signed out after 10 minutes of inactivity for security.",
        });
        void handleSessionTimeout();
      }, SESSION_TIMEOUT_MS);
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "focus",
    ];

    resetInactivityTimeout();
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, resetInactivityTimeout, {
        passive: true,
      }),
    );

    return () => {
      clearInactivityTimeout();
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, resetInactivityTimeout),
      );
    };
  }, [clearInactivityTimeout, handleSessionTimeout, session?.user]);

  const signUp = async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const { data: existingProfile, error: profileLookupError } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (profileLookupError) {
      return {
        error: new Error(
          "We could not validate this email right now. Please try again.",
        ),
      };
    }

    if (existingProfile) {
      return {
        error: new Error(
          "An account with this email already exists. Try signing in or resetting your password.",
        ),
      };
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=user`,
      },
    });

    if (!error && data.user && data.user.identities?.length === 0) {
      return {
        error: new Error(
          "An account with this email already exists. Try signing in or resetting your password.",
        ),
      };
    }

    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    // Supabase can briefly reject a newly issued token when two auth nodes are
    // a fraction of a second out of sync. One bounded retry prevents the first
    // click from failing while still surfacing a real device/server clock issue.
    const { error } = await signInWithTransientJwtRetry(() =>
      supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      }),
    );

    return { error: error as Error | null };
  };

  const sendOtp = async (
    email: string,
    redirectPath = "/auth/confirm?next=user",
  ) => {
    const normalizedEmail = email.trim().toLowerCase();
    const redirectTo = `${window.location.origin}${redirectPath}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });
    return { error: error as Error | null };
  };

  const verifyOtpCode = async (email: string, token: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token,
      type: "email",
    });
    return { data, error: error as Error | null };
  };

  const getAuthenticatorFactor = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp?.find((item) => item.status === "verified");

    return {
      factorId: factor?.id ?? null,
      error: error as Error | null,
    };
  };

  const startAuthenticatorEnrollment = async () => {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "SafeDrive",
      issuer: "SafeDrive",
    });

    if (error || !data) {
      return {
        enrollment: null,
        error: error as Error | null,
      };
    }

    return {
      enrollment: {
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      },
      error: null,
    };
  };

  const startAuthenticatorChallenge = async (factorId: string) => {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId });

    return {
      challengeId: data?.id ?? null,
      error: error as Error | null,
    };
  };

  const verifyAuthenticatorCode = async (
    factorId: string,
    challengeId: string,
    code: string,
  ) => {
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });

    return { error: error as Error | null };
  };

  const cancelAuthenticatorEnrollment = async (factorId: string) => {
    if (!factorId) return { error: null };

    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    try {
      setLoading(true);
      clearInactivityTimeout();
      clearAllAuthPending();
      sessionStorage.removeItem("admin_auth_portal");
      await resetToRenterMode(user?.id);
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    } finally {
      setUser(null);
      setProfile(null);
      setSession(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        loading,
        profileError,
        permissions,
        can,
        permissionsReady,
        signUp,
        signIn,
        signOut,
        refreshProfile,
        sendOtp,
        verifyOtpCode,
        getAuthenticatorFactor,
        startAuthenticatorEnrollment,
        startAuthenticatorChallenge,
        verifyAuthenticatorCode,
        cancelAuthenticatorEnrollment,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
