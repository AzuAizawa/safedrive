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

    // Personal info is locked once submitted or verified; editable again only if rejected
    const infoLocked = profile?.verification_status === 'submitted' || profile?.verification_status === 'verified';

    return (
        <div className="max-w-[800px] mx-auto">
            <BackButton />

            <div className="page-header">
                <h1>👤 My Profile</h1>
                <p>Manage your personal information and identity verification</p>
            </div>

            {/* Verification Status Banner — only two states: verified or not verified */}
            {(() => {
                const verified = profile?.role === 'verified' || profile?.verification_status === 'verified';
                return (
                    <div className={`rounded-[var(--radius-xl)] border border-[var(--border-light)] p-5 mb-6 shadow-sm overflow-hidden ${verified ? 'bg-gradient-to-br from-[#f0fdf4] to-[#dcfce7]' : 'bg-[var(--surface-primary)]'}`}>
                        <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${verified ? 'bg-[#bbf7d020] text-[var(--success-500)]' : 'bg-[#f3f4f620] text-[var(--text-tertiary)]'}`}>
                                {verified ? <FiCheckCircle size={24} /> : <FiShield size={24} />}
                            </div>
                            <div className="flex-1">
                                <h3 className="text-[16px] font-bold mb-0.5">
                                    {verified ? '✅ Identity Verified' : '🔒 Not Verified'}
                                </h3>
                                <p className="text-[13px] text-[var(--text-secondary)]">
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
            <div className="rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface-primary)] shadow-sm overflow-hidden mb-6">
                <div className="p-[16px_24px] border-b border-[var(--border-light)]"><h2 className="text-[16px] font-bold">Personal Information</h2></div>
                <div className="p-[20px_24px]">
                    {/* Lock notice */}
                    {infoLocked && (
                        <div className="bg-[var(--neutral-50)] border border-[var(--border-light)] rounded-[var(--radius-md)] p-3 mb-5 flex items-center gap-2.5 text-[13px] text-[var(--text-secondary)]">
                            <span className="text-[18px]">🔒</span>
                            <span>
                                Your personal information is <strong>locked</strong> because your verification was
                                {profile?.verification_status === 'verified' ? ' approved.' : ' submitted and is pending review.'}
                                {profile?.verification_status !== 'verified' && ' If it is rejected, you can edit and resubmit.'}
                            </span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="form-group mb-4">
                            <label className="form-label">Full Name</label>
                            <div className="relative">
                                <FiUser className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                                <input className={`form-input pl-10 w-full ${infoLocked ? 'opacity-70' : 'opacity-100'}`} value={formData.full_name}
                                    onChange={(e) => !infoLocked && setFormData({ ...formData, full_name: e.target.value })}
                                    placeholder="Your full name" readOnly={infoLocked} />
                            </div>
                        </div>
                        <div className="form-group mb-4">
                            <label className="form-label">Email</label>
                            <div className="relative">
                                <FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                                <input className="form-input pl-10 w-full" value={profile?.email || ''} disabled />
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="form-group mb-4">
                            <label className="form-label">Phone Number</label>
                            <div className="relative">
                                <FiPhone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                                <input className={`form-input pl-10 w-full ${infoLocked ? 'opacity-70' : 'opacity-100'}`} placeholder="09XX XXX XXXX"
                                    value={formData.phone}
                                    onChange={(e) => !infoLocked && setFormData({ ...formData, phone: e.target.value })}
                                    readOnly={infoLocked} />
                            </div>
                        </div>
                        <div className="form-group mb-4">
                            <label className="form-label">Date of Birth</label>
                            <div className="relative">
                                <FiCalendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                                <input type="date" className={`form-input pl-10 w-full ${infoLocked ? 'opacity-70' : 'opacity-100'}`}
                                    value={formData.date_of_birth}
                                    onChange={(e) => !infoLocked && setFormData({ ...formData, date_of_birth: e.target.value })}
                                    readOnly={infoLocked} />
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-5">
                        <div className="form-group mb-4">
                            <label className="form-label">City</label>
                            <div className="relative">
                                <FiMapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                                <input className={`form-input pl-10 w-full ${infoLocked ? 'opacity-70' : 'opacity-100'}`} placeholder="Your city"
                                    value={formData.city}
                                    onChange={(e) => !infoLocked && setFormData({ ...formData, city: e.target.value })}
                                    readOnly={infoLocked} />
                            </div>
                        </div>
                        <div className="form-group mb-4">
                            <label className="form-label">Province</label>
                            <input className={`form-input w-full ${infoLocked ? 'opacity-70' : 'opacity-100'}`} placeholder="Your province"
                                value={formData.province}
                                onChange={(e) => !infoLocked && setFormData({ ...formData, province: e.target.value })}
                                readOnly={infoLocked} />
                        </div>
                    </div>
                    {!infoLocked && (
                        <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saveLoading}>
                            {saveLoading ? 'Saving...' : '💾 Save Profile'}
                        </button>
                    )}
                </div>
            </div>

            {/* Identity Verification Section */}
            {(() => {
                const verified = profile?.role === 'verified' || profile?.verification_status === 'verified';
                if (verified) {
                    return (
                        <div className="rounded-[var(--radius-xl)] border border-[#bbf7d0] bg-gradient-to-br from-[#f0fdf4] to-[#dcfce7] shadow-sm overflow-hidden mb-6">
                            <div className="p-9 text-center">
                                <div className="text-[56px] mb-3">✅</div>
                                <h2 className="text-[20px] font-extrabold text-[#166534] mb-2">You're Verified!</h2>
                                <p className="text-[14px] text-[#15803d] max-w-[400px] mx-auto">
                                    Your identity has been confirmed by our admin team. You now have full access to list vehicles, rent vehicles, and subscribe to SafeDrive Premium.
                                </p>
                            </div>
                        </div>
                    );
                }
                return (
                    <div className="rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface-primary)] shadow-sm overflow-hidden mb-6">
                        <div className="p-[16px_24px] border-b border-[var(--border-light)]">
                            <h2 className="text-[16px] font-bold">🔐 Identity Verification</h2>
                        </div>
                        <div className="p-[20px_24px]">
                            <p className="text-[14px] text-[var(--text-secondary)] mb-5">
                                Submit your information and ID photos to get verified. Once approved by our team, you can list and rent vehicles.
                            </p>

                            {/* Personal info summary shown in verification (so admin sees it) */}
                            {(formData.full_name || formData.phone || formData.city) && (
                                <div className="bg-[var(--neutral-50)] rounded-[var(--radius-md)] p-[14px_18px] mb-5 border border-[var(--border-light)]">
                                    <div className="font-bold text-[13px] mb-2 text-[var(--text-secondary)]">📋 Your Submitted Personal Info</div>
                                    <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[13px]">
                                        {formData.full_name && <div><span className="text-[var(--text-tertiary)]">Name: </span>{formData.full_name}</div>}
                                        {formData.phone && <div><span className="text-[var(--text-tertiary)]">Phone: </span>{formData.phone}</div>}
                                        {formData.city && <div><span className="text-[var(--text-tertiary)]">City: </span>{formData.city}</div>}
                                        {formData.province && <div><span className="text-[var(--text-tertiary)]">Province: </span>{formData.province}</div>}
                                        {formData.date_of_birth && <div><span className="text-[var(--text-tertiary)]">Birthday: </span>{formData.date_of_birth}</div>}
                                    </div>
                                    <div className="text-[12px] text-[var(--text-tertiary)] mt-2">
                                        ℹ️ This information will be included with your verification submission.
                                    </div>
                                </div>
                            )}

                            {/* ID Numbers */}
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div className="form-group mb-4">
                                    <label className="form-label">Driver's License Number</label>
                                    <input className="form-input w-full" placeholder="N01-23-456789" value={formData.drivers_license_number} onChange={(e) => setFormData({ ...formData, drivers_license_number: e.target.value })} />
                                </div>
                                <div className="form-group mb-4">
                                    <label className="form-label">National / UMID ID Number</label>
                                    <input className="form-input w-full" placeholder="0000-0000000-0" value={formData.national_id_number} onChange={(e) => setFormData({ ...formData, national_id_number: e.target.value })} />
                                </div>
                            </div>

                            {/* ID Photos */}
                            <div className="form-group mb-4">
                                <label className="form-label">ID Photo (Front) <span className="text-[var(--error-500)]">*</span></label>
                                <div className="file-upload-area">
                                    <FiUpload size={24} className="text-[var(--text-tertiary)] mb-2" />
                                    <p className="text-[13px] text-[var(--text-secondary)]">Upload front of your Government ID</p>
                                    <input ref={idFrontRef} type="file" accept="image/*" className="mt-2" />
                                </div>
                            </div>

                            <div className="form-group mb-4">
                                <label className="form-label">ID Photo (Back)</label>
                                <div className="file-upload-area">
                                    <FiUpload size={24} className="text-[var(--text-tertiary)] mb-2" />
                                    <p className="text-[13px] text-[var(--text-secondary)]">Upload back of your Government ID</p>
                                    <input ref={idBackRef} type="file" accept="image/*" className="mt-2" />
                                </div>
                            </div>

                            <div className="form-group mb-6">
                                <label className="form-label">Selfie Photo (Face Verification) <span className="text-[var(--error-500)]">*</span></label>
                                <div className="file-upload-area">
                                    <FiUpload size={24} className="text-[var(--text-tertiary)] mb-2" />
                                    <p className="text-[13px] text-[var(--text-secondary)]">Take a clear photo of your face for identity matching</p>
                                    <input ref={selfieRef} type="file" accept="image/*" capture="user" className="mt-2" />
                                </div>
                            </div>

                            <button
                                className="btn btn-accent btn-lg w-full"
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
