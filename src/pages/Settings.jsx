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

const SECTION_STYLE = {
    background: 'var(--surface-primary)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border-light)',
    marginBottom: 20,
    overflow: 'hidden',
};

const HEADER_STYLE = {
    padding: '16px 24px',
    borderBottom: '1px solid var(--border-light)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontWeight: 700,
    fontSize: 15,
    background: 'var(--surface-secondary)',
};

const ITEM_STYLE = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderBottom: '1px solid var(--border-light)',
};

function Toggle({ checked, onChange }) {
    return (
        <button
            type="button"
            onClick={onChange}
            style={{
                width: 44, height: 24, borderRadius: 12, border: 'none',
                background: checked ? 'var(--primary-500)' : 'var(--neutral-300)',
                cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                flexShrink: 0,
            }}
        >
            <span style={{
                position: 'absolute', top: 2,
                left: checked ? 22 : 2,
                width: 20, height: 20, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
            }} />
        </button>
    );
}

export default function Settings() {
    const { user, profile, signOut } = useAuth();
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
        <div style={{ maxWidth: 680, margin: '0 auto', paddingBottom: 48 }}>
            <BackButton />
            <div className="page-header">
                <h1>⚙️ Settings</h1>
                <p>Manage your account preferences, security, and privacy settings.</p>
            </div>

            {/* ── Account Section ────────────────────────────── */}
            <div style={SECTION_STYLE}>
                <div style={HEADER_STYLE}><FiUser /> Account</div>

                <div style={{ ...ITEM_STYLE, cursor: 'pointer' }} onClick={() => navigate('/profile')}>
                    <div>
                        <div style={{ fontWeight: 600 }}>Edit Profile</div>
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            Name, phone, avatar, and identity verification
                        </div>
                    </div>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 18 }}>›</span>
                </div>

                <div style={{ ...ITEM_STYLE }}>
                    <div>
                        <div style={{ fontWeight: 600 }}>Email Address</div>
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            {user?.email}
                        </div>
                    </div>
                    <span style={{
                        background: 'var(--success-50)', color: 'var(--success-700)',
                        fontSize: 11, fontWeight: 700, padding: '3px 10px',
                        borderRadius: 'var(--radius-sm)', border: '1px solid var(--success-200)',
                    }}>Verified</span>
                </div>

                <div style={{ ...ITEM_STYLE, borderBottom: 'none' }}>
                    <div>
                        <div style={{ fontWeight: 600 }}>Account Role</div>
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            {profile?.role === 'verified' ? '✅ Verified User — can list and rent vehicles'
                                : profile?.role === 'admin' ? '🛡️ Administrator'
                                    : '👤 Regular User — complete verification to unlock all features'}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Security Section ────────────────────────────── */}
            <div style={SECTION_STYLE}>
                <div style={HEADER_STYLE}><FiLock /> Security & Password</div>

                <div style={{ padding: '20px 24px' }}>
                    <form onSubmit={handlePasswordChange}>
                        <div className="form-group" style={{ marginBottom: 14 }}>
                            <label className="form-label">New Password</label>
                            <input type="password" className="form-input" style={{ width: '100%' }}
                                placeholder="Enter new password (min 8 characters)"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">Confirm New Password</label>
                            <input type="password" className="form-input" style={{ width: '100%' }}
                                placeholder="Re-enter new password"
                                value={confirmNewPassword}
                                onChange={e => setConfirmNewPassword(e.target.value)} />
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button type="submit" className="btn btn-primary" disabled={passwordLoading}>
                                {passwordLoading ? 'Updating...' : '🔒 Update Password'}
                            </button>
                            <button type="button" className="btn btn-ghost"
                                onClick={handleSendResetEmail} style={{ fontSize: 13 }}>
                                Send Reset Email Instead
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* ── Notification Preferences ────────────────────── */}
            <div style={SECTION_STYLE}>
                <div style={HEADER_STYLE}><FiBell /> Notification Preferences</div>

                {[
                    { key: 'emailNotifications', label: 'Email Notifications', desc: 'Receive booking updates and alerts via email' },
                    { key: 'bookingAlerts', label: 'Booking Alerts', desc: 'Get notified when someone requests to book your vehicle' },
                    { key: 'smsAlerts', label: 'SMS Alerts', desc: 'Receive text messages for critical booking events' },
                    { key: 'promotions', label: 'Promotions & Updates', desc: 'SafeDrive news, tips, and promotional offers' },
                ].map(({ key, label, desc }, i, arr) => (
                    <div key={key} style={{ ...ITEM_STYLE, borderBottom: i < arr.length - 1 ? undefined : 'none' }}>
                        <div>
                            <div style={{ fontWeight: 600 }}>{label}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>{desc}</div>
                        </div>
                        <Toggle checked={prefs[key]} onChange={() => toggle(key)} />
                    </div>
                ))}
            </div>

            {/* ── Privacy Section ─────────────────────────────── */}
            <div style={SECTION_STYLE}>
                <div style={HEADER_STYLE}><FiShield /> Privacy</div>

                <div style={ITEM_STYLE}>
                    <div>
                        <div style={{ fontWeight: 600 }}>Data Export</div>
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            Request a copy of all your personal data (RA 10173 right to data portability)
                        </div>
                    </div>
                    <button className="btn btn-sm btn-secondary"
                        onClick={() => toast.success('Data export requested. You will receive an email within 48 hours.')}>
                        Request Export
                    </button>
                </div>

                <div style={{ ...ITEM_STYLE, borderBottom: 'none' }}>
                    <div>
                        <div style={{ fontWeight: 600, color: 'var(--error-600)' }}>Delete Account</div>
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            Permanently delete your account and all associated data
                        </div>
                    </div>
                    <button className="btn btn-sm"
                        style={{ background: 'var(--error-500)', color: '#fff', border: 'none' }}
                        onClick={() => setShowDeleteConfirm(true)}>
                        <FiTrash2 /> Delete
                    </button>
                </div>
            </div>

            {/* ── Sign Out ─────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-secondary" style={{ width: '100%' }}
                    onClick={async () => { await signOut(); navigate('/'); }}>
                    <FiLogOut /> Sign Out of SafeDrive
                </button>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
                }}>
                    <div style={{
                        background: 'var(--surface-primary)', borderRadius: 'var(--radius-xl)',
                        padding: 32, maxWidth: 420, width: '90%',
                        border: '1px solid var(--error-200)',
                    }}>
                        <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 16 }}>⚠️</div>
                        <h3 style={{ fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Delete Account?</h3>
                        <p style={{ fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 24 }}>
                            This action is permanent and cannot be undone. All your bookings, vehicles, and
                            reviews will be permanently deleted.
                        </p>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button className="btn btn-secondary" style={{ flex: 1 }}
                                onClick={() => setShowDeleteConfirm(false)}>
                                Cancel
                            </button>
                            <button className="btn" style={{ flex: 1, background: 'var(--error-500)', color: '#fff', border: 'none' }}
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
