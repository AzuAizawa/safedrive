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
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 18px',
                background: isEnrolled ? 'var(--success-50)' : 'var(--warning-50)',
                border: `1px solid ${isEnrolled ? 'var(--success-200)' : 'var(--warning-200)'}`,
                borderRadius: 'var(--radius-lg)',
                marginBottom: 20,
            }}>
                <span style={{ fontSize: 24 }}>{isEnrolled ? '✅' : '⚠️'}</span>
                <div>
                    <div style={{ fontWeight: 700, color: isEnrolled ? 'var(--success-800)' : 'var(--warning-800)' }}>
                        {isEnrolled ? '2FA is Active' : '2FA is Not Set Up'}
                    </div>
                    <div style={{ fontSize: 13, color: isEnrolled ? 'var(--success-700)' : 'var(--warning-700)', marginTop: 2 }}>
                        {isEnrolled
                            ? 'Your admin account is protected with two-factor authentication.'
                            : 'Add an extra layer of security. Required for admin accounts.'}
                    </div>
                </div>
            </div>

            {/* Existing Enrolled Factors */}
            {isEnrolled && existingFactors.filter(f => f.status === 'verified').map(factor => (
                <div key={factor.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 16px', background: 'var(--surface-secondary)',
                    borderRadius: 'var(--radius-md)', marginBottom: 12,
                    border: '1px solid var(--border-light)',
                }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <FiSmartphone style={{ color: 'var(--primary-500)' }} />
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{factor.friendly_name || 'Authenticator App'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                TOTP · Added {new Date(factor.created_at).toLocaleDateString()}
                            </div>
                        </div>
                    </div>
                    <button className="btn btn-sm" style={{ background: 'var(--error-500)', color: '#fff', border: 'none' }}
                        onClick={() => unenrollMFA(factor.id)}>
                        Remove
                    </button>
                </div>
            ))}

            {/* Setup Steps */}
            {!isEnrolled && step === 'start' && (
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🔐</div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
                        Scan a QR code with Google Authenticator, Authy, or any TOTP app.
                        You'll enter the 6-digit code every time you log in as admin.
                    </p>
                    <button className="btn btn-primary" onClick={enrollMFA} disabled={loading} style={{ width: '100%' }}>
                        <FiShield /> {loading ? 'Setting up...' : 'Set Up 2FA Now'}
                    </button>
                </div>
            )}

            {step === 'qr' && (
                <div>
                    <h3 style={{ fontWeight: 700, marginBottom: 12 }}>Step 1: Scan this QR Code</h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                        Open Google Authenticator or Authy, tap <strong>+</strong>, and scan the QR code below.
                    </p>
                    {qrCode && (
                        <div style={{ textAlign: 'center', marginBottom: 16 }}>
                            <img src={qrCode} alt="2FA QR Code" style={{ width: 180, height: 180, borderRadius: 8, border: '2px solid var(--border-light)' }} />
                        </div>
                    )}
                    <div style={{ background: 'var(--surface-secondary)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Can't scan? Enter this key manually:</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <code style={{ fontFamily: 'monospace', fontSize: 13, flex: 1, wordBreak: 'break-all' }}>{secret}</code>
                            <button className="btn btn-ghost btn-sm" onClick={copySecret}><FiCopy /></button>
                        </div>
                    </div>

                    <h3 style={{ fontWeight: 700, marginBottom: 10 }}>Step 2: Enter the 6-digit code</h3>
                    <input
                        type="text"
                        className="form-input"
                        style={{ width: '100%', fontSize: 24, textAlign: 'center', letterSpacing: 6, fontFamily: 'monospace', marginBottom: 14 }}
                        placeholder="000000"
                        maxLength={6}
                        value={code}
                        onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                        autoFocus
                    />
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={verifyAndActivate} disabled={loading || code.length !== 6}>
                        {loading ? 'Verifying...' : '✅ Activate 2FA'}
                    </button>
                </div>
            )}

            {step === 'done' && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
                    <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--success-700)' }}>2FA is active!</div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 }}>
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
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-secondary)',
        }}>
            <div style={{
                background: 'var(--surface-primary)',
                borderRadius: 'var(--radius-xl)',
                padding: '48px 40px',
                width: '100%', maxWidth: 400,
                border: '1px solid var(--border-light)',
                textAlign: 'center',
            }}>
                <div style={{ fontSize: 52, marginBottom: 8 }}>🔐</div>
                <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Admin 2FA Verification</h2>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 28, lineHeight: 1.6 }}>
                    Open your authenticator app and enter the 6-digit code for SafeDrive Admin.
                </p>
                <input
                    type="text"
                    className="form-input"
                    style={{ width: '100%', fontSize: 28, textAlign: 'center', letterSpacing: 10, fontFamily: 'monospace', marginBottom: 16 }}
                    placeholder="000000"
                    maxLength={6}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && verify()}
                />
                <button className="btn btn-primary" style={{ width: '100%', marginBottom: 10, fontSize: 16 }} onClick={verify} disabled={loading || code.length !== 6}>
                    {loading ? 'Verifying...' : 'Verify & Enter Admin Panel'}
                </button>
                <button className="btn btn-ghost" style={{ width: '100%', fontSize: 13 }} onClick={onCancel}>
                    Cancel — Back to Login
                </button>
                <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Lost access to your authenticator app? Contact the system owner.
                </div>
            </div>
        </div>
    );
}
