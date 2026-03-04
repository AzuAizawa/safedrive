import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase as supabaseUser, supabaseAdmin } from '../lib/supabase';
import {
    logSecurityEvent,
    logFailedLogin,
    initSessionMonitor,
    sanitizeInput,
    clientRateLimit,
    detectThreats,
    logInjectionAttempt,
} from '../lib/security';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeClient, setActiveClient] = useState(supabaseUser);

    // Use a ref for the active client so auth-state listener always has current value
    const activeClientRef = useRef(supabaseUser);
    const subscriptionRef = useRef(null);
    const mountedRef = useRef(true);

    // ── Failsafe timeout — never spin forever ──────────────────────────────
    useEffect(() => {
        const t = setTimeout(() => { if (mountedRef.current) setLoading(false); }, 5000);
        return () => clearTimeout(t);
    }, []);

    // ── Fetch profile from DB ──────────────────────────────────────────────
    const fetchProfile = async (userId, client) => {
        try {
            const { data, error } = await client
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (!mountedRef.current) return;

            if (!error && data) {
                setProfile(data);
            } else {
                // Fallback: build a minimal profile from the auth user
                const { data: { user: authUser } } = await client.auth.getUser();
                if (authUser && mountedRef.current) {
                    setProfile({
                        id: authUser.id,
                        full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'User',
                        role: authUser.user_metadata?.role || 'user',
                        verification_status: 'pending',
                        email: authUser.email,
                    });
                }
            }
        } catch (err) {
            console.error('fetchProfile error:', err);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    };

    // ── Attach ONE listener to whichever client won the session check ──────
    const attachListener = (client) => {
        // Remove prior subscription if any
        if (subscriptionRef.current) {
            subscriptionRef.current.unsubscribe();
            subscriptionRef.current = null;
        }

        const { data: { subscription } } = client.auth.onAuthStateChange(async (event, session) => {
            if (!mountedRef.current) return;
            if (event === 'INITIAL_SESSION') return; // Already handled in initializeAuth

            try {
                if (session?.user) {
                    setUser(session.user);
                    await fetchProfile(session.user.id, client);

                    if (event === 'SIGNED_IN') {
                        logSecurityEvent('auth.login', 'User signed in', {
                            severity: 'info',
                            metadata: { userId: session.user.id },
                        });
                    }
                } else {
                    // Only the active listener fires here, so clearing state is safe
                    setUser(null);
                    setProfile(null);
                    if (mountedRef.current) setLoading(false);

                    if (event === 'SIGNED_OUT') {
                        logSecurityEvent('auth.logout', 'User signed out', { severity: 'info' });
                    }
                }
            } catch (err) {
                console.error('Auth state listener error:', err);
                if (mountedRef.current) setLoading(false);
            }
        });

        subscriptionRef.current = subscription;
    };

    // ── Core: check BOTH sessions first, then pick a single winner ─────────
    useEffect(() => {
        mountedRef.current = true;

        const initializeAuth = async () => {
            try {
                // Read both buckets in parallel — no listeners yet, no race
                const [adminResult, userResult] = await Promise.all([
                    supabaseAdmin.auth.getSession(),
                    supabaseUser.auth.getSession(),
                ]);

                if (!mountedRef.current) return;

                const adminSession = adminResult.data?.session;
                const userSession = userResult.data?.session;

                if (adminSession?.user) {
                    // ✅ Admin is logged in — bind ONLY to the admin client
                    activeClientRef.current = supabaseAdmin;
                    setActiveClient(supabaseAdmin);
                    setUser(adminSession.user);
                    attachListener(supabaseAdmin);
                    await fetchProfile(adminSession.user.id, supabaseAdmin);
                } else if (userSession?.user) {
                    // ✅ Regular user is logged in — bind ONLY to the user client
                    activeClientRef.current = supabaseUser;
                    setActiveClient(supabaseUser);
                    setUser(userSession.user);
                    attachListener(supabaseUser);
                    await fetchProfile(userSession.user.id, supabaseUser);
                } else {
                    // ✅ Nobody logged in — attach user client listener for future logins
                    attachListener(supabaseUser);
                    setUser(null);
                    setProfile(null);
                    setLoading(false);
                }
            } catch (err) {
                console.error('Auth initialization error:', err);
                if (mountedRef.current) setLoading(false);
            }
        };

        initializeAuth();

        return () => {
            mountedRef.current = false;
            if (subscriptionRef.current) {
                subscriptionRef.current.unsubscribe();
                subscriptionRef.current = null;
            }
        };
    }, []);

    // ── Session monitor — warn user before expiry ──────────────────────────
    useEffect(() => {
        if (user) {
            const cleanup = initSessionMonitor(30 * 60 * 1000);
            return cleanup;
        }
    }, [user]);

    // ── Sign Up ────────────────────────────────────────────────────────────
    const signUp = async ({ email, password, fullName, phone, role }) => {
        const sanitizedName = sanitizeInput(fullName || '');
        const sanitizedEmail = sanitizeInput(email || '');

        const threats = detectThreats(sanitizedName);
        if (!threats.safe) {
            logInjectionAttempt(threats.threats[0], sanitizedName, 'fullName');
            return { data: null, error: { message: 'Invalid characters detected in name.' } };
        }

        const redirectUrl = `${window.location.origin}/auth/callback`;
        const { data, error } = await activeClientRef.current.auth.signUp({
            email: sanitizedEmail,
            password,
            options: {
                emailRedirectTo: redirectUrl,
                data: { full_name: sanitizedName, role: role || 'user', phone },
            },
        });

        if (!error) {
            logSecurityEvent('auth.register', `New user registered: ${sanitizedEmail}`, {
                severity: 'info',
                metadata: { role: role || 'user' },
            });
        }

        return { data, error };
    };

    // ── Sign In ────────────────────────────────────────────────────────────
    const signIn = async ({ email, password }, rememberMe = false, asAdmin = false) => {
        if (!clientRateLimit('login', 5, 300000)) {
            logSecurityEvent('security.brute_force', `Login rate limit exceeded for ${email}`, {
                severity: 'critical',
                owaspCategory: 'A07-Auth-Failures',
                metadata: { email },
            });
            return { data: null, error: { message: 'Too many login attempts. Account temporarily locked. Try again in 5 minutes.' } };
        }

        const targetClient = asAdmin ? supabaseAdmin : supabaseUser;
        const { data, error } = await targetClient.auth.signInWithPassword({ email, password });

        if (error) {
            logFailedLogin(email, 'invalid_password');
        } else if (data?.session) {
            // CRITICAL FIX: The SIGNED_IN auth event fires BEFORE we call attachListener,
            // so the listener never receives it (only INITIAL_SESSION which we skip).
            // Explicitly set the user and fetch the profile here instead of relying on the listener.
            const sessionUser = data.session.user;
            setUser(sessionUser);

            if (asAdmin) {
                activeClientRef.current = supabaseAdmin;
                setActiveClient(supabaseAdmin);
                attachListener(supabaseAdmin);
            } else {
                activeClientRef.current = supabaseUser;
                setActiveClient(supabaseUser);
                attachListener(supabaseUser);
            }

            // Fetch profile immediately — this sets loading=false when done
            await fetchProfile(sessionUser.id, targetClient);

            if (rememberMe) {
                localStorage.setItem('safedrive_remember_me', 'true');
            } else {
                localStorage.removeItem('safedrive_remember_me');
            }
        }

        return { data, error };
    };


    // ── Sign Out ───────────────────────────────────────────────────────────
    const signOut = async () => {
        setUser(null);
        setProfile(null);

        try {
            logSecurityEvent('auth.logout', 'User initiated sign out', { severity: 'info' }).catch(() => { });
        } catch (e) { }

        try {
            await activeClientRef.current.auth.signOut();
        } catch (err) {
            console.warn('Sign out error:', err);
        }

        // Clear all session storage tokens for a clean slate
        try {
            Object.keys(sessionStorage).forEach(key => {
                if (key.startsWith('sb-')) sessionStorage.removeItem(key);
            });
            sessionStorage.removeItem('safedrive-auth');
            sessionStorage.removeItem('safedrive-admin-auth');
            localStorage.removeItem('safedrive_remember_me');
        } catch (e) { }

        // Reset to the user client and re-attach a fresh listener
        activeClientRef.current = supabaseUser;
        setActiveClient(supabaseUser);
        attachListener(supabaseUser);

        return { error: null };
    };

    // ── Update Profile ─────────────────────────────────────────────────────
    const updateProfile = async (updates) => {
        const sanitizedUpdates = {};
        for (const [key, value] of Object.entries(updates)) {
            if (typeof value === 'string') {
                const threats = detectThreats(value);
                if (!threats.safe) {
                    logInjectionAttempt(threats.threats[0], value, key);
                    return { data: null, error: { message: `Invalid input detected in ${key}.` } };
                }
                sanitizedUpdates[key] = sanitizeInput(value);
            } else {
                sanitizedUpdates[key] = value;
            }
        }

        const { data, error } = await activeClientRef.current
            .from('profiles')
            .update(sanitizedUpdates)
            .eq('id', user.id)
            .select()
            .single();

        if (!error) {
            setProfile(data);
            logSecurityEvent('data.update', 'Profile updated', {
                severity: 'info',
                resourceType: 'profile',
                resourceId: user.id,
                metadata: { fields: Object.keys(sanitizedUpdates) },
            });
        }

        return { data, error };
    };

    const value = {
        user,
        profile,
        loading,
        activeClient: activeClientRef.current,
        signUp,
        signIn,
        signOut,
        updateProfile,
        fetchProfile: () => user && fetchProfile(user.id, activeClientRef.current),
        // Role helpers
        isAdmin: profile?.role === 'admin',
        isSuperAdmin: profile?.role === 'super_admin',
        isVerified: profile?.role === 'verified',
        isRenter: profile?.role === 'verified',
        isRentee: profile?.role === 'verified',
        isOwner: profile?.role === 'verified',
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
