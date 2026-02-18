import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { FiMail, FiLock, FiUser, FiPhone, FiAlertCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function Register() {
    const { signUp } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const initialRole = searchParams.get('role') || 'renter';

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [formData, setFormData] = useState({
        fullName: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
        role: initialRole,
        agreeTerms: false,
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (formData.password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        if (!formData.agreeTerms) {
            setError('You must agree to the terms and conditions');
            return;
        }

        setLoading(true);

        try {
            const { error: signUpError } = await signUp({
                email: formData.email,
                password: formData.password,
                fullName: formData.fullName,
                role: formData.role,
                phone: formData.phone,
            });

            if (signUpError) throw signUpError;
            console.log('Registration success');
            toast.success('Account created! Please check your email to verify.');
            navigate('/dashboard');
        } catch (err) {
            console.error('Registration error:', err);
            setError(err.message || 'Failed to create account');
            toast.error(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-visual">
                <div className="auth-visual-content">
                    <div style={{ fontSize: 56, marginBottom: 24 }}>🚗</div>
                    <h2>Join SafeDrive</h2>
                    <p>Create your verified account to start renting or listing vehicles on the most secure P2P car rental platform in the Philippines.</p>
                    <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'left', maxWidth: 320, margin: '48px auto 0' }}>
                        {[
                            '✅ Government ID Verification',
                            '✅ Selfie Identity Matching',
                            '✅ Digital Rental Agreements',
                            '✅ Community Trust & Reviews',
                        ].map((item, i) => (
                            <div key={i} style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{item}</div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="auth-form-container">
                <form className="auth-form" onSubmit={handleSubmit}>
                    <h1>Create Account</h1>
                    <p className="subtitle">Get started with a free SafeDrive account</p>

                    {error && (
                        <div style={{ background: 'var(--error-50)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--error-600)' }}>
                            <FiAlertCircle /> {error}
                        </div>
                    )}

                    {/* Role Selector */}
                    <div className="form-group">
                        <label className="form-label">I want to</label>
                        <div className="role-selector">
                            <div
                                className={`role-option ${formData.role === 'renter' ? 'selected' : ''}`}
                                onClick={() => setFormData({ ...formData, role: 'renter' })}
                            >
                                <div className="role-icon">🔑</div>
                                <div className="role-name">Rent a Car</div>
                                <div className="role-desc">Browse & book vehicles</div>
                            </div>
                            <div
                                className={`role-option ${formData.role === 'owner' ? 'selected' : ''}`}
                                onClick={() => setFormData({ ...formData, role: 'owner' })}
                            >
                                <div className="role-icon">🚘</div>
                                <div className="role-name">List My Car</div>
                                <div className="role-desc">Earn from your vehicle</div>
                            </div>
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Full Name</label>
                        <div style={{ position: 'relative' }}>
                            <FiUser style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Juan Dela Cruz"
                                style={{ paddingLeft: 40, width: '100%' }}
                                value={formData.fullName}
                                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <div style={{ position: 'relative' }}>
                            <FiMail style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type="email"
                                className="form-input"
                                placeholder="you@email.com"
                                style={{ paddingLeft: 40, width: '100%' }}
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Phone Number</label>
                        <div style={{ position: 'relative' }}>
                            <FiPhone style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type="tel"
                                className="form-input"
                                placeholder="09XX XXX XXXX"
                                style={{ paddingLeft: 40, width: '100%' }}
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Password</label>
                            <div style={{ position: 'relative' }}>
                                <FiLock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input
                                    type="password"
                                    className="form-input"
                                    placeholder="••••••••"
                                    style={{ paddingLeft: 40, width: '100%' }}
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    required
                                    minLength={6}
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Confirm</label>
                            <div style={{ position: 'relative' }}>
                                <FiLock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input
                                    type="password"
                                    className="form-input"
                                    placeholder="••••••••"
                                    style={{ paddingLeft: 40, width: '100%' }}
                                    value={formData.confirmPassword}
                                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ marginTop: 8 }}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={formData.agreeTerms}
                                onChange={(e) => setFormData({ ...formData, agreeTerms: e.target.checked })}
                                style={{ marginTop: 2, accentColor: 'var(--primary-600)' }}
                            />
                            I agree to SafeDrive's Terms of Service, Privacy Policy, and Rental Agreement Terms. I understand that my identity will be verified.
                        </label>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-lg"
                        style={{ width: '100%', marginTop: 16 }}
                        disabled={loading}
                    >
                        {loading ? 'Creating Account...' : 'Create Account'}
                    </button>

                    <p className="auth-link">
                        Already have an account? <Link to="/login">Sign In</Link>
                    </p>
                </form>
            </div>
        </div>
    );
}
