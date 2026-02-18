import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { FiMail, FiLock, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function Login() {
    const { signIn } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [verified, setVerified] = useState(false);

    useEffect(() => {
        if (searchParams.get('verified') === 'true') {
            setVerified(true);
            toast.success('Email verified! You can now sign in.');
        }
    }, [searchParams]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const { error: signInError } = await signIn(formData);
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
                                placeholder="you@email.com"
                                style={{ paddingLeft: 40 }}
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <div style={{ position: 'relative' }}>
                            <FiLock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type="password"
                                className="form-input"
                                placeholder="••••••••"
                                style={{ paddingLeft: 40 }}
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                required
                            />
                        </div>
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
