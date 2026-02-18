import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

export default function AuthCallback() {
    const navigate = useNavigate();
    const [status, setStatus] = useState('Verifying your email...');

    useEffect(() => {
        const handleCallback = async () => {
            try {
                // Supabase automatically exchanges the token from the URL hash
                const { data, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('Auth callback error:', error);
                    setStatus('Verification failed. Please try again.');
                    setTimeout(() => navigate('/login?error=verification_failed'), 3000);
                    return;
                }

                if (data.session) {
                    setStatus('Email verified! Redirecting to dashboard...');
                    setTimeout(() => navigate('/dashboard'), 1500);
                } else {
                    // No session yet — might need to exchange token
                    // Check URL hash for tokens (Supabase PKCE flow)
                    const hashParams = new URLSearchParams(window.location.hash.substring(1));
                    const accessToken = hashParams.get('access_token');
                    const refreshToken = hashParams.get('refresh_token');

                    if (accessToken && refreshToken) {
                        const { error: setError } = await supabase.auth.setSession({
                            access_token: accessToken,
                            refresh_token: refreshToken,
                        });

                        if (setError) {
                            console.error('Session set error:', setError);
                            setStatus('Verification failed. Please try logging in.');
                            setTimeout(() => navigate('/login'), 3000);
                        } else {
                            setStatus('Email verified! Redirecting...');
                            setTimeout(() => navigate('/dashboard'), 1500);
                        }
                    } else {
                        // Try URL query params (some Supabase flows use query params)
                        const urlParams = new URLSearchParams(window.location.search);
                        const code = urlParams.get('code');

                        if (code) {
                            const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
                            if (exchangeError) {
                                console.error('Code exchange error:', exchangeError);
                                setStatus('Verification failed. Please try logging in.');
                                setTimeout(() => navigate('/login'), 3000);
                            } else {
                                setStatus('Email verified! Redirecting...');
                                setTimeout(() => navigate('/dashboard'), 1500);
                            }
                        } else {
                            setStatus('Email verified! Please log in.');
                            setTimeout(() => navigate('/login?verified=true'), 2000);
                        }
                    }
                }
            } catch (err) {
                console.error('Callback error:', err);
                setStatus('Something went wrong. Redirecting to login...');
                setTimeout(() => navigate('/login'), 3000);
            }
        };

        handleCallback();
    }, [navigate]);

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-primary)',
            gap: 24,
        }}>
            <div className="loading-spinner">
                <div className="spinner" />
            </div>
            <div style={{
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-display)',
            }}>
                {status}
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                Please wait while we verify your account...
            </p>
        </div>
    );
}
