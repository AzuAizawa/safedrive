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
                <div style={{ display: 'flex', gap: 8, marginBottom: 20, background: 'var(--neutral-100)', borderRadius: 'var(--radius-lg)', padding: 4, maxWidth: 300 }}>
                    {[
                        { id: 'renter', label: '🚗 My Rentals' },
                        { id: 'owner', label: '🔑 My Listings' },
                    ].map(m => (
                        <button
                            key={m.id}
                            onClick={() => setViewMode(m.id)}
                            style={{
                                flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-md)',
                                border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                                background: viewMode === m.id ? 'var(--surface-primary)' : 'transparent',
                                color: viewMode === m.id ? 'var(--primary-700)' : 'var(--text-tertiary)',
                                boxShadow: viewMode === m.id ? 'var(--shadow-sm)' : 'none',
                                transition: 'all 0.15s',
                            }}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            )}

            <div className="tabs" style={{ marginBottom: 16 }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {filteredBookings.map(booking => {
                        const vehicleImage = booking.vehicles?.thumbnail_url || booking.vehicles?.images?.[0];
                        const isOwnerView = viewMode === 'owner' || isAdmin;
                        return (
                            <div key={booking.id} className="card">
                                <div className="card-body">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                            <div style={{
                                                width: 64, height: 64, borderRadius: 12, flexShrink: 0,
                                                background: vehicleImage ? 'transparent' : 'var(--neutral-100)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 28, overflow: 'hidden',
                                            }}>
                                                {vehicleImage
                                                    ? <img src={vehicleImage} alt="vehicle" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : '🚗'}
                                            </div>
                                            <div>
                                                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                                                    {booking.vehicles?.year} {booking.vehicles?.make} {booking.vehicles?.model}
                                                </h3>
                                                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                                                    {isOwnerView && <><strong>{booking.profiles?.full_name}</strong> • </>}
                                                    {booking.vehicles?.plate_number}
                                                </div>
                                                <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
                                                    <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <FiCalendar />
                                                        {new Date(booking.start_date).toLocaleDateString()} → {new Date(booking.end_date).toLocaleDateString()}
                                                    </span>
                                                    <span style={{ fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--primary-700)' }}>
                                                        ₱{booking.total_amount?.toLocaleString()} ({booking.total_days} day{booking.total_days > 1 ? 's' : ''})
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
                                            <span className={`badge badge-${booking.status === 'confirmed' || booking.status === 'completed' ? 'success' : booking.status === 'pending' ? 'pending' : booking.status === 'cancelled' ? 'error' : 'info'}`}>
                                                {booking.status}
                                            </span>

                                            {/* Owner actions on pending bookings */}
                                            {isOwnerView && booking.status === 'pending' && (
                                                <div style={{ display: 'flex', gap: 8 }}>
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
                                                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--error-500)' }}
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
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
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
                                    style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 'var(--radius-lg)', marginBottom: 16 }}
                                />
                            )}

                            <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
                                {selectedBooking.vehicles?.year} {selectedBooking.vehicles?.make} {selectedBooking.vehicles?.model}
                            </h3>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                                {[selectedBooking.vehicles?.pickup_location, selectedBooking.vehicles?.pickup_city, selectedBooking.vehicles?.pickup_province].filter(Boolean).join(', ')}
                            </div>

                            {/* Status */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                                <span className={`badge badge-${selectedBooking.status === 'confirmed' || selectedBooking.status === 'completed' ? 'success' : selectedBooking.status === 'pending' ? 'pending' : selectedBooking.status === 'cancelled' ? 'error' : 'info'}`} style={{ fontSize: 13, padding: '4px 12px' }}>
                                    {selectedBooking.status.toUpperCase()}
                                </span>
                                <span className="badge badge-neutral" style={{ fontSize: 13 }}>
                                    {selectedBooking.vehicles?.plate_number}
                                </span>
                            </div>

                            {/* Date range */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                                {[
                                    { label: 'Pick-up Date', value: new Date(selectedBooking.start_date).toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }) },
                                    { label: 'Return Date', value: new Date(selectedBooking.end_date).toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }) },
                                ].map((item, i) => (
                                    <div key={i} style={{ padding: 12, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{item.label}</div>
                                        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{item.value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Pricing breakdown */}
                            <div style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                                <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Price Breakdown</div>
                                {selectedBooking.vehicles?.pricing_type === 'fixed' ? (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                                        <span>Fixed deal ({selectedBooking.total_days} day{selectedBooking.total_days > 1 ? 's' : ''})</span>
                                        <span style={{ fontWeight: 700 }}>₱{selectedBooking.total_amount?.toLocaleString()}</span>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                                            <span>₱{selectedBooking.daily_rate?.toLocaleString()} × {selectedBooking.total_days} day{selectedBooking.total_days > 1 ? 's' : ''}</span>
                                            <span style={{ fontWeight: 600 }}>₱{selectedBooking.subtotal?.toLocaleString()}</span>
                                        </div>
                                        {selectedBooking.service_fee > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                                                <span>Service fee</span>
                                                <span style={{ fontWeight: 600 }}>₱{selectedBooking.service_fee?.toLocaleString()}</span>
                                            </div>
                                        )}
                                        {selectedBooking.security_deposit > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                                                <span>Security deposit</span>
                                                <span style={{ fontWeight: 600 }}>₱{selectedBooking.security_deposit?.toLocaleString()}</span>
                                            </div>
                                        )}
                                    </>
                                )}
                                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, marginTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 18 }}>
                                    <span>Total</span>
                                    <span style={{ color: 'var(--primary-700)', fontFamily: 'var(--font-display)' }}>₱{selectedBooking.total_amount?.toLocaleString()}</span>
                                </div>
                            </div>

                            {/* Rentee info (for owner view) */}
                            {selectedBooking.profiles?.full_name && (
                                <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--primary-50)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--primary-300)' }}>
                                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Renter Details</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
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
