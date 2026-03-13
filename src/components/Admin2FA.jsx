import { useState, useEffect } from 'react';
import { supabaseAdmin } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiShield, FiSmartphone, FiCopy, FiCheck, FiAlertCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

/**
 * Admin2FA
 * =========
 * Implements TOTP-based 2FA for admin accounts using Supabase Auth MFA.
 *
 * Supabase MFA is FREE — included in all plans (free and paid).
 * Uses industry-standard TOTP (RFC 6238) compatible with Google Authenticator,
 * Authy, 1Password, Microsoft Authenticator, etc.
 *
 * This component handles BOTH:
 * 1. MFA enrollment (setup) — from Settings page for admins
 * 2. MFA verification — triggered after password login
 */

export function Admin2FASetup({ onComplete }) {
    const { user } = useAuth();
    const [step, setStep] = useState('start'); // start | qr | verify | done
    const [factorId, setFactorId] = useState(null);
    const [qrCode, setQrCode] = useState(null);
    const [secret, setSecret] = useState(null);
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [existingFactors, setExistingFactors] = useState([]);

    useEffect(() => {
        checkExistingFactors();
    }, []);

    const checkExistingFactors = async () => {
        try {
            const { data, error } = await supabase.auth.mfa.listFactors();
            if (!error) setExistingFactors(data?.totp || []);
        } catch { }
    };

    const enrollMFA = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.auth.mfa.enroll({
                factorType: 'totp',
                friendlyName: 'SafeDrive Admin Authenticator',
            });
            if (error) throw error;

            setFactorId(data.id);
            setQrCode(data.totp.qr_code);
            setSecret(data.totp.secret);
            setStep('qr');
        } catch (err) {
            toast.error(err.message || 'Failed to set up 2FA');
        } finally {
            setLoading(false);
        }
    };

    const verifyAndActivate = async () => {
        if (!code || code.length !== 6) {
            toast.error('Enter the 6-digit code from your authenticator app');
            return;
        }
        setLoading(true);
        try {
            const challenge = await supabase.auth.mfa.challenge({ factorId });
            if (challenge.error) throw challenge.error;

            const verify = await supabase.auth.mfa.verify({
                factorId,
                challengeId: challenge.data.id,
                code,
            });
            if (verify.error) throw verify.error;

            setStep('done');
            toast.success('✅ Two-factor authentication is now active!');
            if (onComplete) onComplete();
        } catch (err) {
            toast.error(err.message || 'Invalid code. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const unenrollMFA = async (id) => {
        if (!confirm('Are you sure you want to remove 2FA? This will make your account less secure.')) return;
        const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
        if (error) { toast.error(error.message); return; }
        toast.success('2FA removed');
        checkExistingFactors();
    };

    const copySecret = () => {
        navigator.clipboard.writeText(secret || '');
        toast.success('Secret key copied!');
    };

    const isEnrolled = existingFactors.some(f => f.status === 'verified');

    return (
        <div>
            {/* Status Banner */}
            <div className={`flex items-center gap-3 px-[18px] py-3.5 ${isEnrolled ? 'bg-[var(--success-50)] border-[var(--success-200)]' : 'bg-[var(--warning-50)] border-[var(--warning-200)]'} border rounded-[var(--radius-lg)] mb-5`}>
                <span className="text-2xl">{isEnrolled ? '✅' : '⚠️'}</span>
                <div>
                    <div className={`font-bold ${isEnrolled ? 'text-[var(--success-800)]' : 'text-[var(--warning-800)]'}`}>
                        {isEnrolled ? '2FA is Active' : '2FA is Not Set Up'}
                    </div>
                    <div className={`text-[13px] ${isEnrolled ? 'text-[var(--success-700)]' : 'text-[var(--warning-700)]'} mt-0.5`}>
                        {isEnrolled
                            ? 'Your admin account is protected with two-factor authentication.'
                            : 'Add an extra layer of security. Required for admin accounts.'}
                    </div>
                </div>
            </div>

            {/* Existing Enrolled Factors */}
            {isEnrolled && existingFactors.filter(f => f.status === 'verified').map(factor => (
                <div key={factor.id} className="flex justify-between items-center px-4 py-3 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] mb-3 border border-[var(--border-light)]">
                    <div className="flex gap-2.5 items-center">
                        <FiSmartphone className="text-[var(--primary-500)]" />
                        <div>
                            <div className="font-semibold text-sm">{factor.friendly_name || 'Authenticator App'}</div>
                            <div className="text-[12px] text-[var(--text-tertiary)]">
                                TOTP · Added {new Date(factor.created_at).toLocaleDateString()}
                            </div>
                        </div>
                    </div>
                    <button className="btn btn-sm bg-[var(--error-500)] text-white border-none"
                        onClick={() => unenrollMFA(factor.id)}>
                        Remove
                    </button>
                </div>
            ))}

            {/* Setup Steps */}
            {!isEnrolled && step === 'start' && (
                <div className="text-center">
                    <div className="text-[48px] mb-3">🔐</div>
                    <p className="text-[var(--text-secondary)] text-sm mb-5 leading-[1.6]">
                        Scan a QR code with Google Authenticator, Authy, or any TOTP app.
                        You'll enter the 6-digit code every time you log in as admin.
                    </p>
                    <button className="btn btn-primary w-full" onClick={enrollMFA} disabled={loading}>
                        <FiShield /> {loading ? 'Setting up...' : 'Set Up 2FA Now'}
                    </button>
                </div>
            )}

            {step === 'qr' && (
                <div>
                    <h3 className="font-bold mb-3">Step 1: Scan this QR Code</h3>
                    <p className="text-[13px] text-[var(--text-secondary)] mb-4">
                        Open Google Authenticator or Authy, tap <strong>+</strong>, and scan the QR code below.
                    </p>
                    {qrCode && (
                        <div className="text-center mb-4">
                            <img src={qrCode} alt="2FA QR Code" className="w-[180px] h-[180px] rounded-lg border-2 border-[var(--border-light)] mx-auto" />
                        </div>
                    )}
                    <div className="bg-[var(--surface-secondary)] rounded-[var(--radius-md)] px-3.5 py-2.5 mb-4">
                        <div className="text-[12px] text-[var(--text-tertiary)] mb-1">Can't scan? Enter this key manually:</div>
                        <div className="flex items-center gap-2">
                            <code className="font-mono text-[13px] flex-1 break-all">{secret}</code>
                            <button className="btn btn-ghost btn-sm" onClick={copySecret}><FiCopy /></button>
                        </div>
                    </div>

                    <h3 className="font-bold mb-2.5">Step 2: Enter the 6-digit code</h3>
                    <input
                        type="text"
                        className="form-input w-full text-[24px] text-center tracking-[6px] font-mono mb-3.5"
                        placeholder="000000"
                        maxLength={6}
                        value={code}
                        onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                        autoFocus
                    />
                    <button className="btn btn-primary w-full" onClick={verifyAndActivate} disabled={loading || code.length !== 6}>
                        {loading ? 'Verifying...' : '✅ Activate 2FA'}
                    </button>
                </div>
            )}

            {step === 'done' && (
                <div className="text-center py-5">
                    <div className="text-[56px] mb-3">🎉</div>
                    <div className="font-bold text-[18px] text-[var(--success-700)]">2FA is active!</div>
                    <div className="text-sm text-[var(--text-secondary)] mt-2">
                        Next time you log in as admin, you'll be asked for your 6-digit code.
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Admin2FAVerify
 * ==============
 * Shown after successful admin password login IF the account has 2FA enrolled.
 * Call this from AdminLogin.jsx after a successful signIn.
 */
export function Admin2FAVerify({ onSuccess, onCancel }) {
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [factorId, setFactorId] = useState(null);

    useEffect(() => {
        getFactorId();
    }, []);

    const getFactorId = async () => {
        // Must use supabaseAdmin client — admin sessions live there
        const { data } = await supabaseAdmin.auth.mfa.listFactors();
        const verified = data?.totp?.find(f => f.status === 'verified');
        if (verified) {
            setFactorId(verified.id);
        } else {
            // No 2FA enrolled — auto-bypass after a short delay
            // The delay lets the AuthContext profile fetch finish settling
            // before we navigate to /admin, avoiding the double-login bounce.
            setTimeout(() => {
                if (onSuccess) onSuccess();
            }, 300);
        }
    };

    const verify = async () => {
        if (!code || code.length !== 6) { toast.error('Enter the 6-digit code'); return; }
        if (!factorId) { toast.error('No 2FA method found'); return; }

        setLoading(true);
        try {
            const challenge = await supabase.auth.mfa.challenge({ factorId });
            if (challenge.error) throw challenge.error;

            const result = await supabase.auth.mfa.verify({
                factorId,
                challengeId: challenge.data.id,
                code,
            });
            if (result.error) throw result.error;

            toast.success('2FA verified ✅');
            if (onSuccess) onSuccess();
        } catch (err) {
            toast.error('Invalid code. Please try again.');
            setCode('');
        } finally {
            setLoading(false);
        }
    };

    if (!factorId) return <div className="loading-spinner"><div className="spinner" /></div>;

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--surface-secondary)]">
            <div className="bg-[var(--surface-primary)] rounded-[var(--radius-xl)] px-10 py-12 w-full max-w-[400px] border border-[var(--border-light)] text-center">
                <div className="text-[52px] mb-2">🔐</div>
                <h2 className="font-extrabold text-[22px] mb-2">Admin 2FA Verification</h2>
                <p className="text-sm text-[var(--text-secondary)] mb-7 leading-[1.6]">
                    Open your authenticator app and enter the 6-digit code for SafeDrive Admin.
                </p>
                <input
                    type="text"
                    className="form-input w-full text-[28px] text-center tracking-[10px] font-mono mb-4"
                    placeholder="000000"
                    maxLength={6}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && verify()}
                />
                <button className="btn btn-primary w-full mb-2.5 text-base" onClick={verify} disabled={loading || code.length !== 6}>
                    {loading ? 'Verifying...' : 'Verify & Enter Admin Panel'}
                </button>
                <button className="btn btn-ghost w-full text-[13px]" onClick={onCancel}>
                    Cancel — Back to Login
                </button>
                <div className="mt-5 text-[12px] text-[var(--text-tertiary)]">
                    Lost access to your authenticator app? Contact the system owner.
                </div>
            </div>
        </div>
    );
}
