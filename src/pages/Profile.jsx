import { useEffect, useRef, useState } from 'react';
import { FiCalendar, FiCheckCircle, FiMail, FiMapPin, FiPhone, FiShield, FiUpload, FiUser } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { badgeClass, cx, ui } from '../lib/ui';

function Field({ label, icon, children, required = false }) {
  return (
    <label className="space-y-2">
      <span className={ui.label}>
        {label}
        {required ? ' *' : ''}
      </span>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary">{icon}</span>}
        {children}
      </div>
    </label>
  );
}

function UploadCard({ label, hint, inputRef, required = false, capture }) {
  return (
    <div className="space-y-2">
      <label className={ui.label}>
        {label}
        {required ? ' *' : ''}
      </label>
      <div className="rounded-[28px] border border-dashed border-border-medium bg-surface-secondary px-5 py-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
          <FiUpload />
        </div>
        <p className="mt-3 text-sm font-medium text-text-primary">{hint}</p>
        <input ref={inputRef} type="file" accept="image/*" capture={capture} className="mt-4 block w-full text-sm text-text-secondary file:mr-4 file:rounded-full file:border-0 file:bg-primary-700 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-primary-800" />
      </div>
    </div>
  );
}

export default function Profile() {
  const { profile, updateProfile, user } = useAuth();
  const [saveLoading, setSaveLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    city: '',
    province: '',
    date_of_birth: '',
    drivers_license_number: '',
    national_id_number: '',
  });

  const idFrontRef = useRef(null);
  const idBackRef = useRef(null);
  const selfieRef = useRef(null);

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

  const handleSaveProfile = async () => {
    setSaveLoading(true);
    try {
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
        throw new Error(error.message || 'Could not save profile');
      }

      await updateProfile({});
      toast.success('Profile saved successfully');
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not save profile. Please try again.');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleSubmitVerification = async () => {
    if (!formData.full_name || !formData.phone) {
      toast.error('Please fill in your full name and phone number first.');
      return;
    }

    if (!formData.drivers_license_number && !formData.national_id_number) {
      toast.error("Please provide at least one ID number before submitting verification.");
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
      const tryUpload = async (bucket, path, file) => {
        try {
          const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
          if (error) {
            console.warn(`Photo upload to ${bucket} failed:`, error.message);
          }
        } catch (uploadError) {
          console.warn(`Photo upload to ${bucket} threw:`, uploadError.message);
        }
      };

      await tryUpload('documents', `${user.id}/id-front-${Date.now()}`, idFrontRef.current.files[0]);

      if (idBackRef.current?.files?.[0]) {
        await tryUpload('documents', `${user.id}/id-back-${Date.now()}`, idBackRef.current.files[0]);
      }

      await tryUpload('selfies', `${user.id}/selfie-${Date.now()}`, selfieRef.current.files[0]);

      const { error: updateError } = await supabase
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

      if (updateError) {
        throw new Error(updateError.message || 'Could not submit verification');
      }

      await updateProfile({});
      toast.success('Verification submitted. Our team will review it within 24 to 48 hours.');
    } catch (err) {
      console.error('Verification submit error:', err);
      toast.error(err.message || 'Failed to submit verification. Please try again.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const verified = profile?.role === 'verified' || profile?.verification_status === 'verified';
  const infoLocked =
    profile?.verification_status === 'submitted' || profile?.verification_status === 'verified';

  return (
    <div className={ui.pageNarrow}>
      <BackButton />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Account</p>
        <h1 className={ui.pageTitle}>My Profile</h1>
        <p className={ui.pageDescription}>
          Keep your personal details current and manage identity verification for renting and listing.
        </p>
      </div>

      <section
        className={cx(
          'rounded-[32px] border px-6 py-6 shadow-soft',
          verified
            ? 'border-success-200 bg-success-50'
            : 'border-border-light bg-surface-primary'
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={cx(
                'flex h-14 w-14 items-center justify-center rounded-full',
                verified ? 'bg-white text-success-700' : 'bg-primary-50 text-primary-700'
              )}
            >
              {verified ? <FiCheckCircle className="text-2xl" /> : <FiShield className="text-2xl" />}
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-text-primary">
                {verified ? 'Identity verified' : 'Verification required'}
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-text-secondary">
                {verified
                  ? 'Your identity has been approved. You can rent vehicles, list vehicles, and access subscription features.'
                  : 'Submit your identification details and selfie to unlock listing and premium features.'}
              </p>
            </div>
          </div>

          <span className={badgeClass(verified ? 'success' : 'neutral')}>
            {verified ? 'Verified' : 'Not verified'}
          </span>
        </div>
      </section>

      <section className={ui.section}>
        <div className={ui.sectionHeader}>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Personal information</h2>
            <p className="text-sm text-text-secondary">Used for bookings, support, and verification review</p>
          </div>
        </div>

        <div className={ui.sectionBody}>
          {infoLocked && (
            <div className="mb-6 rounded-[28px] border border-border-light bg-surface-secondary px-4 py-4 text-sm leading-6 text-text-secondary">
              Your personal information is locked while verification is pending or approved. If your submission is rejected, you can edit and resubmit it.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full name" icon={<FiUser />} required>
              <input
                className={cx(ui.inputWithIcon, infoLocked && 'opacity-70')}
                value={formData.full_name}
                onChange={(event) =>
                  !infoLocked && setFormData({ ...formData, full_name: event.target.value })
                }
                placeholder="Your full legal name"
                readOnly={infoLocked}
              />
            </Field>

            <Field label="Email" icon={<FiMail />}>
              <input className={ui.inputWithIcon} value={profile?.email || ''} disabled />
            </Field>

            <Field label="Phone number" icon={<FiPhone />} required>
              <input
                className={cx(ui.inputWithIcon, infoLocked && 'opacity-70')}
                value={formData.phone}
                onChange={(event) =>
                  !infoLocked && setFormData({ ...formData, phone: event.target.value })
                }
                placeholder="09XX XXX XXXX"
                readOnly={infoLocked}
              />
            </Field>

            <Field label="Date of birth" icon={<FiCalendar />}>
              <input
                type="date"
                className={cx(ui.inputWithIcon, infoLocked && 'opacity-70')}
                value={formData.date_of_birth}
                onChange={(event) =>
                  !infoLocked && setFormData({ ...formData, date_of_birth: event.target.value })
                }
                readOnly={infoLocked}
              />
            </Field>

            <Field label="City" icon={<FiMapPin />}>
              <input
                className={cx(ui.inputWithIcon, infoLocked && 'opacity-70')}
                value={formData.city}
                onChange={(event) =>
                  !infoLocked && setFormData({ ...formData, city: event.target.value })
                }
                placeholder="Your city"
                readOnly={infoLocked}
              />
            </Field>

            <Field label="Province">
              <input
                className={cx(ui.input, infoLocked && 'opacity-70')}
                value={formData.province}
                onChange={(event) =>
                  !infoLocked && setFormData({ ...formData, province: event.target.value })
                }
                placeholder="Your province"
                readOnly={infoLocked}
              />
            </Field>
          </div>

          {!infoLocked && (
            <button type="button" className={cx(ui.button.primary, 'mt-6')} onClick={handleSaveProfile} disabled={saveLoading}>
              {saveLoading ? 'Saving...' : 'Save profile'}
            </button>
          )}
        </div>
      </section>

      {verified ? (
        <section className="rounded-[32px] border border-success-200 bg-success-50 px-6 py-8 text-center shadow-soft">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl text-success-700 shadow-xs">
            <FiCheckCircle />
          </div>
          <h2 className="mt-4 text-2xl font-semibold text-text-primary">You are verified</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-success-700">
            Your identity has been approved by the admin team. You have full access to listing, renting, and subscription features.
          </p>
        </section>
      ) : (
        <section className={ui.section}>
          <div className={ui.sectionHeader}>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Identity verification</h2>
              <p className="text-sm text-text-secondary">Submit documents so the admin team can review your account</p>
            </div>
          </div>

          <div className={ui.sectionBody}>
            <p className="text-sm leading-6 text-text-secondary">
              Provide at least one government ID number, an ID photo, and a selfie. These details are shared only with admins for verification review.
            </p>

            {(formData.full_name || formData.phone || formData.city) && (
              <div className="mt-5 rounded-[28px] border border-border-light bg-surface-secondary px-5 py-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Submission summary</p>
                <div className="mt-4 grid gap-3 text-sm text-text-primary sm:grid-cols-2">
                  {formData.full_name && <p><span className="text-text-tertiary">Name:</span> {formData.full_name}</p>}
                  {formData.phone && <p><span className="text-text-tertiary">Phone:</span> {formData.phone}</p>}
                  {formData.city && <p><span className="text-text-tertiary">City:</span> {formData.city}</p>}
                  {formData.province && <p><span className="text-text-tertiary">Province:</span> {formData.province}</p>}
                  {formData.date_of_birth && <p><span className="text-text-tertiary">Birthday:</span> {formData.date_of_birth}</p>}
                </div>
              </div>
            )}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className={ui.label}>Driver's license number</label>
                <input
                  className={ui.input}
                  placeholder="N01-23-456789"
                  value={formData.drivers_license_number}
                  onChange={(event) =>
                    setFormData({ ...formData, drivers_license_number: event.target.value })
                  }
                />
              </div>

              <div>
                <label className={ui.label}>National or UMID ID number</label>
                <input
                  className={ui.input}
                  placeholder="0000-0000000-0"
                  value={formData.national_id_number}
                  onChange={(event) =>
                    setFormData({ ...formData, national_id_number: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <UploadCard
                label="ID photo front"
                hint="Upload the front side of your government ID"
                inputRef={idFrontRef}
                required
              />
              <UploadCard
                label="ID photo back"
                hint="Upload the back side if your ID includes details there"
                inputRef={idBackRef}
              />
            </div>

            <div className="mt-4">
              <UploadCard
                label="Selfie photo"
                hint="Take a clear selfie so admins can match it to your ID"
                inputRef={selfieRef}
                required
                capture="user"
              />
            </div>

            <button
              type="button"
              className={cx(ui.button.accent, ui.button.lg, 'mt-6 w-full justify-center')}
              onClick={handleSubmitVerification}
              disabled={submitLoading}
            >
              {submitLoading ? 'Submitting...' : 'Submit for verification'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
