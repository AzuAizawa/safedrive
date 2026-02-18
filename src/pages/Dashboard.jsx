import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FiTruck, FiCalendar, FiStar, FiAlertTriangle, FiArrowRight, FiCheckCircle, FiClock, FiUsers } from 'react-icons/fi';

export default function Dashboard() {
    const { profile, isAdmin, isOwner, isRenter } = useAuth();
    const [stats, setStats] = useState({ vehicles: 0, bookings: 0, reviews: 0, pendingUsers: 0 });
    const [recentBookings, setRecentBookings] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDashboardData();
    }, [profile]);

    const fetchDashboardData = async () => {
        if (!profile) return;
        try {
            // Fetch counts based on role
            if (isAdmin) {
                const [vehicles, bookings, users, pendingUsers] = await Promise.all([
                    supabase.from('vehicles').select('id', { count: 'exact', head: true }),
                    supabase.from('bookings').select('id', { count: 'exact', head: true }),
                    supabase.from('profiles').select('id', { count: 'exact', head: true }),
                    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('verification_status', 'submitted'),
                ]);
                setStats({
                    vehicles: vehicles.count || 0,
                    bookings: bookings.count || 0,
                    reviews: users.count || 0,
                    pendingUsers: pendingUsers.count || 0,
                });
            } else if (isOwner) {
                const [vehicles, bookings, reviews] = await Promise.all([
                    supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('owner_id', profile.id),
                    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('owner_id', profile.id),
                    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('reviewee_id', profile.id),
                ]);
                setStats({
                    vehicles: vehicles.count || 0,
                    bookings: bookings.count || 0,
                    reviews: reviews.count || 0,
                });
            } else {
                const [bookings, reviews, favorites] = await Promise.all([
                    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('renter_id', profile.id),
                    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('reviewer_id', profile.id),
                    supabase.from('favorites').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
                ]);
                setStats({
                    bookings: bookings.count || 0,
                    reviews: reviews.count || 0,
                    vehicles: favorites.count || 0,
                });
            }

            // Fetch recent bookings
            const query = supabase
                .from('bookings')
                .select('*, vehicles(make, model, year, thumbnail_url), profiles!bookings_renter_id_fkey(full_name)')
                .order('created_at', { ascending: false })
                .limit(5);

            if (isOwner) query.eq('owner_id', profile.id);
            else if (isRenter) query.eq('renter_id', profile.id);

            const { data } = await query;
            setRecentBookings(data || []);
        } catch (err) {
            console.error('Dashboard error:', err);
        } finally {
            setLoading(false);
        }
    };

    const getVerificationBanner = () => {
        if (profile?.verification_status === 'verified') return null;

        const messages = {
            pending: {
                icon: <FiAlertTriangle />,
                title: 'Complete Your Verification',
                desc: 'Submit your government IDs and selfie to get verified and start using SafeDrive.',
                action: 'Submit Documents',
                link: '/profile',
            },
            submitted: {
                icon: <FiClock />,
                title: 'Verification In Progress',
                desc: 'Your documents have been submitted. Our admin team is reviewing your identity.',
                action: 'View Status',
                link: '/profile',
            },
            rejected: {
                icon: <FiAlertTriangle />,
                title: 'Verification Rejected',
                desc: 'Your verification was not approved. Please resubmit your documents.',
                action: 'Resubmit',
                link: '/profile',
            },
        };

        const msg = messages[profile?.verification_status || 'pending'];

        return (
            <div className={`verification-card ${profile?.verification_status === 'verified' ? 'verified' : ''}`}>
                <div className="verification-card-icon">{msg.icon}</div>
                <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{msg.title}</h3>
                    <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{msg.desc}</p>
                </div>
                <Link to={msg.link} className="btn btn-accent btn-sm">{msg.action} <FiArrowRight /></Link>
            </div>
        );
    };

    if (loading) {
        return <div className="loading-spinner"><div className="spinner" /></div>;
    }

    return (
        <div>
            <div className="page-header">
                <h1>
                    {isAdmin ? '🛡️ Admin Dashboard' : isOwner ? '🚘 Owner Dashboard' : '👋 Welcome back'}, {profile?.full_name?.split(' ')[0]}
                </h1>
                <p>
                    {isAdmin
                        ? 'Manage users, vehicles, and platform operations'
                        : isOwner
                            ? 'Manage your vehicles and track bookings'
                            : 'Browse verified vehicles and manage your rentals'}
                </p>
            </div>

            {getVerificationBanner()}

            {/* Stats Grid */}
            <div className="stats-grid">
                {isAdmin ? (
                    <>
                        <div className="stat-card">
                            <div className="stat-icon blue"><FiUsers /></div>
                            <div className="stat-info">
                                <h3>{stats.reviews}</h3>
                                <p>Total Users</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon green"><FiTruck /></div>
                            <div className="stat-info">
                                <h3>{stats.vehicles}</h3>
                                <p>Total Vehicles</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon orange"><FiCalendar /></div>
                            <div className="stat-info">
                                <h3>{stats.bookings}</h3>
                                <p>Total Bookings</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon red"><FiAlertTriangle /></div>
                            <div className="stat-info">
                                <h3>{stats.pendingUsers}</h3>
                                <p>Pending Verifications</p>
                            </div>
                        </div>
                    </>
                ) : isOwner ? (
                    <>
                        <div className="stat-card">
                            <div className="stat-icon blue"><FiTruck /></div>
                            <div className="stat-info">
                                <h3>{stats.vehicles}</h3>
                                <p>My Vehicles</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon green"><FiCalendar /></div>
                            <div className="stat-info">
                                <h3>{stats.bookings}</h3>
                                <p>Total Bookings</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon orange"><FiStar /></div>
                            <div className="stat-info">
                                <h3>{profile?.average_rating?.toFixed(1) || '0.0'}</h3>
                                <p>Average Rating ({stats.reviews} reviews)</p>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="stat-card">
                            <div className="stat-icon blue"><FiCalendar /></div>
                            <div className="stat-info">
                                <h3>{stats.bookings}</h3>
                                <p>My Bookings</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon green"><FiStar /></div>
                            <div className="stat-info">
                                <h3>{stats.reviews}</h3>
                                <p>Reviews Given</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon orange"><FiTruck /></div>
                            <div className="stat-info">
                                <h3>{stats.vehicles}</h3>
                                <p>Favorites</p>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginBottom: 32 }}>
                {isAdmin && (
                    <>
                        <Link to="/admin/users" className="card card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
                            <div className="stat-icon blue" style={{ width: 44, height: 44 }}><FiUsers /></div>
                            <div>
                                <h3 style={{ fontSize: 15, fontWeight: 700 }}>Manage Users</h3>
                                <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Verify identities & manage accounts</p>
                            </div>
                            <FiArrowRight style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }} />
                        </Link>
                        <Link to="/admin/vehicles" className="card card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
                            <div className="stat-icon green" style={{ width: 44, height: 44 }}><FiTruck /></div>
                            <div>
                                <h3 style={{ fontSize: 15, fontWeight: 700 }}>Manage Vehicles</h3>
                                <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Approve & review car listings</p>
                            </div>
                            <FiArrowRight style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }} />
                        </Link>
                    </>
                )}
                {(isOwner || isAdmin) && (
                    <Link to="/vehicles/new" className="card card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer', background: 'linear-gradient(135deg, var(--accent-50), var(--warning-50))', borderColor: 'rgba(249,115,22,0.2)' }}>
                        <div className="stat-icon orange" style={{ width: 44, height: 44 }}>🚗</div>
                        <div>
                            <h3 style={{ fontSize: 15, fontWeight: 700 }}>List a New Vehicle</h3>
                            <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Add your car to the platform</p>
                        </div>
                        <FiArrowRight style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }} />
                    </Link>
                )}
                <Link to="/vehicles" className="card card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
                    <div className="stat-icon blue" style={{ width: 44, height: 44 }}>🔍</div>
                    <div>
                        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Browse Vehicles</h3>
                        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Find your perfect rental car</p>
                    </div>
                    <FiArrowRight style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }} />
                </Link>
            </div>

            {/* Recent Bookings */}
            <div className="card">
                <div className="card-header">
                    <h2 style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)' }}>Recent Bookings</h2>
                    <Link to="/bookings" className="btn btn-ghost btn-sm">View All <FiArrowRight /></Link>
                </div>
                {recentBookings.length === 0 ? (
                    <div className="empty-state" style={{ padding: 48 }}>
                        <div className="empty-state-icon">📋</div>
                        <h3>No bookings yet</h3>
                        <p>Your rental bookings will appear here once you start using SafeDrive.</p>
                        <Link to="/vehicles" className="btn btn-primary">Browse Vehicles</Link>
                    </div>
                ) : (
                    <div style={{ overflow: 'auto' }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Vehicle</th>
                                    <th>Dates</th>
                                    <th>Amount</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentBookings.map((booking) => (
                                    <tr key={booking.id}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--neutral-100)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🚗</div>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: 14 }}>{booking.vehicles?.year} {booking.vehicles?.make} {booking.vehicles?.model}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                            {new Date(booking.start_date).toLocaleDateString()} - {new Date(booking.end_date).toLocaleDateString()}
                                        </td>
                                        <td style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>₱{booking.total_amount?.toLocaleString()}</td>
                                        <td>
                                            <span className={`badge badge-${booking.status === 'confirmed' || booking.status === 'completed' ? 'success' : booking.status === 'pending' ? 'pending' : booking.status === 'cancelled' ? 'error' : 'info'}`}>
                                                {booking.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
