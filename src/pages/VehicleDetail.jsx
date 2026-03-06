import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiMapPin, FiUsers, FiSettings, FiStar, FiCalendar, FiShield, FiCheckCircle, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
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
    const [selectedImageIndex, setSelectedImageIndex] = useState(0);
    // Existing booking check
    const [existingBooking, setExistingBooking] = useState(null);

    useEffect(() => {
        let mounted = true;
        fetchVehicle();
        const safety = setTimeout(() => { if (mounted) setLoading(false); }, 5000);
        return () => { mounted = false; clearTimeout(safety); };
    }, [id]);

    // When user changes start_date and vehicle is fixed pricing, auto-compute end_date
    useEffect(() => {
        if (vehicle?.pricing_type === 'fixed' && booking.start_date && vehicle.fixed_rental_days) {
            const start = new Date(booking.start_date);
            start.setDate(start.getDate() + parseInt(vehicle.fixed_rental_days) - 1);
            const endStr = start.toISOString().split('T')[0];
            setBooking(prev => ({ ...prev, end_date: endStr }));
        }
    }, [booking.start_date, vehicle]);

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

            // Check if logged-in user already has a booking for this vehicle
            if (user) {
                const { data: existBook } = await supabase
                    .from('bookings')
                    .select('id, start_date, end_date, status, total_amount, total_days')
                    .eq('vehicle_id', id)
                    .eq('renter_id', user.id)
                    .in('status', ['pending', 'confirmed', 'active'])
                    .maybeSingle();
                setExistingBooking(existBook);
            }
        } catch (err) {
            console.error('Error:', err);
            toast.error('Vehicle not found');
            navigate('/vehicles');
        } finally {
            setLoading(false);
        }
    };

    // ── Flexible pricing cost calculation ───────────────────────────────────
    const calculateTotal = () => {
        if (!booking.start_date || !booking.end_date || !vehicle) return { days: 0, subtotal: 0, fee: 0, total: 0 };
        const start = new Date(booking.start_date);
        const end = new Date(booking.end_date);
        const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));

        if (vehicle.pricing_type === 'fixed') {
            const total = parseFloat(vehicle.fixed_price) || 0;
            return { days: vehicle.fixed_rental_days, subtotal: total, fee: 0, total };
        }

        const subtotal = days * vehicle.daily_rate;
        const fee = subtotal * 0.1;
        const total = subtotal + fee + (vehicle.security_deposit || 0);
        return { days, subtotal, fee, total };
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
        if (existingBooking) {
            toast.error('You already have an active booking for this vehicle');
            return;
        }

        const { days, subtotal, fee, total } = calculateTotal();
        if (!booking.start_date) {
            toast.error('Please select a pick-up date');
            return;
        }
        if (vehicle.pricing_type === 'flexible' && days <= 0) {
            toast.error('Please select valid dates');
            return;
        }

        // Check for date conflicts
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
                daily_rate: vehicle.pricing_type === 'fixed' ? (parseFloat(vehicle.fixed_price) / parseInt(vehicle.fixed_rental_days || 1)) : vehicle.daily_rate,
                total_days: vehicle.pricing_type === 'fixed' ? parseInt(vehicle.fixed_rental_days || 1) : days,
                subtotal,
                service_fee: fee,
                security_deposit: vehicle.pricing_type === 'flexible' ? (vehicle.security_deposit || 0) : 0,
                total_amount: total,
                pickup_location: vehicle.pickup_location,
                status: 'pending',
            }).select().single();

            if (error) throw error;

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

    const { days, subtotal, fee, total } = calculateTotal();
    const isFixed = vehicle.pricing_type === 'fixed';

    // Build images array (thumbnail + additional images)
    const allImages = [];
    if (vehicle.thumbnail_url) allImages.push(vehicle.thumbnail_url);
    if (vehicle.images?.length) {
        vehicle.images.forEach(img => {
            if (img && img !== vehicle.thumbnail_url) allImages.push(img);
        });
    }
    const displayImages = allImages.length > 0 ? allImages : null;
    const currentImage = displayImages ? displayImages[selectedImageIndex] : null;

    // Full address string
    const addressParts = [vehicle.pickup_location, vehicle.pickup_city, vehicle.pickup_province].filter(Boolean);
    const fullAddress = addressParts.join(', ');

    return (
        <div>
            <BackButton />

            <div className="vehicle-detail-hero">
                {/* Image Gallery */}
                <div className="vehicle-images" style={{ position: 'relative' }}>
                    {currentImage ? (
                        <>
                            <img src={currentImage} alt={`${vehicle.make} ${vehicle.model}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            {/* Image navigation arrows */}
                            {displayImages.length > 1 && (
                                <>
                                    <button
                                        onClick={() => setSelectedImageIndex(i => (i - 1 + displayImages.length) % displayImages.length)}
                                        style={{
                                            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                                            background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '50%',
                                            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer', zIndex: 2,
                                        }}
                                    ><FiChevronLeft /></button>
                                    <button
                                        onClick={() => setSelectedImageIndex(i => (i + 1) % displayImages.length)}
                                        style={{
                                            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                                            background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '50%',
                                            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer', zIndex: 2,
                                        }}
                                    ><FiChevronRight /></button>
                                    {/* Dots indicator */}
                                    <div style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6, zIndex: 2 }}>
                                        {displayImages.map((_, i) => (
                                            <div key={i} onClick={() => setSelectedImageIndex(i)} style={{
                                                width: 8, height: 8, borderRadius: '50%', cursor: 'pointer',
                                                background: i === selectedImageIndex ? '#fff' : 'rgba(255,255,255,0.45)',
                                                border: '1px solid rgba(255,255,255,0.8)',
                                            }} />
                                        ))}
                                    </div>
                                </>
                            )}
                            {/* Thumbnail strip */}
                            {displayImages.length > 1 && (
                                <div style={{
                                    position: 'absolute', bottom: 0, left: 0, right: 0,
                                    display: 'flex', gap: 6, padding: '8px 12px',
                                    background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
                                    overflowX: 'auto',
                                }}>
                                    {displayImages.map((img, i) => (
                                        <img key={i} src={img} alt={`Photo ${i + 1}`} onClick={() => setSelectedImageIndex(i)}
                                            style={{
                                                width: 52, height: 38, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                                                border: i === selectedImageIndex ? '2px solid #fff' : '2px solid transparent',
                                                opacity: i === selectedImageIndex ? 1 : 0.65, transition: 'all 0.15s',
                                            }} />
                                    ))}
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80, background: 'linear-gradient(135deg, var(--neutral-100), var(--neutral-200))' }}>
                            🚗
                        </div>
                    )}
                    <span className={`vehicle-card-badge ${vehicle.is_available ? 'available' : 'rented'}`} style={{ bottom: 16, top: 'auto', zIndex: 3 }}>
                        {vehicle.is_available ? '✅ Available' : '🔒 Currently Rented'}
                    </span>
                </div>

                {/* Booking Card */}
                <div className="vehicle-booking-card">
                    {/* ── Already Booked Banner ── */}
                    {existingBooking ? (
                        <div style={{
                            background: 'linear-gradient(135deg, var(--primary-50), var(--primary-100))',
                            border: '2px solid var(--primary-300)', borderRadius: 'var(--radius-lg)',
                            padding: 20, textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--primary-700)', marginBottom: 6 }}>
                                You Already Booked This Car
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--primary-600)', marginBottom: 12 }}>
                                {new Date(existingBooking.start_date).toLocaleDateString()} → {new Date(existingBooking.end_date).toLocaleDateString()}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--primary-700)', marginBottom: 4 }}>
                                ₱{existingBooking.total_amount?.toLocaleString()}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
                                {existingBooking.total_days} day(s) · Status: <strong style={{ textTransform: 'capitalize' }}>{existingBooking.status}</strong>
                            </div>
                            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => navigate('/bookings')}>
                                View My Bookings
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* ── Fixed Pricing Display ── */}
                            {isFixed ? (
                                <div style={{ marginBottom: 16 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Fixed Deal Price</div>
                                    <div className="price-display">
                                        <span className="amount">₱{parseFloat(vehicle.fixed_price || 0).toLocaleString()}</span>
                                        <span className="period"> / {vehicle.fixed_rental_days} day{vehicle.fixed_rental_days > 1 ? 's' : ''}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="price-display">
                                    <span className="amount">₱{vehicle.daily_rate?.toLocaleString()}</span>
                                    <span className="period"> /day</span>
                                </div>
                            )}

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

                                {/* Return Date — auto for fixed, manual for flexible */}
                                <div className="form-group" style={{ marginBottom: 16 }}>
                                    <label className="form-label">
                                        Return Date
                                        {isFixed && booking.end_date && (
                                            <span style={{ fontSize: 11, color: 'var(--primary-600)', marginLeft: 8, fontWeight: 600 }}>
                                                (Auto: {vehicle.fixed_rental_days} days)
                                            </span>
                                        )}
                                    </label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        style={{ width: '100%', opacity: isFixed ? 0.7 : 1, cursor: isFixed ? 'not-allowed' : 'default', background: isFixed ? 'var(--neutral-50)' : undefined }}
                                        value={booking.end_date}
                                        onChange={(e) => !isFixed && setBooking({ ...booking, end_date: e.target.value })}
                                        min={booking.start_date || new Date().toISOString().split('T')[0]}
                                        readOnly={isFixed}
                                        required
                                    />
                                    {isFixed && !booking.start_date && (
                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                            Select pick-up date and the end date will be auto-computed.
                                        </div>
                                    )}
                                </div>

                                {/* Pricing breakdown */}
                                {booking.start_date && booking.end_date && (
                                    <div style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, fontSize: 14 }}>
                                        {isFixed ? (
                                            <>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                    <span>Fixed deal ({vehicle.fixed_rental_days} day{vehicle.fixed_rental_days > 1 ? 's' : ''})</span>
                                                    <span style={{ fontWeight: 700 }}>₱{parseFloat(vehicle.fixed_price || 0).toLocaleString()}</span>
                                                </div>
                                                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, marginTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                                                    <span>Total</span>
                                                    <span style={{ color: 'var(--primary-700)', fontFamily: 'var(--font-display)' }}>₱{parseFloat(vehicle.fixed_price || 0).toLocaleString()}</span>
                                                </div>
                                            </>
                                        ) : (
                                            <>
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
                                                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, marginTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                                                    <span>Total</span>
                                                    <span style={{ color: 'var(--primary-700)', fontFamily: 'var(--font-display)' }}>₱{total.toLocaleString()}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

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
                        </>
                    )}
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
                                {isFixed ? (
                                    <span style={{ background: 'var(--accent-100)', color: 'var(--accent-700)', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>📌 Fixed Pricing</span>
                                ) : (
                                    <span style={{ background: 'var(--success-50)', color: 'var(--success-700)', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>🔄 Flexible Pricing</span>
                                )}
                            </div>
                            <h1 style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 8 }}>
                                {vehicle.year} {vehicle.make} {vehicle.model}
                            </h1>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16, flexWrap: 'wrap' }}>
                                {/* Bug 3 Fix: Full address with city + province */}
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FiMapPin /> {fullAddress || vehicle.pickup_location}</span>
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
                                    isFixed
                                        ? { label: 'Fixed Deal', value: vehicle.fixed_price ? `₱${parseFloat(vehicle.fixed_price).toLocaleString()} / ${vehicle.fixed_rental_days} day(s)` : '—' }
                                        : { label: 'Daily Rate', value: `₱${vehicle.daily_rate?.toLocaleString()}/day` },
                                    vehicle.mileage ? { label: 'Mileage', value: `${vehicle.mileage.toLocaleString()} km` } : null,
                                ].filter(Boolean).map((spec, i) => (
                                    <div key={i} style={{ padding: 12, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{spec.label}</div>
                                        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{spec.value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Owner Contact Info */}
                            {vehicle.contact_info && (
                                <div style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 12,
                                    padding: '14px 18px', background: 'var(--neutral-50)',
                                    border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)',
                                    marginBottom: 24,
                                }}>
                                    <span style={{ fontSize: 22, flexShrink: 0 }}>📞</span>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Owner Contact &amp; Negotiation</div>
                                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{vehicle.contact_info}</div>
                                    </div>
                                </div>
                            )}

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
                                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--primary-700)' }}>Rental Terms &amp; Conditions</div>
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

                {/* Owner Info + Pricing */}
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

                    {/* Pricing Card — adapts to pricing type */}
                    <div className="card">
                        <div className="card-body">
                            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Pricing &amp; Details</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {isFixed ? (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>Fixed Price</span>
                                            <span style={{ fontWeight: 700, color: 'var(--accent-700)' }}>₱{parseFloat(vehicle.fixed_price || 0).toLocaleString()}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>Rental Duration</span>
                                            <span style={{ fontWeight: 700 }}>{vehicle.fixed_rental_days} day{vehicle.fixed_rental_days > 1 ? 's' : ''}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>Effective Daily Rate</span>
                                            <span style={{ fontWeight: 700 }}>₱{(parseFloat(vehicle.fixed_price || 0) / parseInt(vehicle.fixed_rental_days || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}/day</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
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
                                        {vehicle.available_durations?.length > 0 && (
                                            <div style={{ marginTop: 8 }}>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Available Durations</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                    {vehicle.available_durations.map(d => {
                                                        const label = { '1_day': '1 Day', '2_days': '2 Days', '3_days': '3 Days', '1_week': '1 Week', '2_weeks': '2 Weeks', '1_month': '1 Month' }[d] || d;
                                                        return <span key={d} className="badge badge-info" style={{ fontSize: 12 }}>{label}</span>;
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
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
