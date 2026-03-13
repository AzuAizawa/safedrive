import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { FiMail, FiLock, FiAlertCircle, FiCheckCircle, FiArrowLeft, FiEye, FiEyeOff } from 'react-icons/fi';
import toast from 'react-hot-toast';

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

    // Forgot password state
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
            setError('Your session has expired due to inactivity. Please sign in again.');
        }
    }, [searchParams]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const { data, error: signInError } = await signIn(formData, rememberMe);
            if (signInError) throw signInError;

            // Check if this is an admin account trying to use the user portal
            const { data: profileData } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', data.user.id)
                .single();

            if (profileData?.role === 'admin') {
                // Admin trying to use user portal — reject and redirect
                await signOut();
                setError('Admin accounts must use the Admin Portal. Please go to /admin-login to access the admin panel.');
                return;
            }

            toast.success('Welcome back to SafeDrive!');
            navigate('/dashboard');
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
            setError('Please enter your email address');
            return;
        }

        // Basic email format check
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(resetEmail)) {
            setError('Please enter a valid email address');
            return;
        }

        setResetLoading(true);

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
                redirectTo: `${window.location.origin}/auth/callback`,
            });

            if (error) throw error;

            setResetSent(true);
            toast.success('Password reset link sent! Check your email.');
        } catch (err) {
            console.error('Reset password error:', err);
            setError(err.message || 'Failed to send reset email');
            toast.error(err.message || 'Failed to send reset email');
        } finally {
            setResetLoading(false);
        }
    };

    // Forgot Password Form
    if (showForgotPassword) {
        return (
            <div className="auth-page">
                <div className="auth-visual">
                    <div className="auth-visual-content">
                        <div className="text-[56px] mb-6">🔑</div>
                        <h2>Reset Your Password</h2>
                        <p>Enter your email address and we'll send you a secure link to reset your password. No third-party services — it's all handled by SafeDrive.</p>
                    </div>
                </div>

                <div className="auth-form-container">
                    {resetSent ? (
                        <div className="auth-form text-center">
                            <div className="w-[72px] h-[72px] rounded-full bg-[var(--success-50,#f0fdf4)] flex items-center justify-center mx-auto mb-6 border-2 border-[var(--success-200,#bbf7d0)]">
                                <FiCheckCircle size={32} className="text-[var(--success-600,#16a34a)]" />
                            </div>
                            <h1 className="text-[24px] mb-2">Check Your Email</h1>
                            <p className="subtitle mb-6">
                                We've sent a password reset link to <strong>{resetEmail}</strong>.
                                Click the link in your email to create a new password.
                            </p>
                            <div className="bg-[var(--warning-50,#fffbeb)] border border-[#f59e0b33] rounded-[var(--radius-md)] p-[12px_16px] text-[13px] text-[var(--warning-700,#b45309)] mb-6 text-left">
                                💡 <strong>Tips:</strong> Check your spam/junk folder if you don't see the email. The link expires in 1 hour.
                            </div>
                            <button
                                className="btn btn-primary btn-lg w-full mb-3"
                                onClick={() => {
                                    setShowForgotPassword(false);
                                    setResetSent(false);
                                    setResetEmail('');
                                }}
                            >
                                Back to Sign In
                            </button>
                            <button
                                className="btn btn-ghost w-full"
                                onClick={() => {
                                    setResetSent(false);
                                }}
                            >
                                Didn't receive it? Send again
                            </button>
                        </div>
                    ) : (
                        <form className="auth-form" onSubmit={handleForgotPassword}>
                            <button
                                type="button"
                                onClick={() => { setShowForgotPassword(false); setError(''); }}
                                className="flex items-center gap-1.5 bg-none border-none cursor-pointer text-[var(--primary-600)] text-[14px] font-medium p-0 mb-5"
                            >
                                <FiArrowLeft size={16} /> Back to Sign In
                            </button>

                            <h1>Forgot Password?</h1>
                            <p className="subtitle">
                                No worries! Enter the email address linked to your account and we'll send you a reset link.
                            </p>

                             {error && (
                                <div className="bg-[var(--error-50)] border border-[#ef444433] rounded-[var(--radius-md)] p-[12px_16px] mb-4 flex items-center gap-2 text-[14px] text-[var(--error-600)]">
                                    <FiAlertCircle /> {error}
                                </div>
                            )}

                            <div className="form-group">
                                <label className="form-label">Email Address</label>
                                <div className="relative">
                                    <FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                                    <input
                                        type="email"
                                        className="form-input pl-10"
                                        placeholder="you@gmail.com"
                                        value={resetEmail}
                                        onChange={(e) => setResetEmail(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary btn-lg w-full mt-2"
                                disabled={resetLoading}
                            >
                                {resetLoading ? 'Sending Reset Link...' : 'Send Reset Link'}
                            </button>

                            <p className="text-center text-[12px] text-[var(--text-tertiary)] mt-4">
                                🔒 This uses Supabase's built-in secure email service — completely free, no third-party APIs.
                            </p>
                        </form>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="auth-page">
            <div className="auth-visual">
                <div className="auth-visual-content">
                    <div className="text-[56px] mb-6">🔐</div>
                    <h2>Welcome Back to SafeDrive</h2>
                    <p>Sign in to access your verified account, manage bookings, and browse quality vehicles from trusted owners.</p>
                    <div className="flex gap-6 mt-12 justify-center">
                        {[
                            { num: '100%', label: 'Verified Users' },
                            { num: '24/7', label: 'Support' },
                        ].map((s, i) => (
                            <div key={i}>
                                <div className="text-[24px] font-extrabold">{s.num}</div>
                                <div className="text-[12px] text-[#ffffff80]">{s.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="auth-form-container">
                <form className="auth-form" onSubmit={handleSubmit}>
                    <h1>Sign In</h1>
                    <p className="subtitle">Enter your credentials to access your account</p>

                    {verified && (
                        <div className="bg-[var(--success-50,#f0fdf4)] border border-[#22c55e4d] rounded-[var(--radius-md)] p-[12px_16px] mb-4 flex items-center gap-2 text-[14px] text-[var(--success-600,#16a34a)]">
                            <FiCheckCircle /> Email verified successfully! You can now sign in.
                        </div>
                    )}

                    {error && (
                        <div className="bg-[var(--error-50)] border border-[#ef444433] rounded-[var(--radius-md)] p-[12px_16px] mb-4 flex items-center gap-2 text-[14px] text-[var(--error-600)]">
                            <FiAlertCircle /> {error}
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <div className="relative">
                            <FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                            <input
                                type="email"
                                className="form-input pl-10"
                                placeholder="you@gmail.com"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="flex justify-between items-center">
                            <label className="form-label mb-0">Password</label>
                            <button
                                type="button"
                                onClick={() => { setShowForgotPassword(true); setError(''); setResetEmail(formData.email); }}
                                className="bg-none border-none text-[var(--primary-600)] cursor-pointer text-[13px] font-medium p-0"
                            >
                                Forgot password?
                            </button>
                        </div>
                        <div className="relative mt-1.5">
                            <FiLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="form-input pl-10 pr-11"
                                placeholder="••••••••"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 bg-none border-none cursor-pointer text-[var(--text-tertiary)] p-1 flex items-center"
                            >
                                {showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                            </button>
                        </div>
                    </div>

                    {/* Remember Me */}
                    <div className="flex items-center gap-2 mt-1">
                        <input
                            type="checkbox"
                            id="rememberMe"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className="w-4 h-4 cursor-pointer accent-[var(--primary-500)]"
                        />
                        <label htmlFor="rememberMe" className="text-[13px] text-[var(--text-secondary)] cursor-pointer">
                            Remember me — stay signed in on this device
                        </label>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-lg w-full mt-2"
                        disabled={loading}
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>

                    <p className="auth-link">
                        Don't have an account? <Link to="/register">Create Account</Link>
                    </p>
                </form>
            </div>
        </div>
    );
}
