import { useState, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { FiMail, FiLock, FiUser, FiPhone, FiAlertCircle, FiCheck, FiX, FiEye, FiEyeOff } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { validateRegistrationForm } from '../../lib/validation';

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
    const initialRole = 'user';

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
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
        if (formData.password.length === 0) return { level: 'none', label: '', color: 'text-neutral-400', bg: 'bg-neutral-200', percent: 0 };
        if (passed <= 1) return { level: 'weak', label: 'Weak', color: 'text-red-500', bg: 'bg-red-500', percent: 20 };
        if (passed <= 2) return { level: 'fair', label: 'Fair', color: 'text-orange-500', bg: 'bg-orange-500', percent: 40 };
        if (passed <= 3) return { level: 'good', label: 'Good', color: 'text-yellow-500', bg: 'bg-yellow-500', percent: 60 };
        if (passed <= 4) return { level: 'strong', label: 'Strong', color: 'text-green-500', bg: 'bg-green-500', percent: 80 };
        return { level: 'excellent', label: 'Excellent', color: 'text-emerald-500', bg: 'bg-emerald-500', percent: 100 };
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
        setFieldErrors({});

        // Comprehensive validation using centralized validation module
        const { valid, errors } = validateRegistrationForm({
            fullName: formData.fullName,
            email: formData.email,
            phone: formData.phone,
            password: formData.password,
            confirmPassword: formData.confirmPassword,
        });

        if (!valid) {
            setFieldErrors(errors);
            setError('Please fix the errors below before continuing.');
            return;
        }

        if (!formData.agreeTerms) {
            setError('You must agree to the terms and conditions.');
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
                    <div className="text-[56px] mb-6">🚗</div>
                    <h2>Join SafeDrive</h2>
                    <p>Create your verified account to start renting or listing vehicles on the most secure P2P car rental platform in the Philippines.</p>
                    <div className="mt-12 flex flex-col gap-4 text-left max-w-[320px] mx-auto">
                        {[
                            '✅ Government ID Verification',
                            '✅ Selfie Identity Matching',
                            '✅ Digital Rental Agreements',
                            '✅ Community Trust & Reviews',
                        ].map((item, i) => (
                            <div key={i} className="text-[14px] text-[#ffffffcc]">{item}</div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="auth-form-container">
                <form className="auth-form" onSubmit={handleSubmit}>
                    <h1>Create Account</h1>
                    <p className="subtitle">Get started with a free SafeDrive account</p>

                    {error && (
                        <div className="bg-[var(--error-50)] border border-[#ef444433] rounded-[var(--radius-md)] p-[12px_16px] mb-4 flex items-center gap-2 text-[14px] text-[var(--error-600)]">
                            <FiAlertCircle /> {error}
                        </div>
                    )}

                    {/* Role is automatically set to 'user' — no selector needed */}

                    {/* Full Name */}
                    <div className="form-group">
                        <label className="form-label">Full Name</label>
                        <div className="relative">
                            <FiUser className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                            <input
                                type="text"
                                className="form-input pl-10 w-full"
                                placeholder="Juan Dela Cruz"
                                value={formData.fullName}
                                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    {/* Email with validation */}
                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <div className="relative">
                            <FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                            <input
                                type="email"
                                className={`form-input pl-10 w-full ${formData.email ? (emailValidation.valid && !emailValidation.showWarning ? 'border-[var(--success-500,#22c55e)]' : emailValidation.showWarning && !emailValidation.isInfo ? 'border-[var(--error-500,#ef4444)]' : emailValidation.isInfo ? 'border-[var(--warning-500,#f59e0b)]' : '') : ''}`}
                                placeholder="you@gmail.com"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                            {formData.email && emailValidation.valid && !emailValidation.showWarning && (
                                <FiCheck className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#22c55e] text-[18px]" />
                            )}
                        </div>
                        {formData.email && emailValidation.showWarning && (
                            <div className={`flex items-center gap-1.5 mt-1.5 text-[12px] p-[6px_10px] rounded-[var(--radius-sm,6px)] ${emailValidation.isInfo ? 'text-[var(--warning-600,#d97706)] bg-[var(--warning-50,#fffbeb)]' : 'text-[var(--error-600,#dc2626)] bg-[var(--error-50,#fef2f2)]'}`}>
                                {emailValidation.isInfo ? <FiAlertCircle size={13} /> : <FiX size={13} />}
                                <span>{emailValidation.message}</span>
                                {emailValidation.suggestion && (
                                    <button
                                        type="button"
                                        onClick={() => applySuggestion(emailValidation.suggestion)}
                                        className="bg-none border-none text-[var(--primary-600)] cursor-pointer font-semibold text-[12px] underline p-0 ml-1"
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
                        <div className="relative">
                            <FiPhone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                            <input
                                type="tel"
                                className="form-input pl-10 w-full"
                                placeholder="09XX XXX XXXX"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    {/* Password with strength indicator */}
                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <div className="relative">
                            <FiLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="form-input pl-10 pr-11 w-full"
                                placeholder="Create a strong password"
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

                        {/* Password strength bar */}
                        {formData.password && (
                            <div className="mt-2">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className={`text-[11px] font-semibold transition-colors duration-200 ${passwordStrength.color}`}>
                                        {passwordStrength.label}
                                    </span>
                                </div>
                                <div className="w-full h-1 rounded-full bg-[var(--neutral-200)] overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-300 ease-in-out ${passwordStrength.bg}`}
                                        style={{ width: `${passwordStrength.percent}%` }} 
                                    />
                                </div>
                            </div>
                        )}

                        {/* Password rules checklist */}
                        {formData.password && (
                            <div className="flex flex-wrap gap-1.5 mt-2.5">
                                {passwordChecks.map(rule => (
                                    <div
                                        key={rule.key}
                                        className={`inline-flex items-center gap-1 p-[3px_10px] rounded-[20px] text-[11px] font-medium border transition-all duration-200 ease-in-out ${rule.passed ? 'bg-[var(--success-50,#f0fdf4)] text-[var(--success-700,#15803d)] border-[#22c55e40]' : 'bg-[var(--error-50,#fef2f2)] text-[var(--error-600,#dc2626)] border-[#ef444433]'}`}
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
                        <div className="relative">
                            <FiLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                            <input
                                type={showConfirmPassword ? 'text' : 'password'}
                                className={`form-input pl-10 pr-11 w-full ${passwordsMatch === null ? '' : passwordsMatch ? 'border-[var(--success-500,#22c55e)]' : 'border-[var(--error-500,#ef4444)]'}`}
                                placeholder="Re-enter your password"
                                value={formData.confirmPassword}
                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 bg-none border-none cursor-pointer text-[var(--text-tertiary)] p-1 flex items-center"
                            >
                                {showConfirmPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                            </button>
                        </div>
                        {passwordsMatch !== null && (
                            <div className={`flex items-center gap-1.5 mt-1.5 text-[12px] ${passwordsMatch ? 'text-[var(--success-600,#16a34a)]' : 'text-[var(--error-600,#dc2626)]'}`}>
                                {passwordsMatch ? <FiCheck size={13} /> : <FiX size={13} />}
                                {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                            </div>
                        )}
                    </div>

                    {/* Terms */}
                    <div className="mt-2">
                        <label className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)] cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.agreeTerms}
                                onChange={(e) => setFormData({ ...formData, agreeTerms: e.target.checked })}
                                className="mt-0.5 accent-[var(--primary-600)]"
                            />
                            I agree to SafeDrive's Terms of Service, Privacy Policy, and Rental Agreement Terms. I understand that my identity will be verified.
                        </label>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-lg w-full mt-4"
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
