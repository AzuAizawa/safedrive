import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiCalendar, FiCheck, FiX, FiFileText, FiMessageSquare, FiEye } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

export default function Bookings() {
    const { user, profile, isAdmin } = useAuth();
    const navigate = useNavigate();
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('all');
    // Detect if this user has listed vehicles → is a car owner/renter
    const [isOwner, setIsOwner] = useState(false);
    const [viewMode, setViewMode] = useState('renter'); // 'renter' | 'owner'
    const [selectedBooking, setSelectedBooking] = useState(null); // detail modal

    useEffect(() => {
        let mounted = true;
        checkOwnerStatus();
        const safety = setTimeout(() => { if (mounted) setLoading(false); }, 5000);
        return () => { mounted = false; clearTimeout(safety); };
    }, []);

    // Re-fetch bookings whenever viewMode changes
    useEffect(() => {
        fetchBookings();
    }, [viewMode]);

    const checkOwnerStatus = async () => {
        try {
            const { data } = await supabase
                .from('vehicles')
                .select('id')
                .eq('owner_id', user.id)
                .limit(1);
            setIsOwner(data?.length > 0);
        } catch (err) {
            // ignore — default to renter view
        }
    };

    const fetchBookings = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('bookings')
                .select('*, vehicles(id, make, model, year, thumbnail_url, images, plate_number, daily_rate, fixed_price, fixed_rental_days, pricing_type, pickup_location, pickup_city, pickup_province), profiles!bookings_renter_id_fkey(full_name, email, phone)')
                .order('created_at', { ascending: false });

            if (isAdmin) {
                // Admin sees everything — no filter
            } else if (viewMode === 'owner') {
                // Owner view: bookings for my vehicles
                query = query.eq('owner_id', user.id);
            } else {
                // Renter view: bookings where I am the one renting
                query = query.eq('renter_id', user.id);
            }

            const { data, error } = await query;
            if (error) throw error;
            setBookings(data || []);
        } catch (err) {
            console.error('Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const updateBookingStatus = async (bookingId, newStatus) => {
        try {
            const { error } = await supabase.from('bookings').update({ status: newStatus }).eq('id', bookingId);
            if (error) throw error;

            // Bug 9 fix: When owner confirms a booking, insert booked dates into vehicle_availability
            if (newStatus === 'confirmed') {
                const booking = bookings.find(b => b.id === bookingId);
                if (booking) {
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
                        }).catch(err => console.warn('Could not update availability:', err));
                    }
                }
            }

            toast.success(`Booking ${newStatus}`);
            fetchBookings();
        } catch (err) {
            toast.error('Failed to update booking');
        }
    };

    const filteredBookings = activeTab === 'all'
        ? bookings
        : bookings.filter(b => b.status === activeTab);

    if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

    return (
        <div>
            <BackButton />

            <div className="page-header">
                <h1>📋 Bookings</h1>
                <p>Manage your vehicle rental bookings</p>
            </div>

            {/* View mode toggle — only show if user is both an owner and a renter */}
            {(isOwner || isAdmin) && !isAdmin && (
                <div className="flex gap-2 mb-5 bg-[var(--neutral-100)] rounded-[var(--radius-lg)] p-1 max-w-[300px]">
                    {[
                        { id: 'renter', label: '🚗 My Rentals' },
                        { id: 'owner', label: '🔑 My Listings' },
                    ].map(m => (
                        <button
                            key={m.id}
                            onClick={() => setViewMode(m.id)}
                            className={`flex-1 py-2 px-3 rounded-[var(--radius-md)] border-none cursor-pointer text-[13px] font-bold transition-all duration-150 ${viewMode === m.id ? 'bg-[var(--surface-primary)] text-[var(--primary-700)] shadow-[var(--shadow-sm)]' : 'bg-transparent text-[var(--text-tertiary)]'}`}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            )}

            <div className="tabs mb-4">
                {['all', 'pending', 'confirmed', 'active', 'completed', 'cancelled'].map(tab => (
                    <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        {tab !== 'all' && ` (${bookings.filter(b => b.status === tab).length})`}
                    </button>
                ))}
            </div>

            {filteredBookings.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-icon"><FiCalendar /></div>
                    <h3>No bookings found</h3>
                    <p>{activeTab === 'all' ? (viewMode === 'renter' ? 'You haven\'t rented any vehicles yet.' : 'No rental requests for your vehicles.') : `No ${activeTab} bookings.`}</p>
                    {viewMode === 'renter' && <Link to="/vehicles" className="btn btn-primary">Browse Vehicles</Link>}
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {filteredBookings.map(booking => {
                        const vehicleImage = booking.vehicles?.thumbnail_url || booking.vehicles?.images?.[0];
                        const isOwnerView = viewMode === 'owner' || isAdmin;
                        return (
                            <div key={booking.id} className="card">
                                <div className="card-body">
                                    <div className="flex justify-between items-start gap-3 flex-wrap sm:flex-nowrap">
                                        <div className="flex gap-4 items-center">
                                            <div className={`w-16 h-16 rounded-[12px] shrink-0 flex items-center justify-center text-[28px] overflow-hidden ${vehicleImage ? 'bg-transparent' : 'bg-[var(--neutral-100)]'}`}>
                                                {vehicleImage
                                                    ? <img src={vehicleImage} alt="vehicle" className="w-full h-full object-cover" />
                                                    : '🚗'}
                                            </div>
                                            <div>
                                                <h3 className="text-[16px] font-bold mb-1">
                                                    {booking.vehicles?.year} {booking.vehicles?.make} {booking.vehicles?.model}
                                                </h3>
                                                <div className="text-[13px] text-[var(--text-secondary)] mb-2">
                                                    {isOwnerView && <><strong>{booking.profiles?.full_name}</strong> • </>}
                                                    {booking.vehicles?.plate_number}
                                                </div>
                                                <div className="flex gap-4 text-[13px] flex-wrap">
                                                    <span className="text-[var(--text-secondary)] flex items-center gap-1">
                                                        <FiCalendar />
                                                        {new Date(booking.start_date).toLocaleDateString()} → {new Date(booking.end_date).toLocaleDateString()}
                                                    </span>
                                                    <span className="font-bold font-[var(--font-display)] text-[var(--primary-700)]">
                                                        ₱{booking.total_amount?.toLocaleString()} ({booking.total_days} day{booking.total_days > 1 ? 's' : ''})
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 flex-wrap shrink-0">
                                            <span className={`badge badge-${booking.status === 'confirmed' || booking.status === 'completed' ? 'success' : booking.status === 'pending' ? 'pending' : booking.status === 'cancelled' ? 'error' : 'info'}`}>
                                                {booking.status}
                                            </span>

                                            {/* Owner actions on pending bookings */}
                                            {isOwnerView && booking.status === 'pending' && (
                                                <div className="flex gap-2">
                                                    <button className="btn btn-success btn-sm" onClick={() => updateBookingStatus(booking.id, 'confirmed')}>
                                                        <FiCheck /> Accept
                                                    </button>
                                                    <button className="btn btn-danger btn-sm" onClick={() => updateBookingStatus(booking.id, 'cancelled')}>
                                                        <FiX /> Decline
                                                    </button>
                                                </div>
                                            )}

                                            {/* Renter can cancel pending bookings */}
                                            {!isOwnerView && booking.status === 'pending' && (
                                                <button className="btn btn-ghost btn-sm text-[var(--error-500)]"
                                                    onClick={() => { if (confirm('Cancel this booking?')) updateBookingStatus(booking.id, 'cancelled'); }}>
                                                    <FiX /> Cancel
                                                </button>
                                            )}

                                            {booking.status === 'confirmed' && (
                                                <Link to={`/agreements/${booking.id}`} className="btn btn-secondary btn-sm">
                                                    <FiFileText /> Agreement
                                                </Link>
                                            )}

                                            {/* Eye — view booking details */}
                                            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedBooking(booking)} title="View Details">
                                                <FiEye />
                                            </button>

                                            <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/messages/${booking.id}`)} title="Message">
                                                <FiMessageSquare />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Booking Detail Modal ── */}
            {selectedBooking && (
                <div className="modal-overlay" onClick={() => setSelectedBooking(null)}>
                    <div className="modal max-w-[520px]" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Booking Details</h2>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedBooking(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {/* Vehicle image */}
                            {(selectedBooking.vehicles?.thumbnail_url || selectedBooking.vehicles?.images?.[0]) && (
                                <img
                                    src={selectedBooking.vehicles.thumbnail_url || selectedBooking.vehicles.images[0]}
                                    alt="vehicle"
                                    className="w-full h-[200px] object-cover rounded-[var(--radius-lg)] mb-4"
                                />
                            )}

                            <h3 className="text-[20px] font-extrabold mb-1">
                                {selectedBooking.vehicles?.year} {selectedBooking.vehicles?.make} {selectedBooking.vehicles?.model}
                            </h3>
                            <div className="text-[13px] text-[var(--text-secondary)] mb-5">
                                {[selectedBooking.vehicles?.pickup_location, selectedBooking.vehicles?.pickup_city, selectedBooking.vehicles?.pickup_province].filter(Boolean).join(', ')}
                            </div>

                            {/* Status */}
                            <div className="flex gap-2 mb-5 flex-wrap">
                                <span className={`badge badge-${selectedBooking.status === 'confirmed' || selectedBooking.status === 'completed' ? 'success' : selectedBooking.status === 'pending' ? 'pending' : selectedBooking.status === 'cancelled' ? 'error' : 'info'} text-[13px] px-3 py-1`}>
                                    {selectedBooking.status.toUpperCase()}
                                </span>
                                <span className="badge badge-neutral text-[13px]">
                                    {selectedBooking.vehicles?.plate_number}
                                </span>
                            </div>

                            {/* Date range */}
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                {[
                                    { label: 'Pick-up Date', value: new Date(selectedBooking.start_date).toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }) },
                                    { label: 'Return Date', value: new Date(selectedBooking.end_date).toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }) },
                                ].map((item, i) => (
                                    <div key={i} className="p-3 bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                                        <div className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase">{item.label}</div>
                                        <div className="text-[13px] font-semibold mt-1">{item.value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Pricing breakdown */}
                            <div className="bg-[var(--neutral-50)] rounded-[var(--radius-lg)] p-4">
                                <div className="font-bold mb-3 text-[14px]">Price Breakdown</div>
                                {selectedBooking.vehicles?.pricing_type === 'fixed' ? (
                                    <div className="flex justify-between text-[14px] mb-2">
                                        <span>Fixed deal ({selectedBooking.total_days} day{selectedBooking.total_days > 1 ? 's' : ''})</span>
                                        <span className="font-bold">₱{selectedBooking.total_amount?.toLocaleString()}</span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex justify-between text-[14px] mb-2">
                                            <span>₱{selectedBooking.daily_rate?.toLocaleString()} × {selectedBooking.total_days} day{selectedBooking.total_days > 1 ? 's' : ''}</span>
                                            <span className="font-semibold">₱{selectedBooking.subtotal?.toLocaleString()}</span>
                                        </div>
                                        {selectedBooking.service_fee > 0 && (
                                            <div className="flex justify-between text-[14px] mb-2">
                                                <span>Service fee</span>
                                                <span className="font-semibold">₱{selectedBooking.service_fee?.toLocaleString()}</span>
                                            </div>
                                        )}
                                        {selectedBooking.security_deposit > 0 && (
                                            <div className="flex justify-between text-[14px] mb-2">
                                                <span>Security deposit</span>
                                                <span className="font-semibold">₱{selectedBooking.security_deposit?.toLocaleString()}</span>
                                            </div>
                                        )}
                                    </>
                                )}
                                <div className="border-t border-[var(--border-light)] pt-2 mt-2 flex justify-between font-extrabold text-[18px]">
                                    <span>Total</span>
                                    <span className="text-[var(--primary-700)] font-[var(--font-display)]">₱{selectedBooking.total_amount?.toLocaleString()}</span>
                                </div>
                            </div>

                            {/* Rentee info (for owner view) */}
                            {selectedBooking.profiles?.full_name && (
                                <div className="mt-4 p-[12px_16px] bg-[var(--primary-50)] rounded-[var(--radius-md)] border-l-[3px] border-[var(--primary-300)]">
                                    <div className="font-bold text-[13px] mb-1">Renter Details</div>
                                    <div className="text-[13px] text-[var(--text-secondary)]">
                                        {selectedBooking.profiles.full_name}
                                        {selectedBooking.profiles.email && <> • {selectedBooking.profiles.email}</>}
                                        {selectedBooking.profiles.phone && <> • {selectedBooking.profiles.phone}</>}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
