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

    if (loading) return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-[3px] border-[var(--border-light)] border-t-[var(--primary-600)] rounded-full animate-spin" /></div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div className="page-header mb-0">
                    <h1>🚘 My Vehicles</h1>
                    <p>Manage your vehicle listings on SafeDrive</p>
                </div>
                <div className="flex gap-2.5 items-center">
                    {!isSubscribed && (
                        <div className="text-[13px] text-[var(--text-secondary)] text-right">
                            <div className="font-bold">{activeCount}/{FREE_LISTING_LIMIT} active (free)</div>
                            <button className="btn btn-sm btn-ghost text-[12px] text-[var(--primary-500)] p-[2px_0]"
                                onClick={() => navigate('/subscribe')}>
                                ⭐ Get unlimited →
                            </button>
                        </div>
                    )}
                    {isSubscribed && (
                        <div className="text-[12px] text-[var(--success-600)] font-bold bg-[var(--success-50)] p-[4px_10px] rounded-[var(--radius-sm)] border border-[var(--success-200)]">
                            ⭐ Premium — {activeCount} active
                        </div>
                    )}
                    <Link to="/vehicles/new" className="btn btn-accent"><FiPlus /> Add Vehicle</Link>
                </div>
            </div>

            {/* Subscribe CTA for free users with multiple vehicles */}
            {!isSubscribed && vehicles.length >= 1 && (
                <div className="bg-gradient-to-br from-[#1e3a5f] to-[#1a2e4a] rounded-[var(--radius-lg)] p-[16px_20px] mb-5 flex items-center gap-4 text-white">
                    <FiStar className="text-[24px] text-[#fbbf24] shrink-0" />
                    <div className="flex-1">
                        <div className="font-bold text-[14px]">Unlock Unlimited Listings for ₱399/month</div>
                        <div className="text-[13px] text-[#94a3b8] mt-0.5">
                            Free tier: {FREE_LISTING_LIMIT} active listing at a time. Subscribe to activate all your vehicles.
                        </div>
                    </div>
                    <button className="btn bg-[#3b82f6] text-white border-none whitespace-nowrap text-[13px]"
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
                                <th className="text-center">Active Listing</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {vehicles.map((v, idx) => {
                                const isActive = v.is_active_listing === true;
                                const isOldest = idx === 0;
                                return (
                                    <tr key={v.id} className={isActive ? 'opacity-100' : 'opacity-60'}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-[10px] bg-[var(--neutral-100)] flex items-center justify-center text-[20px]">🚗</div>
                                                <div>
                                                    <div className="font-bold">{v.year} {v.make} {v.model}</div>
                                                    <div className="text-[12px] text-[var(--text-tertiary)]">
                                                        {v.plate_number} • {v.color}
                                                        {isOldest && !isSubscribed && <span className="ml-1.5 text-[var(--primary-500)] font-bold">• Default</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="font-bold font-[var(--font-display)]">
                                            {v.pricing_type === 'fixed' ? (
                                                <div className="leading-[1.2]">
                                                    <div>₱{v.fixed_price?.toLocaleString()}</div>
                                                    <div className="text-[11px] text-[var(--text-tertiary)] font-semibold">Fixed • {v.fixed_rental_days}d</div>
                                                </div>
                                            ) : (
                                                <div className="leading-[1.2]">
                                                    <div>₱{v.daily_rate?.toLocaleString()}</div>
                                                    <div className="text-[11px] text-[var(--text-tertiary)] font-semibold">/day</div>
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`badge ${v.status === 'approved' || v.status === 'listed' ? 'badge-success' : v.status === 'pending' ? 'badge-pending' : 'badge-error'}`}>
                                                {v.status}
                                            </span>
                                        </td>
                                        <td className="text-center">
                                            <button
                                                onClick={() => toggleActiveListing(v)}
                                                disabled={togglingId === v.id || (v.status !== 'approved' && v.status !== 'listed')}
                                                title={isActive ? 'Click to deactivate' : 'Click to activate'}
                                                className={`bg-none border-none cursor-pointer text-[28px] flex items-center mx-auto transition-colors duration-150 ${isActive ? 'text-[var(--success-500)]' : 'text-[var(--neutral-400)]'}`}
                                            >
                                                {isActive ? <FiToggleRight /> : <FiToggleLeft />}
                                            </button>
                                        </td>
                                        <td>
                                            <div className="flex gap-2">
                                                <Link to={`/vehicles/${v.id}`} className="btn btn-ghost btn-sm btn-icon"><FiEye /></Link>
                                                <button className="btn btn-ghost btn-sm btn-icon text-[var(--error-500)]" onClick={() => deleteVehicle(v.id)}><FiTrash2 /></button>
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
