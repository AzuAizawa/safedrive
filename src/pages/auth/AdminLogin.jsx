import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';


import { FiShield, FiMail, FiLock, FiAlertCircle, FiEye, FiEyeOff, FiArrowLeft } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { Admin2FAVerify } from '../../components/Admin2FA';

export default function AdminLogin() {
    const { signIn, signOut, isAdmin, user, loading, profile } = useAuth();
    const navigate = useNavigate();
    const [formLoading, setFormLoading] = useState(false);
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [show2FA, setShow2FA] = useState(false);
    const [adminName, setAdminName] = useState('');
    const [loginSuccess, setLoginSuccess] = useState(false); // tracks 2FA cleared

    // Navigate to admin panel ONLY when auth is fully settled
    useEffect(() => {
        // Case 1: Fresh login — loginSuccess + isAdmin confirmed → go to admin
        if (!loading && user && isAdmin && loginSuccess) {
            toast.success(`Welcome back, ${adminName || profile?.full_name || 'Admin'}!`);
            navigate('/admin', { replace: true });
        }
        // Case 2: Fresh login — loginSuccess but NOT admin → reject
        if (!loading && user && !isAdmin && loginSuccess && profile) {
            signOut();
            setLoginSuccess(false);
            setShow2FA(false);
            setError('Access denied. This portal is for administrators only.');
        }
        // Case 3: Already logged in as admin (page refresh) — skip during active login
        if (!loading && user && isAdmin && !show2FA && !loginSuccess && !formLoading) {
            navigate('/admin', { replace: true });
        }
        // Case 4: Logged in as non-admin on page load
        if (!loading && user && !isAdmin && !show2FA && !loginSuccess && !formLoading && profile) {
            setError('This portal is for administrators only. Please use the main login page.');
        }
    }, [loading, user, isAdmin, loginSuccess, formLoading, profile]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setFormLoading(true);
        try {
            const { data, error: signInError } = await signIn(formData, true, true);
            if (signInError) throw signInError;
            // signIn + attachListener(processInitialSession=true) will load the profile
            // via INITIAL_SESSION. The useEffect above will then:
            //   ✔ navigate to /admin if isAdmin=true
            //   ✖ call signOut + show error if isAdmin=false (not an admin account)
            // No raw DB query needed here — avoids RLS blocking the check.
            setShow2FA(true);
        } catch (err) {
            setError(err.message || 'Failed to sign in');
        } finally {
            setFormLoading(false);
        }
    };

    const handle2FASuccess = () => {
        // Don't navigate here — profile may not have loaded yet.
        // Set loginSuccess=true and let the useEffect navigate
        // once AuthContext confirms user+isAdmin are both ready.
        setLoginSuccess(true);
    };

    const handle2FACancel = async () => {
        await signOut();
        setShow2FA(false);
        setError('Login cancelled.');
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-[#0f172a]">
                <div className="w-10 h-10 border-[3px] border-[rgba(255,255,255,0.1)] border-t-[#ef4444] rounded-full animate-spin" />
            </div>
        );
    }

    // Show 2FA verification screen after successful password login
    if (show2FA) {
        return <Admin2FAVerify onSuccess={handle2FASuccess} onCancel={handle2FACancel} />;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#0f172a] flex items-center justify-center p-6 font-[var(--font-body)]">
            {/* Background pattern */}
            <div className="fixed inset-0 opacity-[0.04] bg-[repeating-linear-gradient(45deg,#ffffff_0,#ffffff_1px,transparent_0,transparent_50%)] bg-[length:20px_20px] pointer-events-none" />

            <div className="w-full max-w-[440px] relative z-[1]">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="w-16 h-16 rounded-[16px] bg-gradient-to-br from-[#ef4444] to-[#dc2626] flex items-center justify-center mx-auto mb-4 shadow-[0_8px_32px_rgba(239,68,68,0.4)] text-[28px] text-white">
                        <FiShield />
                    </div>
                    <h1 className="text-[26px] font-[800] text-[#f1f5f9] mb-1.5 font-[var(--font-display)]">
                        Admin Portal
                    </h1>
                    <p className="text-[14px] text-[#64748b]">SafeDrive Administration — Authorized Personnel Only</p>
                </div>

                {/* Card */}
                <div className="bg-[#1e293bf2] border border-[#ef444433] rounded-[20px] p-[36px_32px] shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
                    {error && (
                        <div className="bg-[#ef44441a] border border-[#ef44444d] rounded-[10px] p-[12px_16px] mb-5 flex items-start gap-2.5 text-[#fca5a5] text-[14px]">
                            <FiAlertCircle className="mt-0.5 shrink-0" />
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        {/* Email */}
                        <div className="mb-4.5">
                            <label className="text-[13px] font-semibold text-[#94a3b8] block mb-2 tracking-widest uppercase">
                                Admin Email
                            </label>
                            <div className="relative">
                                <FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#475569] text-[16px]" />
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="admin@safedrive.com"
                                    required
                                    className="w-full box-border p-[12px_14px_12px_42px] bg-[#0f172acc] border border-[#94a3b81a] rounded-[10px] text-[#f1f5f9] text-[14px] outline-none"
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div className="mb-6">
                            <label className="text-[13px] font-semibold text-[#94a3b8] block mb-2 tracking-widest uppercase">
                                Password
                            </label>
                            <div className="relative">
                                <FiLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#475569] text-[16px]" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    placeholder="••••••••"
                                    required
                                    className="w-full box-border p-[12px_44px_12px_42px] bg-[#0f172acc] border border-[#94a3b81a] rounded-[10px] text-[#f1f5f9] text-[14px] outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-none border-none text-[#475569] cursor-pointer"
                                >
                                    {showPassword ? <FiEyeOff /> : <FiEye />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={formLoading}
                            className={`w-full p-3.5 border-none rounded-[10px] text-white text-[15px] font-bold cursor-pointer flex items-center justify-center gap-2 transition-all duration-200 ${formLoading ? 'bg-[#475569] cursor-not-allowed shadow-none' : 'bg-gradient-to-br from-[#ef4444] to-[#dc2626] shadow-[0_4px_16px_rgba(239,68,68,0.3)]'}`}
                        >
                            {formLoading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                    Authenticating...
                                </>
                            ) : (
                                <><FiShield /> Access Admin Panel</>
                            )}
                        </button>
                    </form>
                </div>

                {/* Back link */}
                <div className="text-center mt-5">
                    <Link to="/" className="text-[#475569] text-[13px] no-underline inline-flex items-center gap-1.5 hover:text-[#64748b] transition-colors">
                        <FiArrowLeft size={13} /> Back to SafeDrive
                    </Link>
                </div>

                {/* Security notice */}
                <div className="mt-5 p-[12px_16px] bg-[#ef44440f] border border-[#ef444426] rounded-[10px] flex items-start gap-2.5">
                    <FiShield className="text-[#ef4444] shrink-0 mt-0.5" size={14} />
                    <p className="text-[12px] text-[#64748b] m-0 leading-relaxed">
                        This is a restricted area. All login attempts are logged and monitored. Unauthorized access is prohibited.
                    </p>
                </div>
            </div>
        </div>
    );
}
