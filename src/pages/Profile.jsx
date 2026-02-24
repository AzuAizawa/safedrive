import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FiUser, FiMail, FiPhone, FiMapPin, FiUpload, FiCheckCircle, FiClock, FiShield } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

export default function Profile() {
    const { profile, updateProfile } = useAuth();
    const [loading, setLoading] = useState(false);
    const [verifyStep, setVerifyStep] = useState(0); // 0=info, 1=id docs, 2=selfie
    const [formData, setFormData] = useState({
        full_name: profile?.full_name || '',
        phone: profile?.phone || '',
        city: profile?.city || '',
        province: profile?.province || '',
        date_of_birth: profile?.date_of_birth || '',
        drivers_license_number: profile?.drivers_license_number || '',
        national_id_number: profile?.national_id_number || '',
        bio: profile?.bio || '',
    });

    const idFrontRef = useRef(null);
    const idBackRef = useRef(null);
    const selfieRef = useRef(null);

    const handleSaveProfile = async () => {
        setLoading(true);
        try {
            const { error } = await updateProfile(formData);
            if (error) throw error;
            toast.success('Profile updated successfully');
        } catch (err) {
            toast.error('Failed to update profile');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitVerification = async () => {
        if (!formData.drivers_license_number && !formData.national_id_number) {
            toast.error('Please provide at least one ID number');
            return;
        }

        setLoading(true);
        try {
            // Upload documents if provided
            const uploads = [];

            if (idFrontRef.current?.files?.[0]) {
                const file = idFrontRef.current.files[0];
                const { error } = await supabase.storage.from('documents').upload(`${profile.id}/id-front-${Date.now()}`, file);
                if (error) console.error('Upload error:', error);
            }

            if (idBackRef.current?.files?.[0]) {
                const file = idBackRef.current.files[0];
                const { error } = await supabase.storage.from('documents').upload(`${profile.id}/id-back-${Date.now()}`, file);
                if (error) console.error('Upload error:', error);
            }

            if (selfieRef.current?.files?.[0]) {
                const file = selfieRef.current.files[0];
                const { error } = await supabase.storage.from('selfies').upload(`${profile.id}/selfie-${Date.now()}`, file);
                if (error) console.error('Upload error:', error);
            }

            // Update profile verification status
            const { error } = await updateProfile({
                ...formData,
                verification_status: 'submitted',
            });

            if (error) throw error;
            toast.success('Verification documents submitted! Awaiting admin review.');
        } catch (err) {
            toast.error('Failed to submit verification');
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'verified': return 'var(--success-500)';
            case 'submitted': return 'var(--warning-500)';
            case 'rejected': return 'var(--error-500)';
            default: return 'var(--text-tertiary)';
        }
    };

    return (
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <BackButton />

            <div className="page-header">
                <h1>👤 My Profile</h1>
                <p>Manage your personal information and identity verification</p>
            </div>

            {/* Verification Status Banner */}
            <div className="card" style={{ marginBottom: 24, background: profile?.verification_status === 'verified' ? 'linear-gradient(135deg, var(--success-50), var(--success-100))' : undefined }}>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: `${getStatusColor(profile?.verification_status)}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: getStatusColor(profile?.verification_status) }}>
                        {profile?.verification_status === 'verified' ? <FiCheckCircle size={24} /> : profile?.verification_status === 'submitted' ? <FiClock size={24} /> : <FiShield size={24} />}
                    </div>
                    <div style={{ flex: 1 }}>
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
                            {profile?.verification_status === 'verified' ? '✅ Identity Verified' :
                                profile?.verification_status === 'submitted' ? '⏳ Verification Pending' :
                                    profile?.verification_status === 'rejected' ? '❌ Verification Rejected' : '🔒 Unverified Account'}
                        </h3>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {profile?.verification_status === 'verified' ? 'Your identity has been verified. You have full access to SafeDrive features.' :
                                profile?.verification_status === 'submitted' ? 'Your documents are being reviewed by our admin team. This usually takes 24-48 hours.' :
                                    profile?.verification_status === 'rejected' ? 'Your verification was not approved. Please resubmit your documents with clearer images.' :
                                        'Complete identity verification to unlock all SafeDrive features including booking and listing vehicles.'}
                        </p>
                    </div>
                    <span className={`badge ${profile?.verification_status === 'verified' ? 'badge-verified' : profile?.verification_status === 'submitted' ? 'badge-pending' : 'badge-neutral'}`}>
                        {profile?.verification_status}
                    </span>
                </div>
            </div>

            {/* Personal Information */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>Personal Information</h2></div>
                <div className="card-body">
                    <div className="form-row" style={{ marginBottom: 16 }}>
                        <div className="form-group">
                            <label className="form-label">Full Name</label>
                            <div style={{ position: 'relative' }}>
                                <FiUser style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input className="form-input" style={{ paddingLeft: 40, width: '100%' }} value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Email</label>
                            <div style={{ position: 'relative' }}>
                                <FiMail style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input className="form-input" style={{ paddingLeft: 40, width: '100%' }} value={profile?.email || ''} disabled />
                            </div>
                        </div>
                    </div>
                    <div className="form-row" style={{ marginBottom: 16 }}>
                        <div className="form-group">
                            <label className="form-label">Phone</label>
                            <div style={{ position: 'relative' }}>
                                <FiPhone style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input className="form-input" style={{ paddingLeft: 40, width: '100%' }} placeholder="09XX XXX XXXX" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Date of Birth</label>
                            <input type="date" className="form-input" style={{ width: '100%' }} value={formData.date_of_birth} onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })} />
                        </div>
                    </div>
                    <div className="form-row" style={{ marginBottom: 16 }}>
                        <div className="form-group">
                            <label className="form-label">City</label>
                            <div style={{ position: 'relative' }}>
                                <FiMapPin style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input className="form-input" style={{ paddingLeft: 40, width: '100%' }} placeholder="Your city" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Province</label>
                            <input className="form-input" style={{ width: '100%' }} placeholder="Your province" value={formData.province} onChange={(e) => setFormData({ ...formData, province: e.target.value })} />
                        </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 16 }}>
                        <label className="form-label">Bio</label>
                        <textarea className="form-textarea" style={{ width: '100%' }} rows={3} placeholder="Tell others about yourself..." value={formData.bio} onChange={(e) => setFormData({ ...formData, bio: e.target.value })} />
                    </div>
                    <button className="btn btn-primary" onClick={handleSaveProfile} disabled={loading}>
                        {loading ? 'Saving...' : 'Save Profile'}
                    </button>
                </div>
            </div>

            {/* Identity Verification Section */}
            {profile?.verification_status !== 'verified' && (
                <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-header">
                        <h2 style={{ fontSize: 16, fontWeight: 700 }}>🔐 Identity Verification</h2>
                    </div>
                    <div className="card-body">
                        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
                            SafeDrive requires identity verification to ensure the safety and trust of all users. You'll need to provide:
                        </p>

                        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
                            {[
                                { step: 1, icon: '🪪', label: "Government ID", desc: "Driver's license or National ID" },
                                { step: 2, icon: '📸', label: 'Selfie Photo', desc: 'Face verification match' },
                                { step: 3, icon: '✅', label: 'Admin Review', desc: '24-48 hour review process' },
                            ].map((s) => (
                                <div key={s.step} style={{ flex: 1, padding: 16, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', textAlign: 'center', border: '2px solid transparent' }}>
                                    <div style={{ fontSize: 32, marginBottom: 8 }}>{s.icon}</div>
                                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Step {s.step}: {s.label}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{s.desc}</div>
                                </div>
                            ))}
                        </div>

                        {/* Verification Form */}
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Driver's License Number</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="N01-23-456789" value={formData.drivers_license_number} onChange={(e) => setFormData({ ...formData, drivers_license_number: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">National/UMID ID Number</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="0000-0000000-0" value={formData.national_id_number} onChange={(e) => setFormData({ ...formData, national_id_number: e.target.value })} />
                            </div>
                        </div>

                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">ID Photo (Front)</label>
                            <div className="file-upload-area">
                                <FiUpload size={24} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Upload front of your Government ID</p>
                                <input ref={idFrontRef} type="file" accept="image/*" style={{ marginTop: 8 }} />
                            </div>
                        </div>

                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">ID Photo (Back)</label>
                            <div className="file-upload-area">
                                <FiUpload size={24} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Upload back of your Government ID</p>
                                <input ref={idBackRef} type="file" accept="image/*" style={{ marginTop: 8 }} />
                            </div>
                        </div>

                        <div className="form-group" style={{ marginBottom: 24 }}>
                            <label className="form-label">Selfie Photo (Face Verification)</label>
                            <div className="file-upload-area">
                                <FiUpload size={24} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Take a clear photo of your face for identity matching</p>
                                <input ref={selfieRef} type="file" accept="image/*" capture="user" style={{ marginTop: 8 }} />
                            </div>
                        </div>

                        <button className="btn btn-accent btn-lg" style={{ width: '100%' }} onClick={handleSubmitVerification} disabled={loading}>
                            {loading ? 'Submitting...' : '🔐 Submit for Verification'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
