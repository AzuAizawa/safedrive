import { useEffect, useState } from 'react';
import { FiCheck, FiCopy, FiShield, FiSmartphone } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { supabase, supabaseAdmin } from '../lib/supabase';
import { cx, ui } from '../lib/ui';

function StatusCard({ enrolled }) {
  return (
    <div
      className={cx(
        'flex items-start gap-4 rounded-3xl border px-5 py-4',
        enrolled
          ? 'border-success-200 bg-success-50 text-success-700'
          : 'border-warning-200 bg-warning-50 text-warning-700'
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 text-lg shadow-xs">
        {enrolled ? <FiCheck /> : <FiShield />}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-text-primary">
          {enrolled ? 'Two-factor authentication is active' : 'Two-factor authentication is not set up'}
        </h3>
        <p className="text-sm leading-6">
          {enrolled
            ? 'Your admin account is protected with a TOTP authenticator app.'
            : 'Add an authenticator app to protect admin logins with a second verification step.'}
        </p>
      </div>
    </div>
  );
}

export function Admin2FASetup({ onComplete }) {
  const { user } = useAuth();
  const [step, setStep] = useState('start');
  const [factorId, setFactorId] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [existingFactors, setExistingFactors] = useState([]);

  useEffect(() => {
    if (user) {
      checkExistingFactors();
    }
  }, [user]);

  const checkExistingFactors = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (!error) {
        setExistingFactors(data?.totp || []);
      }
    } catch {
      setExistingFactors([]);
    }
  };

  const enrollMFA = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'SafeDrive Admin Authenticator',
      });

      if (error) {
        throw error;
      }

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
    if (code.length !== 6) {
      toast.error('Enter the 6-digit code from your authenticator app');
      return;
    }

    setLoading(true);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) {
        throw challenge.error;
      }

      const verify = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code,
      });

      if (verify.error) {
        throw verify.error;
      }

      setStep('done');
      toast.success('Two-factor authentication is now active');
      if (onComplete) {
        onComplete();
      }
      await checkExistingFactors();
    } catch (err) {
      toast.error(err.message || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const unenrollMFA = async (id) => {
    if (!window.confirm('Remove 2FA from this admin account?')) {
      return;
    }

    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success('2FA removed');
    setStep('start');
    setFactorId(null);
    setQrCode(null);
    setSecret(null);
    setCode('');
    checkExistingFactors();
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret || '');
      toast.success('Secret key copied');
    } catch {
      toast.error('Unable to copy secret key');
    }
  };

  const isEnrolled = existingFactors.some((factor) => factor.status === 'verified');

  return (
    <div className="space-y-5">
      <StatusCard enrolled={isEnrolled} />

      {isEnrolled &&
        existingFactors
          .filter((factor) => factor.status === 'verified')
          .map((factor) => (
            <div
              key={factor.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border-light bg-surface-secondary px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                  <FiSmartphone />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    {factor.friendly_name || 'Authenticator app'}
                  </p>
                  <p className="text-sm text-text-secondary">
                    Added {new Date(factor.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className={cx(ui.button.danger, ui.button.sm)}
                onClick={() => unenrollMFA(factor.id)}
              >
                Remove
              </button>
            </div>
          ))}

      {!isEnrolled && step === 'start' && (
        <div className="rounded-3xl border border-border-light bg-surface-primary px-6 py-8 text-center shadow-soft">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-2xl text-primary-700">
            <FiShield />
          </div>
          <h3 className="text-xl font-semibold text-text-primary">Set up admin 2FA</h3>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-text-secondary">
            Use Google Authenticator, Authy, 1Password, or another TOTP app. You will enter a 6-digit code after every admin password login.
          </p>
          <button
            type="button"
            className={cx(ui.button.primary, 'mt-6 w-full sm:w-auto')}
            onClick={enrollMFA}
            disabled={loading}
          >
            {loading ? 'Setting up...' : 'Set up 2FA now'}
          </button>
        </div>
      )}

      {step === 'qr' && (
        <div className="space-y-5 rounded-3xl border border-border-light bg-surface-primary px-6 py-6 shadow-soft">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-text-primary">Scan the QR code</h3>
            <p className="text-sm leading-6 text-text-secondary">
              Open your authenticator app, add a new account, and scan this QR code.
            </p>
          </div>

          {qrCode && (
            <div className="flex justify-center rounded-3xl border border-border-light bg-surface-secondary p-5">
              <img
                src={qrCode}
                alt="Two-factor authentication QR code"
                className="h-48 w-48 rounded-2xl border border-border-light bg-white p-3"
              />
            </div>
          )}

          <div className="rounded-3xl border border-border-light bg-surface-secondary px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Manual setup key
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <code className="flex-1 break-all rounded-2xl bg-surface-primary px-4 py-3 font-mono text-sm text-text-primary">
                {secret}
              </code>
              <button
                type="button"
                className={cx(ui.button.secondary, ui.button.sm)}
                onClick={copySecret}
              >
                <FiCopy />
                Copy
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className={ui.label}>Enter the 6-digit code</label>
            <input
              type="text"
              className={cx(ui.input, 'text-center font-mono text-2xl tracking-[0.4em]')}
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </div>

          <button
            type="button"
            className={cx(ui.button.primary, 'w-full')}
            onClick={verifyAndActivate}
            disabled={loading || code.length !== 6}
          >
            {loading ? 'Verifying...' : 'Activate 2FA'}
          </button>
        </div>
      )}

      {step === 'done' && (
        <div className="rounded-3xl border border-success-200 bg-success-50 px-6 py-8 text-center shadow-soft">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl text-success-700 shadow-xs">
            <FiCheck />
          </div>
          <h3 className="text-xl font-semibold text-text-primary">2FA is active</h3>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Future admin logins will require the 6-digit code from your authenticator app.
          </p>
        </div>
      )}
    </div>
  );
}

export function Admin2FAVerify({ onSuccess, onCancel }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [factorId, setFactorId] = useState(null);

  useEffect(() => {
    getFactorId();
  }, []);

  const getFactorId = async () => {
    const { data } = await supabaseAdmin.auth.mfa.listFactors();
    const verified = data?.totp?.find((factor) => factor.status === 'verified');

    if (verified) {
      setFactorId(verified.id);
      return;
    }

    setTimeout(() => {
      if (onSuccess) {
        onSuccess();
      }
    }, 300);
  };

  const verify = async () => {
    if (code.length !== 6) {
      toast.error('Enter the 6-digit code');
      return;
    }

    if (!factorId) {
      toast.error('No 2FA method found');
      return;
    }

    setLoading(true);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) {
        throw challenge.error;
      }

      const result = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code,
      });

      if (result.error) {
        throw result.error;
      }

      toast.success('2FA verified');
      if (onSuccess) {
        onSuccess();
      }
    } catch {
      toast.error('Invalid code. Please try again.');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  if (!factorId) {
    return (
      <div className="min-h-screen bg-surface-secondary px-4 py-10">
        <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center">
          <div className={ui.loadingScreen}>
            <div className={ui.spinner} />
            <p className="text-sm font-medium text-text-secondary">Preparing admin verification...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-secondary px-4 py-10">
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center">
        <div className="w-full rounded-[32px] border border-border-light bg-surface-primary px-7 py-8 text-center shadow-float">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-2xl text-primary-700">
            <FiShield />
          </div>
          <h2 className="mt-5 font-display text-2xl font-semibold text-text-primary">Admin 2FA verification</h2>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Open your authenticator app and enter the 6-digit code for SafeDrive Admin.
          </p>

          <input
            type="text"
            className={cx(ui.input, 'mt-6 text-center font-mono text-3xl tracking-[0.5em]')}
            placeholder="000000"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                verify();
              }
            }}
          />

          <button
            type="button"
            className={cx(ui.button.primary, 'mt-4 w-full')}
            onClick={verify}
            disabled={loading || code.length !== 6}
          >
            {loading ? 'Verifying...' : 'Verify and enter admin panel'}
          </button>

          <button
            type="button"
            className={cx(ui.button.ghost, 'mt-3 w-full')}
            onClick={onCancel}
          >
            Cancel and go back
          </button>

          <p className="mt-5 text-xs leading-5 text-text-tertiary">
            Lost access to your authenticator app? Contact the system owner to reset admin MFA.
          </p>
        </div>
      </div>
    </div>
  );
}
