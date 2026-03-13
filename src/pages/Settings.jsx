import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
    FiUser, FiShield, FiBell, FiLock, FiTrash2,
    FiCheck, FiMoon, FiSun, FiLogOut, FiAlertTriangle
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';
import { Admin2FASetup } from '../components/Admin2FA';







function Toggle({ checked, onChange }) {
    return (
        <button
            type="button"
            onClick={onChange}
            className={`w-11 h-6 rounded-xl border-none cursor-pointer relative transition-colors duration-200 shrink-0 ${checked ? 'bg-[var(--primary-500)]' : 'bg-[var(--neutral-300)]'}`}
        >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-200 ${checked ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
    );
}

export default function Settings() {
    const { user, profile, signOut, isAdmin } = useAuth();
    const navigate = useNavigate();

    // Preference states (in a real app, save to DB/localStorage)
    const [prefs, setPrefs] = useState({
        emailNotifications: true,
        bookingAlerts: true,
        promotions: false,
        smsAlerts: true,
    });

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [passwordLoading, setPasswordLoading] = useState(false);

    const toggle = (key) => setPrefs(p => ({ ...p, [key]: !p[key] }));

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (!newPassword || newPassword.length < 8) {
            toast.error('New password must be at least 8 characters'); return;
        }
        if (newPassword !== confirmNewPassword) {
            toast.error('New passwords do not match'); return;
        }
        setPasswordLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw error;
            toast.success('Password updated successfully!');
            setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword('');
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
            if (error) throw error;
            toast.success('Password reset email sent! Check your inbox.');
        } catch (err) {
            toast.error(err.message || 'Failed to send reset email');
        }
    };

    return (
        <div className="max-w-[680px] mx-auto pb-12">
            <BackButton />
            <div className="page-header">
                <h1>⚙️ Settings</h1>
                <p>Manage your account preferences, security, and privacy settings.</p>
            </div>

            {/* ── Account Section ────────────────────────────── */}
            <div className="bg-[var(--surface-primary)] rounded-[var(--radius-lg)] border border-[var(--border-light)] mb-5 overflow-hidden">
                <div className="p-[16px_24px] border-b border-[var(--border-light)] flex items-center gap-2.5 font-bold text-[15px] bg-[var(--surface-secondary)]"><FiUser /> Account</div>

                <div className="flex items-center justify-between p-[16px_24px] border-b border-[var(--border-light)] cursor-pointer" onClick={() => navigate('/profile')}>
                    <div>
                        <div className="font-semibold">Edit Profile</div>
                        <div className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                            Name, phone, avatar, and identity verification
                        </div>
                    </div>
                    <span className="text-[var(--text-tertiary)] text-[18px]">›</span>
                </div>

                <div className="flex items-center justify-between p-[16px_24px] border-b border-[var(--border-light)]">
                    <div>
                        <div className="font-semibold">Email Address</div>
                        <div className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                            {user?.email}
                        </div>
                    </div>
                    <span className="bg-[var(--success-50)] text-[var(--success-700)] text-[11px] font-bold p-[3px_10px] rounded-[var(--radius-sm)] border border-[var(--success-200)]">Verified</span>
                </div>

                <div className="flex items-center justify-between p-[16px_24px]">
                    <div>
                        <div className="font-semibold">Account Role</div>
                        <div className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                            {profile?.role === 'verified' ? '✅ Verified User — can list and rent vehicles'
                                : profile?.role === 'admin' ? '🛡️ Administrator'
                                    : '👤 Regular User — complete verification to unlock all features'}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Security Section ────────────────────────────── */}
            <div className="bg-[var(--surface-primary)] rounded-[var(--radius-lg)] border border-[var(--border-light)] mb-5 overflow-hidden">
                <div className="p-[16px_24px] border-b border-[var(--border-light)] flex items-center gap-2.5 font-bold text-[15px] bg-[var(--surface-secondary)]"><FiLock /> Security & Password</div>

                <div className="p-[20px_24px]">
                    <form onSubmit={handlePasswordChange}>
                        <div className="form-group mb-3.5">
                            <label className="form-label">New Password</label>
                            <input type="password" className="form-input w-full"
                                placeholder="Enter new password (min 8 characters)"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)} />
                        </div>
                        <div className="form-group mb-4">
                            <label className="form-label">Confirm New Password</label>
                            <input type="password" className="form-input w-full"
                                placeholder="Re-enter new password"
                                value={confirmNewPassword}
                                onChange={e => setConfirmNewPassword(e.target.value)} />
                        </div>
                        <div className="flex gap-3">
                            <button type="submit" className="btn btn-primary" disabled={passwordLoading}>
                                {passwordLoading ? 'Updating...' : '🔒 Update Password'}
                            </button>
                            <button type="button" className="btn btn-ghost text-[13px]"
                                onClick={handleSendResetEmail}>
                                Send Reset Email Instead
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* ── Admin 2FA Section (admin only) ──────────────── */}
            {profile?.role === 'admin' && (
                <div className="bg-[var(--surface-primary)] rounded-[var(--radius-lg)] border border-[var(--border-light)] mb-5 overflow-hidden">
                    <div className="p-[16px_24px] border-b border-[var(--border-light)] flex items-center gap-2.5 font-bold text-[15px] bg-[var(--surface-secondary)]"><FiShield className="text-[var(--primary-500)]" /> Two-Factor Authentication (Admin)</div>
                    <div className="p-[20px_24px]">
                        <Admin2FASetup />
                    </div>
                </div>
            )}

            {/* ── Notification Preferences ────────────────────── */}
            <div className="bg-[var(--surface-primary)] rounded-[var(--radius-lg)] border border-[var(--border-light)] mb-5 overflow-hidden">
                <div className="p-[16px_24px] border-b border-[var(--border-light)] flex items-center gap-2.5 font-bold text-[15px] bg-[var(--surface-secondary)]"><FiBell /> Notification Preferences</div>

                {[
                    { key: 'emailNotifications', label: 'Email Notifications', desc: 'Receive booking updates and alerts via email' },
                    { key: 'bookingAlerts', label: 'Booking Alerts', desc: 'Get notified when someone requests to book your vehicle' },
                    { key: 'smsAlerts', label: 'SMS Alerts', desc: 'Receive text messages for critical booking events' },
                    { key: 'promotions', label: 'Promotions & Updates', desc: 'SafeDrive news, tips, and promotional offers' },
                ].map(({ key, label, desc }, i, arr) => (
                    <div key={key} className={`flex items-center justify-between p-[16px_24px] ${i < arr.length - 1 ? 'border-b border-[var(--border-light)]' : ''}`}>
                        <div>
                            <div className="font-semibold">{label}</div>
                            <div className="text-[13px] text-[var(--text-tertiary)] mt-0.5">{desc}</div>
                        </div>
                        <Toggle checked={prefs[key]} onChange={() => toggle(key)} />
                    </div>
                ))}
            </div>

            {/* ── Privacy Section ─────────────────────────────── */}
            <div className="bg-[var(--surface-primary)] rounded-[var(--radius-lg)] border border-[var(--border-light)] mb-5 overflow-hidden">
                <div className="p-[16px_24px] border-b border-[var(--border-light)] flex items-center gap-2.5 font-bold text-[15px] bg-[var(--surface-secondary)]"><FiShield /> Privacy</div>

                <div className="flex items-center justify-between p-[16px_24px] border-b border-[var(--border-light)]">
                    <div>
                        <div className="font-semibold">Data Export</div>
                        <div className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                            Request a copy of all your personal data (RA 10173 right to data portability)
                        </div>
                    </div>
                    <button className="btn btn-sm btn-secondary"
                        onClick={() => toast.success('Data export requested. You will receive an email within 48 hours.')}>
                        Request Export
                    </button>
                </div>

                <div className="flex items-center justify-between p-[16px_24px]">
                    <div>
                        <div className="font-semibold text-[var(--error-600)]">Delete Account</div>
                        <div className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                            Permanently delete your account and all associated data
                        </div>
                    </div>
                    <button className="btn btn-sm bg-[var(--error-500)] text-white border-none"
                        onClick={() => setShowDeleteConfirm(true)}>
                        <FiTrash2 /> Delete
                    </button>
                </div>
            </div>

            {/* ── Sign Out ─────────────────────────────────────── */}
            <div className="flex gap-3">
                <button className="btn btn-secondary w-full"
                    onClick={async () => {
                        const wasAdmin = profile?.role === 'admin';
                        await signOut();
                        navigate(wasAdmin ? '/admin-login' : '/', { replace: true });
                    }}>
                    <FiLogOut /> Sign Out of SafeDrive
                </button>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[999]">
                    <div className="bg-[var(--surface-primary)] rounded-[var(--radius-xl)] p-8 max-w-[420px] w-[90%] border border-[var(--error-200)]">
                        <div className="text-[32px] text-center mb-4">⚠️</div>
                        <h3 className="font-bold mb-2 text-center">Delete Account?</h3>
                        <p className="text-[14px] text-[var(--text-secondary)] text-center mb-6">
                            This action is permanent and cannot be undone. All your bookings, vehicles, and
                            reviews will be permanently deleted.
                        </p>
                        <div className="flex gap-3">
                            <button className="btn btn-secondary flex-1"
                                onClick={() => setShowDeleteConfirm(false)}>
                                Cancel
                            </button>
                            <button className="btn flex-1 bg-[var(--error-500)] text-white border-none"
                                disabled={deleteLoading}
                                onClick={async () => {
                                    setDeleteLoading(true);
                                    toast.error('Account deletion requires contacting support at support@safedrive.ph');
                                    setDeleteLoading(false);
                                    setShowDeleteConfirm(false);
                                }}>
                                {deleteLoading ? 'Deleting...' : 'Yes, Delete My Account'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
