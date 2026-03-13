import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiCamera, FiCheckCircle, FiFileText, FiUpload, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../../components/BackButton';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { badgeClass, cx, ui } from '../../lib/ui';

const sanitizeInput = (value) =>
  typeof value === 'string'
    ? value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim()
    : '';

const COLOR_OPTIONS = [
  'White',
  'Black',
  'Silver',
  'Gray',
  'Red',
  'Blue',
  'Brown',
  'Beige',
  'Green',
  'Orange',
  'Yellow',
  'Gold',
  'Maroon',
  'Bronze',
  'Champagne',
  'Other',
];

const SEATING_BY_BODY_TYPE = {
  Sedan: { options: [{ value: 5, label: '4-5 seater' }] },
  Hatchback: { options: [{ value: 5, label: '4-5 seater' }] },
  Coupe: { options: [{ value: 4, label: '2-4 seater' }] },
  SUV: { options: [{ value: 7, label: '5-7 seater' }, { value: 8, label: '8 seater' }] },
  Crossover: { options: [{ value: 5, label: '5 seater' }, { value: 7, label: '5-7 seater' }] },
  MPV: { options: [{ value: 7, label: '7 seater' }, { value: 8, label: '8 seater' }] },
  Van: {
    options: [
      { value: 10, label: '10 seater' },
      { value: 12, label: '12 seater' },
      { value: 15, label: '15 seater' },
    ],
  },
  Pickup: {
    options: [
      { value: 2, label: '2 seater (single cab)' },
      { value: 5, label: '4-5 seater (crew cab)' },
    ],
  },
};

const FEATURE_OPTIONS = [
  'ABS',
  'Airbags',
  'GPS Navigation',
  'Dashcam',
  'Reverse Camera',
  'Bluetooth',
  'USB Ports',
  'Leather Seats',
  'Sunroof',
  'Cruise Control',
  'Parking Sensors',
  'Keyless Entry',
];

const DURATION_OPTIONS = [
  { key: '1_day', label: '1 Day' },
  { key: '2_days', label: '2 Days' },
  { key: '3_days', label: '3 Days' },
  { key: '1_week', label: '1 Week' },
  { key: '2_weeks', label: '2 Weeks' },
  { key: '1_month', label: '1 Month' },
];

function getCodingDay(plate) {
  if (!plate) {
    return null;
  }

  const digits = plate.replace(/\D/g, '');
  if (!digits.length) {
    return null;
  }

  const last = parseInt(digits[digits.length - 1], 10);
  const map = {
    1: { day: 'Monday', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
    2: { day: 'Monday', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
    3: { day: 'Tuesday', color: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-200' },
    4: { day: 'Tuesday', color: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-200' },
    5: { day: 'Wednesday', color: 'text-yellow-500', bg: 'bg-yellow-50', border: 'border-yellow-200' },
    6: { day: 'Wednesday', color: 'text-yellow-500', bg: 'bg-yellow-50', border: 'border-yellow-200' },
    7: { day: 'Thursday', color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
    8: { day: 'Thursday', color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
    9: { day: 'Friday', color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
    0: { day: 'Friday', color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
  };

  return map[last] || null;
}

function Section({ title, description, children, accent = false }) {
  return (
    <section
      className={
        accent
          ? 'overflow-hidden rounded-3xl border border-accent-200 bg-surface-primary shadow-soft'
          : ui.section
      }
    >
      <div
        className={
          accent
            ? 'border-b border-accent-200 bg-accent-50 px-5 py-4 sm:px-6'
            : ui.sectionHeader
        }
      >
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          {description && <p className="text-sm text-text-secondary">{description}</p>}
        </div>
      </div>
      <div className={ui.sectionBody}>{children}</div>
    </section>
  );
}

export default function CreateVehicle() {
  const { user, profile, isVerified } = useAuth();
  const navigate = useNavigate();

  const [loadingState, setLoadingState] = useState('');
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [filteredModels, setFilteredModels] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [codingDay, setCodingDay] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [agreementFile, setAgreementFile] = useState(null);
  const [orcrFile, setOrcrFile] = useState(null);
  const agreementInputRef = useRef(null);
  const orcrInputRef = useRef(null);

  const [formData, setFormData] = useState({
    make: '',
    model: '',
    year: new Date().getFullYear(),
    color: '',
    plate_number: '',
    body_type: 'Sedan',
    transmission: 'Automatic',
    fuel_type: 'Gasoline',
    seating_capacity: 5,
    pricing_type: 'flexible',
    daily_rate: '',
    available_durations: ['1_day'],
    security_deposit: '',
    fixed_price: '',
    fixed_rental_days: '',
    contact_info: '',
    pickup_location: '',
    pickup_city: '',
    pickup_province: '',
    mileage: '',
    description: '',
    features: [],
  });

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    fetchCatalog();
  }, []);

  const fetchCatalog = async () => {
    setCatalogLoading(true);
    try {
      const [brandsRes, modelsRes] = await Promise.all([
        supabase.from('car_brands').select('*').eq('is_active', true).order('name'),
        supabase.from('car_models').select('*').eq('is_active', true).order('name'),
      ]);

      setBrands(brandsRes.data || []);
      setModels(modelsRes.data || []);
    } catch (err) {
      console.error('Catalog fetch error:', err);
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (formData.make) {
      const brand = brands.find((item) => item.name === formData.make);
      if (brand) {
        const filtered = models.filter((item) => item.brand_id === brand.id);
        setFilteredModels(filtered);
        if (!filtered.some((item) => item.name === formData.model)) {
          setFormData((previous) => ({ ...previous, model: '', body_type: 'Sedan' }));
        }
      } else {
        setFilteredModels([]);
      }
    } else {
      setFilteredModels([]);
      setFormData((previous) => ({ ...previous, model: '', body_type: 'Sedan' }));
    }
  }, [formData.make, brands, models]);

  useEffect(() => {
    if (formData.model) {
      const model = filteredModels.find((item) => item.name === formData.model);
      if (model?.body_type) {
        setFormData((previous) => ({ ...previous, body_type: model.body_type }));
      }
    }
  }, [formData.model, filteredModels]);

  useEffect(() => {
    const seatOptions = SEATING_BY_BODY_TYPE[formData.body_type]?.options || [{ value: 5, label: '5 seater' }];
    if (!seatOptions.some((option) => option.value === parseInt(formData.seating_capacity, 10))) {
      setFormData((previous) => ({ ...previous, seating_capacity: seatOptions[0].value }));
    }
  }, [formData.body_type]);

  useEffect(() => {
    setCodingDay(getCodingDay(formData.plate_number));
  }, [formData.plate_number]);

  const toggleFeature = (feature) => {
    setFormData((previous) => ({
      ...previous,
      features: previous.features.includes(feature)
        ? previous.features.filter((item) => item !== feature)
        : [...previous.features, feature],
    }));
  };

  const toggleDuration = (key) => {
    setFormData((previous) => {
      const durations = previous.available_durations.includes(key)
        ? previous.available_durations.filter((duration) => duration !== key)
        : [...previous.available_durations, key];

      return {
        ...previous,
        available_durations: durations.length ? durations : previous.available_durations,
      };
    });
  };

  const handlePhotoSelect = (event) => {
    const files = Array.from(event.target.files);
    const remaining = 4 - photos.length;

    if (remaining <= 0) {
      toast.error('Maximum 4 photos allowed');
      return;
    }

    const valid = files.slice(0, remaining).filter((file) => {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image`);
        return false;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 5MB`);
        return false;
      }

      return true;
    });

    setPhotos((previous) => [...previous, ...valid]);
    setPhotoPreviews((previous) => [...previous, ...valid.map((file) => URL.createObjectURL(file))]);
    event.target.value = '';
  };

  const removePhoto = (index) => {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotos((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
    setPhotoPreviews((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleAgreementSelect = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!allowed.includes(file.type)) {
      toast.error('Please upload a PDF or Word document (.pdf, .doc, .docx)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Agreement file must be under 10MB');
      return;
    }

    setAgreementFile(file);
    toast.success(`"${file.name}" selected`);
    event.target.value = '';
  };

  const handleOrcrSelect = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('ORCR must be an image file (JPG, PNG, etc.)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('ORCR photo must be under 10MB');
      return;
    }

    setOrcrFile(file);
    toast.success(`ORCR photo "${file.name}" selected`);
    event.target.value = '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const userIsVerified = isVerified || profile?.role === 'verified' || profile?.verification_status === 'verified';
    if (!userIsVerified) {
      toast.error('You must be verified to list a vehicle. Complete identity verification in your profile first.');
      return;
    }

    if (!formData.make || !formData.model) {
      toast.error('Please select a brand and model');
      return;
    }

    const yearNum = parseInt(formData.year, 10);
    if (yearNum < 1990 || yearNum > currentYear + 1) {
      toast.error(`Year must be between 1990 and ${currentYear + 1}`);
      return;
    }

    if (formData.pricing_type === 'flexible') {
      if (!formData.daily_rate || parseFloat(formData.daily_rate) < 1) {
        toast.error('Please enter a valid daily rate');
        return;
      }

      if (formData.available_durations.length === 0) {
        toast.error('Please select at least one rental duration');
        return;
      }
    } else {
      if (!formData.fixed_price || parseFloat(formData.fixed_price) < 1) {
        toast.error('Please enter a valid fixed price');
        return;
      }

      if (!formData.fixed_rental_days || parseInt(formData.fixed_rental_days, 10) < 1) {
        toast.error('Please enter the number of rental days for this fixed deal');
        return;
      }
    }

    const phoneRegex = /^09\d{9}$/;
    if (!phoneRegex.test(formData.contact_info?.trim())) {
      toast.error('Please provide a valid 11-digit Philippine mobile number starting with 09.');
      return;
    }

    const textFields = ['pickup_location', 'pickup_city', 'pickup_province', 'description'];
    for (const key of textFields) {
      const value = formData[key] || '';
      if (value && /<[^>]+>/.test(value)) {
        toast.error(`Invalid characters detected in ${key.replace(/_/g, ' ')}`);
        return;
      }
    }

    setLoadingState('Uploading photos...');

    try {
      let imageUrls = [];
      if (photos && photos.length > 0) {
        try {
          for (let index = 0; index < photos.length; index += 1) {
            try {
              const file = photos[index];
              const ext = file.name.split('.').pop();
              const path = `${user.id}/${Date.now()}_${index}.${ext}`;
              const { error: uploadError } = await supabase.storage.from('vehicle-images').upload(path, file);
              if (uploadError) {
                console.warn('Photo upload failed:', uploadError.message);
                continue;
              }

              const { data: urlData } = supabase.storage.from('vehicle-images').getPublicUrl(path);
              imageUrls.push(urlData.publicUrl);
            } catch (photoError) {
              console.warn(`Photo ${index} upload threw:`, photoError.message || photoError);
            }
          }
        } catch (globalPhotoError) {
          console.warn('Fatal storage error on vehicle-images:', globalPhotoError.message || globalPhotoError);
        }
      }

      let agreementUrl = null;
      if (agreementFile) {
        setLoadingState('Uploading documents...');
        try {
          const ext = agreementFile.name.split('.').pop();
          const path = `${user.id}/${Date.now()}_agreement.${ext}`;
          const { error: agreementError } = await supabase.storage
            .from('vehicle-agreements')
            .upload(path, agreementFile, { contentType: agreementFile.type });

          if (!agreementError) {
            const { data: agreementData } = supabase.storage.from('vehicle-agreements').getPublicUrl(path);
            agreementUrl = agreementData.publicUrl;
          } else {
            console.warn('Agreement upload failed:', agreementError.message);
          }
        } catch (agreementError) {
          console.warn('Agreement upload threw exception:', agreementError.message || agreementError);
        }
      }

      let orcrUrl = null;
      if (orcrFile) {
        setLoadingState('Uploading ORCR...');
        try {
          const ext = orcrFile.name.split('.').pop();
          const path = `${user.id}/orcr_${Date.now()}.${ext}`;
          const { error: orcrError } = await supabase.storage.from('vehicle-images').upload(path, orcrFile);

          if (!orcrError) {
            const { data: orcrData } = supabase.storage.from('vehicle-images').getPublicUrl(path);
            orcrUrl = orcrData.publicUrl;
          } else {
            console.warn('ORCR upload failed:', orcrError.message);
          }
        } catch (orcrError) {
          console.warn('ORCR upload threw exception:', orcrError.message || orcrError);
        }
      }

      setLoadingState('Saving listing...');

      const effectiveDailyRate =
        formData.pricing_type === 'fixed'
          ? parseFloat(formData.fixed_price) / parseInt(formData.fixed_rental_days, 10)
          : parseFloat(formData.daily_rate);

      const { error: insertError } = await supabase.from('vehicles').insert({
        owner_id: user.id,
        make: sanitizeInput(formData.make),
        model: sanitizeInput(formData.model),
        year: yearNum,
        color: formData.color,
        plate_number: formData.plate_number.toUpperCase(),
        body_type: formData.body_type,
        transmission: formData.transmission,
        fuel_type: formData.fuel_type,
        seating_capacity: parseInt(formData.seating_capacity, 10),
        pricing_type: formData.pricing_type,
        daily_rate: effectiveDailyRate,
        available_durations: formData.pricing_type === 'flexible' ? formData.available_durations : [],
        security_deposit:
          formData.pricing_type === 'flexible' && formData.security_deposit
            ? parseFloat(formData.security_deposit)
            : 0,
        fixed_price: formData.pricing_type === 'fixed' ? parseFloat(formData.fixed_price) : null,
        fixed_rental_days:
          formData.pricing_type === 'fixed' ? parseInt(formData.fixed_rental_days, 10) : null,
        contact_info: sanitizeInput(formData.contact_info || ''),
        pickup_location: sanitizeInput(formData.pickup_location),
        pickup_city: sanitizeInput(formData.pickup_city),
        pickup_province: sanitizeInput(formData.pickup_province),
        mileage: formData.mileage ? parseInt(formData.mileage, 10) : null,
        description: sanitizeInput(formData.description || ''),
        features: formData.features,
        images: imageUrls,
        thumbnail_url: imageUrls[0] || null,
        agreement_url: agreementUrl,
        orcr_url: orcrUrl,
        status: 'pending',
      });

      if (insertError) {
        throw new Error(insertError.message || 'Insert failed');
      }

      toast.success("Vehicle submitted. You'll be notified once an admin approves it.");
      navigate('/my-vehicles');
    } catch (err) {
      console.error('Listing error:', err);
      toast.error(err.message || 'Failed to submit listing');
    } finally {
      setLoadingState('');
    }
  };

  const seatOptions = SEATING_BY_BODY_TYPE[formData.body_type]?.options || [{ value: 5, label: '5 seater' }];
  const verifiedForListing =
    isVerified || profile?.role === 'verified' || profile?.verification_status === 'verified';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-12">
      <BackButton />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Listing</p>
        <h1 className={ui.pageTitle}>List Your Vehicle</h1>
        <p className={ui.pageDescription}>
          Fill in the details below. The admin team reviews every listing before it goes live.
        </p>
      </div>

      {!verifiedForListing && (
        <div className="rounded-[32px] border border-warning-200 bg-warning-50 px-5 py-5 shadow-soft">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-xl font-semibold text-warning-700 shadow-xs">
              !
            </div>
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Identity verification required</h2>
                <p className="mt-1 text-sm leading-6 text-warning-700">
                  You need a verified profile before you can submit a vehicle listing.
                </p>
              </div>
              <button type="button" className={cx(ui.button.accent, ui.button.sm)} onClick={() => navigate('/profile')}>
                Go to profile
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 rounded-[32px] border border-border-light bg-surface-primary p-3 shadow-soft sm:grid-cols-4">
        {[
          { label: 'Get verified', done: verifiedForListing },
          { label: 'Complete form', done: true },
          { label: 'Admin review', done: false },
          { label: 'Go live', done: false },
        ].map((step, index) => (
          <div
            key={step.label}
            className={cx(
              'rounded-[24px] px-4 py-4 text-center',
              step.done ? 'bg-success-50 text-success-700' : 'bg-surface-secondary text-text-secondary'
            )}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.18em]">Step {index + 1}</div>
            <div className="mt-2 text-sm font-semibold">{step.label}</div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Section title="Vehicle information" description="Core details renters and admins will see first">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={ui.label}>Brand *</label>
              <select
                className={ui.select}
                value={formData.make}
                disabled={catalogLoading}
                onChange={(event) => setFormData({ ...formData, make: event.target.value })}
              >
                <option value="">{catalogLoading ? 'Loading...' : 'Select brand'}</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.name}>
                    {brand.logo_emoji ? `${brand.logo_emoji} ` : ''}
                    {brand.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={ui.label}>Model *</label>
              <select
                className={ui.select}
                value={formData.model}
                disabled={!formData.make || catalogLoading}
                onChange={(event) => setFormData({ ...formData, model: event.target.value })}
              >
                <option value="">
                  {!formData.make
                    ? 'Select a brand first'
                    : filteredModels.length === 0
                      ? 'No models available'
                      : 'Select model'}
                </option>
                {filteredModels.map((model) => (
                  <option key={model.id} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={ui.label}>Year model *</label>
              <select
                className={ui.select}
                value={formData.year}
                onChange={(event) => setFormData({ ...formData, year: event.target.value })}
              >
                {Array.from({ length: currentYear + 1 - 1990 + 1 }, (_, index) => currentYear + 1 - index).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={ui.label}>Color *</label>
              <select
                className={ui.select}
                value={formData.color}
                required
                onChange={(event) => setFormData({ ...formData, color: event.target.value })}
              >
                <option value="">Select color</option>
                {COLOR_OPTIONS.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={ui.label}>Body type</label>
              <input className={ui.input} value={formData.body_type || '-'} readOnly disabled />
              <p className={cx(ui.helperText, 'mt-2')}>Auto-detected from the selected model.</p>
            </div>

            <div>
              <label className={ui.label}>Plate number *</label>
              <input
                className={ui.input}
                placeholder="ABC 1234"
                value={formData.plate_number}
                onChange={(event) => {
                  const value = event.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
                  if (value.replace(/\s/g, '').length <= 7) {
                    setFormData({ ...formData, plate_number: value });
                  }
                }}
                required
              />
              <p className={cx(ui.helperText, 'mt-2')}>Maximum 7 alphanumeric characters.</p>
              {codingDay && (
                <div
                  className={cx(
                    'mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
                    codingDay.bg,
                    codingDay.border,
                    codingDay.color
                  )}
                >
                  Coding day: {codingDay.day}
                </div>
              )}
            </div>

            <div>
              <label className={ui.label}>Transmission *</label>
              <select
                className={ui.select}
                value={formData.transmission}
                onChange={(event) => setFormData({ ...formData, transmission: event.target.value })}
              >
                <option value="Automatic">Automatic</option>
                <option value="Manual">Manual</option>
              </select>
            </div>

            <div>
              <label className={ui.label}>Fuel type *</label>
              <select
                className={ui.select}
                value={formData.fuel_type}
                onChange={(event) => setFormData({ ...formData, fuel_type: event.target.value })}
              >
                <option value="Gasoline">Gasoline</option>
                <option value="Diesel">Diesel</option>
                <option value="Hybrid">Hybrid</option>
                <option value="Electric">Electric</option>
              </select>
            </div>

            <div>
              <label className={ui.label}>Seating capacity *</label>
              {seatOptions.length === 1 ? (
                <div className="rounded-2xl border border-border-light bg-surface-secondary px-4 py-3 text-sm font-semibold text-text-primary">
                  {seatOptions[0].label}
                </div>
              ) : (
                <select
                  className={ui.select}
                  value={formData.seating_capacity}
                  onChange={(event) =>
                    setFormData({ ...formData, seating_capacity: parseInt(event.target.value, 10) })
                  }
                >
                  {seatOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className={ui.label}>Mileage (km)</label>
              <input
                type="number"
                className={ui.input}
                placeholder="e.g. 45000"
                value={formData.mileage}
                onChange={(event) => setFormData({ ...formData, mileage: event.target.value })}
                min={0}
              />
            </div>
          </div>
        </Section>

        <Section title="Pricing and availability" description="Choose how renters will book this vehicle">
          <div className="space-y-5">
            <div>
              <label className={ui.label}>Rental type *</label>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    key: 'flexible',
                    label: 'Flexible',
                    description: 'Renters pick the number of days at your daily rate.',
                  },
                  {
                    key: 'fixed',
                    label: 'Fixed',
                    description: 'Offer a set number of days for one total price.',
                  },
                ].map((option) => {
                  const active = formData.pricing_type === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setFormData({ ...formData, pricing_type: option.key })}
                      className={cx(
                        'rounded-[28px] border px-4 py-4 text-left transition',
                        active
                          ? 'border-primary-300 bg-primary-50'
                          : 'border-border-light bg-surface-secondary hover:border-primary-200'
                      )}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                        {active && <FiCheckCircle className="text-primary-700" />}
                        {option.label}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-text-secondary">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {formData.pricing_type === 'flexible' ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={ui.label}>Daily rate (PHP) *</label>
                    <input
                      type="number"
                      className={ui.input}
                      placeholder="e.g. 2500"
                      value={formData.daily_rate}
                      onChange={(event) => setFormData({ ...formData, daily_rate: event.target.value })}
                      required
                      min={1}
                    />
                    <p className={cx(ui.helperText, 'mt-2')}>Base daily rate renters see first.</p>
                  </div>

                  <div>
                    <label className={ui.label}>Security deposit (PHP)</label>
                    <input
                      type="number"
                      className={ui.input}
                      placeholder="e.g. 5000"
                      value={formData.security_deposit}
                      onChange={(event) => setFormData({ ...formData, security_deposit: event.target.value })}
                      min={0}
                    />
                  </div>
                </div>

                <div>
                  <label className={ui.label}>Available rental durations *</label>
                  <div className="flex flex-wrap gap-2">
                    {DURATION_OPTIONS.map((duration) => {
                      const selected = formData.available_durations.includes(duration.key);
                      return (
                        <button
                          key={duration.key}
                          type="button"
                          className={selected ? badgeClass('info') : badgeClass('neutral')}
                          onClick={() => toggleDuration(duration.key)}
                        >
                          {selected ? 'Selected: ' : ''}
                          {duration.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={ui.label}>Fixed price (PHP) *</label>
                  <input
                    type="number"
                    className={ui.input}
                    placeholder="e.g. 1500"
                    value={formData.fixed_price}
                    onChange={(event) => setFormData({ ...formData, fixed_price: event.target.value })}
                    min={1}
                  />
                  <p className={cx(ui.helperText, 'mt-2')}>Total price for the package.</p>
                </div>

                <div>
                  <label className={ui.label}>Number of rental days *</label>
                  <input
                    type="number"
                    className={ui.input}
                    placeholder="e.g. 3"
                    value={formData.fixed_rental_days}
                    onChange={(event) => setFormData({ ...formData, fixed_rental_days: event.target.value })}
                    min={1}
                  />
                  <p className={cx(ui.helperText, 'mt-2')}>
                    {formData.fixed_price && formData.fixed_rental_days
                      ? `Effective rate: PHP ${(
                          parseFloat(formData.fixed_price) / parseInt(formData.fixed_rental_days, 10) || 0
                        ).toLocaleString(undefined, { maximumFractionDigits: 0 })} per day`
                      : 'Set how many days the fixed deal covers.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Section>

        <Section title="Pickup location" description="Let renters know where the handoff happens">
          <div className="space-y-4">
            <div>
              <label className={ui.label}>Address or landmark *</label>
              <input
                className={ui.input}
                placeholder="Exact address or nearby landmark"
                value={formData.pickup_location}
                onChange={(event) => setFormData({ ...formData, pickup_location: event.target.value })}
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={ui.label}>City *</label>
                <input
                  className={ui.input}
                  placeholder="e.g. Quezon City"
                  value={formData.pickup_city}
                  onChange={(event) => setFormData({ ...formData, pickup_city: event.target.value })}
                  required
                />
              </div>

              <div>
                <label className={ui.label}>Province *</label>
                <input
                  className={ui.input}
                  placeholder="e.g. Metro Manila"
                  value={formData.pickup_province}
                  onChange={(event) => setFormData({ ...formData, pickup_province: event.target.value })}
                  required
                />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Owner contact information" description="Shown to renters for direct coordination">
          <label className={ui.label}>Philippine mobile number *</label>
          <input
            type="tel"
            className={ui.input}
            placeholder="09XXXXXXXXX"
            maxLength={11}
            value={formData.contact_info}
            onChange={(event) => {
              const value = event.target.value.replace(/\D/g, '');
              if (value.length <= 11) {
                setFormData({ ...formData, contact_info: value });
              }
            }}
            required
          />
          <p className={cx(ui.helperText, 'mt-2')}>
            Renters use this number to contact you. It must be 11 digits and start with 09.
          </p>
        </Section>

        <Section title="Features and description" description="Highlight the vehicle condition and included amenities">
          <div className="space-y-5">
            <div>
              <label className={ui.label}>Vehicle features</label>
              <div className="flex flex-wrap gap-2">
                {FEATURE_OPTIONS.map((feature) => (
                  <button
                    key={feature}
                    type="button"
                    className={formData.features.includes(feature) ? badgeClass('info') : badgeClass('neutral')}
                    onClick={() => toggleFeature(feature)}
                  >
                    {formData.features.includes(feature) ? 'Selected: ' : ''}
                    {feature}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={ui.label}>Description</label>
              <textarea
                className={ui.textarea}
                rows={4}
                placeholder="Describe the vehicle condition, history, and anything renters should know."
                value={formData.description}
                onChange={(event) => setFormData({ ...formData, description: event.target.value })}
              />
            </div>
          </div>
        </Section>

        <Section title="Rental agreement" description="Optional, but helpful for custom terms">
          <p className="text-sm leading-6 text-text-secondary">
            Upload a PDF or Word document containing your rental terms and conditions. Renters can review it before they book.
          </p>
          <div
            onClick={() => agreementInputRef.current?.click()}
            className={cx(
              'mt-4 rounded-[28px] border-2 border-dashed px-6 py-8 text-center transition',
              agreementFile
                ? 'border-success-200 bg-success-50'
                : 'border-border-medium bg-surface-secondary hover:border-primary-300'
            )}
          >
            {agreementFile ? (
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <FiFileText className="text-3xl text-success-700" />
                <div className="text-center sm:text-left">
                  <p className="text-sm font-semibold text-success-700">{agreementFile.name}</p>
                  <p className="text-sm text-success-700">{(agreementFile.size / 1024).toFixed(0)} KB</p>
                </div>
              </div>
            ) : (
              <>
                <FiUpload className="mx-auto text-3xl text-text-tertiary" />
                <p className="mt-3 text-sm font-semibold text-text-primary">Click to upload an agreement document</p>
                <p className="mt-1 text-sm text-text-secondary">PDF, DOC, or DOCX up to 10MB</p>
              </>
            )}
          </div>
          <input
            ref={agreementInputRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleAgreementSelect}
            className="hidden"
          />
          {agreementFile && (
            <button
              type="button"
              className="mt-3 text-sm font-medium text-error-700 transition hover:text-error-600"
              onClick={() => setAgreementFile(null)}
            >
              Remove document
            </button>
          )}
        </Section>

        <Section
          title="ORCR"
          description="Required for admin review only and never shown in the public listing"
          accent
        >
          <p className="text-sm leading-6 text-text-secondary">
            Upload a clear photo of the vehicle&apos;s Official Receipt and Certificate of Registration. Only admins can view this file.
          </p>
          <div
            onClick={() => orcrInputRef.current?.click()}
            className={cx(
              'mt-4 rounded-[28px] border-2 border-dashed px-6 py-8 text-center transition',
              orcrFile
                ? 'border-accent-300 bg-accent-50'
                : 'border-border-medium bg-surface-secondary hover:border-accent-300'
            )}
          >
            {orcrFile ? (
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <FiFileText className="text-3xl text-accent-700" />
                <div className="text-center sm:text-left">
                  <p className="text-sm font-semibold text-accent-700">{orcrFile.name}</p>
                  <p className="text-sm text-accent-700">{(orcrFile.size / 1024).toFixed(0)} KB</p>
                </div>
              </div>
            ) : (
              <>
                <FiUpload className="mx-auto text-3xl text-text-tertiary" />
                <p className="mt-3 text-sm font-semibold text-text-primary">Click to upload an ORCR image</p>
                <p className="mt-1 text-sm text-text-secondary">JPG or PNG up to 10MB</p>
              </>
            )}
          </div>
          <input ref={orcrInputRef} type="file" accept="image/*" onChange={handleOrcrSelect} className="hidden" />
          {orcrFile && (
            <button
              type="button"
              className="mt-3 text-sm font-medium text-error-700 transition hover:text-error-600"
              onClick={() => setOrcrFile(null)}
            >
              Remove ORCR image
            </button>
          )}
        </Section>

        <Section title="Vehicle photos" description={`${photos.length}/4 uploaded`}>
          <div className="grid gap-3 sm:grid-cols-2">
            {photoPreviews.map((url, index) => (
              <div key={url} className="relative aspect-[4/3] overflow-hidden rounded-[28px] border border-border-light bg-surface-secondary">
                <img src={url} alt={`Vehicle photo ${index + 1}`} className="h-full w-full object-cover" />
                {index === 0 && (
                  <span className="absolute left-3 top-3 rounded-full bg-primary-700 px-3 py-1 text-xs font-semibold text-white">
                    Cover
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/60 text-white transition hover:bg-slate-950/80"
                >
                  <FiX />
                </button>
              </div>
            ))}

            {photos.length < 4 && (
              <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-3 rounded-[28px] border-2 border-dashed border-border-medium bg-surface-secondary text-center text-text-secondary transition hover:border-primary-300 hover:bg-primary-50/30">
                <FiCamera className="text-3xl" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">Add photo</p>
                  <p className="mt-1 text-sm text-text-secondary">JPG or PNG up to 5MB</p>
                </div>
                <input type="file" accept="image/*" multiple onChange={handlePhotoSelect} className="hidden" />
              </label>
            )}
          </div>

          <p className={cx(ui.helperText, 'mt-3')}>
            The first photo becomes the cover image. Front, rear, interior, and dashboard shots usually perform best.
          </p>
        </Section>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="button" className={ui.button.secondary} onClick={() => navigate(-1)} disabled={!!loadingState}>
            Cancel
          </button>
          <button type="submit" className={cx(ui.button.primary, ui.button.lg)} disabled={!!loadingState}>
            {loadingState || 'Submit for admin review'}
          </button>
        </div>

        {!verifiedForListing && (
          <p className="text-right text-sm text-text-tertiary">
            You must be verified before this form can be submitted.
          </p>
        )}
      </form>
    </div>
  );
}
