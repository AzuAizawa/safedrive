import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabaseAdmin } from '../../lib/supabase';
import { FiShield, FiMail, FiLock, FiAlertCircle, FiEye, FiEyeOff, FiArrowLeft } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function AdminLogin() {
    const { signIn, signOut, isAdmin, user, loading } = useAuth();
    const navigate = useNavigate();
    const [formLoading, setFormLoading] = useState(false);
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // If already logged in as admin, redirect to admin panel
    useEffect(() => {
        if (!loading && user && isAdmin) {
            navigate('/admin', { replace: true });
        }
        // If logged in as a non-admin, stay here with an error
        if (!loading && user && !isAdmin) {
            setError('This portal is for administrators only. Please use the main login page.');
        }
    }, [loading, user, isAdmin]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setFormLoading(true);

        try {
            const { data, error: signInError } = await signIn(formData, true);
            if (signInError) throw signInError;

            // After sign in, check if this is actually an admin account
            const { data: profileData } = await supabaseAdmin
                .from('profiles')
                .select('role, full_name')
                .eq('id', data.user.id)
                .single();

            if (profileData?.role !== 'admin') {
                // Not an admin — sign them out and show error
                await signOut();
                setError('Access denied. This portal is for administrators only. If you are a regular user, please use the main login page.');
                return;
            }

            toast.success(`Welcome back, ${profileData.full_name || 'Admin'}!`);
            navigate('/admin', { replace: true });
        } catch (err) {
            setError(err.message || 'Failed to sign in');
        } finally {
            setFormLoading(false);
        }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0f172a' }}>
                <div className="spinner" style={{ borderTopColor: '#ef4444' }} />
            </div>
        );
    }

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            fontFamily: 'var(--font-body)',
        }}>
            {/* Background pattern */}
            <div style={{
                position: 'fixed', inset: 0, opacity: 0.04,
                backgroundImage: `repeating-linear-gradient(45deg, #ffffff 0, #ffffff 1px, transparent 0, transparent 50%)`,
                backgroundSize: '20px 20px',
                pointerEvents: 'none',
            }} />

            <div style={{
                width: '100%',
                maxWidth: 440,
                position: 'relative',
                zIndex: 1,
            }}>
                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{
                        width: 64, height: 64, borderRadius: 16,
                        background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px',
                        boxShadow: '0 8px 32px rgba(239,68,68,0.4)',
                        fontSize: 28, color: '#fff',
                    }}>
                        <FiShield />
                    </div>
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: '#f1f5f9', marginBottom: 6, fontFamily: 'var(--font-display)' }}>
                        Admin Portal
                    </h1>
                    <p style={{ fontSize: 14, color: '#64748b' }}>SafeDrive Administration — Authorized Personnel Only</p>
                </div>

                {/* Card */}
                <div style={{
                    background: 'rgba(30,41,59,0.95)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    borderRadius: 20,
                    padding: '36px 32px',
                    boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
                }}>
                    {error && (
                        <div style={{
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 10,
                            padding: '12px 16px',
                            marginBottom: 20,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            color: '#fca5a5',
                            fontSize: 14,
                        }}>
                            <FiAlertCircle style={{ marginTop: 2, flexShrink: 0 }} />
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        {/* Email */}
                        <div style={{ marginBottom: 18 }}>
                            <label style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                Admin Email
                            </label>
                            <div style={{ position: 'relative' }}>
                                <FiMail style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: 16 }} />
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="admin@safedrive.com"
                                    required
                                    style={{
                                        width: '100%', boxSizing: 'border-box',
                                        padding: '12px 14px 12px 42px',
                                        background: 'rgba(15,23,42,0.8)',
                                        border: '1px solid rgba(148,163,184,0.1)',
                                        borderRadius: 10, color: '#f1f5f9', fontSize: 14,
                                        outline: 'none',
                                    }}
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div style={{ marginBottom: 24 }}>
                            <label style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                Password
                            </label>
                            <div style={{ position: 'relative' }}>
                                <FiLock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: 16 }} />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    placeholder="••••••••"
                                    required
                                    style={{
                                        width: '100%', boxSizing: 'border-box',
                                        padding: '12px 44px 12px 42px',
                                        background: 'rgba(15,23,42,0.8)',
                                        border: '1px solid rgba(148,163,184,0.1)',
                                        borderRadius: 10, color: '#f1f5f9', fontSize: 14,
                                        outline: 'none',
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#475569', cursor: 'pointer' }}
                                >
                                    {showPassword ? <FiEyeOff /> : <FiEye />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={formLoading}
                            style={{
                                width: '100%',
                                padding: '14px',
                                background: formLoading ? '#475569' : 'linear-gradient(135deg, #ef4444, #dc2626)',
                                border: 'none', borderRadius: 10, color: '#fff',
                                fontSize: 15, fontWeight: 700, cursor: formLoading ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                boxShadow: formLoading ? 'none' : '0 4px 16px rgba(239,68,68,0.3)',
                                transition: 'all 0.2s',
                            }}
                        >
                            {formLoading ? (
                                <>
                                    <div className="spinner" style={{ width: 16, height: 16, borderTopColor: '#fff' }} />
                                    Authenticating...
                                </>
                            ) : (
                                <><FiShield /> Access Admin Panel</>
                            )}
                        </button>
                    </form>
                </div>

                {/* Back link */}
                <div style={{ textAlign: 'center', marginTop: 20 }}>
                    <Link to="/" style={{ color: '#475569', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <FiArrowLeft size={13} /> Back to SafeDrive
                    </Link>
                </div>

                {/* Security notice */}
                <div style={{
                    marginTop: 20, padding: '12px 16px',
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.15)',
                    borderRadius: 10,
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                }}>
                    <FiShield style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} size={14} />
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                        This is a restricted area. All login attempts are logged and monitored. Unauthorized access is prohibited.
                    </p>
                </div>
            </div>
        </div>
    );
}
