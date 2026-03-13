import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiCheck, FiEye, FiEyeOff, FiLock, FiMail, FiPhone, FiUser, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { validateRegistrationForm } from '../../lib/validation';
import { getDefaultAppPath } from '../../lib/navigation';
import { ui } from '../../lib/ui';

const PASSWORD_RULES = [
    { key: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
    { key: 'uppercase', label: 'One uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
    { key: 'lowercase', label: 'One lowercase letter', test: (pw) => /[a-z]/.test(pw) },
    { key: 'number', label: 'One number', test: (pw) => /[0-9]/.test(pw) },
    { key: 'special', label: 'One special character', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

function AuthShell({ children }) {
    return (
        <div className="min-h-screen bg-neutral-100 px-4 pb-12 pt-28 sm:px-6 lg:px-8">
            <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_1.02fr]">
                <section className="relative overflow-hidden rounded-[36px] border border-primary-400/20 bg-primary-900 px-6 py-10 text-white shadow-float sm:px-10 sm:py-12">
                    <div className="absolute inset-0 bg-primary-700/15" />
                    <div className="relative space-y-6">
                        <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                            New account
                        </div>
                        <div className="space-y-4">
                            <h1 className="max-w-md font-display text-4xl font-bold leading-tight sm:text-5xl">
                                Join SafeDrive with confidence.
                            </h1>
                            <p className="max-w-lg text-sm leading-7 text-white/70 sm:text-base">
                                Build one verified account for both renting and listing, then switch experiences with a simple mode toggle after you sign in.
                            </p>
                        </div>
                        <div className="space-y-3 text-sm text-white/80">
                            {[
                                'Government ID verification before marketplace actions',
                                'Protected booking requests and digital agreements',
                                'Role-based renter and lister interfaces after login',
                            ].map((item) => (
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
                            Create account
                        </div>
                        <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary">
                            Start with a SafeDrive account
                        </h2>
                        <p className="text-sm leading-6 text-text-secondary">
                            Create your account now, then complete verification from your profile to unlock renter and lister actions.
                        </p>
                    </div>
                    {children}
                </section>
            </div>
        </div>
    );
}

export default function Register() {
    const { signUp } = useAuth();
    const navigate = useNavigate();
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
        role: 'user',
        agreeTerms: false,
    });

    const passwordChecks = useMemo(() => {
        return PASSWORD_RULES.map((rule) => ({
            ...rule,
            passed: formData.password.length > 0 && rule.test(formData.password),
        }));
    }, [formData.password]);

    const passwordsMatch = useMemo(() => {
        if (!formData.confirmPassword) return null;
        return formData.password === formData.confirmPassword;
    }, [formData.confirmPassword, formData.password]);

    const passwordStrength = useMemo(() => {
        const passed = passwordChecks.filter((rule) => rule.passed).length;
        if (formData.password.length === 0) return { label: '', width: '0%', color: 'bg-neutral-200' };
        if (passed <= 2) return { label: 'Weak', width: '35%', color: 'bg-error-500' };
        if (passed === 3) return { label: 'Good', width: '60%', color: 'bg-warning-500' };
        if (passed === 4) return { label: 'Strong', width: '80%', color: 'bg-primary-600' };
        return { label: 'Excellent', width: '100%', color: 'bg-success-500' };
    }, [formData.password.length, passwordChecks]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setFieldErrors({});

        const { valid, errors } = validateRegistrationForm({
            fullName: formData.fullName,
            email: formData.email,
            phone: formData.phone,
            password: formData.password,
            confirmPassword: formData.confirmPassword,
        });

        if (!valid) {
            setFieldErrors(errors);
            setError('Please fix the highlighted fields before continuing.');
            return;
        }

        if (!formData.agreeTerms) {
            setError('You must agree to the terms and conditions.');
            return;
        }

        setLoading(true);

        try {
            const { data, error: signUpError } = await signUp({
                email: formData.email,
                password: formData.password,
                fullName: formData.fullName,
                role: formData.role,
                phone: formData.phone,
            });

            if (signUpError) throw signUpError;

            toast.success('Account created. Check your email to verify.');

            if (data?.session?.user) {
                navigate(getDefaultAppPath({ mode: 'renter' }));
            } else {
                navigate('/login');
            }
        } catch (err) {
            console.error('Registration error:', err);
            setError(err.message || 'Failed to create account');
            toast.error(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthShell>
            <form className="space-y-5" onSubmit={handleSubmit}>
                {error && (
                    <div className="rounded-3xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700">
                        <div className="flex items-start gap-2">
                            <FiAlertCircle className="mt-0.5 shrink-0" />
                            {error}
                        </div>
                    </div>
                )}

                <div>
                    <label className={ui.label}>Full name</label>
                    <div className="relative">
                        <FiUser className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                            type="text"
                            className={ui.inputWithIcon}
                            placeholder="Juan Dela Cruz"
                            value={formData.fullName}
                            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                            required
                        />
                    </div>
                    {fieldErrors.fullName && <p className="mt-2 text-xs text-error-600">{fieldErrors.fullName}</p>}
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
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
                        {fieldErrors.email && <p className="mt-2 text-xs text-error-600">{fieldErrors.email}</p>}
                    </div>

                    <div>
                        <label className={ui.label}>Phone number</label>
                        <div className="relative">
                            <FiPhone className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                            <input
                                type="tel"
                                className={ui.inputWithIcon}
                                placeholder="09XX XXX XXXX"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                required
                            />
                        </div>
                        {fieldErrors.phone && <p className="mt-2 text-xs text-error-600">{fieldErrors.phone}</p>}
                    </div>
                </div>

                <div>
                    <label className={ui.label}>Password</label>
                    <div className="relative">
                        <FiLock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                            type={showPassword ? 'text' : 'password'}
                            className={`${ui.inputWithIcon} pr-12`}
                            placeholder="Create a strong password"
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
                    <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-text-tertiary">
                            <span>Password strength</span>
                            <span>{passwordStrength.label}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                            <div className={`${passwordStrength.color} h-full rounded-full transition-all`} style={{ width: passwordStrength.width }} />
                        </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {passwordChecks.map((rule) => (
                            <div
                                key={rule.key}
                                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${rule.passed ? 'border-success-200 bg-success-50 text-success-700' : 'border-border-light bg-neutral-100 text-text-tertiary'}`}
                            >
                                {rule.passed ? <FiCheck size={12} /> : <FiX size={12} />}
                                {rule.label}
                            </div>
                        ))}
                    </div>
                    {fieldErrors.password && <p className="mt-2 text-xs text-error-600">{fieldErrors.password}</p>}
                </div>

                <div>
                    <label className={ui.label}>Confirm password</label>
                    <div className="relative">
                        <FiLock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            className={`${ui.inputWithIcon} pr-12`}
                            placeholder="Re-enter your password"
                            value={formData.confirmPassword}
                            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                            required
                        />
                        <button
                            type="button"
                            onClick={() => setShowConfirmPassword((value) => !value)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary transition hover:text-text-primary"
                        >
                            {showConfirmPassword ? <FiEyeOff /> : <FiEye />}
                        </button>
                    </div>
                    {passwordsMatch !== null && (
                        <p className={`mt-2 text-xs ${passwordsMatch ? 'text-success-700' : 'text-error-600'}`}>
                            {passwordsMatch ? 'Passwords match.' : 'Passwords do not match.'}
                        </p>
                    )}
                </div>

                <label className="flex items-start gap-3 text-sm leading-6 text-text-secondary">
                    <input
                        type="checkbox"
                        checked={formData.agreeTerms}
                        onChange={(e) => setFormData({ ...formData, agreeTerms: e.target.checked })}
                        className="mt-1 h-4 w-4 rounded border-border-light text-primary-600 focus:ring-primary-200"
                    />
                    I agree to SafeDrive&apos;s terms, privacy policy, and verification requirements.
                </label>

                <button
                    type="submit"
                    className={`${ui.button.primary} w-full`}
                    disabled={loading}
                >
                    {loading ? 'Creating account...' : 'Create account'}
                </button>

                <p className="text-center text-sm text-text-secondary">
                    Already have an account?{' '}
                    <Link to="/login" className="font-semibold text-primary-700 hover:text-primary-800">
                        Sign in
                    </Link>
                </p>
            </form>
        </AuthShell>
    );
}
