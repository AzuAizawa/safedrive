import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { FiPlus, FiEye, FiTrash2, FiStar, FiToggleLeft, FiToggleRight } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { isSubscriptionActive, FREE_LISTING_LIMIT } from '../../lib/paymongo';

export default function MyVehicles() {
    const { user, profile, refreshProfile } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [togglingId, setTogglingId] = useState(null);

    // Always derive subscription status dynamically on render
    const isSubscribed = isSubscriptionActive(profile);

    // 1. Fetch vehicles on load or when profile changes
    useEffect(() => {
        let mounted = true;
        fetchMyVehicles();
        const safety = setTimeout(() => { if (mounted) setLoading(false); }, 5000);
        return () => { mounted = false; clearTimeout(safety); };
    }, [profile?.id, location.key]); // Refetch on route change to capture newly added vehicles

    // 2. Guarantee profile is perfectly synced with DB if they just paid
    useEffect(() => {
        if (refreshProfile) {
            refreshProfile().catch(console.error);
        }
    }, []); // Run once when visiting the page

    const fetchMyVehicles = async () => {
        try {
            const { data, error } = await supabase
                .from('vehicles')
                .select('*')
                .eq('owner_id', user.id)
                .order('created_at', { ascending: true }); // oldest first (free tier keeps oldest active)
            if (error) throw error;
            setVehicles(data || []);
        } catch (err) {
            console.error('Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const activeCount = vehicles.filter(v => v.is_active_listing === true).length;

    /**
     * Toggle a vehicle's active/inactive listing state.
     * Free users: max FREE_LISTING_LIMIT (1) active at a time.
     * Subscribed users: unlimited.
     */
    const toggleActiveListing = async (vehicle) => {
        const currentlyActive = vehicle.is_active_listing === true;

        if (!currentlyActive && !isSubscribed && activeCount >= FREE_LISTING_LIMIT) {
            toast.error(
                `Free users can only have ${FREE_LISTING_LIMIT} active listing. ` +
                `Deactivate another vehicle first, or subscribe for unlimited listings.`,
                { duration: 5000 }
            );
            return;
        }

        setTogglingId(vehicle.id);
        try {
            const { error } = await supabase.from('vehicles').update({
                is_available: !currentlyActive,
                is_active_listing: !currentlyActive,
            }).eq('id', vehicle.id);

            if (error) throw error;
            toast.success(currentlyActive ? 'Listing deactivated' : 'Listing activated ✅');
            fetchMyVehicles();
        } catch (err) {
            toast.error('Failed to update listing');
        } finally {
            setTogglingId(null);
        }
    };

    const deleteVehicle = async (vehicleId) => {
        if (!confirm('Are you sure you want to delete this vehicle? This cannot be undone.')) return;
        const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
        if (error) { toast.error('Failed to delete'); return; }
        toast.success('Vehicle deleted');
        fetchMyVehicles();
    };

    if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div className="page-header" style={{ marginBottom: 0 }}>
                    <h1>🚘 My Vehicles</h1>
                    <p>Manage your vehicle listings on SafeDrive</p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {!isSubscribed && (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'right' }}>
                            <div style={{ fontWeight: 700 }}>{activeCount}/{FREE_LISTING_LIMIT} active (free)</div>
                            <button className="btn btn-sm btn-ghost" style={{ fontSize: 12, color: 'var(--primary-500)', padding: '2px 0' }}
                                onClick={() => navigate('/subscribe')}>
                                ⭐ Get unlimited →
                            </button>
                        </div>
                    )}
                    {isSubscribed && (
                        <div style={{ fontSize: 12, color: 'var(--success-600)', fontWeight: 700, background: 'var(--success-50)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--success-200)' }}>
                            ⭐ Premium — {activeCount} active
                        </div>
                    )}
                    <Link to="/vehicles/new" className="btn btn-accent"><FiPlus /> Add Vehicle</Link>
                </div>
            </div>

            {/* Subscribe CTA for free users with multiple vehicles */}
            {!isSubscribed && vehicles.length >= 1 && (
                <div style={{
                    background: 'linear-gradient(135deg, #1e3a5f, #1a2e4a)',
                    borderRadius: 'var(--radius-lg)', padding: '16px 20px',
                    marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16, color: '#fff',
                }}>
                    <FiStar style={{ fontSize: 24, color: '#fbbf24', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>Unlock Unlimited Listings for ₱399/month</div>
                        <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
                            Free tier: {FREE_LISTING_LIMIT} active listing at a time. Subscribe to activate all your vehicles.
                        </div>
                    </div>
                    <button className="btn" style={{ background: '#3b82f6', color: '#fff', border: 'none', whiteSpace: 'nowrap', fontSize: 13 }}
                        onClick={() => navigate('/subscribe')}>
                        Subscribe Now
                    </button>
                </div>
            )}

            {vehicles.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-icon">🚗</div>
                    <h3>No vehicles listed</h3>
                    <p>Start earning by listing your first vehicle on SafeDrive.</p>
                    <Link to="/vehicles/new" className="btn btn-accent"><FiPlus /> List a Vehicle</Link>
                </div>
            ) : (
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Vehicle</th>
                                <th>Price</th>
                                <th>Admin Status</th>
                                <th style={{ textAlign: 'center' }}>Active Listing</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {vehicles.map((v, idx) => {
                                const isActive = v.is_active_listing === true;
                                const isOldest = idx === 0;
                                return (
                                    <tr key={v.id} style={{ opacity: isActive ? 1 : 0.6 }}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--neutral-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🚗</div>
                                                <div>
                                                    <div style={{ fontWeight: 700 }}>{v.year} {v.make} {v.model}</div>
                                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                                        {v.plate_number} • {v.color}
                                                        {isOldest && !isSubscribed && <span style={{ marginLeft: 6, color: 'var(--primary-500)', fontWeight: 700 }}>• Default</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                                            {v.pricing_type === 'fixed' ? (
                                                <div style={{ lineHeight: 1.2 }}>
                                                    <div>₱{v.fixed_price?.toLocaleString()}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Fixed • {v.fixed_rental_days}d</div>
                                                </div>
                                            ) : (
                                                <div style={{ lineHeight: 1.2 }}>
                                                    <div>₱{v.daily_rate?.toLocaleString()}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>/day</div>
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`badge ${v.status === 'approved' || v.status === 'listed' ? 'badge-success' : v.status === 'pending' ? 'badge-pending' : 'badge-error'}`}>
                                                {v.status}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <button
                                                onClick={() => toggleActiveListing(v)}
                                                disabled={togglingId === v.id || (v.status !== 'approved' && v.status !== 'listed')}
                                                title={isActive ? 'Click to deactivate' : 'Click to activate'}
                                                style={{
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    color: isActive ? 'var(--success-500)' : 'var(--neutral-400)',
                                                    fontSize: 28, display: 'flex', alignItems: 'center', margin: '0 auto',
                                                    transition: 'color 0.15s',
                                                }}
                                            >
                                                {isActive ? <FiToggleRight /> : <FiToggleLeft />}
                                            </button>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <Link to={`/vehicles/${v.id}`} className="btn btn-ghost btn-sm btn-icon"><FiEye /></Link>
                                                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => deleteVehicle(v.id)} style={{ color: 'var(--error-500)' }}><FiTrash2 /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
