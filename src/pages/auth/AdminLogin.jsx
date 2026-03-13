import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiArrowLeft, FiEye, FiEyeOff, FiLock, FiMail, FiShield } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { Admin2FAVerify } from '../../components/Admin2FA';

export default function AdminLogin() {
    const { signIn, signOut, isAdmin, user, loading, profile } = useAuth();
    const navigate = useNavigate();
    const [formLoading, setFormLoading] = useState(false);
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [show2FA, setShow2FA] = useState(false);
    const [loginSuccess, setLoginSuccess] = useState(false);

    useEffect(() => {
        if (!loading && user && isAdmin && loginSuccess) {
            toast.success(`Welcome back, ${profile?.full_name || 'Admin'}!`);
            navigate('/admin', { replace: true });
            return;
        }

        if (!loading && user && !isAdmin && loginSuccess && profile) {
            void signOut();
            setLoginSuccess(false);
            setShow2FA(false);
            setError('Access denied. This portal is for administrators only.');
            return;
        }

        if (!loading && user && isAdmin && !show2FA && !loginSuccess && !formLoading) {
            navigate('/admin', { replace: true });
            return;
        }

        if (!loading && user && !isAdmin && !show2FA && !loginSuccess && !formLoading && profile) {
            setError('This portal is for administrators only. Please use the main login page.');
        }
    }, [formLoading, isAdmin, loading, loginSuccess, navigate, profile, show2FA, signOut, user]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setFormLoading(true);

        try {
            const { error: signInError } = await signIn(formData, true, true);
            if (signInError) throw signInError;

            setShow2FA(true);
        } catch (err) {
            setError(err.message || 'Failed to sign in');
        } finally {
            setFormLoading(false);
        }
    };

    const handle2FASuccess = () => {
        setLoginSuccess(true);
    };

    const handle2FACancel = async () => {
        await signOut();
        setShow2FA(false);
        setError('Login cancelled.');
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-primary-900">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-error-500" />
            </div>
        );
    }

    if (show2FA) {
        return <Admin2FAVerify onSuccess={handle2FASuccess} onCancel={handle2FACancel} />;
    }

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-primary-900 px-6 py-14 text-white">
            <div className="absolute inset-0 bg-white/4" />
            <div className="pointer-events-none absolute inset-0 border border-white/8 opacity-20" />

            <div className="relative w-full max-w-[460px]">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex h-18 w-18 items-center justify-center rounded-[22px] bg-error-500 text-3xl shadow-[0_18px_40px_rgba(220,38,38,0.35)]">
                        <FiShield />
                    </div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                        SafeDrive control room
                    </p>
                    <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white">
                        Admin Portal
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                        Secure access for administration, moderation, and verification review.
                    </p>
                </div>

                <div className="rounded-[32px] border border-white/10 bg-white/8 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
                    {error && (
                        <div className="mb-5 rounded-3xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-100">
                            <div className="flex items-start gap-2">
                                <FiAlertCircle className="mt-0.5 shrink-0" />
                                {error}
                            </div>
                        </div>
                    )}

                    <form className="space-y-5" onSubmit={handleSubmit}>
                        <div>
                            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                                Admin Email
                            </label>
                            <div className="relative">
                                <FiMail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35" />
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                                    placeholder="admin@safedrive.com"
                                    required
                                    className="w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 pl-11 text-sm text-white placeholder:text-white/30 focus:border-error-400 focus:outline-none focus:ring-4 focus:ring-error-500/20"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                                Password
                            </label>
                            <div className="relative">
                                <FiLock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={formData.password}
                                    onChange={(event) => setFormData({ ...formData, password: event.target.value })}
                                    placeholder="Enter your password"
                                    required
                                    className="w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 pl-11 pr-12 text-sm text-white placeholder:text-white/30 focus:border-error-400 focus:outline-none focus:ring-4 focus:ring-error-500/20"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((value) => !value)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 transition hover:text-white"
                                >
                                    {showPassword ? <FiEyeOff /> : <FiEye />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={formLoading}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-error-500 bg-error-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-error-600 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/50"
                        >
                            {formLoading ? (
                                <>
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                                    Authenticating...
                                </>
                            ) : (
                                <>
                                    <FiShield />
                                    Access Admin Panel
                                </>
                            )}
                        </button>
                    </form>
                </div>

                <div className="mt-5 flex items-center justify-between gap-4 text-sm text-white/45">
                    <Link to="/" className="inline-flex items-center gap-2 transition hover:text-white/70">
                        <FiArrowLeft />
                        Back to SafeDrive
                    </Link>
                    <div className="max-w-[220px] text-right text-xs leading-5 text-white/35">
                        Unauthorized access is monitored and logged.
                    </div>
                </div>
            </div>
        </div>
    );
}
