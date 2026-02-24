import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FiTruck, FiCalendar, FiStar, FiAlertTriangle, FiArrowRight, FiCheckCircle, FiClock, FiUsers, FiShield } from 'react-icons/fi';

export default function Dashboard() {
    const { profile, isAdmin, isRenter, isRentee } = useAuth();
    const [stats, setStats] = useState({ vehicles: 0, bookings: 0, reviews: 0, pendingUsers: 0 });
    const [recentBookings, setRecentBookings] = useState([]);
    const [dataLoading, setDataLoading] = useState(true);

    useEffect(() => {
        if (profile) {
            fetchDashboardData();
        } else {
            // Even if profile hasn't loaded, stop blocking the UI after a brief delay
            const timer = setTimeout(() => setDataLoading(false), 1500);
            return () => clearTimeout(timer);
        }
    }, [profile]);

    const fetchDashboardData = async () => {
        if (!profile) { setDataLoading(false); return; }
        try {
            // Helper to safely query — returns 0 on any error
            const safeCount = async (queryFn) => {
                try {
                    const result = await queryFn();
                    return result.count || 0;
                } catch { return 0; }
            };

            // Fetch counts based on role
            if (isAdmin) {
                const [vehicleCount, bookingCount, userCount, pendingCount] = await Promise.all([
                    safeCount(() => supabase.from('vehicles').select('id', { count: 'exact', head: true })),
                    safeCount(() => supabase.from('bookings').select('id', { count: 'exact', head: true })),
                    safeCount(() => supabase.from('profiles').select('id', { count: 'exact', head: true })),
                    safeCount(() => supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('verification_status', 'submitted')),
                ]);
                setStats({
                    vehicles: vehicleCount,
                    bookings: bookingCount,
                    reviews: userCount,
                    pendingUsers: pendingCount,
                });
            } else if (isRenter) {
                const [vehicleCount, bookingCount, reviewCount] = await Promise.all([
                    safeCount(() => supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('owner_id', profile.id)),
                    safeCount(() => supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('owner_id', profile.id)),
                    safeCount(() => supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('reviewee_id', profile.id)),
                ]);
                setStats({
                    vehicles: vehicleCount,
                    bookings: bookingCount,
                    reviews: reviewCount,
                });
            } else {
                const [bookingCount, reviewCount, favCount] = await Promise.all([
                    safeCount(() => supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('renter_id', profile.id)),
                    safeCount(() => supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('reviewer_id', profile.id)),
                    safeCount(() => supabase.from('favorites').select('id', { count: 'exact', head: true }).eq('user_id', profile.id)),
                ]);
                setStats({
                    bookings: bookingCount,
                    reviews: reviewCount,
                    vehicles: favCount,
                });
            }

            // Fetch recent bookings (with graceful failure)
            try {
                const query = supabase
                    .from('bookings')
                    .select('*, vehicles(make, model, year, thumbnail_url), profiles!bookings_renter_id_fkey(full_name)')
                    .order('created_at', { ascending: false })
                    .limit(5);

                if (isRenter) query.eq('owner_id', profile.id);
                else if (isRentee) query.eq('renter_id', profile.id);

                const { data } = await query;
                setRecentBookings(data || []);
            } catch {
                setRecentBookings([]);
            }
        } catch (err) {
            console.error('Dashboard error:', err);
        } finally {
            setDataLoading(false);
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
                bgGradient: 'linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)',
                borderColor: 'rgba(245,158,11,0.3)',
                iconBg: '#fef3c7',
                iconColor: '#d97706',
            },
            submitted: {
                icon: <FiClock />,
                title: 'Verification In Progress',
                desc: 'Your documents have been submitted. Our admin team is reviewing your identity. This usually takes 24-48 hours.',
                action: 'View Status',
                link: '/profile',
                bgGradient: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                borderColor: 'rgba(59,130,246,0.3)',
                iconBg: '#dbeafe',
                iconColor: '#2563eb',
            },
            rejected: {
                icon: <FiAlertTriangle />,
                title: 'Verification Rejected',
                desc: 'Your verification was not approved. Please resubmit your documents with clearer photos.',
                action: 'Resubmit',
                link: '/profile',
                bgGradient: 'linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)',
                borderColor: 'rgba(239,68,68,0.3)',
                iconBg: '#fecaca',
                iconColor: '#dc2626',
            },
        };

        const msg = messages[profile?.verification_status || 'pending'];

        return (
            <div style={{
                background: msg.bgGradient,
                border: `1px solid ${msg.borderColor}`,
                borderRadius: 'var(--radius-lg, 12px)',
                padding: '20px 24px',
                marginBottom: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
            }}>
                <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: msg.iconBg, color: msg.iconColor,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, flexShrink: 0,
                }}>
                    {msg.icon}
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{msg.title}</h3>
                    <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>{msg.desc}</p>
                </div>
                <Link to={msg.link} className="btn btn-accent btn-sm" style={{ flexShrink: 0 }}>
                    {msg.action} <FiArrowRight />
                </Link>
            </div>
        );
    };

    // Skeleton placeholder for stats while loading
    const StatSkeleton = () => (
        <div className="stat-card" style={{ opacity: 0.5 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--neutral-200, #e5e7eb)', animation: 'pulse 1.5s infinite' }} />
            <div className="stat-info">
                <div style={{ width: 40, height: 24, borderRadius: 6, background: 'var(--neutral-200, #e5e7eb)', marginBottom: 4, animation: 'pulse 1.5s infinite' }} />
                <div style={{ width: 80, height: 14, borderRadius: 4, background: 'var(--neutral-200, #e5e7eb)', animation: 'pulse 1.5s infinite' }} />
            </div>
        </div>
    );

    return (
        <div>
            {/* Pulse animation for skeletons */}
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.4; }
                }
            `}</style>

            <div className="page-header">
                <h1>
                    {isAdmin ? '🛡️ Admin Dashboard' : isRenter ? '🚘 Renter Dashboard' : '👋 Welcome back'}
                    {profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
                </h1>
                <p>
                    {isAdmin
                        ? 'Manage users, vehicles, and platform operations'
                        : isRenter
                            ? 'Manage your vehicles and track bookings'
                            : 'Browse verified vehicles and manage your rentals'}
                </p>
            </div>

            {getVerificationBanner()}

            {/* Stats Grid */}
            <div className="stats-grid">
                {dataLoading ? (
                    <>
                        <StatSkeleton />
                        <StatSkeleton />
                        <StatSkeleton />
                    </>
                ) : isAdmin ? (
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
                ) : isRenter ? (
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
                {(isRenter || isAdmin) && (
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
                {dataLoading ? (
                    <div style={{ padding: 32, textAlign: 'center' }}>
                        <div className="spinner" style={{ margin: '0 auto 12px' }} />
                        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading bookings...</p>
                    </div>
                ) : recentBookings.length === 0 ? (
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
