import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { FiMail, FiLock, FiAlertCircle, FiCheckCircle, FiArrowLeft, FiEye, FiEyeOff } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function Login() {
    const { signIn } = useAuth();
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
            const { error: signInError } = await signIn(formData, rememberMe);
            if (signInError) throw signInError;
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
                        <div style={{ fontSize: 56, marginBottom: 24 }}>🔑</div>
                        <h2>Reset Your Password</h2>
                        <p>Enter your email address and we'll send you a secure link to reset your password. No third-party services — it's all handled by SafeDrive.</p>
                    </div>
                </div>

                <div className="auth-form-container">
                    {resetSent ? (
                        <div className="auth-form" style={{ textAlign: 'center' }}>
                            <div style={{
                                width: 72, height: 72, borderRadius: '50%',
                                background: 'var(--success-50, #f0fdf4)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 24px',
                                border: '2px solid var(--success-200, #bbf7d0)',
                            }}>
                                <FiCheckCircle size={32} style={{ color: 'var(--success-600, #16a34a)' }} />
                            </div>
                            <h1 style={{ fontSize: 24, marginBottom: 8 }}>Check Your Email</h1>
                            <p className="subtitle" style={{ marginBottom: 24 }}>
                                We've sent a password reset link to <strong>{resetEmail}</strong>.
                                Click the link in your email to create a new password.
                            </p>
                            <div style={{
                                background: 'var(--warning-50, #fffbeb)',
                                border: '1px solid rgba(245,158,11,0.2)',
                                borderRadius: 'var(--radius-md)',
                                padding: '12px 16px',
                                fontSize: 13,
                                color: 'var(--warning-700, #b45309)',
                                marginBottom: 24,
                                textAlign: 'left',
                            }}>
                                💡 <strong>Tips:</strong> Check your spam/junk folder if you don't see the email. The link expires in 1 hour.
                            </div>
                            <button
                                className="btn btn-primary btn-lg"
                                style={{ width: '100%', marginBottom: 12 }}
                                onClick={() => {
                                    setShowForgotPassword(false);
                                    setResetSent(false);
                                    setResetEmail('');
                                }}
                            >
                                Back to Sign In
                            </button>
                            <button
                                className="btn btn-ghost"
                                style={{ width: '100%' }}
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
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--primary-600)', fontSize: 14, fontWeight: 500,
                                    padding: 0, marginBottom: 20,
                                }}
                            >
                                <FiArrowLeft size={16} /> Back to Sign In
                            </button>

                            <h1>Forgot Password?</h1>
                            <p className="subtitle">
                                No worries! Enter the email address linked to your account and we'll send you a reset link.
                            </p>

                            {error && (
                                <div style={{ background: 'var(--error-50)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--error-600)' }}>
                                    <FiAlertCircle /> {error}
                                </div>
                            )}

                            <div className="form-group">
                                <label className="form-label">Email Address</label>
                                <div style={{ position: 'relative' }}>
                                    <FiMail style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                    <input
                                        type="email"
                                        className="form-input"
                                        placeholder="you@gmail.com"
                                        style={{ paddingLeft: 40 }}
                                        value={resetEmail}
                                        onChange={(e) => setResetEmail(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary btn-lg"
                                style={{ width: '100%', marginTop: 8 }}
                                disabled={resetLoading}
                            >
                                {resetLoading ? 'Sending Reset Link...' : 'Send Reset Link'}
                            </button>

                            <p style={{
                                textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)',
                                marginTop: 16,
                            }}>
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
                    <div style={{ fontSize: 56, marginBottom: 24 }}>🔐</div>
                    <h2>Welcome Back to SafeDrive</h2>
                    <p>Sign in to access your verified account, manage bookings, and browse quality vehicles from trusted owners.</p>
                    <div style={{ display: 'flex', gap: 24, marginTop: 48, justifyContent: 'center' }}>
                        {[
                            { num: '100%', label: 'Verified Users' },
                            { num: '24/7', label: 'Support' },
                        ].map((s, i) => (
                            <div key={i}>
                                <div style={{ fontSize: 24, fontWeight: 800 }}>{s.num}</div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{s.label}</div>
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
                        <div style={{ background: 'var(--success-50, #f0fdf4)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--success-600, #16a34a)' }}>
                            <FiCheckCircle /> Email verified successfully! You can now sign in.
                        </div>
                    )}

                    {error && (
                        <div style={{ background: 'var(--error-50)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--error-600)' }}>
                            <FiAlertCircle /> {error}
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <div style={{ position: 'relative' }}>
                            <FiMail style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type="email"
                                className="form-input"
                                placeholder="you@gmail.com"
                                style={{ paddingLeft: 40 }}
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label className="form-label" style={{ marginBottom: 0 }}>Password</label>
                            <button
                                type="button"
                                onClick={() => { setShowForgotPassword(true); setError(''); setResetEmail(formData.email); }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--primary-600)',
                                    cursor: 'pointer',
                                    fontSize: 13,
                                    fontWeight: 500,
                                    padding: 0,
                                }}
                            >
                                Forgot password?
                            </button>
                        </div>
                        <div style={{ position: 'relative', marginTop: 6 }}>
                            <FiLock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="form-input"
                                placeholder="••••••••"
                                style={{ paddingLeft: 40, paddingRight: 44 }}
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)',
                                    padding: 4, display: 'flex', alignItems: 'center',
                                }}
                            >
                                {showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                            </button>
                        </div>
                    </div>

                    {/* Remember Me */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <input
                            type="checkbox"
                            id="rememberMe"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--primary-500)' }}
                        />
                        <label htmlFor="rememberMe" style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                            Remember me — stay signed in on this device
                        </label>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-lg"
                        style={{ width: '100%', marginTop: 8 }}
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
