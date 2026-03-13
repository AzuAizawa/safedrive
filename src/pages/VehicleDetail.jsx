import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    FiCalendar,
    FiCheckCircle,
    FiChevronLeft,
    FiChevronRight,
    FiFileText,
    FiMapPin,
    FiSettings,
    FiShield,
    FiStar,
    FiUsers,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import VerificationGate from '../components/VerificationGate';
import BackButton from '../components/BackButton';
import AvailabilityCalendar from '../components/AvailabilityCalendar';
import { badgeClass, ui } from '../lib/ui';

function money(value) {
    return `PHP ${Number(value || 0).toLocaleString()}`;
}

function shortDate(value) {
    return new Date(value).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

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
    const [existingBooking, setExistingBooking] = useState(null);

    useEffect(() => {
        fetchVehicle();
    }, [id, user?.id]);

    useEffect(() => {
        if (vehicle?.pricing_type === 'fixed' && booking.start_date && vehicle.fixed_rental_days) {
            const start = new Date(booking.start_date);
            start.setDate(start.getDate() + parseInt(vehicle.fixed_rental_days, 10) - 1);
            setBooking((current) => ({ ...current, end_date: start.toISOString().split('T')[0] }));
        }
    }, [booking.start_date, vehicle]);

    const pricing = useMemo(() => {
        if (!vehicle || !booking.start_date || !booking.end_date) {
            return { days: 0, subtotal: 0, fee: 0, total: 0 };
        }

        const start = new Date(booking.start_date);
        const end = new Date(booking.end_date);
        const days = Math.max(1, Math.ceil((end - start) / 86400000) + 1);

        if (vehicle.pricing_type === 'fixed') {
            const total = parseFloat(vehicle.fixed_price) || 0;
            return { days: parseInt(vehicle.fixed_rental_days || 1, 10), subtotal: total, fee: 0, total };
        }

        const subtotal = days * (vehicle.daily_rate || 0);
        const fee = subtotal * 0.1;
        const total = subtotal + fee + (vehicle.security_deposit || 0);
        return { days, subtotal, fee, total };
    }, [booking.end_date, booking.start_date, vehicle]);

    const fetchVehicle = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('vehicles')
                .select('*, profiles!vehicles_owner_id_fkey(*)')
                .eq('id', id)
                .single();

            if (error) throw error;

            setVehicle(data);
            setOwner(data.profiles);

            const { data: reviewsData } = await supabase
                .from('reviews')
                .select('*, profiles!reviews_reviewer_id_fkey(full_name, avatar_url)')
                .eq('vehicle_id', id)
                .order('created_at', { ascending: false });
            setReviews(reviewsData || []);

            if (user) {
                const { data: activeBooking } = await supabase
                    .from('bookings')
                    .select('id, start_date, end_date, status, total_amount')
                    .eq('vehicle_id', id)
                    .eq('renter_id', user.id)
                    .in('status', ['pending', 'confirmed', 'active'])
                    .maybeSingle();
                setExistingBooking(activeBooking);
            }
        } catch (err) {
            console.error('Error:', err);
            toast.error('Vehicle not found');
            navigate('/vehicles');
        } finally {
            setLoading(false);
        }
    };

    const submitBooking = async (event) => {
        event.preventDefault();

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

        if (!booking.start_date || !booking.end_date) {
            toast.error('Please select valid booking dates');
            return;
        }

        try {
            const { data: conflicts } = await supabase
                .from('vehicle_availability')
                .select('unavailable_date')
                .eq('vehicle_id', vehicle.id)
                .gte('unavailable_date', booking.start_date)
                .lte('unavailable_date', booking.end_date);

            if (conflicts?.length) {
                toast.error('Some selected dates are unavailable');
                return;
            }
        } catch (err) {
            console.warn('Availability check failed:', err);
        }

        setBookingLoading(true);
        try {
            const { data, error } = await supabase
                .from('bookings')
                .insert({
                    vehicle_id: vehicle.id,
                    renter_id: user.id,
                    owner_id: vehicle.owner_id,
                    start_date: booking.start_date,
                    end_date: booking.end_date,
                    daily_rate: vehicle.pricing_type === 'fixed'
                        ? parseFloat(vehicle.fixed_price || 0) / parseInt(vehicle.fixed_rental_days || 1, 10)
                        : vehicle.daily_rate,
                    total_days: pricing.days,
                    subtotal: pricing.subtotal,
                    service_fee: pricing.fee,
                    security_deposit: vehicle.pricing_type === 'flexible' ? (vehicle.security_deposit || 0) : 0,
                    total_amount: pricing.total,
                    pickup_location: vehicle.pickup_location,
                    status: 'pending',
                })
                .select()
                .single();

            if (error) throw error;

            await supabase.from('notifications').insert({
                user_id: vehicle.owner_id,
                title: 'New Booking Request',
                message: `${profile?.full_name || 'A renter'} wants to rent your ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                type: 'booking',
                reference_id: data.id,
                reference_type: 'booking',
            });

            toast.success('Booking request sent');
            navigate('/bookings');
        } catch (err) {
            console.error('Booking error:', err);
            toast.error('Failed to create booking');
        } finally {
            setBookingLoading(false);
        }
    };

    if (loading) {
        return (
            <div className={ui.loadingScreen}>
                <div className={ui.spinner} />
                <p className="text-sm font-medium text-text-secondary">Loading vehicle details...</p>
            </div>
        );
    }

    if (!vehicle) return null;

    const gallery = [vehicle.thumbnail_url, ...(vehicle.images || []).filter((image) => image && image !== vehicle.thumbnail_url)].filter(Boolean);
    const currentImage = gallery[selectedImageIndex];
    const isFixed = vehicle.pricing_type === 'fixed';
    const address = [vehicle.pickup_location, vehicle.pickup_city, vehicle.pickup_province].filter(Boolean).join(', ');

    return (
        <div className={ui.page}>
            <BackButton />

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6">
                    <section className="overflow-hidden rounded-[36px] border border-border-light bg-neutral-100 shadow-soft">
                        <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100">
                            {currentImage ? (
                                <img src={currentImage} alt={`${vehicle.make} ${vehicle.model}`} className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full items-center justify-center text-7xl">🚗</div>
                            )}
                            <div className="absolute left-5 top-5 flex gap-2">
                                <span className={vehicle.is_available ? badgeClass('success') : badgeClass('pending')}>
                                    {vehicle.is_available ? 'Available' : 'Unavailable'}
                                </span>
                                <span className={isFixed ? badgeClass('info') : badgeClass('neutral')}>
                                    {isFixed ? 'Fixed price' : 'Flexible rate'}
                                </span>
                            </div>
                            {gallery.length > 1 && (
                                <>
                                    <button type="button" onClick={() => setSelectedImageIndex((index) => (index - 1 + gallery.length) % gallery.length)} className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white">
                                        <FiChevronLeft />
                                    </button>
                                    <button type="button" onClick={() => setSelectedImageIndex((index) => (index + 1) % gallery.length)} className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white">
                                        <FiChevronRight />
                                    </button>
                                </>
                            )}
                        </div>
                        {gallery.length > 1 && (
                            <div className="flex gap-3 overflow-x-auto border-t border-white/60 bg-white/75 px-5 py-4 backdrop-blur">
                                {gallery.map((image, index) => (
                                    <button key={`${image}-${index}`} type="button" onClick={() => setSelectedImageIndex(index)} className={`h-16 w-24 shrink-0 overflow-hidden rounded-2xl border-2 ${index === selectedImageIndex ? 'border-primary-500' : 'border-transparent opacity-70'}`}>
                                        <img src={image} alt={`Vehicle ${index + 1}`} className="h-full w-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className={ui.section}>
                        <div className={ui.sectionBody}>
                            <div className="flex flex-wrap gap-2">
                                <span className={badgeClass('info')}>{vehicle.body_type}</span>
                                <span className={badgeClass('neutral')}>{vehicle.transmission}</span>
                                <span className={badgeClass('neutral')}>{vehicle.year}</span>
                            </div>
                            <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-text-primary">
                                {vehicle.year} {vehicle.make} {vehicle.model}
                            </h1>
                            <div className="mt-4 flex flex-wrap gap-4 text-sm text-text-secondary">
                                <span className="inline-flex items-center gap-2"><FiMapPin /> {address}</span>
                                <span className="inline-flex items-center gap-2"><FiUsers /> {vehicle.seating_capacity} seats</span>
                                <span className="inline-flex items-center gap-2"><FiSettings /> {vehicle.fuel_type}</span>
                            </div>
                            {vehicle.description && (
                                <p className="mt-5 text-sm leading-7 text-text-secondary">{vehicle.description}</p>
                            )}
                        </div>
                    </section>

                    <section className={ui.section}>
                        <div className={ui.sectionHeader}>
                            <div>
                                <h2 className="font-display text-2xl font-bold text-text-primary">Vehicle details</h2>
                                <p className="text-sm text-text-tertiary">Key specifications, terms, and rider expectations.</p>
                            </div>
                        </div>
                        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
                            {[
                                ['Body type', vehicle.body_type],
                                ['Transmission', vehicle.transmission],
                                ['Fuel type', vehicle.fuel_type],
                                ['Color', vehicle.color],
                                ['Seating', `${vehicle.seating_capacity} seats`],
                                ['Rate', isFixed ? `${money(vehicle.fixed_price)} for ${vehicle.fixed_rental_days} day(s)` : `${money(vehicle.daily_rate)} per day`],
                            ].map(([label, value]) => (
                                <div key={label} className="rounded-3xl border border-border-light bg-surface-secondary p-4">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">{label}</div>
                                    <div className="mt-2 text-sm font-semibold text-text-primary">{value}</div>
                                </div>
                            ))}
                        </div>
                        {(vehicle.features?.length > 0 || vehicle.agreement_url || vehicle.contact_info) && (
                            <div className="border-t border-border-light px-5 py-5 sm:px-6">
                                {vehicle.features?.length > 0 && (
                                    <div className="mb-5 flex flex-wrap gap-2">
                                        {vehicle.features.map((feature) => (
                                            <span key={feature} className={badgeClass('info')}>
                                                <FiCheckCircle />
                                                {feature}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {vehicle.contact_info && (
                                    <p className="text-sm leading-7 text-text-secondary">{vehicle.contact_info}</p>
                                )}
                                {vehicle.agreement_url && (
                                    <a href={vehicle.agreement_url} target="_blank" rel="noopener noreferrer" className={`${ui.button.secondary} mt-5`}>
                                        <FiFileText />
                                        View agreement
                                    </a>
                                )}
                            </div>
                        )}
                    </section>

                    <section className={ui.section}>
                        <div className={ui.sectionHeader}>
                            <div>
                                <h2 className="font-display text-2xl font-bold text-text-primary">Reviews</h2>
                                <p className="text-sm text-text-tertiary">{reviews.length} review{reviews.length === 1 ? '' : 's'}</p>
                            </div>
                        </div>
                        <div className={ui.sectionBody}>
                            {reviews.length === 0 ? (
                                <p className="text-sm text-text-secondary">No reviews yet for this vehicle.</p>
                            ) : (
                                <div className="space-y-4">
                                    {reviews.map((review) => (
                                        <article key={review.id} className="rounded-3xl border border-border-light bg-surface-secondary p-4">
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <div className="font-semibold text-text-primary">{review.profiles?.full_name || 'Anonymous'}</div>
                                                    <div className="mt-1 text-xs text-text-tertiary">{shortDate(review.created_at)}</div>
                                                </div>
                                                <div className="flex items-center gap-1 text-warning-600">
                                                    {[1, 2, 3, 4, 5].map((star) => (
                                                        <FiStar key={star} className={star <= review.rating ? 'fill-current' : 'text-neutral-300'} />
                                                    ))}
                                                </div>
                                            </div>
                                            {review.comment && <p className="mt-3 text-sm leading-7 text-text-secondary">{review.comment}</p>}
                                        </article>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                <aside className="space-y-6">
                    <section className="rounded-[36px] border border-border-light bg-surface-primary p-6 shadow-soft xl:sticky xl:top-28">
                        {existingBooking ? (
                            <div className="space-y-4">
                                <div className="rounded-3xl border border-primary-200 bg-primary-50 p-5 text-center">
                                    <div className="text-4xl">📋</div>
                                    <h2 className="mt-3 font-display text-2xl font-bold text-primary-800">You already booked this car</h2>
                                    <p className="mt-2 text-sm text-primary-700">{shortDate(existingBooking.start_date)} to {shortDate(existingBooking.end_date)}</p>
                                    <div className="mt-3 font-display text-3xl font-bold text-primary-800">{money(existingBooking.total_amount)}</div>
                                </div>
                                <button type="button" className={`${ui.button.secondary} w-full`} onClick={() => navigate('/bookings')}>
                                    View my bookings
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="border-b border-border-light pb-5">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">Pricing</div>
                                    <div className="mt-2 font-display text-4xl font-bold text-text-primary">
                                        {isFixed ? money(vehicle.fixed_price) : money(vehicle.daily_rate)}
                                    </div>
                                    <div className="mt-1 text-sm text-text-tertiary">{isFixed ? `for ${vehicle.fixed_rental_days} day(s)` : 'per day'}</div>
                                </div>

                                <form onSubmit={submitBooking} className="space-y-4 pt-5">
                                    <div>
                                        <label className={ui.label}>Pick-up date</label>
                                        <input type="date" className={ui.input} value={booking.start_date} min={new Date().toISOString().split('T')[0]} onChange={(event) => setBooking((current) => ({ ...current, start_date: event.target.value }))} required />
                                    </div>
                                    <div>
                                        <label className={ui.label}>Return date</label>
                                        <input type="date" className={ui.input} value={booking.end_date} min={booking.start_date || new Date().toISOString().split('T')[0]} onChange={(event) => !isFixed && setBooking((current) => ({ ...current, end_date: event.target.value }))} readOnly={isFixed} required />
                                    </div>
                                    {booking.start_date && booking.end_date && (
                                        <div className="rounded-3xl border border-border-light bg-surface-secondary p-4 text-sm">
                                            {isFixed ? (
                                                <>
                                                    <div className="flex justify-between"><span>{vehicle.fixed_rental_days} day package</span><span className="font-semibold text-text-primary">{money(vehicle.fixed_price)}</span></div>
                                                    <div className="mt-3 flex justify-between border-t border-border-light pt-3 font-semibold text-text-primary"><span>Total</span><span>{money(vehicle.fixed_price)}</span></div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="flex justify-between"><span>{money(vehicle.daily_rate)} x {pricing.days} day(s)</span><span className="font-semibold text-text-primary">{money(pricing.subtotal)}</span></div>
                                                    <div className="mt-2 flex justify-between"><span>Service fee</span><span>{money(pricing.fee)}</span></div>
                                                    {vehicle.security_deposit > 0 && <div className="mt-2 flex justify-between"><span>Security deposit</span><span>{money(vehicle.security_deposit)}</span></div>}
                                                    <div className="mt-3 flex justify-between border-t border-border-light pt-3 font-semibold text-text-primary"><span>Total</span><span>{money(pricing.total)}</span></div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                    <button type="submit" className={`${ui.button.accent} w-full`} disabled={bookingLoading || !vehicle.is_available}>
                                        {bookingLoading ? 'Submitting request...' : vehicle.is_available ? 'Request to book' : 'Currently unavailable'}
                                    </button>
                                </form>
                                <div className="mt-4 flex items-center gap-2 text-sm text-text-tertiary">
                                    <FiShield />
                                    Verified owner · Digital agreement supported
                                </div>
                            </>
                        )}
                    </section>

                    <section className={ui.section}>
                        <div className={ui.sectionBody}>
                            <h2 className="font-display text-2xl font-bold text-text-primary">Owner</h2>
                            <div className="mt-4 flex items-center gap-4">
                                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-lg font-semibold text-white">
                                    {owner?.full_name?.[0] || 'O'}
                                </div>
                                <div>
                                    <div className="font-semibold text-text-primary">{owner?.full_name}</div>
                                    <div className="mt-1 inline-flex items-center gap-2 text-sm text-success-700">
                                        <FiCheckCircle />
                                        Verified owner
                                    </div>
                                </div>
                            </div>
                            <div className="mt-5 grid grid-cols-2 gap-4">
                                <div className="rounded-3xl border border-border-light bg-surface-secondary p-4 text-center">
                                    <div className="font-display text-3xl font-bold text-text-primary">{owner?.average_rating?.toFixed(1) || '0.0'}</div>
                                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-text-tertiary">Rating</div>
                                </div>
                                <div className="rounded-3xl border border-border-light bg-surface-secondary p-4 text-center">
                                    <div className="font-display text-3xl font-bold text-text-primary">{owner?.total_reviews || 0}</div>
                                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-text-tertiary">Reviews</div>
                                </div>
                            </div>
                        </div>
                    </section>
                </aside>
            </div>

            <AvailabilityCalendar vehicleId={vehicle.id} editable={false} />

            <VerificationGate isOpen={showVerifyGate} onClose={() => setShowVerifyGate(false)} action="rent this car" />
        </div>
    );
}
