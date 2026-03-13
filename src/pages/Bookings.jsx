import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiCalendar, FiCheck, FiEye, FiFileText, FiMessageSquare, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useUserMode } from '../context/UserModeContext';
import BackButton from '../components/BackButton';
import { bookingStatusClass, cx, ui } from '../lib/ui';

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'active', 'completed', 'cancelled'];

function formatCurrency(value) {
    return `PHP ${Number(value || 0).toLocaleString()}`;
}

function formatDate(value) {
    return new Date(value).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export default function Bookings() {
    const { user, isAdmin } = useAuth();
    const { mode } = useUserMode();
    const navigate = useNavigate();
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('all');
    const [selectedBooking, setSelectedBooking] = useState(null);

    useEffect(() => {
        if (user) {
            fetchBookings();
        }
    }, [mode, user]);

    const fetchBookings = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('bookings')
                .select(`
                    *,
                    vehicles(
                        id,
                        make,
                        model,
                        year,
                        thumbnail_url,
                        images,
                        plate_number,
                        daily_rate,
                        fixed_price,
                        fixed_rental_days,
                        pricing_type,
                        pickup_location,
                        pickup_city,
                        pickup_province
                    ),
                    renter:profiles!bookings_renter_id_fkey(full_name, email, phone),
                    owner:profiles!bookings_owner_id_fkey(full_name, email, phone)
                `)
                .order('created_at', { ascending: false });

            if (!isAdmin) {
                query = mode === 'lister'
                    ? query.eq('owner_id', user.id)
                    : query.eq('renter_id', user.id);
            }

            const { data, error } = await query;
            if (error) throw error;

            setBookings(data || []);
        } catch (err) {
            console.error('Error loading bookings:', err);
            toast.error('Failed to load bookings');
        } finally {
            setLoading(false);
        }
    };

    const updateBookingStatus = async (bookingId, newStatus) => {
        try {
            const { error } = await supabase
                .from('bookings')
                .update({ status: newStatus })
                .eq('id', bookingId);

            if (error) throw error;

            if (newStatus === 'confirmed') {
                const booking = bookings.find((entry) => entry.id === bookingId);
                if (booking) {
                    const start = new Date(booking.start_date);
                    const end = new Date(booking.end_date);
                    const datesToInsert = [];

                    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
                        datesToInsert.push({
                            vehicle_id: booking.vehicle_id,
                            unavailable_date: date.toISOString().split('T')[0],
                            reason: 'booked',
                        });
                    }

                    if (datesToInsert.length > 0) {
                        await supabase.from('vehicle_availability').upsert(datesToInsert, {
                            onConflict: 'vehicle_id,unavailable_date',
                        });
                    }
                }
            }

            toast.success(`Booking ${newStatus}`);
            fetchBookings();
        } catch (err) {
            console.error('Failed updating booking:', err);
            toast.error('Failed to update booking');
        }
    };

    const filteredBookings = useMemo(() => {
        if (activeFilter === 'all') return bookings;
        return bookings.filter((booking) => booking.status === activeFilter);
    }, [activeFilter, bookings]);

    const ownerView = isAdmin || mode === 'lister';

    if (loading) {
        return (
            <div className={ui.loadingScreen}>
                <div className={ui.spinner} />
                <p className="text-sm font-medium text-text-secondary">Loading bookings...</p>
            </div>
        );
    }

    return (
        <div className={ui.page}>
            <BackButton />

            <div className={ui.pageHeader}>
                <h1 className={ui.pageTitle}>
                    {ownerView ? 'Bookings for your vehicles' : 'My bookings'}
                </h1>
                <p className={ui.pageDescription}>
                    {ownerView
                        ? 'Review incoming reservations, contact renters, and approve or decline requests.'
                        : 'Track your reservations, see owner details, and manage the next steps of your trip.'}
                </p>
            </div>

            <section className={ui.section}>
                <div className={ui.sectionHeader}>
                    <div>
                        <div className="text-sm font-semibold text-text-primary">
                            {filteredBookings.length} booking{filteredBookings.length === 1 ? '' : 's'}
                        </div>
                        <div className="text-xs text-text-tertiary">
                            Filter by booking status
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {STATUS_FILTERS.map((status) => (
                            <button
                                key={status}
                                type="button"
                                onClick={() => setActiveFilter(status)}
                                className={cx(
                                    'rounded-full px-4 py-2 text-sm font-semibold transition',
                                    activeFilter === status
                                        ? 'bg-primary-700 text-white shadow-soft'
                                        : 'bg-neutral-100 text-text-secondary hover:bg-neutral-200 hover:text-text-primary'
                                )}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>

                {filteredBookings.length === 0 ? (
                    <div className={ui.sectionBody}>
                        <div className={ui.emptyState}>
                            <div className={ui.emptyIcon}>
                                <FiCalendar />
                            </div>
                            <h2 className="font-display text-2xl font-semibold text-text-primary">
                                No bookings found
                            </h2>
                            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-text-secondary">
                                {ownerView
                                    ? 'You do not have matching booking requests in this view yet.'
                                    : 'You do not have matching renter bookings in this view yet.'}
                            </p>
                            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                                {!ownerView && (
                                    <Link to="/vehicles" className={ui.button.primary}>
                                        Browse vehicles
                                    </Link>
                                )}
                                {ownerView && (
                                    <Link to="/my-vehicles" className={ui.button.secondary}>
                                        Manage vehicles
                                    </Link>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
                        <div className="hidden overflow-hidden rounded-[28px] border border-border-light lg:block">
                            <table className="min-w-full divide-y divide-border-light text-sm">
                                <thead className="bg-surface-secondary text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                                    <tr>
                                        <th className="px-4 py-3.5">Vehicle</th>
                                        <th className="px-4 py-3.5">{ownerView ? 'Customer' : 'Owner'}</th>
                                        <th className="px-4 py-3.5">Dates</th>
                                        <th className="px-4 py-3.5">Amount</th>
                                        <th className="px-4 py-3.5">Status</th>
                                        <th className="px-4 py-3.5 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border-light bg-surface-primary">
                                    {filteredBookings.map((booking) => {
                                        const counterpart = ownerView ? booking.renter : booking.owner;
                                        const vehicleImage = booking.vehicles?.thumbnail_url || booking.vehicles?.images?.[0];

                                        return (
                                            <tr key={booking.id} className="text-text-secondary">
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-neutral-100">
                                                            {vehicleImage ? (
                                                                <img src={vehicleImage} alt="vehicle" className="h-full w-full object-cover" />
                                                            ) : (
                                                                <span className="text-xl">🚗</span>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div className="font-semibold text-text-primary">
                                                                {booking.vehicles?.year} {booking.vehicles?.make} {booking.vehicles?.model}
                                                            </div>
                                                            <div className="text-xs text-text-tertiary">
                                                                {booking.vehicles?.plate_number}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="space-y-1">
                                                        <div className="font-semibold text-text-primary">
                                                            {counterpart?.full_name || 'Unavailable'}
                                                        </div>
                                                        <div className="text-xs text-text-tertiary">
                                                            {[counterpart?.email, counterpart?.phone].filter(Boolean).join(' • ') || 'No contact details'}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="space-y-1 text-sm">
                                                        <div>{formatDate(booking.start_date)}</div>
                                                        <div className="text-text-tertiary">to {formatDate(booking.end_date)}</div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 font-semibold text-text-primary">
                                                    {formatCurrency(booking.total_amount)}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={bookingStatusClass(booking.status)}>{booking.status}</span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex justify-end gap-2">
                                                        {ownerView && booking.status === 'pending' && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className={`${ui.button.success} ${ui.button.sm}`}
                                                                    onClick={() => updateBookingStatus(booking.id, 'confirmed')}
                                                                >
                                                                    <FiCheck /> Accept
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className={`${ui.button.danger} ${ui.button.sm}`}
                                                                    onClick={() => updateBookingStatus(booking.id, 'cancelled')}
                                                                >
                                                                    <FiX /> Decline
                                                                </button>
                                                            </>
                                                        )}
                                                        {!ownerView && booking.status === 'pending' && (
                                                            <button
                                                                type="button"
                                                                className={`${ui.button.secondary} ${ui.button.sm}`}
                                                                onClick={() => {
                                                                    if (window.confirm('Cancel this booking?')) {
                                                                        updateBookingStatus(booking.id, 'cancelled');
                                                                    }
                                                                }}
                                                            >
                                                                <FiX /> Cancel
                                                            </button>
                                                        )}
                                                        {booking.status === 'confirmed' && (
                                                            <Link to={`/agreements/${booking.id}`} className={`${ui.button.secondary} ${ui.button.sm}`}>
                                                                <FiFileText /> Agreement
                                                            </Link>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className={`${ui.button.ghost} ${ui.button.sm}`}
                                                            onClick={() => setSelectedBooking(booking)}
                                                        >
                                                            <FiEye /> Details
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={`${ui.button.ghost} ${ui.button.sm}`}
                                                            onClick={() => navigate(`/messages/${booking.id}`)}
                                                        >
                                                            <FiMessageSquare /> Message
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="grid gap-4 lg:hidden">
                            {filteredBookings.map((booking) => {
                                const counterpart = ownerView ? booking.renter : booking.owner;
                                const vehicleImage = booking.vehicles?.thumbnail_url || booking.vehicles?.images?.[0];

                                return (
                                    <article key={booking.id} className="rounded-[30px] border border-border-light bg-surface-primary p-5 shadow-soft">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex items-start gap-4">
                                                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-neutral-100">
                                                    {vehicleImage ? (
                                                        <img src={vehicleImage} alt="vehicle" className="h-full w-full object-cover" />
                                                    ) : (
                                                        <span className="text-2xl">🚗</span>
                                                    )}
                                                </div>
                                                <div>
                                                    <h2 className="font-semibold text-text-primary">
                                                        {booking.vehicles?.year} {booking.vehicles?.make} {booking.vehicles?.model}
                                                    </h2>
                                                    <p className="mt-1 text-sm text-text-secondary">
                                                        {counterpart?.full_name || 'Unavailable'}
                                                    </p>
                                                    <p className="text-xs text-text-tertiary">
                                                        {[counterpart?.email, counterpart?.phone].filter(Boolean).join(' • ') || 'No contact details'}
                                                    </p>
                                                </div>
                                            </div>
                                            <span className={bookingStatusClass(booking.status)}>{booking.status}</span>
                                        </div>

                                        <div className="mt-5 grid gap-3 rounded-3xl bg-surface-secondary p-4 text-sm text-text-secondary sm:grid-cols-2">
                                            <div>
                                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Dates</div>
                                                <div className="mt-1">{formatDate(booking.start_date)} to {formatDate(booking.end_date)}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Amount</div>
                                                <div className="mt-1 font-semibold text-text-primary">{formatCurrency(booking.total_amount)}</div>
                                            </div>
                                        </div>

                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {ownerView && booking.status === 'pending' && (
                                                <>
                                                    <button
                                                        type="button"
                                                        className={`${ui.button.success} ${ui.button.sm}`}
                                                        onClick={() => updateBookingStatus(booking.id, 'confirmed')}
                                                    >
                                                        <FiCheck /> Accept
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`${ui.button.danger} ${ui.button.sm}`}
                                                        onClick={() => updateBookingStatus(booking.id, 'cancelled')}
                                                    >
                                                        <FiX /> Decline
                                                    </button>
                                                </>
                                            )}
                                            {!ownerView && booking.status === 'pending' && (
                                                <button
                                                    type="button"
                                                    className={`${ui.button.secondary} ${ui.button.sm}`}
                                                    onClick={() => {
                                                        if (window.confirm('Cancel this booking?')) {
                                                            updateBookingStatus(booking.id, 'cancelled');
                                                        }
                                                    }}
                                                >
                                                    <FiX /> Cancel
                                                </button>
                                            )}
                                            {booking.status === 'confirmed' && (
                                                <Link to={`/agreements/${booking.id}`} className={`${ui.button.secondary} ${ui.button.sm}`}>
                                                    <FiFileText /> Agreement
                                                </Link>
                                            )}
                                            <button
                                                type="button"
                                                className={`${ui.button.ghost} ${ui.button.sm}`}
                                                onClick={() => setSelectedBooking(booking)}
                                            >
                                                <FiEye /> Details
                                            </button>
                                            <button
                                                type="button"
                                                className={`${ui.button.ghost} ${ui.button.sm}`}
                                                onClick={() => navigate(`/messages/${booking.id}`)}
                                            >
                                                <FiMessageSquare /> Message
                                            </button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>

            {selectedBooking && (
                <div className={ui.modalOverlay} onClick={() => setSelectedBooking(null)}>
                    <div className={`${ui.modalPanel} max-w-[680px]`} onClick={(e) => e.stopPropagation()}>
                        <div className={ui.sectionHeader}>
                            <div>
                                <div className="font-display text-2xl font-bold text-text-primary">
                                    Booking details
                                </div>
                                <div className="text-sm text-text-tertiary">
                                    {selectedBooking.vehicles?.year} {selectedBooking.vehicles?.make} {selectedBooking.vehicles?.model}
                                </div>
                            </div>
                            <button
                                type="button"
                                className={ui.button.ghost}
                                onClick={() => setSelectedBooking(null)}
                            >
                                <FiX />
                                Close
                            </button>
                        </div>
                        <div className={ui.sectionBody}>
                            <div className="grid gap-4 sm:grid-cols-2">
                                {[
                                    { label: ownerView ? 'Customer' : 'Owner', value: ownerView ? selectedBooking.renter?.full_name : selectedBooking.owner?.full_name },
                                    { label: 'Status', value: selectedBooking.status },
                                    { label: 'Start date', value: formatDate(selectedBooking.start_date) },
                                    { label: 'End date', value: formatDate(selectedBooking.end_date) },
                                    { label: 'Vehicle', value: `${selectedBooking.vehicles?.year} ${selectedBooking.vehicles?.make} ${selectedBooking.vehicles?.model}` },
                                    { label: 'Amount', value: formatCurrency(selectedBooking.total_amount) },
                                ].map((item) => (
                                    <div key={item.label} className="rounded-3xl border border-border-light bg-surface-secondary p-4">
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                                            {item.label}
                                        </div>
                                        <div className="mt-2 text-sm font-semibold text-text-primary">
                                            {item.value || 'Unavailable'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
