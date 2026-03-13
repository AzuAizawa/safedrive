import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FiTruck, FiCalendar, FiStar, FiAlertTriangle, FiArrowRight, FiCheckCircle, FiClock, FiUsers, FiShield } from 'react-icons/fi';
import { isSubscriptionActive, getSubscriptionDaysLeft } from '../lib/paymongo';

export default function Dashboard() {
    const { profile, isAdmin, isRenter, isRentee, refreshProfile } = useAuth();
    const [stats, setStats] = useState({ vehicles: 0, bookings: 0, reviews: 0, pendingUsers: 0 });
    const [recentBookings, setRecentBookings] = useState([]);
    const [dataLoading, setDataLoading] = useState(true);

    // Completely bust the Profile Context cache
    useEffect(() => {
        if (refreshProfile) refreshProfile().catch(console.error);
    }, []);

    useEffect(() => {
        if (profile) {
            fetchDashboardData();
        } else {
            // Don't block UI waiting for profile — stop loading quickly
            const timer = setTimeout(() => setDataLoading(false), 500);
            return () => clearTimeout(timer);
        }
    }, [profile]);

    // Safety: never show loading forever, even if queries hang
    useEffect(() => {
        const safety = setTimeout(() => setDataLoading(false), 5000);
        return () => clearTimeout(safety);
    }, []);

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
        if (isAdmin) {
            return (
                <div className="bg-gradient-to-br from-[#eff6ff] to-[#dbeafe] border border-blue-500/30 rounded-[var(--radius-lg,12px)] px-6 py-5 mb-6 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-[#dbeafe] text-[#2563eb] flex items-center justify-center text-[22px] shrink-0">
                        <FiShield />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base font-bold mb-1">You're the Admin</h3>
                        <p className="text-sm text-[var(--text-secondary)] m-0">Manage users, verify identities, and approve vehicle listings from the Admin Panel.</p>
                    </div>
                    <Link to="/admin" className="btn btn-primary btn-sm shrink-0">
                        Go to Admin Panel <FiArrowRight />
                    </Link>
                </div>
            );
        }
        // Hide banner when verified — check both role and verification_status
        const userIsVerified = profile?.role === 'verified' || profile?.verification_status === 'verified';
        if (userIsVerified) return null;

        // Only two states: verified (hidden above) or not verified (show this)
        const msg = {
            icon: <FiAlertTriangle />,
            title: 'Verify Your Identity',
            desc: 'Submit your government ID and a selfie photo to get verified. Verified users can list and rent vehicles.',
            action: 'Submit Documents',
            link: '/profile',
            bgGradient: 'linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)',
            borderColor: 'rgba(245,158,11,0.3)',
            iconBg: '#fef3c7',
            iconColor: '#d97706',
        };

        return (
            <div className={`rounded-[var(--radius-lg,12px)] px-6 py-5 mb-6 flex items-center gap-4 flex-wrap border border-orange-500/30 bg-gradient-to-br from-orange-50 to-amber-50`}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[22px] shrink-0 bg-amber-100 text-[#d97706]">
                    {msg.icon}
                </div>
                <div className="flex-1 min-w-[200px]">
                    <h3 className="text-base font-bold mb-1">{msg.title}</h3>
                    <p className="text-sm text-[var(--text-secondary)] m-0">{msg.desc}</p>
                </div>
                <Link to={msg.link} className="btn btn-accent btn-sm shrink-0">
                    {msg.action} <FiArrowRight />
                </Link>
            </div>
        );
    };

    // Skeleton placeholder for stats while loading
    const StatSkeleton = () => (
        <div className="stat-card opacity-50">
            <div className="w-12 h-12 rounded-xl bg-[var(--neutral-200,#e5e7eb)] animate-pulse" />
            <div className="stat-info">
                <div className="w-10 h-6 rounded-md bg-[var(--neutral-200,#e5e7eb)] mb-1 animate-pulse" />
                <div className="w-20 h-3.5 rounded bg-[var(--neutral-200,#e5e7eb)] animate-pulse" />
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

            {/* ── Subscription Banner (verified non-admin users only) ── */}
            {!isAdmin && (profile?.role === 'verified' || profile?.verification_status === 'verified') && (
                isSubscriptionActive(profile) ? (
                    <div className="bg-gradient-to-br from-[#0f2d1f] to-[#14532d] border border-green-400/30 rounded-[var(--radius-lg,12px)] px-5 py-3.5 mb-6 flex items-center gap-3.5">
                        <span className="text-[22px]">⭐</span>
                        <div className="flex-1">
                            <div className="font-bold text-[14px] text-[#4ade80]">SafeDrive Premium Active</div>
                            <div className="text-[13px] text-[#86efac]">
                                {getSubscriptionDaysLeft(profile)} days remaining — Unlimited listings
                            </div>
                        </div>
                        <Link to="/subscribe" className="btn btn-sm bg-green-400/20 text-[#4ade80] border border-green-400/40 text-[12px]">
                            Manage
                        </Link>
                    </div>
                ) : (
                    <div className="bg-gradient-to-br from-[#1e3a5f] to-[#1a2e4a] border border-blue-500/40 rounded-[var(--radius-lg,12px)] px-5 py-4 mb-6 flex items-center gap-3.5">
                        <span className="text-2xl">⭐</span>
                        <div className="flex-1">
                            <div className="font-bold text-[14px] text-[#93c5fd]">Unlock Unlimited Listings</div>
                            <div className="text-[13px] text-[#64748b]">
                                Subscribe for ₱399/month via GCash — list as many cars as you want.
                            </div>
                        </div>
                        <Link to="/subscribe" className="btn btn-primary btn-sm shrink-0 bg-[#3b82f6] border-none whitespace-nowrap">
                            Subscribe ₱399 →
                        </Link>
                    </div>
                )
            )}

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
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5 mb-8">
                {isAdmin && (
                    <>
                        <Link to="/admin?tab=users" className="card card-body flex items-center gap-4 cursor-pointer">
                            <div className="stat-icon blue w-11 h-11"><FiUsers /></div>
                            <div>
                                <h3 className="text-[15px] font-bold">Manage Users</h3>
                                <p className="text-[13px] text-[var(--text-tertiary)]">Verify identities & manage accounts</p>
                            </div>
                            <FiArrowRight className="ml-auto text-[var(--text-tertiary)]" />
                        </Link>
                        <Link to="/admin?tab=vehicles" className="card card-body flex items-center gap-4 cursor-pointer">
                            <div className="stat-icon green w-11 h-11"><FiTruck /></div>
                            <div>
                                <h3 className="text-[15px] font-bold">Manage Vehicles</h3>
                                <p className="text-[13px] text-[var(--text-tertiary)]">Approve & review car listings</p>
                            </div>
                            <FiArrowRight className="ml-auto text-[var(--text-tertiary)]" />
                        </Link>
                    </>
                )}
                {isRenter && !isAdmin && (
                    <Link to="/vehicles/new" className="card card-body flex items-center gap-4 cursor-pointer bg-gradient-to-br from-[var(--accent-50)] to-[var(--warning-50)] border-orange-500/20">
                        <div className="stat-icon orange w-11 h-11">🚗</div>
                        <div>
                            <h3 className="text-[15px] font-bold">List a New Vehicle</h3>
                            <p className="text-[13px] text-[var(--text-tertiary)]">Add your car to the platform</p>
                        </div>
                        <FiArrowRight className="ml-auto text-[var(--text-tertiary)]" />
                    </Link>
                )}
                <Link to="/vehicles" className="card card-body flex items-center gap-4 cursor-pointer">
                    <div className="stat-icon blue w-11 h-11">🔍</div>
                    <div>
                        <h3 className="text-[15px] font-bold">{isAdmin ? 'View All Vehicles' : 'Browse Vehicles'}</h3>
                        <p className="text-[13px] text-[var(--text-tertiary)]">{isAdmin ? 'See all listed vehicles on the platform' : 'Find your perfect rental car'}</p>
                    </div>
                    <FiArrowRight className="ml-auto text-[var(--text-tertiary)]" />
                </Link>
            </div>

            {/* Recent Bookings */}
            <div className="card">
                <div className="card-header">
                    <h2 className="text-base font-bold font-[var(--font-display)]">Recent Bookings</h2>
                    <Link to="/bookings" className="btn btn-ghost btn-sm">View All <FiArrowRight /></Link>
                </div>
                {dataLoading ? (
                    <div className="p-8 text-center">
                        <div className="spinner mx-auto mb-3" />
                        <p className="text-[13px] text-[var(--text-tertiary)]">Loading bookings...</p>
                    </div>
                ) : recentBookings.length === 0 ? (
                    <div className="empty-state p-12">
                        <div className="empty-state-icon">📋</div>
                        <h3>No bookings yet</h3>
                        <p>Your rental bookings will appear here once you start using SafeDrive.</p>
                        <Link to="/vehicles" className="btn btn-primary">Browse Vehicles</Link>
                    </div>
                ) : (
                    <div className="overflow-auto">
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
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-[var(--neutral-100)] flex items-center justify-center">🚗</div>
                                                <div>
                                                    <div className="font-semibold text-[14px]">{booking.vehicles?.year} {booking.vehicles?.make} {booking.vehicles?.model}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="text-[13px] text-[var(--text-secondary)]">
                                            {new Date(booking.start_date).toLocaleDateString()} - {new Date(booking.end_date).toLocaleDateString()}
                                        </td>
                                        <td className="font-bold font-[var(--font-display)]">₱{booking.total_amount?.toLocaleString()}</td>
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
