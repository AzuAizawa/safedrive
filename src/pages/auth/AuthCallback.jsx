import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getDefaultAppPath, getStoredUserMode } from '../../lib/navigation';
import { ui } from '../../lib/ui';

export default function AuthCallback() {
    const navigate = useNavigate();
    const [status, setStatus] = useState('Verifying your email...');

    useEffect(() => {
        const handleCallback = async () => {
            try {
                const { data, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('Auth callback error:', error);
                    setStatus('Verification failed. Redirecting to sign in...');
                    setTimeout(() => navigate('/login?error=verification_failed'), 2500);
                    return;
                }

                if (data.session) {
                    setStatus('Email verified. Redirecting you...');
                    setTimeout(() => navigate(getDefaultAppPath({ mode: getStoredUserMode(data.session.user.id) })), 1200);
                    return;
                }

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
                        setStatus('Verification failed. Redirecting to sign in...');
                        setTimeout(() => navigate('/login'), 2500);
                    } else {
                        const { data: userData } = await supabase.auth.getUser();
                        setStatus('Email verified. Redirecting you...');
                        setTimeout(() => navigate(getDefaultAppPath({ mode: getStoredUserMode(userData.user?.id) })), 1200);
                    }

                    return;
                }

                const urlParams = new URLSearchParams(window.location.search);
                const code = urlParams.get('code');

                if (code) {
                    const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
                    if (exchangeError) {
                        console.error('Code exchange error:', exchangeError);
                        setStatus('Verification failed. Redirecting to sign in...');
                        setTimeout(() => navigate('/login'), 2500);
                    } else {
                        setStatus('Email verified. Redirecting you...');
                        setTimeout(() => navigate(getDefaultAppPath({ mode: getStoredUserMode(exchangeData.session?.user?.id) })), 1200);
                    }

                    return;
                }

                setStatus('Email verified. Please sign in.');
                setTimeout(() => navigate('/login?verified=true'), 1800);
            } catch (err) {
                console.error('Callback error:', err);
                setStatus('Something went wrong. Redirecting to sign in...');
                setTimeout(() => navigate('/login'), 2500);
            }
        };

        handleCallback();
    }, [navigate]);

    return (
        <div className="min-h-screen bg-surface-secondary px-4 pt-28 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl">
                <div className={ui.loadingScreen}>
                    <div className={ui.spinner} />
                    <div className="space-y-2 text-center">
                        <p className="font-display text-2xl font-bold text-text-primary">
                            {status}
                        </p>
                        <p className="text-sm text-text-secondary">
                            Please wait while we finish setting up your SafeDrive session.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
