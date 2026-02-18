import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { FiChevronLeft, FiUpload } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function CreateVehicle() {
    const { user, profile, isVerified } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        make: '', model: '', year: new Date().getFullYear(), color: '', plate_number: '',
        body_type: 'Sedan', transmission: 'Automatic', fuel_type: 'Gasoline',
        seating_capacity: 5, daily_rate: '', weekly_rate: '', monthly_rate: '',
        security_deposit: '', pickup_location: '', pickup_city: '', pickup_province: '',
        mileage: '', description: '', features: [],
    });

    const currentYear = new Date().getFullYear();
    const featureOptions = ['ABS', 'Airbags', 'GPS Navigation', 'Dashcam', 'Reverse Camera', 'Bluetooth', 'USB Ports', 'Leather Seats', 'Sunroof', 'Cruise Control', 'Parking Sensors', 'Keyless Entry'];

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
            toast.error('You must be verified to list a vehicle');
            return;
        }

        const yearNum = parseInt(formData.year);
        if (yearNum < currentYear - 5 || yearNum > currentYear + 1) {
            toast.error(`Vehicle must be between ${currentYear - 5} and ${currentYear + 1} years old`);
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
            <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
                <FiChevronLeft /> Back
            </button>

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
                                <label className="form-label">Make *</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="e.g., Toyota" value={formData.make} onChange={(e) => setFormData({ ...formData, make: e.target.value })} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Model *</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="e.g., Vios" value={formData.model} onChange={(e) => setFormData({ ...formData, model: e.target.value })} required />
                            </div>
                        </div>
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Year * (0-5 years old only)</label>
                                <input type="number" className="form-input" style={{ width: '100%' }} min={currentYear - 5} max={currentYear + 1} value={formData.year} onChange={(e) => setFormData({ ...formData, year: e.target.value })} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Color *</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="e.g., White" value={formData.color} onChange={(e) => setFormData({ ...formData, color: e.target.value })} required />
                            </div>
                        </div>
                        <div className="form-row" style={{ marginBottom: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Body Type *</label>
                                <select className="form-select" style={{ width: '100%' }} value={formData.body_type} onChange={(e) => setFormData({ ...formData, body_type: e.target.value })}>
                                    <option value="Sedan">Sedan</option>
                                    <option value="SUV">SUV</option>
                                    <option value="MPV">MPV</option>
                                    <option value="Van">Van</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Plate Number *</label>
                                <input className="form-input" style={{ width: '100%' }} placeholder="ABC 1234" value={formData.plate_number} onChange={(e) => setFormData({ ...formData, plate_number: e.target.value })} required />
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
                                <input type="number" className="form-input" style={{ width: '100%' }} min={2} max={15} value={formData.seating_capacity} onChange={(e) => setFormData({ ...formData, seating_capacity: e.target.value })} required />
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
        </div>
    );
}
