import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiMapPin, FiUsers, FiSettings, FiStar, FiCalendar, FiShield, FiCheckCircle, FiChevronLeft } from 'react-icons/fi';
import toast from 'react-hot-toast';
import VerificationGate from '../components/VerificationGate';
import BackButton from '../components/BackButton';
import AvailabilityCalendar from '../components/AvailabilityCalendar';

export default function VehicleDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, profile, isVerified } = useAuth();
    const [vehicle, setVehicle] = useState(null);
    const [owner, setOwner] = useState(null);
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [booking, setBooking] = useState({ start_date: '', end_date: '' });
    const [bookingLoading, setBookingLoading] = useState(false);
    const [showVerifyGate, setShowVerifyGate] = useState(false);
    const [blockedDates, setBlockedDates] = useState([]);
    const [insuranceOpted, setInsuranceOpted] = useState(false);
    const INSURANCE_RATE = 200; // ₱200 per day flat

    useEffect(() => {
        let mounted = true;
        fetchVehicle();
        const safety = setTimeout(() => { if (mounted) setLoading(false); }, 5000);
        return () => { mounted = false; clearTimeout(safety); };
    }, [id]);

    const fetchVehicle = async () => {
        try {
            const { data, error } = await supabase
                .from('vehicles')
                .select('*, profiles!vehicles_owner_id_fkey(*)')
                .eq('id', id)
                .single();

            if (error) throw error;
            setVehicle(data);
            setOwner(data.profiles);

            // Fetch reviews
            const { data: reviewsData } = await supabase
                .from('reviews')
                .select('*, profiles!reviews_reviewer_id_fkey(full_name, avatar_url)')
                .eq('vehicle_id', id)
                .order('created_at', { ascending: false });

            setReviews(reviewsData || []);
        } catch (err) {
            console.error('Error:', err);
            toast.error('Vehicle not found');
            navigate('/vehicles');
        } finally {
            setLoading(false);
        }
    };

    const calculateTotal = () => {
        if (!booking.start_date || !booking.end_date || !vehicle) return { days: 0, subtotal: 0, fee: 0, total: 0, insuranceCost: 0 };
        const start = new Date(booking.start_date);
        const end = new Date(booking.end_date);
        const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
        const subtotal = days * vehicle.daily_rate;
        const fee = subtotal * 0.1;
        const insuranceCost = insuranceOpted ? days * INSURANCE_RATE : 0;
        const total = subtotal + fee + (vehicle.security_deposit || 0) + insuranceCost;
        return { days, subtotal, fee, total, insuranceCost };
    };

    const handleBooking = async (e) => {
        e.preventDefault();
        if (!user) {
            toast.error('Please sign in to book a vehicle');
            navigate('/login');
            return;
        }
        if (!isVerified) {
            setShowVerifyGate(true);
            return;
        }
        if (user.id === vehicle.owner_id) {
            toast.error('You cannot book your own vehicle');
            return;
        }

        const { days, subtotal, fee, total } = calculateTotal();
        if (days <= 0) {
            toast.error('Please select valid dates');
            return;
        }

        // Check for date conflicts with blocked/booked dates
        try {
            const { data: conflicts } = await supabase
                .from('vehicle_availability')
                .select('unavailable_date')
                .eq('vehicle_id', vehicle.id)
                .gte('unavailable_date', booking.start_date)
                .lte('unavailable_date', booking.end_date);

            if (conflicts && conflicts.length > 0) {
                toast.error(`Some of your selected dates are unavailable. Check the availability calendar.`);
                return;
            }
        } catch (err) {
            console.warn('Could not check availability:', err);
        }

        setBookingLoading(true);
        try {
            const { data, error } = await supabase.from('bookings').insert({
                vehicle_id: vehicle.id,
                renter_id: user.id,
                owner_id: vehicle.owner_id,
                start_date: booking.start_date,
                end_date: booking.end_date,
                daily_rate: vehicle.daily_rate,
                total_days: days,
                subtotal,
                service_fee: fee,
                security_deposit: vehicle.security_deposit || 0,
                total_amount: total,
                insurance_opted: insuranceOpted,
                insurance_amount: insuranceCost,
                pickup_location: vehicle.pickup_location,
                status: 'pending',
            }).select().single();

            if (error) throw error;

            // Create notification for owner
            await supabase.from('notifications').insert({
                user_id: vehicle.owner_id,
                title: 'New Booking Request',
                message: `${profile.full_name} wants to rent your ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                type: 'booking',
                reference_id: data.id,
                reference_type: 'booking',
            });

            toast.success('Booking request sent!');
            navigate('/bookings');
        } catch (err) {
            console.error('Booking error:', err);
            toast.error('Failed to create booking');
        } finally {
            setBookingLoading(false);
        }
    };

    if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
    if (!vehicle) return null;

    const { days, subtotal, fee, total, insuranceCost } = calculateTotal();

    return (
        <div>
            <BackButton />

            <div className="vehicle-detail-hero">
                {/* Image Gallery */}
                <div className="vehicle-images">
                    {vehicle.thumbnail_url || vehicle.images?.[0] ? (
                        <img src={vehicle.thumbnail_url || vehicle.images[0]} alt={`${vehicle.make} ${vehicle.model}`} />
                    ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80, background: 'linear-gradient(135deg, var(--neutral-100), var(--neutral-200))' }}>
                            🚗
                        </div>
                    )}
                    <span className={`vehicle-card-badge ${vehicle.is_available ? 'available' : 'rented'}`} style={{ bottom: 16, top: 'auto' }}>
                        {vehicle.is_available ? '✅ Available' : '🔒 Currently Rented'}
                    </span>
                </div>

                {/* Booking Card */}
                <div className="vehicle-booking-card">
                    <div className="price-display">
                        <span className="amount">₱{vehicle.daily_rate?.toLocaleString()}</span>
                        <span className="period"> /day</span>
                    </div>

                    <form onSubmit={handleBooking}>
                        <div className="form-group" style={{ marginBottom: 12 }}>
                            <label className="form-label">Pick-up Date</label>
                            <input
                                type="date"
                                className="form-input"
                                style={{ width: '100%' }}
                                value={booking.start_date}
                                onChange={(e) => setBooking({ ...booking, start_date: e.target.value })}
                                min={new Date().toISOString().split('T')[0]}
                                required
                            />
                        </div>
                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">Return Date</label>
                            <input
                                type="date"
                                className="form-input"
                                style={{ width: '100%' }}
                                value={booking.end_date}
                                onChange={(e) => setBooking({ ...booking, end_date: e.target.value })}
                                min={booking.start_date || new Date().toISOString().split('T')[0]}
                                required
                            />
                        </div>

                        {days > 0 && (
                            <div style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, fontSize: 14 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span>₱{vehicle.daily_rate.toLocaleString()} × {days} day{days > 1 ? 's' : ''}</span>
                                    <span style={{ fontWeight: 600 }}>₱{subtotal.toLocaleString()}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span>Service fee (10%)</span>
                                    <span style={{ fontWeight: 600 }}>₱{fee.toLocaleString()}</span>
                                </div>
                                {vehicle.security_deposit > 0 && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <span>Security deposit</span>
                                        <span style={{ fontWeight: 600 }}>₱{vehicle.security_deposit.toLocaleString()}</span>
                                    </div>
                                )}
                                {insuranceOpted && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, color: 'var(--success-700)' }}>
                                        <span>🛡️ Insurance (₱{INSURANCE_RATE}/day × {days})</span>
                                        <span style={{ fontWeight: 600 }}>₱{insuranceCost.toLocaleString()}</span>
                                    </div>
                                )}
                                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, marginTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                                    <span>Total</span>
                                    <span style={{ color: 'var(--primary-700)', fontFamily: 'var(--font-display)' }}>₱{total.toLocaleString()}</span>
                                </div>
                            </div>
                        )}

                        {/* Insurance Opt-in */}
                        <div
                            onClick={() => setInsuranceOpted(!insuranceOpted)}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: 10,
                                padding: '12px 14px', marginBottom: 14,
                                background: insuranceOpted ? 'var(--success-50)' : 'var(--surface-secondary)',
                                borderRadius: 'var(--radius-md)',
                                border: `1px solid ${insuranceOpted ? 'var(--success-300)' : 'var(--border-light)'}`,
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={insuranceOpted}
                                onChange={() => setInsuranceOpted(!insuranceOpted)}
                                style={{ marginTop: 2, accentColor: 'var(--success-500)', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 13 }}>🛡️ Add Basic Insurance — ₱{INSURANCE_RATE}/day</div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 2 }}>
                                    Covers accidental damage up to ₱50,000. Processed via SafeDrive partner insurer.
                                </div>
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="btn btn-accent btn-lg"
                            style={{ width: '100%' }}
                            disabled={bookingLoading || !vehicle.is_available}
                        >
                            {bookingLoading ? 'Submitting...' : vehicle.is_available ? 'Request to Book' : 'Currently Unavailable'}
                        </button>
                    </form>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                        <FiShield /> Verified owner · Digital agreement included
                    </div>
                </div>
            </div>

            {/* Vehicle Details */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24 }}>
                <div>
                    <div className="card" style={{ marginBottom: 24 }}>
                        <div className="card-body">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span className="badge badge-info">{vehicle.body_type}</span>
                                <span className="badge badge-success">{vehicle.year}</span>
                            </div>
                            <h1 style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 8 }}>
                                {vehicle.year} {vehicle.make} {vehicle.model}
                            </h1>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FiMapPin /> {vehicle.pickup_location}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FiUsers /> {vehicle.seating_capacity} seats</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FiSettings /> {vehicle.transmission}</span>
                            </div>

                            {vehicle.description && (
                                <div style={{ marginBottom: 24 }}>
                                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Description</h3>
                                    <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{vehicle.description}</p>
                                </div>
                            )}

                            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Vehicle Specifications</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
                                {[
                                    { label: 'Color', value: vehicle.color },
                                    { label: 'Fuel Type', value: vehicle.fuel_type },
                                    { label: 'Transmission', value: vehicle.transmission },
                                    { label: 'Seating', value: `${vehicle.seating_capacity} seats` },
                                    { label: 'Body Type', value: vehicle.body_type },
                                    { label: 'Year', value: vehicle.year },
                                ].map((spec, i) => (
                                    <div key={i} style={{ padding: 12, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{spec.label}</div>
                                        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{spec.value}</div>
                                    </div>
                                ))}
                            </div>

                            {vehicle.features?.length > 0 && (
                                <>
                                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Features</h3>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                                        {vehicle.features.map((f, i) => (
                                            <span key={i} className="badge badge-info">
                                                <FiCheckCircle /> {f}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}
                            {vehicle.agreement_url && (
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '14px 18px', background: 'var(--primary-50)',
                                    border: '1px solid var(--primary-200)', borderRadius: 'var(--radius-lg)',
                                    marginBottom: 24,
                                }}>
                                    <span style={{ fontSize: 22 }}>📄</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--primary-700)' }}>Rental Terms & Conditions</div>
                                        <div style={{ fontSize: 12, color: 'var(--primary-500)' }}>The owner has uploaded a rental agreement. Please review before booking.</div>
                                    </div>
                                    <a
                                        href={vehicle.agreement_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn btn-sm"
                                        style={{ background: 'var(--primary-600)', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}
                                    >
                                        View Document
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Reviews */}
                    <div className="card">
                        <div className="card-header">
                            <h2 style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                                Reviews ({reviews.length})
                            </h2>
                        </div>
                        {reviews.length === 0 ? (
                            <div className="card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
                                No reviews yet for this vehicle
                            </div>
                        ) : (
                            <div className="card-body">
                                {reviews.map((review) => (
                                    <div key={review.id} style={{ paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid var(--border-light)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--primary-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--primary-700)' }}>
                                                    {review.profiles?.full_name?.[0] || 'U'}
                                                </div>
                                                <span style={{ fontWeight: 600, fontSize: 14 }}>{review.profiles?.full_name || 'Anonymous'}</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                {[1, 2, 3, 4, 5].map(s => (
                                                    <FiStar key={s} style={{ fontSize: 14, color: s <= review.rating ? '#facc15' : 'var(--neutral-200)', fill: s <= review.rating ? '#facc15' : 'none' }} />
                                                ))}
                                            </div>
                                        </div>
                                        {review.comment && <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{review.comment}</p>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Owner Info */}
                <div>
                    <div className="card" style={{ marginBottom: 24 }}>
                        <div className="card-body">
                            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Car Owner</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-400), var(--accent-400))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700 }}>
                                    {owner?.full_name?.[0] || 'O'}
                                </div>
                                <div>
                                    <div style={{ fontWeight: 700 }}>{owner?.full_name}</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <FiCheckCircle style={{ color: 'var(--success-500)' }} /> Verified Owner
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 16 }}>
                                <div style={{ textAlign: 'center', flex: 1, padding: 12, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)' }}>
                                        {owner?.average_rating?.toFixed(1) || '0.0'}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Rating</div>
                                </div>
                                <div style={{ textAlign: 'center', flex: 1, padding: 12, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)' }}>
                                        {owner?.total_reviews || 0}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Reviews</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Pricing Card */}
                    <div className="card">
                        <div className="card-body">
                            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Pricing & Durations</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Daily Rate</span>
                                    <span style={{ fontWeight: 700 }}>₱{vehicle.daily_rate?.toLocaleString()}</span>
                                </div>
                                {vehicle.security_deposit > 0 && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Security Deposit</span>
                                        <span style={{ fontWeight: 700 }}>₱{vehicle.security_deposit?.toLocaleString()}</span>
                                    </div>
                                )}
                            </div>
                            {vehicle.available_durations?.length > 0 && (
                                <div style={{ marginTop: 16 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Available Durations</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {vehicle.available_durations.map(d => {
                                            const label = { '1_day': '1 Day', '2_days': '2 Days', '3_days': '3 Days', '1_week': '1 Week', '2_weeks': '2 Weeks', '1_month': '1 Month' }[d] || d;
                                            return <span key={d} className="badge badge-info" style={{ fontSize: 12 }}>{label}</span>;
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Availability Calendar */}
            <div style={{ marginTop: 24 }}>
                <AvailabilityCalendar vehicleId={vehicle.id} editable={false} />
            </div>

            {/* Verification Gate Modal */}
            <VerificationGate
                isOpen={showVerifyGate}
                onClose={() => setShowVerifyGate(false)}
                action="rent a car"
            />
        </div>
    );
}
