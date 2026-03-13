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
                <div className="vehicle-images relative">
                    {currentImage ? (
                        <>
                            <img src={currentImage} alt={`${vehicle.make} ${vehicle.model}`} className="w-full h-full object-cover" />
                            {/* Image navigation arrows */}
                            {displayImages.length > 1 && (
                                <>
                                    <button
                                        onClick={() => setSelectedImageIndex(i => (i - 1 + displayImages.length) % displayImages.length)}
                                        className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/55 text-white border-none rounded-full w-9 h-9 flex items-center justify-center cursor-pointer z-[2]"
                                    ><FiChevronLeft /></button>
                                    <button
                                        onClick={() => setSelectedImageIndex(i => (i + 1) % displayImages.length)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/55 text-white border-none rounded-full w-9 h-9 flex items-center justify-center cursor-pointer z-[2]"
                                    ><FiChevronRight /></button>
                                    {/* Dots indicator */}
                                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-1.5 z-[2]">
                                        {displayImages.map((_, i) => (
                                            <div key={i} onClick={() => setSelectedImageIndex(i)} className={`w-2 h-2 rounded-full cursor-pointer border border-white/80 ${i === selectedImageIndex ? 'bg-white' : 'bg-white/45'}`} />
                                        ))}
                                    </div>
                                </>
                            )}
                            {/* Thumbnail strip */}
                            {displayImages.length > 1 && (
                                <div className="absolute bottom-0 left-0 right-0 flex gap-1.5 p-2 bg-gradient-to-t from-black/70 to-transparent overflow-x-auto">
                                    {displayImages.map((img, i) => (
                                        <img key={i} src={img} alt={`Photo ${i + 1}`} onClick={() => setSelectedImageIndex(i)}
                                            className={`w-[52px] h-[38px] object-cover rounded-md cursor-pointer shrink-0 border-2 transition-all duration-150 ${i === selectedImageIndex ? 'border-white opacity-100' : 'border-transparent opacity-65'}`} />
                                    ))}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[80px] bg-gradient-to-br from-[var(--neutral-100)] to-[var(--neutral-200)]">
                            🚗
                        </div>
                    )}
                    <span className={`vehicle-card-badge ${vehicle.is_available ? 'available' : 'rented'} !bottom-4 !top-auto z-[3]`}>
                        {vehicle.is_available ? '✅ Available' : '🔒 Currently Rented'}
                    </span>
                </div>

                {/* Booking Card */}
                <div className="vehicle-booking-card">
                    {/* ── Already Booked Banner ── */}
                    {existingBooking ? (
                        <div className="bg-gradient-to-br from-[var(--primary-50)] to-[var(--primary-100)] border-2 border-[var(--primary-300)] rounded-[var(--radius-lg)] p-5 text-center">
                            <div className="text-[32px] mb-2">📋</div>
                            <div className="font-extrabold text-base text-[var(--primary-700)] mb-1.5">
                                You Already Booked This Car
                            </div>
                            <div className="text-[13px] text-[var(--primary-600)] mb-3">
                                {new Date(existingBooking.start_date).toLocaleDateString()} → {new Date(existingBooking.end_date).toLocaleDateString()}
                            </div>
                            <div className="text-[18px] font-extrabold font-[var(--font-display)] text-[var(--primary-700)] mb-1">
                                ₱{existingBooking.total_amount?.toLocaleString()}
                            </div>
                            <div className="text-[12px] text-[var(--text-secondary)] mb-4">
                                {existingBooking.total_days} day(s) · Status: <strong className="capitalize">{existingBooking.status}</strong>
                            </div>
                            <button className="btn btn-secondary w-full" onClick={() => navigate('/bookings')}>
                                View My Bookings
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* ── Fixed Pricing Display ── */}
                            {isFixed ? (
                                <div className="mb-4">
                                    <div className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">Fixed Deal Price</div>
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
                                <div className="form-group mb-3">
                                    <label className="form-label">Pick-up Date</label>
                                    <input
                                        type="date"
                                        className="form-input w-full"
                                        value={booking.start_date}
                                        onChange={(e) => setBooking({ ...booking, start_date: e.target.value })}
                                        min={new Date().toISOString().split('T')[0]}
                                        required
                                    />
                                </div>

                                {/* Return Date — auto for fixed, manual for flexible */}
                                <div className="form-group mb-4">
                                    <label className="form-label">
                                        Return Date
                                        {isFixed && booking.end_date && (
                                            <span className="text-[11px] text-[var(--primary-600)] ml-2 font-semibold">
                                                (Auto: {vehicle.fixed_rental_days} days)
                                            </span>
                                        )}
                                    </label>
                                    <input
                                        type="date"
                                        className={`form-input w-full ${isFixed ? 'opacity-70 cursor-not-allowed bg-[var(--neutral-50)]' : ''}`}
                                        value={booking.end_date}
                                        onChange={(e) => !isFixed && setBooking({ ...booking, end_date: e.target.value })}
                                        min={booking.start_date || new Date().toISOString().split('T')[0]}
                                        readOnly={isFixed}
                                        required
                                    />
                                    {isFixed && !booking.start_date && (
                                        <div className="text-[11px] text-[var(--text-tertiary)] mt-1">
                                            Select pick-up date and the end date will be auto-computed.
                                        </div>
                                    )}
                                </div>

                                {/* Pricing breakdown */}
                                {booking.start_date && booking.end_date && (
                                    <div className="bg-[var(--neutral-50)] rounded-[var(--radius-md)] p-4 mb-3 text-sm">
                                        {isFixed ? (
                                            <>
                                                <div className="flex justify-between mb-1">
                                                    <span>Fixed deal ({vehicle.fixed_rental_days} day{vehicle.fixed_rental_days > 1 ? 's' : ''})</span>
                                                    <span className="font-bold">₱{parseFloat(vehicle.fixed_price || 0).toLocaleString()}</span>
                                                </div>
                                                <div className="border-t border-[var(--border-light)] pt-2 mt-2 flex justify-between font-bold text-base">
                                                    <span>Total</span>
                                                    <span className="text-[var(--primary-700)] font-[var(--font-display)]">₱{parseFloat(vehicle.fixed_price || 0).toLocaleString()}</span>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex justify-between mb-2">
                                                    <span>₱{vehicle.daily_rate.toLocaleString()} × {days} day{days > 1 ? 's' : ''}</span>
                                                    <span className="font-semibold">₱{subtotal.toLocaleString()}</span>
                                                </div>
                                                <div className="flex justify-between mb-2">
                                                    <span>Service fee (10%)</span>
                                                    <span className="font-semibold">₱{fee.toLocaleString()}</span>
                                                </div>
                                                {vehicle.security_deposit > 0 && (
                                                    <div className="flex justify-between mb-2">
                                                        <span>Security deposit</span>
                                                        <span className="font-semibold">₱{vehicle.security_deposit.toLocaleString()}</span>
                                                    </div>
                                                )}
                                                <div className="border-t border-[var(--border-light)] pt-2 mt-2 flex justify-between font-bold text-base">
                                                    <span>Total</span>
                                                    <span className="text-[var(--primary-700)] font-[var(--font-display)]">₱{total.toLocaleString()}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    className="btn btn-accent btn-lg w-full"
                                    disabled={bookingLoading || !vehicle.is_available}
                                >
                                    {bookingLoading ? 'Submitting...' : vehicle.is_available ? 'Request to Book' : 'Currently Unavailable'}
                                </button>
                            </form>

                            <div className="flex items-center gap-2 mt-4 justify-center text-[var(--text-tertiary)] text-[13px]">
                                <FiShield /> Verified owner · Digital agreement included
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Vehicle Details */}
            <div className="grid grid-cols-[1.5fr_1fr] gap-6">
                <div>
                    <div className="card mb-6">
                        <div className="card-body">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="badge badge-info">{vehicle.body_type}</span>
                                <span className="badge badge-success">{vehicle.year}</span>
                                {isFixed ? (
                                    <span className="bg-[var(--accent-100)] text-[var(--accent-700)] rounded-[20px] p-[2px_10px] text-[11px] font-bold">📌 Fixed Pricing</span>
                                ) : (
                                    <span className="bg-[var(--success-50)] text-[var(--success-700)] rounded-[20px] p-[2px_10px] text-[11px] font-bold">🔄 Flexible Pricing</span>
                                )}
                            </div>
                            <h1 className="text-[28px] font-extrabold font-[var(--font-display)] mb-2">
                                {vehicle.year} {vehicle.make} {vehicle.model}
                            </h1>
                            <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)] mb-4 flex-wrap">
                                {/* Bug 3 Fix: Full address with city + province */}
                                <span className="flex items-center gap-1"><FiMapPin /> {fullAddress || vehicle.pickup_location}</span>
                                <span className="flex items-center gap-1"><FiUsers /> {vehicle.seating_capacity} seats</span>
                                <span className="flex items-center gap-1"><FiSettings /> {vehicle.transmission}</span>
                            </div>

                            {vehicle.description && (
                                <div className="mb-6">
                                    <h3 className="text-[15px] font-bold mb-2">Description</h3>
                                    <p className="text-sm text-[var(--text-secondary)] leading-loose">{vehicle.description}</p>
                                </div>
                            )}

                            <h3 className="text-[15px] font-bold mb-3">Vehicle Specifications</h3>
                            <div className="grid grid-cols-2 gap-3 mb-6">
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
                                    <div key={i} className="p-3 bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                                        <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">{spec.label}</div>
                                        <div className="text-sm font-semibold mt-1">{spec.value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Owner Contact Info */}
                            {vehicle.contact_info && (
                                <div className="flex items-start gap-3 p-[14px_18px] bg-[var(--neutral-50)] border border-[var(--border-light)] rounded-[var(--radius-lg)] mb-6">
                                    <span className="text-[22px] shrink-0">📞</span>
                                    <div>
                                        <div className="font-bold text-sm mb-1">Owner Contact &amp; Negotiation</div>
                                        <div className="text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{vehicle.contact_info}</div>
                                    </div>
                                </div>
                            )}

                            {vehicle.features?.length > 0 && (
                                <>
                                    <h3 className="text-[15px] font-bold mb-3">Features</h3>
                                    <div className="flex flex-wrap gap-2 mb-6">
                                        {vehicle.features.map((f, i) => (
                                            <span key={i} className="badge badge-info">
                                                <FiCheckCircle /> {f}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}

                            {vehicle.agreement_url && (
                                <div className="flex items-center gap-3 p-[14px_18px] bg-[var(--primary-50)] border border-[var(--primary-200)] rounded-[var(--radius-lg)] mb-6">
                                    <span className="text-[22px]">📄</span>
                                    <div className="flex-1">
                                        <div className="font-bold text-sm text-[var(--primary-700)]">Rental Terms &amp; Conditions</div>
                                        <div className="text-[12px] text-[var(--primary-500)]">The owner has uploaded a rental agreement. Please review before booking.</div>
                                    </div>
                                    <a
                                        href={vehicle.agreement_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn btn-sm bg-[var(--primary-600)] text-white no-underline whitespace-nowrap"
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
                            <h2 className="text-base font-bold font-[var(--font-display)]">
                                Reviews ({reviews.length})
                            </h2>
                        </div>
                        {reviews.length === 0 ? (
                            <div className="card-body text-center p-12 text-[var(--text-tertiary)]">
                                No reviews yet for this vehicle
                            </div>
                        ) : (
                            <div className="card-body">
                                {reviews.map((review) => (
                                    <div key={review.id} className="pb-4 mb-4 border-b border-[var(--border-light)]">
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-[var(--primary-100)] flex items-center justify-center text-[12px] font-bold text-[var(--primary-700)]">
                                                    {review.profiles?.full_name?.[0] || 'U'}
                                                </div>
                                                <span className="font-semibold text-sm">{review.profiles?.full_name || 'Anonymous'}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {[1, 2, 3, 4, 5].map(s => (
                                                    <FiStar key={s} className={`text-[14px] ${s <= review.rating ? 'text-[#facc15] fill-[#facc15]' : 'text-[var(--neutral-200)]'}`} />
                                                ))}
                                            </div>
                                        </div>
                                        {review.comment && <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{review.comment}</p>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Owner Info + Pricing */}
                <div>
                    <div className="card mb-6">
                        <div className="card-body">
                            <h3 className="text-[15px] font-bold mb-4">Car Owner</h3>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--primary-400)] to-[var(--accent-400)] flex items-center justify-center text-white font-bold">
                                    {owner?.full_name?.[0] || 'O'}
                                </div>
                                <div>
                                    <div className="font-bold">{owner?.full_name}</div>
                                    <div className="text-[13px] text-[var(--text-secondary)] flex items-center gap-1">
                                        <FiCheckCircle className="text-[var(--success-500)]" /> Verified Owner
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="text-center flex-1 p-3 bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                                    <div className="text-[18px] font-extrabold font-[var(--font-display)]">
                                        {owner?.average_rating?.toFixed(1) || '0.0'}
                                    </div>
                                    <div className="text-[11px] text-[var(--text-tertiary)]">Rating</div>
                                </div>
                                <div className="text-center flex-1 p-3 bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                                    <div className="text-[18px] font-extrabold font-[var(--font-display)]">
                                        {owner?.total_reviews || 0}
                                    </div>
                                    <div className="text-[11px] text-[var(--text-tertiary)]">Reviews</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Pricing Card — adapts to pricing type */}
                    <div className="card">
                        <div className="card-body">
                            <h3 className="text-[15px] font-bold mb-4">Pricing &amp; Details</h3>
                            <div className="flex flex-col gap-3">
                                {isFixed ? (
                                    <>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-[var(--text-secondary)]">Fixed Price</span>
                                            <span className="font-bold text-[var(--accent-700)]">₱{parseFloat(vehicle.fixed_price || 0).toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-[var(--text-secondary)]">Rental Duration</span>
                                            <span className="font-bold">{vehicle.fixed_rental_days} day{vehicle.fixed_rental_days > 1 ? 's' : ''}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-[var(--text-secondary)]">Effective Daily Rate</span>
                                            <span className="font-bold">₱{(parseFloat(vehicle.fixed_price || 0) / parseInt(vehicle.fixed_rental_days || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}/day</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-[var(--text-secondary)]">Daily Rate</span>
                                            <span className="font-bold">₱{vehicle.daily_rate?.toLocaleString()}</span>
                                        </div>
                                        {vehicle.security_deposit > 0 && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-[var(--text-secondary)]">Security Deposit</span>
                                                <span className="font-bold">₱{vehicle.security_deposit?.toLocaleString()}</span>
                                            </div>
                                        )}
                                        {vehicle.available_durations?.length > 0 && (
                                            <div className="mt-2">
                                                <div className="text-[12px] font-semibold text-[var(--text-tertiary)] uppercase mb-2">Available Durations</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {vehicle.available_durations.map(d => {
                                                        const label = { '1_day': '1 Day', '2_days': '2 Days', '3_days': '3 Days', '1_week': '1 Week', '2_weeks': '2 Weeks', '1_month': '1 Month' }[d] || d;
                                                        return <span key={d} className="badge badge-info text-[12px]">{label}</span>;
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
            <div className="mt-6">
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
