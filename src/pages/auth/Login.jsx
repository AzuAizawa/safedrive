import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiAlertCircle, FiArrowLeft, FiCheckCircle, FiEye, FiEyeOff, FiLock, FiMail } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { getDefaultAppPath, getStoredUserMode } from '../../lib/navigation';
import { ui } from '../../lib/ui';
import { supabase } from '../../lib/supabase';

function AuthShell({ eyebrow, title, description, sideTitle, sideCopy, children }) {
    return (
        <div className="min-h-screen bg-neutral-100 px-4 pb-12 pt-28 sm:px-6 lg:px-8">
            <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                <section className="relative overflow-hidden rounded-[36px] border border-primary-400/20 bg-primary-900 px-6 py-10 text-white shadow-float sm:px-10 sm:py-12">
                    <div className="absolute inset-0 bg-primary-700/15" />
                    <div className="relative space-y-6">
                        <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                            {eyebrow}
                        </div>
                        <div className="space-y-4">
                            <h1 className="max-w-md font-display text-4xl font-bold leading-tight sm:text-5xl">
                                {sideTitle}
                            </h1>
                            <p className="max-w-lg text-sm leading-7 text-white/70 sm:text-base">
                                {sideCopy}
                            </p>
                        </div>
                        <div className="grid gap-3 text-sm text-white/80 sm:grid-cols-2">
                            {['Identity-verified users', 'Digital rental agreements', 'Protected booking flows', 'Owner and renter messaging'].map((item) => (
                                <div key={item} className="rounded-2xl border border-white/12 bg-white/8 px-4 py-3">
                                    {item}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="rounded-[36px] border border-border-medium bg-surface-elevated px-6 py-8 shadow-soft sm:px-8 sm:py-10">
                    <div className="mb-8 space-y-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                            {eyebrow}
                        </div>
                        <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary">
                            {title}
                        </h2>
                        <p className="text-sm leading-6 text-text-secondary">
                            {description}
                        </p>
                    </div>
                    {children}
                </section>
            </div>
        </div>
    );
}

export default function Login() {
    const { signIn, signOut } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [verified, setVerified] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [resetSent, setResetSent] = useState(false);

    useEffect(() => {
        if (searchParams.get('verified') === 'true') {
            setVerified(true);
            toast.success('Email verified! You can now sign in.');
        }

        if (searchParams.get('reason') === 'timeout') {
            setError('Your session expired due to inactivity. Please sign in again.');
        }
    }, [searchParams]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const { data, error: signInError } = await signIn(formData, rememberMe);
            if (signInError) throw signInError;

            const { data: profileData } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', data.user.id)
                .single();

            if (profileData?.role === 'admin') {
                await signOut();
                setError('Admin accounts must use the Admin Portal.');
                return;
            }

            toast.success('Welcome back to SafeDrive!');
            navigate(getDefaultAppPath({ mode: getStoredUserMode(data.user.id) }));
        } catch (err) {
            setError(err.message || 'Failed to sign in');
            toast.error(err.message || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        setError('');

        if (!resetEmail) {
            setError('Please enter your email address.');
            return;
        }

        setResetLoading(true);

        try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(resetEmail, {
                redirectTo: `${window.location.origin}/auth/callback`,
            });

            if (resetError) throw resetError;

            setResetSent(true);
            toast.success('Password reset link sent.');
        } catch (err) {
            console.error('Reset password error:', err);
            setError(err.message || 'Failed to send reset email');
            toast.error(err.message || 'Failed to send reset email');
        } finally {
            setResetLoading(false);
        }
    };

    if (showForgotPassword) {
        return (
            <AuthShell
                eyebrow="Account recovery"
                title={resetSent ? 'Check your inbox' : 'Reset your password'}
                description={resetSent ? 'Your reset link is on the way.' : 'We will email you a secure reset link.'}
                sideTitle="Get back into SafeDrive quickly."
                sideCopy="Use your account email and we will send a one-time reset link so you can choose a new password securely."
            >
                {resetSent ? (
                    <div className="space-y-5">
                        <div className="rounded-3xl border border-success-200 bg-success-50 p-5 text-success-700">
                            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                                <FiCheckCircle />
                                Reset email sent
                            </div>
                            <p className="text-sm leading-6">
                                We sent a reset link to <strong>{resetEmail}</strong>. Check your inbox or spam folder.
                            </p>
                        </div>
                        <button
                            type="button"
                            className={`${ui.button.primary} w-full`}
                            onClick={() => {
                                setShowForgotPassword(false);
                                setResetSent(false);
                                setResetEmail('');
                            }}
                        >
                            Back to sign in
                        </button>
                    </div>
                ) : (
                    <form className="space-y-5" onSubmit={handleForgotPassword}>
                        <button
                            type="button"
                            onClick={() => {
                                setShowForgotPassword(false);
                                setError('');
                            }}
                            className={`${ui.button.ghost} -ml-2 pl-2`}
                        >
                            <FiArrowLeft /> Back to sign in
                        </button>

                        {error && (
                            <div className="rounded-3xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700">
                                <div className="flex items-start gap-2">
                                    <FiAlertCircle className="mt-0.5 shrink-0" />
                                    {error}
                                </div>
                            </div>
                        )}

                        <div>
                            <label className={ui.label}>Email address</label>
                            <div className="relative">
                                <FiMail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                <input
                                    type="email"
                                    className={ui.inputWithIcon}
                                    placeholder="you@gmail.com"
                                    value={resetEmail}
                                    onChange={(e) => setResetEmail(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            className={`${ui.button.primary} w-full`}
                            disabled={resetLoading}
                        >
                            {resetLoading ? 'Sending reset link...' : 'Send reset link'}
                        </button>
                    </form>
                )}
            </AuthShell>
        );
    }

    return (
        <AuthShell
            eyebrow="Welcome back"
            title="Sign in"
            description="Enter your credentials to continue renting or listing with SafeDrive."
            sideTitle="Return to your next trip or listing."
            sideCopy="SafeDrive keeps renter and lister workflows separate so you can focus on the right side of the marketplace as soon as you sign in."
        >
            <form className="space-y-5" onSubmit={handleSubmit}>
                {verified && (
                    <div className="rounded-3xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700">
                        <div className="flex items-start gap-2">
                            <FiCheckCircle className="mt-0.5 shrink-0" />
                            Email verified successfully. You can sign in now.
                        </div>
                    </div>
                )}

                {error && (
                    <div className="rounded-3xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700">
                        <div className="flex items-start gap-2">
                            <FiAlertCircle className="mt-0.5 shrink-0" />
                            {error}
                        </div>
                    </div>
                )}

                <div>
                    <label className={ui.label}>Email address</label>
                    <div className="relative">
                        <FiMail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                            type="email"
                            className={ui.inputWithIcon}
                            placeholder="you@gmail.com"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            required
                        />
                    </div>
                </div>

                <div>
                    <div className="mb-2 flex items-center justify-between">
                        <label className={ui.label}>Password</label>
                        <button
                            type="button"
                            onClick={() => {
                                setShowForgotPassword(true);
                                setError('');
                                setResetEmail(formData.email);
                            }}
                            className="text-sm font-medium text-primary-700 transition hover:text-primary-800"
                        >
                            Forgot password?
                        </button>
                    </div>
                    <div className="relative">
                        <FiLock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                            type={showPassword ? 'text' : 'password'}
                            className={`${ui.inputWithIcon} pr-12`}
                            placeholder="Enter your password"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            required
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword((value) => !value)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary transition hover:text-text-primary"
                        >
                            {showPassword ? <FiEyeOff /> : <FiEye />}
                        </button>
                    </div>
                </div>

                <label className="flex items-center gap-3 text-sm text-text-secondary">
                    <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-4 w-4 rounded border-border-light text-primary-600 focus:ring-primary-200"
                    />
                    Stay signed in on this device
                </label>

                <button
                    type="submit"
                    className={`${ui.button.primary} w-full`}
                    disabled={loading}
                >
                    {loading ? 'Signing in...' : 'Sign in'}
                </button>

                <p className="text-center text-sm text-text-secondary">
                    Don&apos;t have an account?{' '}
                    <Link to="/register" className="font-semibold text-primary-700 hover:text-primary-800">
                        Create one
                    </Link>
                </p>
            </form>
        </AuthShell>
    );
}
