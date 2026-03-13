import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { FiEye, FiPlus, FiStar, FiToggleLeft, FiToggleRight, FiTrash2 } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatPHP, FREE_LISTING_LIMIT, isSubscriptionActive } from '../../lib/paymongo';
import { badgeClass, cx, ui } from '../../lib/ui';

export default function MyVehicles() {
    const { user, profile, refreshProfile } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [togglingId, setTogglingId] = useState(null);

    const isSubscribed = isSubscriptionActive(profile);
    const activeCount = vehicles.filter((vehicle) => vehicle.is_active_listing === true).length;
    const formatCurrency = (value) => formatPHP(value || 0);

    useEffect(() => {
        fetchMyVehicles();
    }, [location.key, profile?.id]);

    useEffect(() => {
        if (refreshProfile) {
            refreshProfile().catch(console.error);
        }
    }, [refreshProfile]);

    const fetchMyVehicles = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('vehicles')
                .select('*')
                .eq('owner_id', user.id)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setVehicles(data || []);
        } catch (err) {
            console.error('Error loading vehicles:', err);
            toast.error('Failed to load your vehicles');
        } finally {
            setLoading(false);
        }
    };

    const toggleActiveListing = async (vehicle) => {
        const currentlyActive = vehicle.is_active_listing === true;

        if (!currentlyActive && !isSubscribed && activeCount >= FREE_LISTING_LIMIT) {
            toast.error(
                `Free users can only have ${FREE_LISTING_LIMIT} active listing at a time. Deactivate another vehicle or subscribe.`
            );
            return;
        }

        setTogglingId(vehicle.id);
        try {
            const { error } = await supabase
                .from('vehicles')
                .update({
                    is_available: !currentlyActive,
                    is_active_listing: !currentlyActive,
                })
                .eq('id', vehicle.id);

            if (error) throw error;

            toast.success(currentlyActive ? 'Listing deactivated' : 'Listing activated');
            fetchMyVehicles();
        } catch (err) {
            console.error('Error toggling listing:', err);
            toast.error('Failed to update listing');
        } finally {
            setTogglingId(null);
        }
    };

    const deleteVehicle = async (vehicleId) => {
        if (!window.confirm('Delete this vehicle? This cannot be undone.')) return;

        const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
        if (error) {
            toast.error('Failed to delete vehicle');
            return;
        }

        toast.success('Vehicle deleted');
        fetchMyVehicles();
    };

    if (loading) {
        return (
            <div className={ui.loadingScreen}>
                <div className={ui.spinner} />
                <p className="text-sm font-medium text-text-secondary">Loading your vehicles...</p>
            </div>
        );
    }

    return (
        <div className={ui.page}>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className={ui.pageHeader}>
                    <h1 className={ui.pageTitle}>My vehicles</h1>
                    <p className={ui.pageDescription}>
                        Manage your active listings, monitor approval status, and control which cars are visible to renters.
                    </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="rounded-3xl border border-border-light bg-surface-primary px-4 py-3 text-sm shadow-soft">
                        {!isSubscribed ? (
                            <div className="space-y-1">
                                <div className="font-semibold text-text-primary">
                                    {activeCount}/{FREE_LISTING_LIMIT} active on free tier
                                </div>
                                <button
                                    type="button"
                                    className="text-sm font-medium text-primary-700 transition hover:text-primary-800"
                                    onClick={() => navigate('/subscribe')}
                                >
                                    Upgrade for unlimited listings
                                </button>
                            </div>
                        ) : (
                            <div className="inline-flex items-center gap-2 font-semibold text-success-700">
                                <FiStar />
                                Premium active
                            </div>
                        )}
                    </div>
                    <Link to="/vehicles/new" className={ui.button.accent}>
                        <FiPlus />
                        Add vehicle
                    </Link>
                </div>
            </div>

            {!isSubscribed && vehicles.length > 0 && (
                <section className="overflow-hidden rounded-[36px] border border-primary-700/20 bg-primary-900 p-6 text-white shadow-float">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-white/60">
                                Premium
                            </div>
                            <h2 className="mt-2 font-display text-3xl font-bold">
                                Unlock unlimited active listings
                            </h2>
                            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/70">
                                Free users can keep only {FREE_LISTING_LIMIT} active vehicle at a time. Upgrade to activate more vehicles and manage your lister business without limits.
                            </p>
                        </div>
                        <button type="button" className={ui.button.accent} onClick={() => navigate('/subscribe')}>
                            Subscribe now
                        </button>
                    </div>
                </section>
            )}

            {vehicles.length === 0 ? (
                <div className={ui.emptyState}>
                    <div className={ui.emptyIcon}>🚗</div>
                    <h2 className="font-display text-2xl font-semibold text-text-primary">
                        No vehicles listed yet
                    </h2>
                    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-text-secondary">
                        Start building your lister presence by adding your first vehicle and setting its availability.
                    </p>
                    <div className="mt-6">
                        <Link to="/vehicles/new" className={ui.button.accent}>
                            <FiPlus />
                            List a vehicle
                        </Link>
                    </div>
                </div>
            ) : (
                <section className={ui.tableWrap}>
                    <div className="hidden lg:block">
                        <table className={ui.table}>
                            <thead className={ui.tableHead}>
                                <tr>
                                    <th className={ui.tableHeadCell}>Vehicle</th>
                                    <th className={ui.tableHeadCell}>Pricing</th>
                                    <th className={ui.tableHeadCell}>Admin status</th>
                                    <th className={ui.tableHeadCell}>Listing</th>
                                    <th className={`${ui.tableHeadCell} text-right`}>Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-light bg-surface-primary">
                                {vehicles.map((vehicle, index) => {
                                    const isActive = vehicle.is_active_listing === true;
                                    const isOldest = index === 0;

                                    return (
                                        <tr key={vehicle.id}>
                                            <td className={ui.tableCell}>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-2xl">
                                                        🚗
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold text-text-primary">
                                                            {vehicle.year} {vehicle.make} {vehicle.model}
                                                        </div>
                                                        <div className="text-xs text-text-tertiary">
                                                            {vehicle.plate_number} • {vehicle.color}
                                                            {isOldest && !isSubscribed ? ' • default free listing' : ''}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className={ui.tableCell}>
                                                <div className="font-semibold text-text-primary">
                                                    {vehicle.pricing_type === 'fixed'
                                                        ? formatCurrency(vehicle.fixed_price)
                                                        : formatCurrency(vehicle.daily_rate)}
                                                </div>
                                                <div className="text-xs text-text-tertiary">
                                                    {vehicle.pricing_type === 'fixed'
                                                        ? `${vehicle.fixed_rental_days} day package`
                                                        : 'Daily rate'}
                                                </div>
                                            </td>
                                            <td className={ui.tableCell}>
                                                <span
                                                    className={badgeClass(
                                                        vehicle.status === 'approved' || vehicle.status === 'listed'
                                                            ? 'success'
                                                            : vehicle.status === 'pending'
                                                                ? 'pending'
                                                                : 'error'
                                                    )}
                                                >
                                                    {vehicle.status}
                                                </span>
                                            </td>
                                            <td className={ui.tableCell}>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleActiveListing(vehicle)}
                                                    disabled={togglingId === vehicle.id || (vehicle.status !== 'approved' && vehicle.status !== 'listed')}
                                                    className={cx(
                                                        'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition',
                                                        isActive
                                                            ? 'bg-success-50 text-success-700'
                                                            : 'bg-neutral-100 text-text-tertiary'
                                                    )}
                                                >
                                                    {isActive ? <FiToggleRight /> : <FiToggleLeft />}
                                                    {isActive ? 'Active' : 'Inactive'}
                                                </button>
                                            </td>
                                            <td className={`${ui.tableCell} text-right`}>
                                                <div className="flex justify-end gap-2">
                                                    <Link to={`/vehicles/${vehicle.id}`} className={`${ui.button.ghost} ${ui.button.sm}`}>
                                                        <FiEye />
                                                        View
                                                    </Link>
                                                    <button
                                                        type="button"
                                                        className={`${ui.button.danger} ${ui.button.sm}`}
                                                        onClick={() => deleteVehicle(vehicle.id)}
                                                    >
                                                        <FiTrash2 />
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="grid gap-4 p-5 lg:hidden">
                        {vehicles.map((vehicle, index) => {
                            const isActive = vehicle.is_active_listing === true;
                            const isOldest = index === 0;

                            return (
                                <article key={vehicle.id} className="rounded-[30px] border border-border-light bg-surface-primary p-5 shadow-soft">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <h2 className="font-semibold text-text-primary">
                                                {vehicle.year} {vehicle.make} {vehicle.model}
                                            </h2>
                                            <p className="mt-1 text-sm text-text-secondary">
                                                {vehicle.plate_number} • {vehicle.color}
                                            </p>
                                            {isOldest && !isSubscribed && (
                                                <p className="mt-1 text-xs text-primary-700">Default free listing</p>
                                            )}
                                        </div>
                                        <span
                                            className={badgeClass(
                                                vehicle.status === 'approved' || vehicle.status === 'listed'
                                                    ? 'success'
                                                    : vehicle.status === 'pending'
                                                        ? 'pending'
                                                        : 'error'
                                            )}
                                        >
                                            {vehicle.status}
                                        </span>
                                    </div>

                                    <div className="mt-4 flex items-center justify-between rounded-3xl bg-surface-secondary px-4 py-3 text-sm">
                                        <div>
                                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Pricing</div>
                                            <div className="mt-1 font-semibold text-text-primary">
                                                {vehicle.pricing_type === 'fixed'
                                                    ? formatCurrency(vehicle.fixed_price)
                                                    : formatCurrency(vehicle.daily_rate)}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => toggleActiveListing(vehicle)}
                                            disabled={togglingId === vehicle.id || (vehicle.status !== 'approved' && vehicle.status !== 'listed')}
                                            className={cx(
                                                'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition',
                                                isActive
                                                    ? 'bg-success-50 text-success-700'
                                                    : 'bg-neutral-100 text-text-tertiary'
                                            )}
                                        >
                                            {isActive ? <FiToggleRight /> : <FiToggleLeft />}
                                            {isActive ? 'Active' : 'Inactive'}
                                        </button>
                                    </div>

                                    <div className="mt-4 flex flex-wrap gap-2">
                                        <Link to={`/vehicles/${vehicle.id}`} className={`${ui.button.ghost} ${ui.button.sm}`}>
                                            <FiEye />
                                            View
                                        </Link>
                                        <button
                                            type="button"
                                            className={`${ui.button.danger} ${ui.button.sm}`}
                                            onClick={() => deleteVehicle(vehicle.id)}
                                        >
                                            <FiTrash2 />
                                            Delete
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
