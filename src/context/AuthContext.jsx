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
                    await fetchProfile(session.user.id);

                    // A09: Log authentication events
                    if (event === 'SIGNED_IN') {
                        logSecurityEvent('auth.login', 'User signed in successfully', {
                            severity: 'info',
                            metadata: { method: 'password' },
                        });
                    }
                } else {
                    setProfile(null);
                    setLoading(false);

                    if (event === 'SIGNED_OUT') {
                        logSecurityEvent('auth.logout', 'User signed out', { severity: 'info' });
                    }
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    // A09: Initialize session idle monitor when user is authenticated
    useEffect(() => {
        if (user) {
            const cleanup = initSessionMonitor(30 * 60 * 1000); // 30 min idle timeout
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

            if (error) throw error;
            setProfile(data);
        } catch (error) {
            console.error('Error fetching profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const signUp = async ({ email, password, fullName, role, phone }) => {
        // A04: Rate limit registration attempts
        if (!clientRateLimit('register', 3, 3600000)) {
            return { data: null, error: { message: 'Too many registration attempts. Please try again later.' } };
        }

        // A03: Sanitize inputs & detect injection
        const sanitizedName = sanitizeInput(fullName);
        const nameThreats = detectThreats(fullName);
        if (!nameThreats.safe) {
            logInjectionAttempt(nameThreats.threats[0], fullName, 'full_name');
            return { data: null, error: { message: 'Invalid characters detected in name.' } };
        }

        // A07: Check password strength
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
                    role: role || 'renter',
                    phone: phone,
                },
            },
        });

        if (!error) {
            // A09: Log successful registration
            logSecurityEvent('auth.login', `New user registered: ${email}`, {
                severity: 'info',
                metadata: { role: role || 'renter' },
            });
        }

        return { data, error };
    };

    const signIn = async ({ email, password }) => {
        // A04: Rate limit login attempts (5 per 5 min)
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
            // A07/A09: Log failed login attempt
            logFailedLogin(email, 'invalid_password');
        }

        return { data, error };
    };

    const signOut = async () => {
        // A09: Log sign out
        await logSecurityEvent('auth.logout', 'User initiated sign out', { severity: 'info' });

        const { error } = await supabase.auth.signOut();
        if (!error) {
            setUser(null);
            setProfile(null);
        }
        return { error };
    };

    const updateProfile = async (updates) => {
        // A03: Sanitize all string fields
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
            // A09: Log profile update
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
        isOwner: profile?.role === 'owner',
        isRenter: profile?.role === 'renter',
        isVerified: profile?.verification_status === 'verified',
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
