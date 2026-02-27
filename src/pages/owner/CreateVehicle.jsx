import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { FiUpload } from 'react-icons/fi';
import toast from 'react-hot-toast';
import VerificationGate from '../../components/VerificationGate';
import BackButton from '../../components/BackButton';

const COLOR_OPTIONS = [
    'White', 'Black', 'Silver', 'Gray', 'Red', 'Blue',
    'Brown', 'Beige', 'Green', 'Orange', 'Yellow', 'Gold',
    'Maroon', 'Bronze', 'Champagne', 'Other'
];

// Seating capacity ranges per body type
const SEATING_BY_BODY_TYPE = {
    Sedan: [4, 5],
    Hatchback: [4, 5],
    Coupe: [2, 4],
    SUV: [5, 7],
    Crossover: [5, 7],
    MPV: [7, 8],
    Van: [8, 10, 12, 15],
    Pickup: [2, 4, 5],
};

// MMDA/LTO Number Coding — based on last digit of plate number
function getCodingDay(plateNumber) {
    if (!plateNumber) return null;
    const digits = plateNumber.replace(/\D/g, '');
    if (digits.length === 0) return null;
    const lastDigit = parseInt(digits[digits.length - 1]);
    const coding = {
        1: { day: 'Monday', color: '#ef4444' },
        2: { day: 'Monday', color: '#ef4444' },
        3: { day: 'Tuesday', color: '#f97316' },
        4: { day: 'Tuesday', color: '#f97316' },
        5: { day: 'Wednesday', color: '#eab308' },
        6: { day: 'Wednesday', color: '#eab308' },
        7: { day: 'Thursday', color: '#22c55e' },
        8: { day: 'Thursday', color: '#22c55e' },
        9: { day: 'Friday', color: '#3b82f6' },
        0: { day: 'Friday', color: '#3b82f6' },
    };
    return coding[lastDigit] || null;
}

export default function CreateVehicle() {
    const { user, profile, isVerified } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [showVerifyGate, setShowVerifyGate] = useState(false);

    // Dynamic brand/model data
    const [brands, setBrands] = useState([]);
    const [models, setModels] = useState([]);
    const [filteredModels, setFilteredModels] = useState([]);
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [codingDay, setCodingDay] = useState(null);

    const [formData, setFormData] = useState({
        make: '', model: '', year: new Date().getFullYear(), color: '', plate_number: '',
        body_type: 'Sedan', transmission: 'Automatic', fuel_type: 'Gasoline',
        seating_capacity: 5, daily_rate: '', weekly_rate: '', monthly_rate: '',
        security_deposit: '', pickup_location: '', pickup_city: '', pickup_province: '',
        mileage: '', description: '', features: [],
    });

    const currentYear = new Date().getFullYear();
    const featureOptions = ['ABS', 'Airbags', 'GPS Navigation', 'Dashcam', 'Reverse Camera', 'Bluetooth', 'USB Ports', 'Leather Seats', 'Sunroof', 'Cruise Control', 'Parking Sensors', 'Keyless Entry'];

    // Fetch brands and models on mount
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
            console.error('Error fetching catalog:', err);
        } finally {
            setCatalogLoading(false);
        }
    };

    // When brand changes, filter models
    useEffect(() => {
        if (formData.make) {
            const brand = brands.find(b => b.name === formData.make);
            if (brand) {
                const filtered = models.filter(m => m.brand_id === brand.id);
                setFilteredModels(filtered);
                // Reset model if current selection doesn't belong to new brand
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

    // When model changes, auto-fill body_type if available
    useEffect(() => {
        if (formData.model) {
            const model = filteredModels.find(m => m.name === formData.model);
            if (model?.body_type) {
                setFormData(prev => ({ ...prev, body_type: model.body_type }));
            }
        }
    }, [formData.model, filteredModels]);

    // When body type changes, auto-adjust seating capacity
    useEffect(() => {
        if (formData.body_type) {
            const validSeats = SEATING_BY_BODY_TYPE[formData.body_type] || [5];
            if (!validSeats.includes(parseInt(formData.seating_capacity))) {
                setFormData(prev => ({ ...prev, seating_capacity: validSeats[0] }));
            }
        }
    }, [formData.body_type]);

    // Compute LTO coding day when plate number changes
    useEffect(() => {
        setCodingDay(getCodingDay(formData.plate_number));
    }, [formData.plate_number]);

    const toggleFeature = (feature) => {
        setFormData(prev => ({
            ...prev,
            features: prev.features.includes(feature)
                ? prev.features.filter(f => f !== feature)
                : [...prev.features, feature]
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!isVerified) {
            setShowVerifyGate(true);
            return;
        }

        if (!formData.make || !formData.model) {
            toast.error('Please select a brand and model');
            return;
        }

        const yearNum = parseInt(formData.year);
        if (yearNum < 1990 || yearNum > currentYear + 1) {
            toast.error(`Year model must be between 1990 and ${currentYear + 1}`);
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase.from('vehicles').insert({
                owner_id: user.id,
                make: formData.make,
                model: formData.model,
                year: yearNum,
                color: formData.color,
                plate_number: formData.plate_number.toUpperCase(),
                body_type: formData.body_type,
                transmission: formData.transmission,
                fuel_type: formData.fuel_type,
                seating_capacity: parseInt(formData.seating_capacity),
                daily_rate: parseFloat(formData.daily_rate),
                weekly_rate: formData.weekly_rate ? parseFloat(formData.weekly_rate) : null,
                monthly_rate: formData.monthly_rate ? parseFloat(formData.monthly_rate) : null,
                security_deposit: formData.security_deposit ? parseFloat(formData.security_deposit) : 0,
                pickup_location: formData.pickup_location,
                pickup_city: formData.pickup_city,
                pickup_province: formData.pickup_province,
                mileage: formData.mileage ? parseInt(formData.mileage) : null,
                description: formData.description,
                features: formData.features,
                status: 'pending',
            });

            if (error) throw error;
            toast.success('Vehicle submitted for approval!');
            navigate('/my-vehicles');
        } catch (err) {
            console.error('Error:', err);
            toast.error(err.message || 'Failed to create listing');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <BackButton />

            <div className="page-header">
                <h1>🚗 List Your Vehicle</h1>
                <p>Add your car to SafeDrive. It will be reviewed by our admin before going live.</p>
            </div>

            {!isVerified && (
                <div className="verification-card" style={{ marginBottom: 24 }}>
                    <div className="verification-card-icon">⚠️</div>
                    <div>
                        <h3 style={{ fontSize: 16, fontWeight: 700 }}>Verification Required</h3>
                        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>You must complete identity verification before listing a vehicle.</p>
                    </div>
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>Vehicle Information</h2></div>
                    <div className="card-body">
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Brand *</label>
                                <select
                                    className="form-select"
                                    style={{ width: '100%' }}
                                    value={formData.make}
                                    onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                                    required
                                    disabled={catalogLoading}
                                >
                                    <option value="">
                                        {catalogLoading ? 'Loading brands...' : '— Select Brand —'}
                                    </option>
                                    {brands.map(b => (
                                        <option key={b.id} value={b.name}>
                                            {b.logo_emoji ? `${b.logo_emoji} ` : ''}{b.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Model *</label>
                                <select
                                    className="form-select"
                                    style={{ width: '100%' }}
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    required
                                    disabled={!formData.make || catalogLoading}
                                >
                                    <option value="">
                                        {!formData.make ? '— Select brand first —' : filteredModels.length === 0 ? 'No models available' : '— Select Model —'}
                                    </option>
                                    {filteredModels.map(m => (
                                        <option key={m.id} value={m.name}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Year Model *</label>
                                <select
                                    className="form-select"
                                    style={{ width: '100%' }}
                                    value={formData.year}
                                    onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                                    required
                                >
                                    {Array.from({ length: currentYear + 1 - 1990 + 1 }, (_, i) => currentYear + 1 - i).map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Color *</label>
                                <select
                                    className="form-select"
                                    style={{ width: '100%' }}
                                    value={formData.color}
                                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                                    required
                                >
                                    <option value="">— Select Color —</option>
                                    {COLOR_OPTIONS.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Body Type</label>
                                <input
                                    className="form-input"
                                    style={{ width: '100%', background: 'var(--neutral-50)', cursor: 'not-allowed' }}
                                    value={formData.body_type || '—'}
                                    readOnly
                                    disabled
                                    title="Auto-detected from selected model"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Plate Number *</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="ABC 1234" value={formData.plate_number} onChange={(e) => setFormData({ ...formData, plate_number: e.target.value.toUpperCase() })} required />
                                {codingDay && (
                                    <div style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        marginTop: 6, padding: '4px 10px', borderRadius: 'var(--radius-md)',
                                        background: codingDay.color + '15', border: `1px solid ${codingDay.color}40`,
                                        fontSize: 12, fontWeight: 600, color: codingDay.color,
                                    }}>
                                        🚦 Coding Day: {codingDay.day}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Transmission *</label>
                                <select className="form-select" style={{ width: '100%' }} value={formData.transmission} onChange={(e) => setFormData({ ...formData, transmission: e.target.value })}>
                                    <option value="Automatic">Automatic</option>
                                    <option value="Manual">Manual</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Fuel Type *</label>
                                <select className="form-select" style={{ width: '100%' }} value={formData.fuel_type} onChange={(e) => setFormData({ ...formData, fuel_type: e.target.value })}>
                                    <option value="Gasoline">Gasoline</option>
                                    <option value="Diesel">Diesel</option>
                                    <option value="Hybrid">Hybrid</option>
                                    <option value="Electric">Electric</option>
                                </select>
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Seating Capacity *</label>
                                <select
                                    className="form-select"
                                    style={{ width: '100%' }}
                                    value={formData.seating_capacity}
                                    onChange={(e) => setFormData({ ...formData, seating_capacity: e.target.value })}
                                    required
                                >
                                    {(SEATING_BY_BODY_TYPE[formData.body_type] || [2, 4, 5, 6, 7, 8]).map(n => (
                                        <option key={n} value={n}>{n} seats</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Mileage (km)</label>
                                <input type="number" className="form-input" style={{ width: '100%' }} placeholder="Optional" value={formData.mileage} onChange={(e) => setFormData({ ...formData, mileage: e.target.value })} />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>Pricing</h2></div>
                    <div className="card-body">
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Daily Rate (₱) *</label>
                                <input type="number" className="form-input" style={{ width: '100%' }} placeholder="2500" value={formData.daily_rate} onChange={(e) => setFormData({ ...formData, daily_rate: e.target.value })} required min={1} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Security Deposit (₱)</label>
                                <input type="number" className="form-input" style={{ width: '100%' }} placeholder="5000" value={formData.security_deposit} onChange={(e) => setFormData({ ...formData, security_deposit: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Weekly Rate (₱) - Optional</label>
                                <input type="number" className="form-input" style={{ width: '100%' }} placeholder="15000" value={formData.weekly_rate} onChange={(e) => setFormData({ ...formData, weekly_rate: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Monthly Rate (₱) - Optional</label>
                                <input type="number" className="form-input" style={{ width: '100%' }} placeholder="50000" value={formData.monthly_rate} onChange={(e) => setFormData({ ...formData, monthly_rate: e.target.value })} />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>Pickup Location</h2></div>
                    <div className="card-body">
                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">Address / Landmark *</label>
                            <input className="form-input" style={{ width: '100%' }} placeholder="Exact address or nearby landmark" value={formData.pickup_location} onChange={(e) => setFormData({ ...formData, pickup_location: e.target.value })} required />
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">City *</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="e.g., Quezon City" value={formData.pickup_city} onChange={(e) => setFormData({ ...formData, pickup_city: e.target.value })} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Province *</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="e.g., Metro Manila" value={formData.pickup_province} onChange={(e) => setFormData({ ...formData, pickup_province: e.target.value })} required />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>Features & Description</h2></div>
                    <div className="card-body">
                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">Vehicle Features</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {featureOptions.map(f => (
                                    <button
                                        key={f}
                                        type="button"
                                        className={`badge ${formData.features.includes(f) ? 'badge-info' : 'badge-neutral'}`}
                                        style={{ cursor: 'pointer', padding: '6px 12px', fontSize: 13 }}
                                        onClick={() => toggleFeature(f)}
                                    >
                                        {formData.features.includes(f) ? '✓ ' : ''}{f}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Description</label>
                            <textarea className="form-textarea" style={{ width: '100%' }} rows={4} placeholder="Describe your vehicle's condition, special features, and any rental terms..." value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
                    <button type="submit" className="btn btn-accent btn-lg" disabled={loading || !isVerified}>
                        {loading ? 'Submitting...' : 'Submit for Approval'}
                    </button>
                </div>
            </form>

            {/* Verification Gate Modal */}
            <VerificationGate
                isOpen={showVerifyGate}
                onClose={() => setShowVerifyGate(false)}
                action="list a vehicle"
            />
        </div>
    );
}
