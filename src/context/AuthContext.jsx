import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
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

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id);
            } else {
                setLoading(false);
            }
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                setUser(session?.user ?? null);
                if (session?.user) {
                    sessionStorage.setItem('safedrive_active', 'true');
                    await fetchProfile(session.user.id);

                    if (event === 'SIGNED_IN') {
                        logSecurityEvent('auth.login', 'User signed in successfully', {
                            severity: 'info',
                            metadata: { method: 'password' },
                        });
                    }
                } else {
                    setProfile(null);
                    setLoading(false);
                    sessionStorage.removeItem('safedrive_active');

                    if (event === 'SIGNED_OUT') {
                        logSecurityEvent('auth.logout', 'User signed out', { severity: 'info' });
                    }
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    // Session persists normally via Supabase localStorage tokens.
    // Sign out explicitly clears everything. No need to clear on page close.

    useEffect(() => {
        if (user) {
            const cleanup = initSessionMonitor(30 * 60 * 1000);
            return cleanup;
        }
    }, [user]);

    const fetchProfile = async (userId) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) {
                console.warn('Profile fetch error (may not exist yet):', error.message);
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    setProfile({
                        id: user.id,
                        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
                        role: user.user_metadata?.role || 'user',
                        verification_status: 'pending',
                        email: user.email,
                    });
                }
            } else {
                setProfile(data);
            }
        } catch (error) {
            console.error('Error fetching profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const signUp = async ({ email, password, fullName, role, phone }) => {
        if (!clientRateLimit('register', 3, 3600000)) {
            return { data: null, error: { message: 'Too many registration attempts. Please try again later.' } };
        }

        const sanitizedName = sanitizeInput(fullName);
        const nameThreats = detectThreats(fullName);
        if (!nameThreats.safe) {
            logInjectionAttempt(nameThreats.threats[0], fullName, 'full_name');
            return { data: null, error: { message: 'Invalid characters detected in name.' } };
        }

        const strength = checkPasswordStrength(password);
        if (!strength.passing) {
            return { data: null, error: { message: `Password too weak: ${strength.feedback.join(', ')}` } };
        }

        const redirectUrl = `${window.location.origin}/auth/callback`;

        const { data, error } = await supabase.auth.signUp({
            email,
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
            logSecurityEvent('auth.register', `New user registered: ${email}`, {
                severity: 'info',
                metadata: { role: role || 'user' },
            });
        }

        return { data, error };
    };

    const signIn = async ({ email, password }, rememberMe = false) => {
        if (!clientRateLimit('login', 5, 300000)) {
            logSecurityEvent('security.brute_force', `Login rate limit exceeded for ${email}`, {
                severity: 'critical',
                owaspCategory: 'A07-Auth-Failures',
                metadata: { email },
            });
            return { data: null, error: { message: 'Too many login attempts. Account temporarily locked. Try again in 5 minutes.' } };
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            logFailedLogin(email, 'invalid_password');
        } else {
            // Store "Remember Me" preference
            if (rememberMe) {
                localStorage.setItem('safedrive_remember_me', 'true');
            } else {
                localStorage.removeItem('safedrive_remember_me');
            }
            // Mark this session as active (for session-only persistence)
            sessionStorage.setItem('safedrive_active', 'true');
        }

        return { data, error };
    };

    const signOut = async () => {
        // Clear state immediately — never let logging block sign-out
        setUser(null);
        setProfile(null);

        try {
            logSecurityEvent('auth.logout', 'User initiated sign out', { severity: 'info' }).catch(() => { });
        } catch (e) {
            // Ignore — security logging must never block sign-out
        }

        try {
            await supabase.auth.signOut();
        } catch (err) {
            console.warn('Sign out error:', err);
        }

        // Failsafe: clear any remaining Supabase tokens from storage
        try {
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('sb-')) localStorage.removeItem(key);
            });
            localStorage.removeItem('safedrive_remember_me');
            sessionStorage.removeItem('safedrive_active');
        } catch (e) {
            // Ignore storage errors
        }

        return { error: null };
    };

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
        isAdmin: profile?.role === 'admin',
        isSuperAdmin: profile?.role === 'super_admin',
        isVerified: profile?.role === 'verified' || profile?.role === 'admin',
        isRenter: profile?.role === 'verified' || profile?.role === 'admin',  // Verified users can list cars
        isRentee: profile?.role === 'verified' || profile?.role === 'admin',  // Verified users can rent cars
        isOwner: profile?.role === 'verified' || profile?.role === 'admin',   // Alias
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
