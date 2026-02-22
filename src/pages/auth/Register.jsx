import { useState, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { FiMail, FiLock, FiUser, FiPhone, FiAlertCircle, FiCheck, FiX, FiEye, FiEyeOff } from 'react-icons/fi';
import toast from 'react-hot-toast';

// Password rules config
const PASSWORD_RULES = [
    { key: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
    { key: 'uppercase', label: 'One uppercase letter (A-Z)', test: (pw) => /[A-Z]/.test(pw) },
    { key: 'lowercase', label: 'One lowercase letter (a-z)', test: (pw) => /[a-z]/.test(pw) },
    { key: 'number', label: 'One number (0-9)', test: (pw) => /[0-9]/.test(pw) },
    { key: 'special', label: 'One special character (!@#$%^&*)', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

// Valid email domains
const VALID_EMAIL_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
    'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'aol.com',
    'ymail.com', 'msn.com', 'googlemail.com',
];

function validateEmail(email) {
    if (!email) return { valid: false, message: '', showWarning: false };

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return { valid: false, message: 'Enter a valid email address', showWarning: true };
    }

    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) {
        return { valid: false, message: 'Missing email domain (e.g. @gmail.com)', showWarning: true };
    }

    // Check if domain looks valid (has a dot)
    if (!domain.includes('.')) {
        return { valid: false, message: `"${domain}" is not a valid domain. Did you mean @gmail.com?`, showWarning: true };
    }

    // Suggest known domains if close match
    if (!VALID_EMAIL_DOMAINS.includes(domain)) {
        // Check for typos in common domains
        const suggestions = VALID_EMAIL_DOMAINS.filter(d => {
            const similarity = getSimilarity(domain, d);
            return similarity > 0.6 && similarity < 1;
        });

        if (suggestions.length > 0) {
            return {
                valid: false,
                message: `Did you mean @${suggestions[0]}?`,
                showWarning: true,
                suggestion: suggestions[0],
            };
        }

        // Unknown domain but valid format — just warn
        return { valid: true, message: `Using ${domain} — make sure this email can receive mail`, showWarning: true, isInfo: true };
    }

    return { valid: true, message: '', showWarning: false };
}

// Simple similarity check for typo detection
function getSimilarity(a, b) {
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1.0;

    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) matches++;
    }
    return matches / longer.length;
}

export default function Register() {
    const { signUp } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const initialRole = searchParams.get('role') || 'renter';

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [formData, setFormData] = useState({
        fullName: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
        role: initialRole,
        agreeTerms: false,
    });

    // Live password validation
    const passwordChecks = useMemo(() => {
        return PASSWORD_RULES.map(rule => ({
            ...rule,
            passed: formData.password.length > 0 && rule.test(formData.password),
        }));
    }, [formData.password]);

    const allPasswordRulesPassed = passwordChecks.every(r => r.passed);

    // Password strength score
    const passwordStrength = useMemo(() => {
        const passed = passwordChecks.filter(r => r.passed).length;
        if (formData.password.length === 0) return { level: 'none', label: '', color: '', percent: 0 };
        if (passed <= 1) return { level: 'weak', label: 'Weak', color: '#ef4444', percent: 20 };
        if (passed <= 2) return { level: 'fair', label: 'Fair', color: '#f97316', percent: 40 };
        if (passed <= 3) return { level: 'good', label: 'Good', color: '#eab308', percent: 60 };
        if (passed <= 4) return { level: 'strong', label: 'Strong', color: '#22c55e', percent: 80 };
        return { level: 'excellent', label: 'Excellent', color: '#10b981', percent: 100 };
    }, [passwordChecks, formData.password]);

    // Confirm password match
    const passwordsMatch = useMemo(() => {
        if (!formData.confirmPassword) return null; // not typed yet
        return formData.password === formData.confirmPassword;
    }, [formData.password, formData.confirmPassword]);

    // Email validation
    const emailValidation = useMemo(() => {
        return validateEmail(formData.email);
    }, [formData.email]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        // Validate email
        if (!emailValidation.valid && !emailValidation.isInfo) {
            setError(emailValidation.message || 'Please enter a valid email address');
            return;
        }

        // Validate password rules
        if (!allPasswordRulesPassed) {
            setError('Password does not meet all requirements');
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
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

    const applySuggestion = (suggestion) => {
        const localPart = formData.email.split('@')[0];
        setFormData({ ...formData, email: `${localPart}@${suggestion}` });
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

                    {/* Full Name */}
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

                    {/* Email with validation */}
                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <div style={{ position: 'relative' }}>
                            <FiMail style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type="email"
                                className="form-input"
                                placeholder="you@gmail.com"
                                style={{
                                    paddingLeft: 40,
                                    width: '100%',
                                    borderColor: formData.email
                                        ? emailValidation.valid && !emailValidation.showWarning ? 'var(--success-500, #22c55e)'
                                            : emailValidation.showWarning && !emailValidation.isInfo ? 'var(--error-500, #ef4444)'
                                                : emailValidation.isInfo ? 'var(--warning-500, #f59e0b)'
                                                    : undefined
                                        : undefined,
                                }}
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                            {formData.email && emailValidation.valid && !emailValidation.showWarning && (
                                <FiCheck style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: 18 }} />
                            )}
                        </div>
                        {formData.email && emailValidation.showWarning && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                marginTop: 6,
                                fontSize: 12,
                                color: emailValidation.isInfo ? 'var(--warning-600, #d97706)' : 'var(--error-600, #dc2626)',
                                padding: '6px 10px',
                                background: emailValidation.isInfo ? 'var(--warning-50, #fffbeb)' : 'var(--error-50, #fef2f2)',
                                borderRadius: 'var(--radius-sm, 6px)',
                            }}>
                                {emailValidation.isInfo ? <FiAlertCircle size={13} /> : <FiX size={13} />}
                                <span>{emailValidation.message}</span>
                                {emailValidation.suggestion && (
                                    <button
                                        type="button"
                                        onClick={() => applySuggestion(emailValidation.suggestion)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--primary-600)',
                                            cursor: 'pointer',
                                            fontWeight: 600,
                                            fontSize: 12,
                                            textDecoration: 'underline',
                                            padding: 0,
                                            marginLeft: 4,
                                        }}
                                    >
                                        Fix it
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Phone */}
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

                    {/* Password with strength indicator */}
                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <div style={{ position: 'relative' }}>
                            <FiLock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="form-input"
                                placeholder="Create a strong password"
                                style={{ paddingLeft: 40, paddingRight: 44, width: '100%' }}
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

                        {/* Password strength bar */}
                        {formData.password && (
                            <div style={{ marginTop: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: passwordStrength.color }}>
                                        {passwordStrength.label}
                                    </span>
                                </div>
                                <div style={{
                                    width: '100%', height: 4, borderRadius: 4,
                                    background: 'var(--neutral-200, #e5e7eb)',
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        width: `${passwordStrength.percent}%`,
                                        height: '100%',
                                        borderRadius: 4,
                                        background: passwordStrength.color,
                                        transition: 'all 0.3s ease',
                                    }} />
                                </div>
                            </div>
                        )}

                        {/* Password rules checklist */}
                        {formData.password && (
                            <div style={{
                                display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10,
                            }}>
                                {passwordChecks.map(rule => (
                                    <div
                                        key={rule.key}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            padding: '3px 10px',
                                            borderRadius: 20,
                                            fontSize: 11,
                                            fontWeight: 500,
                                            background: rule.passed ? 'var(--success-50, #f0fdf4)' : 'var(--error-50, #fef2f2)',
                                            color: rule.passed ? 'var(--success-700, #15803d)' : 'var(--error-600, #dc2626)',
                                            border: `1px solid ${rule.passed ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.2)'}`,
                                            transition: 'all 0.2s ease',
                                        }}
                                    >
                                        {rule.passed ? <FiCheck size={11} /> : <FiX size={11} />}
                                        {rule.label}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Confirm Password */}
                    <div className="form-group">
                        <label className="form-label">Confirm Password</label>
                        <div style={{ position: 'relative' }}>
                            <FiLock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type={showConfirmPassword ? 'text' : 'password'}
                                className="form-input"
                                placeholder="Re-enter your password"
                                style={{
                                    paddingLeft: 40,
                                    paddingRight: 44,
                                    width: '100%',
                                    borderColor: passwordsMatch === null ? undefined
                                        : passwordsMatch ? 'var(--success-500, #22c55e)' : 'var(--error-500, #ef4444)',
                                }}
                                value={formData.confirmPassword}
                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                style={{
                                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)',
                                    padding: 4, display: 'flex', alignItems: 'center',
                                }}
                            >
                                {showConfirmPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                            </button>
                        </div>
                        {passwordsMatch !== null && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12,
                                color: passwordsMatch ? 'var(--success-600, #16a34a)' : 'var(--error-600, #dc2626)',
                            }}>
                                {passwordsMatch ? <FiCheck size={13} /> : <FiX size={13} />}
                                {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                            </div>
                        )}
                    </div>

                    {/* Terms */}
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
