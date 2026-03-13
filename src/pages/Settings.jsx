import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiBell, FiChevronRight, FiLock, FiLogOut, FiShield, FiTrash2, FiUser } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';
import { Admin2FASetup } from '../components/Admin2FA';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { badgeClass, cx, ui } from '../lib/ui';

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cx(
        'relative h-7 w-12 rounded-full transition',
        checked ? 'bg-primary-600' : 'bg-neutral-300'
      )}
      aria-pressed={checked}
    >
      <span
        className={cx(
          'absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition',
          checked ? 'left-6' : 'left-1'
        )}
      />
    </button>
  );
}

function SettingsRow({ title, description, action, danger = false, onClick, clickable = false }) {
  const body = (
    <div
      className={cx(
        'flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6',
        clickable && 'transition hover:bg-primary-50/40'
      )}
    >
      <div className="space-y-1">
        <h3 className={cx('text-sm font-semibold', danger ? 'text-error-700' : 'text-text-primary')}>{title}</h3>
        <p className="text-sm leading-6 text-text-secondary">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );

  if (clickable) {
    return (
      <button type="button" onClick={onClick} className="w-full border-b border-border-light text-left last:border-b-0">
        {body}
      </button>
    );
  }

  return <div className="border-b border-border-light last:border-b-0">{body}</div>;
}

export default function Settings() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [prefs, setPrefs] = useState({
    emailNotifications: true,
    bookingAlerts: true,
    promotions: false,
    smsAlerts: true,
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const toggle = (key) => setPrefs((previous) => ({ ...previous, [key]: !previous[key] }));

  const handlePasswordChange = async (event) => {
    event.preventDefault();

    if (!newPassword || newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        throw error;
      }

      toast.success('Password updated successfully');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSendResetEmail = async () => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user?.email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });

      if (error) {
        throw error;
      }

      toast.success('Password reset email sent');
    } catch (err) {
      toast.error(err.message || 'Failed to send reset email');
    }
  };

  return (
    <div className={ui.pageCompact}>
      <BackButton />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Preferences</p>
        <h1 className={ui.pageTitle}>Settings</h1>
        <p className={ui.pageDescription}>
          Manage account access, notifications, privacy, and security from one place.
        </p>
      </div>

      <section className={ui.section}>
        <div className={ui.sectionHeader}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <FiUser />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Account</h2>
              <p className="text-sm text-text-secondary">Profile basics and account role</p>
            </div>
          </div>
        </div>

        <SettingsRow
          title="Edit profile"
          description="Update your personal information, identity details, and verification documents."
          clickable
          onClick={() => navigate('/profile')}
          action={<FiChevronRight className="text-lg text-text-tertiary" />}
        />

        <SettingsRow
          title="Email address"
          description={user?.email || 'No email available'}
          action={<span className={badgeClass('success')}>Verified</span>}
        />

        <SettingsRow
          title="Account role"
          description={
            profile?.role === 'verified'
              ? 'Verified user with renting and listing access.'
              : profile?.role === 'admin'
                ? 'Administrator access enabled.'
                : 'Standard user. Complete verification to unlock listing features.'
          }
          action={
            <span className={badgeClass(profile?.role === 'admin' ? 'error' : profile?.role === 'verified' ? 'success' : 'info')}>
              {profile?.role === 'user' ? 'Not verified' : profile?.role || 'User'}
            </span>
          }
        />
      </section>

      <section className={ui.section}>
        <div className={ui.sectionHeader}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <FiLock />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Password and security</h2>
              <p className="text-sm text-text-secondary">Keep your account locked down</p>
            </div>
          </div>
        </div>

        <div className={ui.sectionBody}>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className={ui.label}>New password</label>
              <input
                type="password"
                className={ui.input}
                placeholder="Enter a new password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>

            <div>
              <label className={ui.label}>Confirm new password</label>
              <input
                type="password"
                className={ui.input}
                placeholder="Re-enter your new password"
                value={confirmNewPassword}
                onChange={(event) => setConfirmNewPassword(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="submit" className={ui.button.primary} disabled={passwordLoading}>
                {passwordLoading ? 'Updating...' : 'Update password'}
              </button>
              <button type="button" className={ui.button.ghost} onClick={handleSendResetEmail}>
                Send reset email instead
              </button>
            </div>
          </form>
        </div>
      </section>

      {profile?.role === 'admin' && (
        <section className={ui.section}>
          <div className={ui.sectionHeader}>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <FiShield />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Admin two-factor authentication</h2>
                <p className="text-sm text-text-secondary">Required for admin access</p>
              </div>
            </div>
          </div>

          <div className={ui.sectionBody}>
            <Admin2FASetup />
          </div>
        </section>
      )}

      <section className={ui.section}>
        <div className={ui.sectionHeader}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <FiBell />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Notifications</h2>
              <p className="text-sm text-text-secondary">Choose what reaches you</p>
            </div>
          </div>
        </div>

        {[
          {
            key: 'emailNotifications',
            label: 'Email notifications',
            desc: 'Receive booking updates and important alerts by email.',
          },
          {
            key: 'bookingAlerts',
            label: 'Booking alerts',
            desc: 'Get notified when someone requests, updates, or cancels a booking.',
          },
          {
            key: 'smsAlerts',
            label: 'SMS alerts',
            desc: 'Use text messages for urgent booking events.',
          },
          {
            key: 'promotions',
            label: 'Promotions and updates',
            desc: 'Occasional SafeDrive product updates and offers.',
          },
        ].map(({ key, label, desc }) => (
          <SettingsRow
            key={key}
            title={label}
            description={desc}
            action={<Toggle checked={prefs[key]} onChange={() => toggle(key)} />}
          />
        ))}
      </section>

      <section className={ui.section}>
        <div className={ui.sectionHeader}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <FiShield />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Privacy</h2>
              <p className="text-sm text-text-secondary">Export and deletion controls</p>
            </div>
          </div>
        </div>

        <SettingsRow
          title="Data export"
          description="Request a copy of your personal data under RA 10173 portability rights."
          action={
            <button
              type="button"
              className={cx(ui.button.secondary, ui.button.sm)}
              onClick={() =>
                toast.success('Data export requested. You will receive an email within 48 hours.')
              }
            >
              Request export
            </button>
          }
        />

        <SettingsRow
          title="Delete account"
          description="Permanently remove your account and associated data."
          danger
          action={
            <button
              type="button"
              className={cx(ui.button.danger, ui.button.sm)}
              onClick={() => setShowDeleteConfirm(true)}
            >
              <FiTrash2 />
              Delete
            </button>
          }
        />
      </section>

      <button
        type="button"
        className={cx(ui.button.secondary, 'w-full justify-center')}
        onClick={async () => {
          const wasAdmin = profile?.role === 'admin';
          await signOut();
          navigate(wasAdmin ? '/admin-login' : '/', { replace: true });
        }}
      >
        <FiLogOut />
        Sign out of SafeDrive
      </button>

      {showDeleteConfirm && (
        <div className={ui.modalOverlay}>
          <div className={cx(ui.modalPanel, 'max-w-lg')} onClick={(event) => event.stopPropagation()}>
            <div className={ui.sectionHeader}>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Delete account?</h2>
                <p className="text-sm text-text-secondary">
                  This cannot be undone. We keep support involved for safety and recovery reasons.
                </p>
              </div>
            </div>

            <div className={ui.sectionBody}>
              <p className="text-sm leading-6 text-text-secondary">
                Bookings, vehicles, and reviews connected to your account would be permanently removed. Use this only when you are sure.
              </p>
            </div>

            <div className="flex flex-col gap-3 border-t border-border-light px-5 py-4 sm:flex-row sm:px-6">
              <button
                type="button"
                className={cx(ui.button.secondary, 'sm:flex-1')}
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cx(ui.button.danger, 'sm:flex-1')}
                disabled={deleteLoading}
                onClick={async () => {
                  setDeleteLoading(true);
                  toast.error('Account deletion requires contacting support at support@safedrive.ph');
                  setDeleteLoading(false);
                  setShowDeleteConfirm(false);
                }}
              >
                {deleteLoading ? 'Deleting...' : 'Continue with deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
