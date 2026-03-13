import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    FiCalendar,
    FiCheck,
    FiClock,
    FiCreditCard,
    FiDollarSign,
    FiEye,
    FiFileText,
    FiMessageSquare,
    FiX,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useUserMode } from '../context/UserModeContext';
import BackButton from '../components/BackButton';
import { bookingStatusClass, cx, ui } from '../lib/ui';
import {
    createBookingInvoice,
    checkInvoiceStatus,
    formatPHP,
    getDeadline,
    getTimeRemaining,
    isDeadlinePassed,
} from '../lib/xendit';

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'active', 'completed', 'cancelled', 'expired'];

function formatDate(value) {
    return new Date(value).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

function PaymentStatusBadge({ status }) {
    const map = {
        unpaid: { class: 'border-warning-200 bg-warning-50 text-warning-700', label: 'Unpaid' },
        pending: { class: 'border-warning-200 bg-warning-50 text-warning-700', label: 'Payment Pending' },
        paid: { class: 'border-success-200 bg-success-50 text-success-700', label: 'Paid' },
        failed: { class: 'border-error-200 bg-error-50 text-error-700', label: 'Payment Failed' },
        refunded: { class: 'border-primary-200 bg-primary-50 text-primary-700', label: 'Refunded' },
    };
    const info = map[status] || map.unpaid;
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${info.class}`}>
            <FiDollarSign className="h-3 w-3" />
            {info.label}
        </span>
    );
}

function PayoutStatusBadge({ status }) {
    const map = {
        pending: { class: 'border-neutral-200 bg-neutral-50 text-neutral-600', label: 'Payout Pending' },
        processing: { class: 'border-warning-200 bg-warning-50 text-warning-700', label: 'Processing' },
        completed: { class: 'border-success-200 bg-success-50 text-success-700', label: 'Paid Out' },
        failed: { class: 'border-error-200 bg-error-50 text-error-700', label: 'Payout Failed' },
    };
    const info = map[status] || map.pending;
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${info.class}`}>
            {info.label}
        </span>
    );
}

export default function Bookings() {
    const { user, isAdmin, profile } = useAuth();
    const { mode } = useUserMode();
    const navigate = useNavigate();
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('all');
    const [selectedBooking, setSelectedBooking] = useState(null);
    const [actionLoading, setActionLoading] = useState(null);

    useEffect(() => {
        if (user) {
            fetchBookings();
        }
    }, [mode, user]);

    // Auto-refresh timer for deadlines
    useEffect(() => {
        const interval = setInterval(() => {
            // Force re-render to update countdown timers
            setBookings((prev) => [...prev]);
        }, 60000); // every minute
        return () => clearInterval(interval);
    }, []);

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

    /** OWNER ACCEPTS the booking → 24h payment window starts */
    const acceptBooking = async (bookingId) => {
        setActionLoading(bookingId);
        try {
            const booking = bookings.find((b) => b.id === bookingId);
            if (!booking) throw new Error('Booking not found');

            const paymentDeadline = getDeadline(24);

            // 1. Update booking status to confirmed with payment deadline
            const { error: updateError } = await supabase
                .from('bookings')
                .update({
                    status: 'confirmed',
                    booking_accepted_at: new Date().toISOString(),
                    payment_deadline: paymentDeadline,
                })
                .eq('id', bookingId);

            if (updateError) throw updateError;

            // 2. Block dates in availability calendar
            const start = new Date(booking.start_date);
            const end = new Date(booking.end_date);
            const datesToInsert = [];
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                datesToInsert.push({
                    vehicle_id: booking.vehicle_id,
                    unavailable_date: d.toISOString().split('T')[0],
                    reason: 'booked',
                });
            }
            if (datesToInsert.length > 0) {
                await supabase.from('vehicle_availability').upsert(datesToInsert, {
                    onConflict: 'vehicle_id,unavailable_date',
                });
            }

            // 3. Notify renter
            await supabase.from('notifications').insert({
                user_id: booking.renter_id,
                title: 'Booking Accepted! 🎉',
                message: `Your booking for ${booking.vehicles?.year} ${booking.vehicles?.make} ${booking.vehicles?.model} has been accepted! Please pay ${formatPHP(booking.total_amount)} within 24 hours to confirm.`,
                type: 'payment',
                reference_id: bookingId,
                reference_type: 'booking',
            });

            toast.success('Booking accepted! Renter has 24 hours to pay.');
            fetchBookings();
        } catch (err) {
            console.error('Accept error:', err);
            toast.error('Failed to accept booking');
        } finally {
            setActionLoading(null);
        }
    };

    /** OWNER or RENTER declines/cancels the booking */
    const declineBooking = async (bookingId) => {
        setActionLoading(bookingId);
        try {
            const { error } = await supabase
                .from('bookings')
                .update({
                    status: 'cancelled',
                    cancelled_by: user.id,
                    cancelled_at: new Date().toISOString(),
                })
                .eq('id', bookingId);

            if (error) throw error;

            const booking = bookings.find((b) => b.id === bookingId);
            const notifyUserId = user.id === booking?.owner_id ? booking?.renter_id : booking?.owner_id;

            if (notifyUserId) {
                await supabase.from('notifications').insert({
                    user_id: notifyUserId,
                    title: 'Booking Cancelled',
                    message: `The booking for ${booking?.vehicles?.year} ${booking?.vehicles?.make} ${booking?.vehicles?.model} has been cancelled.`,
                    type: 'booking',
                    reference_id: bookingId,
                    reference_type: 'booking',
                });
            }

            toast.success('Booking cancelled');
            fetchBookings();
        } catch (err) {
            console.error('Decline error:', err);
            toast.error('Failed to cancel booking');
        } finally {
            setActionLoading(null);
        }
    };

    /** RENTER initiates payment via Xendit */
    const initiatePayment = async (bookingEntry) => {
        setActionLoading(bookingEntry.id);
        try {
            // Check if payment deadline has passed
            if (bookingEntry.payment_deadline && isDeadlinePassed(bookingEntry.payment_deadline)) {
                toast.error('Payment deadline has expired. This booking has been automatically cancelled.');
                fetchBookings();
                return;
            }

            // If there's already an invoice, check its status first
            if (bookingEntry.xendit_invoice_id) {
                try {
                    const invoiceStatus = await checkInvoiceStatus(bookingEntry.xendit_invoice_id);
                    if (invoiceStatus.status === 'PAID' || invoiceStatus.status === 'SETTLED') {
                        // Already paid, update the DB
                        await supabase
                            .from('bookings')
                            .update({ payment_status: 'paid' })
                            .eq('id', bookingEntry.id);
                        toast.success('Payment already confirmed!');
                        fetchBookings();
                        return;
                    }
                    if (invoiceStatus.status === 'PENDING') {
                        // Redirect to existing invoice
                        window.open(bookingEntry.xendit_payment_url, '_blank');
                        return;
                    }
                } catch {
                    // Invoice expired or error, create new one
                }
            }

            // Create new Xendit invoice
            const baseUrl = window.location.origin;
            const result = await createBookingInvoice({
                bookingId: bookingEntry.id,
                amount: bookingEntry.total_amount,
                description: `SafeDrive Rental Payment — ${bookingEntry.vehicles?.year} ${bookingEntry.vehicles?.make} ${bookingEntry.vehicles?.model}`,
                payerEmail: profile?.email || user?.email,
                successRedirectUrl: `${baseUrl}/payment/success?booking_id=${bookingEntry.id}`,
                failureRedirectUrl: `${baseUrl}/payment/failed?booking_id=${bookingEntry.id}`,
            });

            // Save invoice info to booking
            await supabase
                .from('bookings')
                .update({
                    xendit_invoice_id: result.invoiceId,
                    xendit_external_id: result.externalId,
                    xendit_payment_url: result.invoiceUrl,
                    payment_status: 'pending',
                })
                .eq('id', bookingEntry.id);

            // Open the payment page
            window.open(result.invoiceUrl, '_blank');
            toast.success('Payment page opened! Complete your payment there.');
            fetchBookings();
        } catch (err) {
            console.error('Payment error:', err);
            toast.error(err.message || 'Failed to create payment link');
        } finally {
            setActionLoading(null);
        }
    };

    /** RENTER verifies payment status after returning from Xendit */
    const verifyPayment = async (bookingEntry) => {
        if (!bookingEntry.xendit_invoice_id) return;
        setActionLoading(bookingEntry.id);
        try {
            const status = await checkInvoiceStatus(bookingEntry.xendit_invoice_id);
            if (status.status === 'PAID' || status.status === 'SETTLED') {
                await supabase
                    .from('bookings')
                    .update({ payment_status: 'paid' })
                    .eq('id', bookingEntry.id);
                toast.success('Payment confirmed! 🎉');

                // Notify owner
                await supabase.from('notifications').insert({
                    user_id: bookingEntry.owner_id,
                    title: 'Payment Received! 💰',
                    message: `${bookingEntry.renter?.full_name || 'Renter'} has paid ${formatPHP(bookingEntry.total_amount)} for ${bookingEntry.vehicles?.year} ${bookingEntry.vehicles?.make} ${bookingEntry.vehicles?.model}.`,
                    type: 'payment',
                    reference_id: bookingEntry.id,
                    reference_type: 'booking',
                });
            } else if (status.status === 'EXPIRED') {
                toast.error('Payment link has expired.');
            } else {
                toast('Payment is still pending. Please complete your payment.', { icon: '⏳' });
            }
            fetchBookings();
        } catch (err) {
            console.error('Verify error:', err);
            toast.error('Could not verify payment status');
        } finally {
            setActionLoading(null);
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

    /** Render action buttons for a booking row */
    const renderActions = (bookingEntry) => {
        const isOwnerSide = ownerView;
        const isLoading = actionLoading === bookingEntry.id;

        return (
            <div className="flex flex-wrap gap-2">
                {/* ─── PENDING: Owner can accept/decline ─── */}
                {isOwnerSide && bookingEntry.status === 'pending' && (
                    <>
                        <button
                            type="button"
                            className={`${ui.button.success} ${ui.button.sm}`}
                            onClick={() => acceptBooking(bookingEntry.id)}
                            disabled={isLoading}
                        >
                            <FiCheck /> {isLoading ? 'Accepting...' : 'Accept'}
                        </button>
                        <button
                            type="button"
                            className={`${ui.button.danger} ${ui.button.sm}`}
                            onClick={() => {
                                if (window.confirm('Decline this booking request?')) {
                                    declineBooking(bookingEntry.id);
                                }
                            }}
                            disabled={isLoading}
                        >
                            <FiX /> Decline
                        </button>
                    </>
                )}

                {/* ─── PENDING: Renter can cancel ─── */}
                {!isOwnerSide && bookingEntry.status === 'pending' && (
                    <button
                        type="button"
                        className={`${ui.button.secondary} ${ui.button.sm}`}
                        onClick={() => {
                            if (window.confirm('Cancel this booking?')) {
                                declineBooking(bookingEntry.id);
                            }
                        }}
                        disabled={isLoading}
                    >
                        <FiX /> Cancel
                    </button>
                )}

                {/* ─── CONFIRMED + UNPAID/PENDING: Renter can pay ─── */}
                {!isOwnerSide && bookingEntry.status === 'confirmed' && (bookingEntry.payment_status === 'unpaid' || bookingEntry.payment_status === 'pending' || bookingEntry.payment_status === 'failed') && (
                    <>
                        <button
                            type="button"
                            className={`${ui.button.accent} ${ui.button.sm}`}
                            onClick={() => initiatePayment(bookingEntry)}
                            disabled={isLoading}
                        >
                            <FiCreditCard /> {isLoading ? 'Processing...' : 'Pay Now'}
                        </button>
                        {bookingEntry.xendit_invoice_id && bookingEntry.payment_status === 'pending' && (
                            <button
                                type="button"
                                className={`${ui.button.soft} ${ui.button.sm}`}
                                onClick={() => verifyPayment(bookingEntry)}
                                disabled={isLoading}
                            >
                                <FiCheck /> I already paid
                            </button>
                        )}
                    </>
                )}

                {/* ─── CONFIRMED + PAID: Show agreement and Complete button ─── */}
                {bookingEntry.status === 'confirmed' && bookingEntry.payment_status === 'paid' && (
                    <>
                        <Link to={`/agreements/${bookingEntry.id}`} className={`${ui.button.secondary} ${ui.button.sm}`}>
                            <FiFileText /> Agreement
                        </Link>
                        {isOwnerSide && (
                            <button
                                type="button"
                                className={`${ui.button.success} ${ui.button.sm}`}
                                onClick={async () => {
                                    if (window.confirm('Mark this rental as completed? This will initiate the owner payout.')) {
                                        setActionLoading(bookingEntry.id);
                                        const { error } = await supabase
                                            .from('bookings')
                                            .update({ status: 'completed' })
                                            .eq('id', bookingEntry.id);
                                        if (error) toast.error('Failed to complete rental');
                                        else toast.success('Rental marked as completed!');
                                        fetchBookings();
                                        setActionLoading(null);
                                    }
                                }}
                                disabled={isLoading}
                            >
                                <FiCheck /> Complete Rental
                            </button>
                        )}
                    </>
                )}

                {/* ─── Common actions ─── */}
                <button
                    type="button"
                    className={`${ui.button.ghost} ${ui.button.sm}`}
                    onClick={() => setSelectedBooking(bookingEntry)}
                >
                    <FiEye /> Details
                </button>
                <button
                    type="button"
                    className={`${ui.button.ghost} ${ui.button.sm}`}
                    onClick={() => navigate(`/messages/${bookingEntry.id}`)}
                >
                    <FiMessageSquare /> Message
                </button>
            </div>
        );
    };

    /** Render the deadline/timer info for a booking */
    const renderDeadlineInfo = (bookingEntry) => {
        // Owner approval deadline (24h from creation) — show on pending bookings
        if (bookingEntry.status === 'pending') {
            const createdAt = new Date(bookingEntry.created_at);
            const approvalDeadline = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
            const remaining = getTimeRemaining(approvalDeadline);
            return (
                <div className="flex items-center gap-1 text-xs text-warning-600">
                    <FiClock className="h-3 w-3" />
                    <span>{ownerView ? 'Accept within' : 'Owner approval in'}: {remaining}</span>
                </div>
            );
        }

        // Payment deadline — show on confirmed + unpaid
        if (bookingEntry.status === 'confirmed' && bookingEntry.payment_deadline &&
            (bookingEntry.payment_status === 'unpaid' || bookingEntry.payment_status === 'pending')) {
            const remaining = getTimeRemaining(bookingEntry.payment_deadline);
            const expired = isDeadlinePassed(bookingEntry.payment_deadline);
            return (
                <div className={`flex items-center gap-1 text-xs ${expired ? 'text-error-600' : 'text-warning-600'}`}>
                    <FiClock className="h-3 w-3" />
                    <span>{expired ? 'Payment expired' : `Pay within: ${remaining}`}</span>
                </div>
            );
        }

        return null;
    };

    return (
        <div className={ui.page}>
            <BackButton />

            <div className={ui.pageHeader}>
                <h1 className={ui.pageTitle}>
                    {ownerView ? 'Bookings for your vehicles' : 'My bookings'}
                </h1>
                <p className={ui.pageDescription}>
                    {ownerView
                        ? 'Review incoming reservations, accept or decline. Once accepted, the renter has 24h to pay.'
                        : 'Track your reservations, pay when accepted, and manage your trips.'}
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
                        {/* ─── Desktop table ─── */}
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
                                    {filteredBookings.map((bookingEntry) => {
                                        const counterpart = ownerView ? bookingEntry.renter : bookingEntry.owner;
                                        const vehicleImage = bookingEntry.vehicles?.thumbnail_url || bookingEntry.vehicles?.images?.[0];

                                        return (
                                            <tr key={bookingEntry.id} className="text-text-secondary">
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
                                                                {bookingEntry.vehicles?.year} {bookingEntry.vehicles?.make} {bookingEntry.vehicles?.model}
                                                            </div>
                                                            <div className="text-xs text-text-tertiary">
                                                                {bookingEntry.vehicles?.plate_number}
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
                                                        <div>{formatDate(bookingEntry.start_date)}</div>
                                                        <div className="text-text-tertiary">to {formatDate(bookingEntry.end_date)}</div>
                                                        {renderDeadlineInfo(bookingEntry)}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="space-y-2">
                                                        <div className="font-semibold text-text-primary">{formatPHP(bookingEntry.total_amount)}</div>
                                                        {bookingEntry.payment_status && bookingEntry.payment_status !== 'not_applicable' && (
                                                            <PaymentStatusBadge status={bookingEntry.payment_status} />
                                                        )}
                                                        {ownerView && bookingEntry.payout_status && bookingEntry.payment_status === 'paid' && (
                                                            <PayoutStatusBadge status={bookingEntry.payout_status} />
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={bookingStatusClass(bookingEntry.status)}>{bookingEntry.status}</span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex justify-end">
                                                        {renderActions(bookingEntry)}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* ─── Mobile cards ─── */}
                        <div className="grid gap-4 lg:hidden">
                            {filteredBookings.map((bookingEntry) => {
                                const counterpart = ownerView ? bookingEntry.renter : bookingEntry.owner;
                                const vehicleImage = bookingEntry.vehicles?.thumbnail_url || bookingEntry.vehicles?.images?.[0];

                                return (
                                    <article key={bookingEntry.id} className="rounded-[30px] border border-border-light bg-surface-primary p-5 shadow-soft">
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
                                                        {bookingEntry.vehicles?.year} {bookingEntry.vehicles?.make} {bookingEntry.vehicles?.model}
                                                    </h2>
                                                    <p className="mt-1 text-sm text-text-secondary">
                                                        {counterpart?.full_name || 'Unavailable'}
                                                    </p>
                                                    <p className="text-xs text-text-tertiary">
                                                        {[counterpart?.email, counterpart?.phone].filter(Boolean).join(' • ') || 'No contact details'}
                                                    </p>
                                                </div>
                                            </div>
                                            <span className={bookingStatusClass(bookingEntry.status)}>{bookingEntry.status}</span>
                                        </div>

                                        <div className="mt-5 grid gap-3 rounded-3xl bg-surface-secondary p-4 text-sm text-text-secondary sm:grid-cols-2">
                                            <div>
                                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Dates</div>
                                                <div className="mt-1">{formatDate(bookingEntry.start_date)} to {formatDate(bookingEntry.end_date)}</div>
                                                {renderDeadlineInfo(bookingEntry)}
                                            </div>
                                            <div>
                                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Amount</div>
                                                <div className="mt-1 font-semibold text-text-primary">{formatPHP(bookingEntry.total_amount)}</div>
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {bookingEntry.payment_status && bookingEntry.payment_status !== 'not_applicable' && (
                                                        <PaymentStatusBadge status={bookingEntry.payment_status} />
                                                    )}
                                                    {ownerView && bookingEntry.payout_status && bookingEntry.payment_status === 'paid' && (
                                                        <PayoutStatusBadge status={bookingEntry.payout_status} />
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-4">{renderActions(bookingEntry)}</div>
                                    </article>
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>

            {/* ─── Detail Modal ─── */}
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
                            <button type="button" className={ui.button.ghost} onClick={() => setSelectedBooking(null)}>
                                <FiX /> Close
                            </button>
                        </div>
                        <div className={ui.sectionBody}>
                            <div className="grid gap-4 sm:grid-cols-2">
                                {[
                                    { label: ownerView ? 'Customer' : 'Owner', value: ownerView ? selectedBooking.renter?.full_name : selectedBooking.owner?.full_name },
                                    { label: 'Status', value: selectedBooking.status },
                                    { label: 'Start date', value: formatDate(selectedBooking.start_date) },
                                    { label: 'End date', value: formatDate(selectedBooking.end_date) },
                                    { label: 'Total Amount', value: formatPHP(selectedBooking.total_amount) },
                                    { label: 'Payment Status', value: selectedBooking.payment_status || 'N/A' },
                                    { label: 'Platform Fee (10%)', value: formatPHP(selectedBooking.commission_amount) },
                                    { label: 'Owner Payout (90%)', value: formatPHP(selectedBooking.owner_payout_amount) },
                                    { label: 'Payout Status', value: selectedBooking.payout_status || 'N/A' },
                                    { label: 'Daily Rate', value: formatPHP(selectedBooking.daily_rate) },
                                ].map((item) => (
                                    <div key={item.label} className="rounded-3xl border border-border-light bg-surface-secondary p-4">
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                                            {item.label}
                                        </div>
                                        <div className="mt-2 text-sm font-semibold capitalize text-text-primary">
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
