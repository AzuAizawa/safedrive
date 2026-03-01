import { createContext, useContext, useEffect, useState } from 'react';
import { supabase as supabaseUser, supabaseAdmin } from '../lib/supabase';
import {
    logSecurityEvent,
    logFailedLogin,
    initSessionMonitor,
    sanitizeInput,
    checkPasswordStrength,
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

    // Determine the correct client for this portal session
    const getActiveClient = () => {
        const isAdminRoute = typeof window !== 'undefined' &&
            (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/admin-login'));
        return isAdminRoute ? supabaseAdmin : supabaseUser;
    };

    const activeClient = getActiveClient();

    // ── Ultimate Failsafe Timeout ──────────────────────────────────────────
    useEffect(() => {
        const timeout = setTimeout(() => {
            setLoading(false);
        }, 4000);
        return () => clearTimeout(timeout);
    }, []);

    // ── Fetch profile from DB ──────────────────────────────────────────────
    const fetchProfile = async (userId) => {
        try {
            const { data, error } = await activeClient
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (!error && data) {
                setProfile(data);
            } else {
                const { data: { user: authUser } } = await activeClient.auth.getUser();
                if (authUser) {
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
            setLoading(false);
        }
    };

    // ── Initialize session on mount (race-condition proof) ─────────────────
    useEffect(() => {
        let mounted = true;

        const syncSession = async (session) => {
            if (session?.user) {
                setUser(session.user);
                await fetchProfile(session.user.id);
            } else {
                setUser(null);
                setProfile(null);
                if (mounted) setLoading(false);
            }
        };

        activeClient.auth.getSession().then(({ data: { session }, error }) => {
            if (error) console.error('Session get error:', error);
            if (mounted) syncSession(session);
        });

        const { data: { subscription } } = activeClient.auth.onAuthStateChange(
            async (event, session) => {
                if (!mounted) return;
                if (event === 'INITIAL_SESSION') return;

                try {
                    await syncSession(session);

                    if (event === 'SIGNED_IN') {
                        logSecurityEvent('auth.login', 'User signed in successfully', {
                            severity: 'info',
                            metadata: { method: 'password', userId: session?.user?.id },
                        });
                    } else if (event === 'SIGNED_OUT') {
                        logSecurityEvent('auth.logout', 'User signed out', { severity: 'info' });
                    }
                } catch (err) {
                    console.error('Auth state change error:', err);
                    if (mounted) setLoading(false);
                }
            }
        );

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    // ── Session monitor ────────────────────────────────────────────────────
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

        const { data, error } = await supabase.auth.signUp({
            email: sanitizedEmail,
            password,
            options: {
                emailRedirectTo: redirectUrl,
                data: {
                    full_name: sanitizedName,
                    role: role || 'user',
                    phone: phone,
                },
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
    const signIn = async ({ email, password }, rememberMe = false) => {
        if (!clientRateLimit('login', 5, 300000)) {
            logSecurityEvent('security.brute_force', `Login rate limit exceeded for ${email}`, {
                severity: 'critical',
                owaspCategory: 'A07-Auth-Failures',
                metadata: { email },
            });
            return { data: null, error: { message: 'Too many login attempts. Account temporarily locked. Try again in 5 minutes.' } };
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            logFailedLogin(email, 'invalid_password');
        } else {
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
        // Clear local state immediately
        setUser(null);
        setProfile(null);

        try {
            logSecurityEvent('auth.logout', 'User initiated sign out', { severity: 'info' }).catch(() => { });
        } catch (e) { }

        try {
            await supabase.auth.signOut();
        } catch (err) {
            console.warn('Sign out error:', err);
        }

        // Failsafe: clear any remaining Supabase tokens specific to this portal
        try {
            const isAdminRoute = typeof window !== 'undefined' &&
                (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/admin-login'));
            const storageKey = isAdminRoute ? 'safedrive-admin-auth' : 'safedrive-auth';

            Object.keys(sessionStorage).forEach(key => {
                if (key.startsWith('sb-') || key === storageKey) sessionStorage.removeItem(key);
            });
            localStorage.removeItem('safedrive_remember_me');
        } catch (e) { }

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

        const { data, error } = await supabase
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
        signUp,
        signIn,
        signOut,
        updateProfile,
        fetchProfile: () => user && fetchProfile(user.id),
        // Role helpers — admin is STRICTLY management only
        isAdmin: profile?.role === 'admin',
        isSuperAdmin: profile?.role === 'super_admin',
        isVerified: profile?.role === 'verified',
        isRenter: profile?.role === 'verified',   // Only verified non-admin users can list cars
        isRentee: profile?.role === 'verified',   // Only verified non-admin users can rent cars
        isOwner: profile?.role === 'verified',    // Alias for isRenter
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
