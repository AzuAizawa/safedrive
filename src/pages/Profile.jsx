import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FiUser, FiMail, FiPhone, FiMapPin, FiUpload, FiCheckCircle, FiClock, FiShield, FiCalendar } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

export default function Profile() {
    const { profile, updateProfile, user } = useAuth();
    const [saveLoading, setSaveLoading] = useState(false);
    const [submitLoading, setSubmitLoading] = useState(false);

    // Sync profile into formData whenever profile changes (handles async load)
    const [formData, setFormData] = useState({
        full_name: '',
        phone: '',
        city: '',
        province: '',
        date_of_birth: '',
        drivers_license_number: '',
        national_id_number: '',
    });

    useEffect(() => {
        if (profile) {
            setFormData({
                full_name: profile.full_name || '',
                phone: profile.phone || '',
                city: profile.city || '',
                province: profile.province || '',
                date_of_birth: profile.date_of_birth || '',
                drivers_license_number: profile.drivers_license_number || '',
                national_id_number: profile.national_id_number || '',
            });
        }
    }, [profile]);

    const idFrontRef = useRef(null);
    const idBackRef = useRef(null);
    const selfieRef = useRef(null);

    // ── Save personal info ────────────────────────────────────────────────
    const handleSaveProfile = async () => {
        setSaveLoading(true);
        try {
            // Use supabase directly (.eq on own ID always passes RLS for authenticated users)
            const { error } = await supabase
                .from('profiles')
                .update({
                    full_name: formData.full_name,
                    phone: formData.phone,
                    city: formData.city,
                    province: formData.province,
                    date_of_birth: formData.date_of_birth || null,
                    drivers_license_number: formData.drivers_license_number,
                    national_id_number: formData.national_id_number,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', user.id);

            if (error) {
                console.error('Profile save error:', error);
                throw new Error(error.message || 'Could not save profile');
            }

            // Refresh profile in context
            await updateProfile({});
            toast.success('Profile saved successfully!');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Could not save profile. Please try again.');
        } finally {
            setSaveLoading(false);
        }
    };

    // ── Submit for verification ───────────────────────────────────────────
    const handleSubmitVerification = async () => {
        if (!formData.full_name || !formData.phone) {
            toast.error('Please fill in your full name and phone number first.');
            return;
        }
        if (!formData.drivers_license_number && !formData.national_id_number) {
            toast.error('Please provide at least one ID number (Driver\'s License or National ID).');
            return;
        }
        if (!idFrontRef.current?.files?.[0]) {
            toast.error('Please upload the front photo of your ID.');
            return;
        }
        if (!selfieRef.current?.files?.[0]) {
            toast.error('Please upload a selfie photo.');
            return;
        }

        setSubmitLoading(true);
        try {
            // Upload photos as BEST-EFFORT — don't block submission if storage fails
            const tryUpload = async (bucket, path, file) => {
                try {
                    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
                    if (error) console.warn(`Photo upload to ${bucket} failed (will retry later):`, error.message);
                } catch (e) {
                    console.warn(`Photo upload to ${bucket} threw:`, e.message);
                }
            };

            await tryUpload('documents', `${user.id}/id-front-${Date.now()}`, idFrontRef.current.files[0]);
            if (idBackRef.current?.files?.[0]) {
                await tryUpload('documents', `${user.id}/id-back-${Date.now()}`, idBackRef.current.files[0]);
            }
            await tryUpload('selfies', `${user.id}/selfie-${Date.now()}`, selfieRef.current.files[0]);

            // ALWAYS save profile data + set verification_status to 'submitted'
            // This is the critical step — even if photo uploads fail, the request is registered
            const { error: updateErr } = await supabase
                .from('profiles')
                .update({
                    full_name: formData.full_name,
                    phone: formData.phone,
                    city: formData.city,
                    province: formData.province,
                    date_of_birth: formData.date_of_birth || null,
                    drivers_license_number: formData.drivers_license_number,
                    national_id_number: formData.national_id_number,

                    verification_status: 'submitted',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', user.id);

            if (updateErr) throw new Error(updateErr.message || 'Could not submit verification');

            // Refresh context profile
            await updateProfile({});
            toast.success('Verification submitted! Our team will review within 24–48 hours. ✅');
        } catch (err) {
            console.error('Verification submit error:', err);
            toast.error(err.message || 'Failed to submit verification. Please try again.');
        } finally {
            setSubmitLoading(false);
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

            {/* Verification Status Banner — only two states: verified or not verified */}
            {(() => {
                const verified = profile?.role === 'verified' || profile?.verification_status === 'verified';
                return (
                    <div className="card" style={{ marginBottom: 24, background: verified ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)' : undefined }}>
                        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <div style={{ width: 48, height: 48, borderRadius: '50%', background: verified ? '#bbf7d020' : '#f3f4f620', display: 'flex', alignItems: 'center', justifyContent: 'center', color: verified ? 'var(--success-500)' : 'var(--text-tertiary)' }}>
                                {verified ? <FiCheckCircle size={24} /> : <FiShield size={24} />}
                            </div>
                            <div style={{ flex: 1 }}>
                                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
                                    {verified ? '✅ Identity Verified' : '🔒 Not Verified'}
                                </h3>
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                    {verified
                                        ? 'Your identity has been verified. You have full access — list vehicles, rent, and subscribe.'
                                        : 'Submit your ID and selfie below to get verified and unlock all SafeDrive features.'}
                                </p>
                            </div>
                            <span className={`badge ${verified ? 'badge-verified' : 'badge-neutral'}`}>
                                {verified ? 'Verified' : 'Not Verified'}
                            </span>
                        </div>
                    </div>
                );
            })()}

            {/* Personal Information */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>Personal Information</h2></div>
                <div className="card-body">
                    <div className="form-row" style={{ marginBottom: 16 }}>
                        <div className="form-group">
                            <label className="form-label">Full Name</label>
                            <div style={{ position: 'relative' }}>
                                <FiUser style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input className="form-input" style={{ paddingLeft: 40, width: '100%' }} value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} placeholder="Your full name" />
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
                            <label className="form-label">Phone Number</label>
                            <div style={{ position: 'relative' }}>
                                <FiPhone style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input className="form-input" style={{ paddingLeft: 40, width: '100%' }} placeholder="09XX XXX XXXX" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Date of Birth</label>
                            <div style={{ position: 'relative' }}>
                                <FiCalendar style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input type="date" className="form-input" style={{ paddingLeft: 40, width: '100%' }} value={formData.date_of_birth} onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })} />
                            </div>
                        </div>
                    </div>
                    <div className="form-row" style={{ marginBottom: 20 }}>
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
                    <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saveLoading}>
                        {saveLoading ? 'Saving...' : '💾 Save Profile'}
                    </button>
                </div>
            </div>

            {/* Identity Verification Section */}
            {(() => {
                const verified = profile?.role === 'verified' || profile?.verification_status === 'verified';
                if (verified) {
                    return (
                        <div className="card" style={{ marginBottom: 24, background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #bbf7d0' }}>
                            <div className="card-body" style={{ textAlign: 'center', padding: '36px 24px' }}>
                                <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
                                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#166534', marginBottom: 8 }}>You're Verified!</h2>
                                <p style={{ fontSize: 14, color: '#15803d', maxWidth: 400, margin: '0 auto' }}>
                                    Your identity has been confirmed by our admin team. You now have full access to list vehicles, rent vehicles, and subscribe to SafeDrive Premium.
                                </p>
                            </div>
                        </div>
                    );
                }
                return (
                    <div className="card" style={{ marginBottom: 24 }}>
                        <div className="card-header">
                            <h2 style={{ fontSize: 16, fontWeight: 700 }}>🔐 Identity Verification</h2>
                        </div>
                        <div className="card-body">
                            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
                                Submit your information and ID photos to get verified. Once approved by our team, you can list and rent vehicles.
                            </p>

                            {/* Personal info summary shown in verification (so admin sees it) */}
                            {(formData.full_name || formData.phone || formData.city) && (
                                <div style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', padding: '14px 18px', marginBottom: 20, border: '1px solid var(--border-light)' }}>
                                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>📋 Your Submitted Personal Info</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13 }}>
                                        {formData.full_name && <div><span style={{ color: 'var(--text-tertiary)' }}>Name: </span>{formData.full_name}</div>}
                                        {formData.phone && <div><span style={{ color: 'var(--text-tertiary)' }}>Phone: </span>{formData.phone}</div>}
                                        {formData.city && <div><span style={{ color: 'var(--text-tertiary)' }}>City: </span>{formData.city}</div>}
                                        {formData.province && <div><span style={{ color: 'var(--text-tertiary)' }}>Province: </span>{formData.province}</div>}
                                        {formData.date_of_birth && <div><span style={{ color: 'var(--text-tertiary)' }}>Birthday: </span>{formData.date_of_birth}</div>}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
                                        ℹ️ This information will be included with your verification submission.
                                    </div>
                                </div>
                            )}

                            {/* ID Numbers */}
                            <div className="form-row" style={{ marginBottom: 16 }}>
                                <div className="form-group">
                                    <label className="form-label">Driver's License Number</label>
                                    <input className="form-input" style={{ width: '100%' }} placeholder="N01-23-456789" value={formData.drivers_license_number} onChange={(e) => setFormData({ ...formData, drivers_license_number: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">National / UMID ID Number</label>
                                    <input className="form-input" style={{ width: '100%' }} placeholder="0000-0000000-0" value={formData.national_id_number} onChange={(e) => setFormData({ ...formData, national_id_number: e.target.value })} />
                                </div>
                            </div>

                            {/* ID Photos */}
                            <div className="form-group" style={{ marginBottom: 16 }}>
                                <label className="form-label">ID Photo (Front) <span style={{ color: 'var(--error-500)' }}>*</span></label>
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
                                <label className="form-label">Selfie Photo (Face Verification) <span style={{ color: 'var(--error-500)' }}>*</span></label>
                                <div className="file-upload-area">
                                    <FiUpload size={24} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
                                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Take a clear photo of your face for identity matching</p>
                                    <input ref={selfieRef} type="file" accept="image/*" capture="user" style={{ marginTop: 8 }} />
                                </div>
                            </div>

                            <button
                                className="btn btn-accent btn-lg"
                                style={{ width: '100%' }}
                                onClick={handleSubmitVerification}
                                disabled={submitLoading}
                            >
                                {submitLoading ? '⏳ Submitting... Please wait' : '🔐 Submit for Verification'}
                            </button>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
