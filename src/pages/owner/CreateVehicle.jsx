import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { FiUpload, FiX, FiCamera, FiFileText, FiCheckCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';
import VerificationGate from '../../components/VerificationGate';
import BackButton from '../../components/BackButton';

// Simple sanitizer for freetext fields (strips HTML, trims whitespace)
const sanitizeInput = (str) =>
    typeof str === 'string'
        ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim()
        : '';


// ── Constants ────────────────────────────────────────────────────────────────

const COLOR_OPTIONS = [
    'White', 'Black', 'Silver', 'Gray', 'Red', 'Blue',
    'Brown', 'Beige', 'Green', 'Orange', 'Yellow', 'Gold',
    'Maroon', 'Bronze', 'Champagne', 'Other'
];

/**
 * Seating by body type — each entry has a numeric capacity (stored in DB)
 * and a human-readable label displayed in the form.
 */
const SEATING_BY_BODY_TYPE = {
    Sedan: { options: [{ value: 5, label: '4–5 seater' }] },
    Hatchback: { options: [{ value: 5, label: '4–5 seater' }] },
    Coupe: { options: [{ value: 4, label: '2–4 seater' }] },
    SUV: { options: [{ value: 7, label: '5–7 seater' }, { value: 8, label: '8 seater' }] },
    Crossover: { options: [{ value: 5, label: '5 seater' }, { value: 7, label: '5–7 seater' }] },
    MPV: { options: [{ value: 7, label: '7 seater' }, { value: 8, label: '8 seater' }] },
    Van: { options: [{ value: 10, label: '10 seater' }, { value: 12, label: '12 seater' }, { value: 15, label: '15 seater' }] },
    Pickup: { options: [{ value: 2, label: '2 seater (single cab)' }, { value: 5, label: '4–5 seater (crew cab)' }] },
};

const FEATURE_OPTIONS = [
    'ABS', 'Airbags', 'GPS Navigation', 'Dashcam', 'Reverse Camera',
    'Bluetooth', 'USB Ports', 'Leather Seats', 'Sunroof', 'Cruise Control',
    'Parking Sensors', 'Keyless Entry',
];

const DURATION_OPTIONS = [
    { key: '1_day', label: '1 Day' },
    { key: '2_days', label: '2 Days' },
    { key: '3_days', label: '3 Days' },
    { key: '1_week', label: '1 Week' },
    { key: '2_weeks', label: '2 Weeks' },
    { key: '1_month', label: '1 Month' },
];

// Compute MMDA/LTO number coding day from plate number
function getCodingDay(plate) {
    if (!plate) return null;
    const digits = plate.replace(/\D/g, '');
    if (!digits.length) return null;
    const last = parseInt(digits[digits.length - 1]);
    const map = {
        1: { day: 'Monday', color: '#ef4444' }, 2: { day: 'Monday', color: '#ef4444' },
        3: { day: 'Tuesday', color: '#f97316' }, 4: { day: 'Tuesday', color: '#f97316' },
        5: { day: 'Wednesday', color: '#eab308' }, 6: { day: 'Wednesday', color: '#eab308' },
        7: { day: 'Thursday', color: '#22c55e' }, 8: { day: 'Thursday', color: '#22c55e' },
        9: { day: 'Friday', color: '#3b82f6' }, 0: { day: 'Friday', color: '#3b82f6' },
    };
    return map[last] || null;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CreateVehicle() {
    const { user, profile, isVerified } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [showVerifyGate, setShowVerifyGate] = useState(false);

    // Catalog data
    const [brands, setBrands] = useState([]);
    const [models, setModels] = useState([]);
    const [filteredModels, setFilteredModels] = useState([]);
    const [catalogLoading, setCatalogLoading] = useState(true);

    // UI
    const [codingDay, setCodingDay] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [photoPreviews, setPhotoPreviews] = useState([]);
    const [agreementFile, setAgreementFile] = useState(null);
    const [orcrFile, setOrcrFile] = useState(null);
    const agreementInputRef = useRef(null);
    const orcrInputRef = useRef(null);

    const [formData, setFormData] = useState({
        make: '', model: '', year: new Date().getFullYear(),
        color: '', plate_number: '',
        body_type: 'Sedan', transmission: 'Automatic',
        fuel_type: 'Gasoline', seating_capacity: 5,
        // Pricing mode
        pricing_type: 'flexible',  // 'flexible' | 'fixed'
        daily_rate: '',
        available_durations: ['1_day'],
        security_deposit: '',
        fixed_price: '',           // For fixed pricing mode
        fixed_rental_days: '',     // Number of days for fixed deal
        // Contact & Location
        contact_info: '',
        pickup_location: '', pickup_city: '', pickup_province: '',
        mileage: '', description: '', features: [],
    });

    const currentYear = new Date().getFullYear();

    // ── Fetchers ────────────────────────────────────────────────────────────
    useEffect(() => { fetchCatalog(); }, []);

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

    // Filter models when brand changes
    useEffect(() => {
        if (formData.make) {
            const brand = brands.find(b => b.name === formData.make);
            if (brand) {
                const filtered = models.filter(m => m.brand_id === brand.id);
                setFilteredModels(filtered);
                if (!filtered.some(m => m.name === formData.model)) {
                    setFormData(prev => ({ ...prev, model: '', body_type: 'Sedan' }));
                }
            } else {
                setFilteredModels([]);
            }
        } else {
            setFilteredModels([]);
            setFormData(prev => ({ ...prev, model: '', body_type: 'Sedan' }));
        }
    }, [formData.make, brands, models]);

    // Auto-fill body_type from selected model
    useEffect(() => {
        if (formData.model) {
            const model = filteredModels.find(m => m.name === formData.model);
            if (model?.body_type) {
                setFormData(prev => ({ ...prev, body_type: model.body_type }));
            }
        }
    }, [formData.model, filteredModels]);

    // Auto-adjust seating when body type changes
    useEffect(() => {
        const seatOptions = SEATING_BY_BODY_TYPE[formData.body_type]?.options || [{ value: 5, label: '5 seater' }];
        // Reset to the first valid option if current value isn't valid
        if (!seatOptions.some(o => o.value === parseInt(formData.seating_capacity))) {
            setFormData(prev => ({ ...prev, seating_capacity: seatOptions[0].value }));
        }
    }, [formData.body_type]);

    // Compute coding day from plate
    useEffect(() => {
        setCodingDay(getCodingDay(formData.plate_number));
    }, [formData.plate_number]);

    // ── Helpers ─────────────────────────────────────────────────────────────
    const toggleFeature = (feat) => {
        setFormData(prev => ({
            ...prev,
            features: prev.features.includes(feat)
                ? prev.features.filter(f => f !== feat)
                : [...prev.features, feat],
        }));
    };

    const toggleDuration = (key) => {
        setFormData(prev => {
            const durations = prev.available_durations.includes(key)
                ? prev.available_durations.filter(d => d !== key)
                : [...prev.available_durations, key];
            // Always keep at least one
            return { ...prev, available_durations: durations.length ? durations : prev.available_durations };
        });
    };

    const handlePhotoSelect = (e) => {
        const files = Array.from(e.target.files);
        const remaining = 4 - photos.length;
        if (remaining <= 0) { toast.error('Maximum 4 photos allowed'); return; }
        const valid = files.slice(0, remaining).filter(f => {
            if (!f.type.startsWith('image/')) { toast.error(`${f.name} is not an image`); return false; }
            if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} exceeds 5MB`); return false; }
            return true;
        });
        setPhotos(prev => [...prev, ...valid]);
        setPhotoPreviews(prev => [...prev, ...valid.map(f => URL.createObjectURL(f))]);
        e.target.value = '';
    };

    const removePhoto = (i) => {
        URL.revokeObjectURL(photoPreviews[i]);
        setPhotos(prev => prev.filter((_, idx) => idx !== i));
        setPhotoPreviews(prev => prev.filter((_, idx) => idx !== i));
    };

    const handleAgreementSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const allowed = ['application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
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
        e.target.value = '';
    };

    const handleOrcrSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
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
        e.target.value = '';
    };

    // ── Submit ───────────────────────────────────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();

        // Check verified using both role and verification_status
        const userIsVerified = isVerified || profile?.role === 'verified' || profile?.verification_status === 'verified';
        if (!userIsVerified) {
            toast.error('⚠️ You must be verified to list a vehicle. Go to Profile → complete identity verification first.');
            return;
        }

        if (!formData.make || !formData.model) {
            toast.error('Please select a brand and model'); return;
        }

        const yearNum = parseInt(formData.year);
        if (yearNum < 1990 || yearNum > currentYear + 1) {
            toast.error(`Year must be between 1990 and ${currentYear + 1}`); return;
        }

        // Pricing validation depends on mode
        if (formData.pricing_type === 'flexible') {
            if (!formData.daily_rate || parseFloat(formData.daily_rate) < 1) {
                toast.error('Please enter a valid daily rate'); return;
            }
            if (formData.available_durations.length === 0) {
                toast.error('Please select at least one rental duration'); return;
            }
        } else {
            // fixed pricing
            if (!formData.fixed_price || parseFloat(formData.fixed_price) < 1) {
                toast.error('Please enter a valid fixed price'); return;
            }
            if (!formData.fixed_rental_days || parseInt(formData.fixed_rental_days) < 1) {
                toast.error('Please enter the number of rental days for this fixed deal'); return;
            }
        }

        if (!formData.contact_info?.trim()) {
            toast.error('Please provide your contact information for renters'); return;
        }

        // Basic sanitization check — reject inputs containing HTML tags
        const textFields = ['pickup_location', 'pickup_city', 'pickup_province', 'description', 'contact_info'];
        for (const key of textFields) {
            const val = formData[key] || '';
            if (val && /<[^>]+>/.test(val)) {
                toast.error(`Invalid characters detected in ${key.replace(/_/g, ' ')}`);
                return;
            }
        }

        setLoading(true);

        try {
            // 1. Upload vehicle photos
            // 1. Upload vehicle photos (best-effort — don't block listing if storage fails)
            let imageUrls = [];
            for (let i = 0; i < photos.length; i++) {
                try {
                    const file = photos[i];
                    const ext = file.name.split('.').pop();
                    const path = `${user.id}/${Date.now()}_${i}.${ext}`;
                    const { error: upErr } = await supabase.storage.from('vehicle-images').upload(path, file);
                    if (upErr) { console.warn('Photo upload failed:', upErr.message); continue; }
                    const { data: urlData } = supabase.storage.from('vehicle-images').getPublicUrl(path);
                    imageUrls.push(urlData.publicUrl);
                } catch (photoErr) {
                    console.warn('Photo upload threw:', photoErr.message);
                }
            }

            // 2. Upload agreement document (best-effort)
            let agreementUrl = null;
            if (agreementFile) {
                try {
                    const ext = agreementFile.name.split('.').pop();
                    const path = `${user.id}/${Date.now()}_agreement.${ext}`;
                    const { error: agErr } = await supabase.storage
                        .from('vehicle-agreements')
                        .upload(path, agreementFile, { contentType: agreementFile.type });
                    if (!agErr) {
                        const { data: agUrl } = supabase.storage.from('vehicle-agreements').getPublicUrl(path);
                        agreementUrl = agUrl.publicUrl;
                    } else {
                        console.warn('Agreement upload failed:', agErr.message);
                    }
                } catch (agErr) {
                    console.warn('Agreement upload threw:', agErr.message);
                }
            }

            // 3. Upload ORCR document (admin-only, best-effort)
            let orcrUrl = null;
            if (orcrFile) {
                try {
                    const ext = orcrFile.name.split('.').pop();
                    const path = `${user.id}/orcr_${Date.now()}.${ext}`;
                    const { error: orcrErr } = await supabase.storage
                        .from('vehicle-images')
                        .upload(path, orcrFile);
                    if (!orcrErr) {
                        const { data: orcrData } = supabase.storage.from('vehicle-images').getPublicUrl(path);
                        orcrUrl = orcrData.publicUrl;
                    } else {
                        console.warn('ORCR upload failed:', orcrErr.message);
                    }
                } catch (orcrErr) {
                    console.warn('ORCR upload threw:', orcrErr.message);
                }
            }

            // 4. Insert vehicle (status: pending)
            // Compute daily_rate for fixed mode so DB stays consistent
            const effectiveDailyRate = formData.pricing_type === 'fixed'
                ? (parseFloat(formData.fixed_price) / parseInt(formData.fixed_rental_days))
                : parseFloat(formData.daily_rate);

            const { error } = await supabase.from('vehicles').insert({
                owner_id: user.id,
                make: sanitizeInput(formData.make),
                model: sanitizeInput(formData.model),
                year: yearNum,
                color: formData.color,
                plate_number: formData.plate_number.toUpperCase(),
                body_type: formData.body_type,
                transmission: formData.transmission,
                fuel_type: formData.fuel_type,
                seating_capacity: parseInt(formData.seating_capacity),
                pricing_type: formData.pricing_type,
                daily_rate: effectiveDailyRate,
                available_durations: formData.pricing_type === 'flexible' ? formData.available_durations : [],
                security_deposit: formData.pricing_type === 'flexible' && formData.security_deposit ? parseFloat(formData.security_deposit) : 0,
                fixed_price: formData.pricing_type === 'fixed' ? parseFloat(formData.fixed_price) : null,
                fixed_rental_days: formData.pricing_type === 'fixed' ? parseInt(formData.fixed_rental_days) : null,
                contact_info: sanitizeInput(formData.contact_info || ''),
                pickup_location: sanitizeInput(formData.pickup_location),
                pickup_city: sanitizeInput(formData.pickup_city),
                pickup_province: sanitizeInput(formData.pickup_province),
                mileage: formData.mileage ? parseInt(formData.mileage) : null,
                description: sanitizeInput(formData.description || ''),
                features: formData.features,
                images: imageUrls,
                thumbnail_url: imageUrls[0] || null,
                agreement_url: agreementUrl,
                orcr_url: orcrUrl,
                status: 'pending',
            });

            if (error) throw error;

            toast.success('✅ Vehicle submitted for admin review! You\'ll be notified once it\'s approved.');
            navigate('/my-vehicles');
        } catch (err) {
            console.error('Listing error:', err);
            toast.error(err.message || 'Failed to submit listing');
        } finally {
            setLoading(false);
        }
    };

    // ── Render ───────────────────────────────────────────────────────────────
    const seatOptions = SEATING_BY_BODY_TYPE[formData.body_type]?.options || [{ value: 5, label: '5 seater' }];

    return (
        <div style={{ maxWidth: 820, margin: '0 auto', paddingBottom: 48 }}>
            <BackButton />

            <div className="page-header">
                <h1>🚗 List Your Vehicle</h1>
                <p>Fill in your vehicle details. Our admin team will review and approve your listing before it goes live.</p>
            </div>

            {/* Verification warning banner */}
            {!isVerified && (
                <div style={{
                    background: 'var(--warning-50)', border: '1px solid var(--warning-200)',
                    borderRadius: 'var(--radius-lg)', padding: '16px 20px',
                    display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24,
                }}>
                    <span style={{ fontSize: 22 }}>⚠️</span>
                    <div>
                        <div style={{ fontWeight: 700, color: 'var(--warning-700)', marginBottom: 4 }}>
                            Identity Verification Required
                        </div>
                        <div style={{ fontSize: 14, color: 'var(--warning-600)' }}>
                            You must be verified to list a vehicle. Go to your Profile to upload your ID and selfie.
                        </div>
                        <button
                            className="btn btn-sm"
                            style={{ marginTop: 10, background: 'var(--warning-500)', color: '#fff', border: 'none' }}
                            onClick={() => navigate('/profile')}
                        >
                            Go to Profile & Verify
                        </button>
                    </div>
                </div>
            )}

            {/* Process Steps */}
            <div style={{
                display: 'flex', gap: 0, marginBottom: 28, background: 'var(--surface-secondary)',
                borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-light)',
            }}>
                {[
                    { icon: '✅', label: 'Get Verified', done: isVerified },
                    { icon: '📋', label: 'Fill Listing Form', done: false },
                    { icon: '🔍', label: 'Admin Review', done: false },
                    { icon: '🚀', label: 'Go Live', done: false },
                ].map((step, i) => (
                    <div key={i} style={{
                        flex: 1, padding: '12px 8px', textAlign: 'center',
                        borderRight: i < 3 ? '1px solid var(--border-light)' : 'none',
                        background: step.done ? 'var(--success-50)' : 'transparent',
                    }}>
                        <div style={{ fontSize: 18 }}>{step.icon}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: step.done ? 'var(--success-700)' : 'var(--text-secondary)' }}>
                            {step.label}
                        </div>
                    </div>
                ))}
            </div>

            <form onSubmit={handleSubmit}>
                {/* ── Section 1: Vehicle Info ─────────────────────────── */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>🚘 Vehicle Information</h2></div>
                    <div className="card-body">
                        {/* Brand + Model */}
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Brand *</label>
                                <select className="form-select" style={{ width: '100%' }}
                                    value={formData.make} disabled={catalogLoading}
                                    onChange={e => setFormData({ ...formData, make: e.target.value })}>
                                    <option value="">{catalogLoading ? 'Loading...' : '— Select Brand —'}</option>
                                    {brands.map(b => (
                                        <option key={b.id} value={b.name}>{b.logo_emoji ? `${b.logo_emoji} ` : ''}{b.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Model *</label>
                                <select className="form-select" style={{ width: '100%' }}
                                    value={formData.model} disabled={!formData.make || catalogLoading}
                                    onChange={e => setFormData({ ...formData, model: e.target.value })}>
                                    <option value="">{!formData.make ? '— Select brand first —' : filteredModels.length === 0 ? 'No models available' : '— Select Model —'}</option>
                                    {filteredModels.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Year + Color */}
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Year Model *</label>
                                <select className="form-select" style={{ width: '100%' }} value={formData.year}
                                    onChange={e => setFormData({ ...formData, year: e.target.value })}>
                                    {Array.from({ length: currentYear + 1 - 1990 + 1 }, (_, i) => currentYear + 1 - i).map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Color *</label>
                                <select className="form-select" style={{ width: '100%' }} value={formData.color} required
                                    onChange={e => setFormData({ ...formData, color: e.target.value })}>
                                    <option value="">— Select Color —</option>
                                    {COLOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Body Type (read-only) + Plate Number */}
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Body Type <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>(auto-detected)</span></label>
                                <input className="form-input" style={{ width: '100%', opacity: 0.7, cursor: 'not-allowed' }}
                                    value={formData.body_type || '—'} readOnly disabled />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Plate Number *</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="ABC 1234"
                                    value={formData.plate_number}
                                    onChange={e => {
                                        const val = e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
                                        if (val.replace(/\s/g, '').length <= 7) setFormData({ ...formData, plate_number: val });
                                    }} required />
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                    Max 7 alphanumeric chars. Format: ABC 1234
                                </div>
                                {codingDay && (
                                    <div style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6,
                                        padding: '4px 10px', borderRadius: 'var(--radius-md)',
                                        background: codingDay.color + '18', border: `1px solid ${codingDay.color}40`,
                                        fontSize: 12, fontWeight: 600, color: codingDay.color,
                                    }}>
                                        🚦 Coding Day: {codingDay.day}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Transmission + Fuel */}
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Transmission *</label>
                                <select className="form-select" style={{ width: '100%' }} value={formData.transmission}
                                    onChange={e => setFormData({ ...formData, transmission: e.target.value })}>
                                    <option value="Automatic">Automatic</option>
                                    <option value="Manual">Manual</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Fuel Type *</label>
                                <select className="form-select" style={{ width: '100%' }} value={formData.fuel_type}
                                    onChange={e => setFormData({ ...formData, fuel_type: e.target.value })}>
                                    <option value="Gasoline">Gasoline</option>
                                    <option value="Diesel">Diesel</option>
                                    <option value="Hybrid">Hybrid</option>
                                    <option value="Electric">Electric</option>
                                </select>
                            </div>
                        </div>

                        {/* Seating + Mileage */}
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Seating Capacity *</label>
                                {seatOptions.length === 1 ? (
                                    // Only one valid option — show as non-editable badge
                                    <div style={{
                                        padding: '10px 14px', background: 'var(--neutral-50)',
                                        border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)',
                                        fontWeight: 600, color: 'var(--text-primary)',
                                    }}>
                                        {seatOptions[0].label}
                                        <input type="hidden" value={seatOptions[0].value} />
                                    </div>
                                ) : (
                                    <select className="form-select" style={{ width: '100%' }}
                                        value={formData.seating_capacity}
                                        onChange={e => setFormData({ ...formData, seating_capacity: parseInt(e.target.value) })}>
                                        {seatOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                )}
                            </div>
                            <div className="form-group">
                                <label className="form-label">Mileage (km) <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>optional</span></label>
                                <input type="number" className="form-input" style={{ width: '100%' }}
                                    placeholder="e.g. 45000" value={formData.mileage}
                                    onChange={e => setFormData({ ...formData, mileage: e.target.value })} min={0} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Section 2: Pricing & Availability ──────────────── */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>💰 Pricing &amp; Availability</h2></div>
                    <div className="card-body">

                        {/* Pricing Mode Toggle */}
                        <div style={{ marginBottom: 20 }}>
                            <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>
                                Rental Type *
                            </label>
                            <div style={{ display: 'flex', gap: 10 }}>
                                {[{ key: 'flexible', icon: '🔄', label: 'Flexible', sub: 'Renter picks the days at your daily rate' },
                                { key: 'fixed', icon: '📌', label: 'Fixed', sub: 'One price for a set number of days' }].map(opt => {
                                    const active = formData.pricing_type === opt.key;
                                    return (
                                        <button key={opt.key} type="button" onClick={() => setFormData({ ...formData, pricing_type: opt.key })} style={{
                                            flex: 1, padding: '12px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                                            border: `2px solid ${active ? 'var(--primary-500)' : 'var(--border-light)'}`,
                                            background: active ? 'var(--primary-50)' : 'var(--surface-secondary)',
                                            textAlign: 'left', transition: 'all 0.15s',
                                        }}>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: active ? 'var(--primary-700)' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {active && <FiCheckCircle size={14} />} {opt.icon} {opt.label}
                                            </div>
                                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{opt.sub}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Flexible mode fields */}
                        {formData.pricing_type === 'flexible' && (
                            <>
                                <div className="form-row" style={{ marginBottom: 20 }}>
                                    <div className="form-group">
                                        <label className="form-label">Daily Rate (₱) *</label>
                                        <input type="number" className="form-input" style={{ width: '100%' }}
                                            placeholder="e.g. 2500" value={formData.daily_rate}
                                            onChange={e => setFormData({ ...formData, daily_rate: e.target.value })}
                                            required min={1} />
                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                            Base daily rate. Renter picks how many days to rent.
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Security Deposit (₱) <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>optional</span></label>
                                        <input type="number" className="form-input" style={{ width: '100%' }}
                                            placeholder="e.g. 5000" value={formData.security_deposit}
                                            onChange={e => setFormData({ ...formData, security_deposit: e.target.value })} min={0} />
                                    </div>
                                </div>
                                <div>
                                    <label className="form-label" style={{ marginBottom: 10, display: 'block' }}>
                                        Available Rental Durations * <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Select all that apply</span>
                                    </label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                        {DURATION_OPTIONS.map(d => {
                                            const selected = formData.available_durations.includes(d.key);
                                            return (
                                                <button key={d.key} type="button" onClick={() => toggleDuration(d.key)} style={{
                                                    padding: '8px 16px', borderRadius: 'var(--radius-md)',
                                                    border: `2px solid ${selected ? 'var(--primary-500)' : 'var(--border-light)'}`,
                                                    background: selected ? 'var(--primary-50)' : 'var(--surface-secondary)',
                                                    color: selected ? 'var(--primary-700)' : 'var(--text-secondary)',
                                                    fontWeight: selected ? 700 : 400, cursor: 'pointer', fontSize: 14, transition: 'all 0.15s',
                                                    display: 'flex', alignItems: 'center', gap: 6,
                                                }}>
                                                    {selected && <FiCheckCircle size={14} />}{d.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Fixed mode fields */}
                        {formData.pricing_type === 'fixed' && (
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Fixed Price (₱) *</label>
                                    <input type="number" className="form-input" style={{ width: '100%' }}
                                        placeholder="e.g. 1500" value={formData.fixed_price}
                                        onChange={e => setFormData({ ...formData, fixed_price: e.target.value })} min={1} />
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                        Total price for the whole deal.
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Number of Rental Days *</label>
                                    <input type="number" className="form-input" style={{ width: '100%' }}
                                        placeholder="e.g. 3" value={formData.fixed_rental_days}
                                        onChange={e => setFormData({ ...formData, fixed_rental_days: e.target.value })} min={1} />
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                        {formData.fixed_price && formData.fixed_rental_days ? (
                                            <>Effective rate: ₱{(parseFloat(formData.fixed_price) / parseInt(formData.fixed_rental_days) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}/day</>
                                        ) : 'How many days is this fixed deal for?'}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Section 3: Pickup Location ─────────────────────── */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>📍 Pickup Location</h2></div>
                    <div className="card-body">
                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">Address / Landmark *</label>
                            <input className="form-input" style={{ width: '100%' }}
                                placeholder="Exact address or nearby landmark"
                                value={formData.pickup_location}
                                onChange={e => setFormData({ ...formData, pickup_location: e.target.value })} required />
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">City *</label>
                                <input className="form-input" style={{ width: '100%' }}
                                    placeholder="e.g., Quezon City"
                                    value={formData.pickup_city}
                                    onChange={e => setFormData({ ...formData, pickup_city: e.target.value })} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Province *</label>
                                <input className="form-input" style={{ width: '100%' }}
                                    placeholder="e.g., Metro Manila"
                                    value={formData.pickup_province}
                                    onChange={e => setFormData({ ...formData, pickup_province: e.target.value })} required />
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Section 3b: Owner Contact Info ─────────────────── */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header">
                        <h2 style={{ fontSize: 16, fontWeight: 700 }}>📞 Owner Contact Information</h2>
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>Shown to renters so they can negotiate directly with you</div>
                    </div>
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Contact Details *</label>
                            <textarea className="form-textarea" style={{ width: '100%' }} rows={3}
                                placeholder="e.g. 09XX-XXX-XXXX | Facebook: Juan Dela Cruz | Viber: 09XX-XXX-XXXX"
                                value={formData.contact_info}
                                onChange={e => setFormData({ ...formData, contact_info: e.target.value })} />
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                Provide your preferred contact method so renters can reach you to coordinate and negotiate.
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Section 4: Features & Description ─────────────── */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>🛠️ Features & Description</h2></div>
                    <div className="card-body">
                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">Vehicle Features</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {FEATURE_OPTIONS.map(f => (
                                    <button key={f} type="button"
                                        className={`badge ${formData.features.includes(f) ? 'badge-info' : 'badge-neutral'}`}
                                        style={{ cursor: 'pointer', padding: '6px 14px', fontSize: 13 }}
                                        onClick={() => toggleFeature(f)}>
                                        {formData.features.includes(f) ? '✓ ' : ''}{f}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Description</label>
                            <textarea className="form-textarea" style={{ width: '100%' }} rows={4}
                                placeholder="Describe the vehicle's condition, history, and any special notes for renters..."
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })} />
                        </div>
                    </div>
                </div>

                {/* ── Section 5: Agreement Document ─────────────────── */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header">
                        <div>
                            <h2 style={{ fontSize: 16, fontWeight: 700 }}>📄 Rental Agreement / Terms & Conditions</h2>
                            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>optional but recommended</div>
                        </div>
                    </div>
                    <div className="card-body">
                        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                            Upload a PDF or Word document containing your rental terms and conditions.
                            Renters will be able to view and download this document before booking.
                        </p>
                        <div
                            onClick={() => agreementInputRef.current?.click()}
                            style={{
                                border: `2px dashed ${agreementFile ? 'var(--success-400)' : 'var(--neutral-300)'}`,
                                borderRadius: 'var(--radius-lg)', padding: '28px 20px',
                                textAlign: 'center', cursor: 'pointer',
                                background: agreementFile ? 'var(--success-50)' : 'var(--neutral-50)',
                                transition: 'all 0.2s ease',
                            }}>
                            {agreementFile ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                                    <FiFileText size={28} color="var(--success-600)" />
                                    <div style={{ textAlign: 'left' }}>
                                        <div style={{ fontWeight: 700, color: 'var(--success-700)' }}>{agreementFile.name}</div>
                                        <div style={{ fontSize: 12, color: 'var(--success-600)' }}>
                                            {(agreementFile.size / 1024).toFixed(0)} KB · Click to replace
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <FiUpload size={32} color="var(--text-tertiary)" />
                                    <div style={{ marginTop: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>
                                        Click to upload agreement document
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                        PDF, DOC, or DOCX · Max 10MB
                                    </div>
                                </>
                            )}
                        </div>
                        <input ref={agreementInputRef} type="file"
                            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            onChange={handleAgreementSelect} style={{ display: 'none' }} />
                        {agreementFile && (
                            <button type="button"
                                style={{ marginTop: 10, fontSize: 13, color: 'var(--error-600)', background: 'none', border: 'none', cursor: 'pointer' }}
                                onClick={() => setAgreementFile(null)}>
                                ✕ Remove document
                            </button>
                        )}
                    </div>
                </div>

                {/* ── Section 5b: ORCR (Admin Review Only) ──────────── */}
                <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--accent-400)' }}>
                    <div className="card-header" style={{ background: 'var(--accent-50)' }}>
                        <div>
                            <h2 style={{ fontSize: 16, fontWeight: 700 }}>🪪 ORCR — Official Receipt &amp; Certificate of Registration</h2>
                            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>Required for admin verification only · Not shown in public listing</div>
                        </div>
                    </div>
                    <div className="card-body">
                        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                            Upload a clear photo of your vehicle's Official Receipt (OR) and Certificate of Registration (CR).
                            This is <strong>only visible to admins</strong> for verification — renters will not see this.
                        </p>
                        <div onClick={() => orcrInputRef.current?.click()} style={{
                            border: `2px dashed ${orcrFile ? 'var(--accent-400)' : 'var(--neutral-300)'}`,
                            borderRadius: 'var(--radius-lg)', padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
                            background: orcrFile ? 'var(--accent-50)' : 'var(--neutral-50)', transition: 'all 0.2s ease',
                        }}>
                            {orcrFile ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                                    <FiFileText size={28} color="var(--accent-600)" />
                                    <div style={{ textAlign: 'left' }}>
                                        <div style={{ fontWeight: 700, color: 'var(--accent-700)' }}>{orcrFile.name}</div>
                                        <div style={{ fontSize: 12, color: 'var(--accent-600)' }}>{(orcrFile.size / 1024).toFixed(0)} KB · Click to replace</div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <FiUpload size={32} color="var(--text-tertiary)" />
                                    <div style={{ marginTop: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>Click to upload ORCR photo</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>JPG, PNG · Max 10MB · Take a clear, full-page photo</div>
                                </>
                            )}
                        </div>
                        <input ref={orcrInputRef} type="file" accept="image/*" onChange={handleOrcrSelect} style={{ display: 'none' }} />
                        {orcrFile && (
                            <button type="button" style={{ marginTop: 10, fontSize: 13, color: 'var(--error-600)', background: 'none', border: 'none', cursor: 'pointer' }}
                                onClick={() => setOrcrFile(null)}>✕ Remove ORCR photo</button>
                        )}
                    </div>
                </div>

                {/* ── Section 6: Vehicle Photos ──────────────────────── */}
                <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-header">
                        <h2 style={{ fontSize: 16, fontWeight: 700 }}>📸 Vehicle Photos</h2>
                        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{photos.length}/4 photos</span>
                    </div>
                    <div className="card-body">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            {photoPreviews.map((url, i) => (
                                <div key={i} style={{
                                    position: 'relative', borderRadius: 'var(--radius-lg)',
                                    overflow: 'hidden', aspectRatio: '4/3',
                                    border: '2px solid var(--neutral-200)',
                                }}>
                                    <img src={url} alt={`Photo ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    {i === 0 && (
                                        <span style={{
                                            position: 'absolute', top: 8, left: 8,
                                            background: 'var(--primary-500)', color: '#fff',
                                            fontSize: 10, fontWeight: 700, padding: '2px 8px',
                                            borderRadius: 'var(--radius-sm)',
                                        }}>COVER</span>
                                    )}
                                    <button type="button" onClick={() => removePhoto(i)} style={{
                                        position: 'absolute', top: 8, right: 8, width: 28, height: 28,
                                        borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff',
                                        border: 'none', cursor: 'pointer', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <FiX size={14} />
                                    </button>
                                </div>
                            ))}
                            {photos.length < 4 && (
                                <label style={{
                                    aspectRatio: '4/3', border: '2px dashed var(--neutral-300)',
                                    borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center', gap: 8,
                                    cursor: 'pointer', background: 'var(--neutral-50)',
                                    color: 'var(--text-tertiary)', transition: 'all 0.2s ease',
                                }}>
                                    <FiCamera size={28} />
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>Add Photo</span>
                                    <span style={{ fontSize: 11 }}>JPG, PNG · Max 5MB</span>
                                    <input type="file" accept="image/*" multiple onChange={handlePhotoSelect} style={{ display: 'none' }} />
                                </label>
                            )}
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 12 }}>
                            📌 First photo will be used as the cover image. Upload front, rear, interior, and dashboard photos for best results.
                        </p>
                    </div>
                </div>

                {/* ── Submit ─────────────────────────────────────────── */}
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)} disabled={loading}>
                        Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
                        {loading ? '⏳ Submitting...' : '📋 Submit for Admin Review'}
                    </button>
                </div>

                {!isVerified && (
                    <p style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-tertiary)', marginTop: 8 }}>
                        You must be verified to submit a listing.
                    </p>
                )}
            </form>

            <VerificationGate
                isOpen={showVerifyGate}
                onClose={() => setShowVerifyGate(false)}
                action="list a vehicle"
            />
        </div>
    );
}
