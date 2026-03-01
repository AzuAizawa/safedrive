import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiCalendar, FiCheck, FiX, FiFileText } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

export default function Bookings() {
    const { user, profile, isRenter, isAdmin } = useAuth();
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('all');

    useEffect(() => {
        let mounted = true;
        fetchBookings();
        const safety = setTimeout(() => { if (mounted) setLoading(false); }, 5000);
        return () => { mounted = false; clearTimeout(safety); };
    }, []);

    const fetchBookings = async () => {
        try {
            let query = supabase
                .from('bookings')
                .select('*, vehicles(make, model, year, thumbnail_url, plate_number), profiles!bookings_renter_id_fkey(full_name, email)')
                .order('created_at', { ascending: false });

            if (isRenter && !isAdmin) query = query.eq('owner_id', user.id);
            else if (!isAdmin) query = query.eq('renter_id', user.id);

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
                <h1>📋 {isRenter ? 'Rental Requests' : 'My Bookings'}</h1>
                <p>{isRenter ? 'Manage incoming rental requests for your vehicles' : 'Track and manage your vehicle rental bookings'}</p>
            </div>

            <div className="tabs">
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
                    <p>{activeTab === 'all' ? 'No bookings yet. Start browsing vehicles!' : `No ${activeTab} bookings.`}</p>
                    {!isRenter && <Link to="/vehicles" className="btn btn-primary">Browse Vehicles</Link>}
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {filteredBookings.map(booking => (
                        <div key={booking.id} className="card">
                            <div className="card-body">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                        <div style={{ width: 64, height: 64, borderRadius: 12, background: 'var(--neutral-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🚗</div>
                                        <div>
                                            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                                                {booking.vehicles?.year} {booking.vehicles?.make} {booking.vehicles?.model}
                                            </h3>
                                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                                                {isRenter && <>Rentee: <strong>{booking.profiles?.full_name}</strong> • </>}
                                                {booking.vehicles?.plate_number}
                                            </div>
                                            <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                                                <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <FiCalendar /> {new Date(booking.start_date).toLocaleDateString()} → {new Date(booking.end_date).toLocaleDateString()}
                                                </span>
                                                <span style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                                                    ₱{booking.total_amount?.toLocaleString()} ({booking.total_days} days)
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span className={`badge badge-${booking.status === 'confirmed' || booking.status === 'completed' ? 'success' : booking.status === 'pending' ? 'pending' : booking.status === 'cancelled' ? 'error' : 'info'}`}>
                                            {booking.status}
                                        </span>

                                        {isRenter && booking.status === 'pending' && (
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button className="btn btn-success btn-sm" onClick={() => updateBookingStatus(booking.id, 'confirmed')}>
                                                    <FiCheck /> Accept
                                                </button>
                                                <button className="btn btn-danger btn-sm" onClick={() => updateBookingStatus(booking.id, 'cancelled')}>
                                                    <FiX /> Decline
                                                </button>
                                            </div>
                                        )}

                                        {booking.status === 'confirmed' && (
                                            <Link to={`/agreements/${booking.id}`} className="btn btn-primary btn-sm">
                                                <FiFileText /> View Agreement
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
