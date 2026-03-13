import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FiFilter, FiHeart, FiMapPin, FiSearch, FiStar, FiUsers, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { badgeClass, cx, ui } from '../lib/ui';

const PRICE_RANGES = [
    { label: 'All prices', min: 0, max: Infinity },
    { label: 'PHP 0 - PHP 1,500', min: 0, max: 1500 },
    { label: 'PHP 1,500 - PHP 3,000', min: 1500, max: 3000 },
    { label: 'PHP 3,000 - PHP 5,000', min: 3000, max: 5000 },
    { label: 'PHP 5,000+', min: 5000, max: Infinity },
];

const BODY_TYPES = ['Sedan', 'SUV', 'MPV', 'Van', 'Hatchback', 'Pickup', 'Crossover', 'Coupe'];

function formatCurrency(value) {
    return `PHP ${Number(value || 0).toLocaleString()}`;
}

export default function Vehicles() {
    const { user } = useAuth();
    const location = useLocation();
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all');
    const [filterBrand, setFilterBrand] = useState('all');
    const [filterCity, setFilterCity] = useState('all');
    const [filterTransmission, setFilterTransmission] = useState('all');
    const [filterPrice, setFilterPrice] = useState(0);
    const [sortBy, setSortBy] = useState('newest');
    const [favorites, setFavorites] = useState(new Set());
    const [showFilters, setShowFilters] = useState(false);
    const [brands, setBrands] = useState([]);

    useEffect(() => {
        fetchVehicles();
        fetchBrands();
        if (user) fetchFavorites();
    }, [location.key, user]);

    const fetchVehicles = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('vehicles')
                .select('*, profiles!vehicles_owner_id_fkey(full_name, average_rating, avatar_url)')
                .in('status', ['approved', 'listed'])
                .eq('is_available', true)
                .is('is_active_listing', true)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setVehicles(data || []);
        } catch (err) {
            console.error('Error fetching vehicles:', err);
            toast.error('Failed to load vehicles');
            setVehicles([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchBrands = async () => {
        try {
            const { data } = await supabase.from('car_brands').select('name').eq('is_active', true).order('name');
            setBrands(data?.map((brand) => brand.name) || []);
        } catch {
            setBrands([]);
        }
    };

    const fetchFavorites = async () => {
        try {
            const { data } = await supabase.from('favorites').select('vehicle_id').eq('user_id', user.id);
            setFavorites(new Set(data?.map((favorite) => favorite.vehicle_id) || []));
        } catch {
            setFavorites(new Set());
        }
    };

    const toggleFavorite = async (event, vehicleId) => {
        event.preventDefault();
        event.stopPropagation();

        if (!user) {
            toast.error('Please sign in to save favorites.');
            return;
        }

        if (favorites.has(vehicleId)) {
            await supabase.from('favorites').delete().eq('user_id', user.id).eq('vehicle_id', vehicleId);
            setFavorites((previous) => {
                const next = new Set(previous);
                next.delete(vehicleId);
                return next;
            });
            toast.success('Removed from favorites');
        } else {
            await supabase.from('favorites').insert({ user_id: user.id, vehicle_id: vehicleId });
            setFavorites((previous) => new Set([...previous, vehicleId]));
            toast.success('Added to favorites');
        }
    };

    const priceRange = PRICE_RANGES[filterPrice];
    const cities = [...new Set(vehicles.map((vehicle) => vehicle.pickup_city).filter(Boolean))].sort();
    const activeFilterCount = [filterType !== 'all', filterBrand !== 'all', filterCity !== 'all', filterTransmission !== 'all', filterPrice !== 0].filter(Boolean).length;

    const filteredVehicles = vehicles
        .filter((vehicle) => {
            const searchHaystack = `${vehicle.make} ${vehicle.model} ${vehicle.year} ${vehicle.color}`.toLowerCase();
            const matchesSearch = searchHaystack.includes(searchTerm.toLowerCase());
            const matchesType = filterType === 'all' || vehicle.body_type === filterType;
            const matchesBrand = filterBrand === 'all' || vehicle.make === filterBrand;
            const matchesCity = filterCity === 'all' || vehicle.pickup_city === filterCity;
            const matchesTransmission = filterTransmission === 'all' || vehicle.transmission === filterTransmission;
            const matchesPrice = (vehicle.daily_rate || 0) >= priceRange.min && (vehicle.daily_rate || 0) <= priceRange.max;
            return matchesSearch && matchesType && matchesBrand && matchesCity && matchesTransmission && matchesPrice;
        })
        .sort((a, b) => {
            if (sortBy === 'price-low') return (a.daily_rate || 0) - (b.daily_rate || 0);
            if (sortBy === 'price-high') return (b.daily_rate || 0) - (a.daily_rate || 0);
            if (sortBy === 'rating') return (b.profiles?.average_rating || 0) - (a.profiles?.average_rating || 0);
            return new Date(b.created_at) - new Date(a.created_at);
        });

    const clearFilters = () => {
        setFilterType('all');
        setFilterBrand('all');
        setFilterCity('all');
        setFilterTransmission('all');
        setFilterPrice(0);
        setSearchTerm('');
    };

    if (loading) {
        return (
            <div className={`${ui.loadingScreen} mt-28`}>
                <div className={ui.spinner} />
                <p className="text-sm font-medium text-text-secondary">Loading available vehicles...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <section className="overflow-hidden rounded-[40px] border border-primary-700/20 bg-primary-900 px-6 py-8 text-white shadow-float sm:px-8 sm:py-10">
                <div className="max-w-3xl space-y-5">
                    <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                        Browse vehicles
                    </div>
                    <div className="space-y-3">
                        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
                            Find the right car for your next booking.
                        </h1>
                        <p className="max-w-2xl text-sm leading-7 text-white/70 sm:text-base">
                            Explore verified listings across the Philippines and refine by body type, city, price, and transmission.
                        </p>
                    </div>
                </div>

                <div className="mt-8 flex flex-col gap-3 lg:flex-row">
                    <div className="relative flex-1">
                        <FiSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/50" />
                        <input
                            type="text"
                            className="w-full rounded-full border border-white/15 bg-white/10 px-4 py-3 pl-12 text-sm text-white placeholder:text-white/45 backdrop-blur focus:border-white/30 focus:outline-none"
                            placeholder="Search by make, model, or year"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowFilters((open) => !open)}
                        className={cx(
                            'inline-flex items-center justify-center gap-2 rounded-full border px-5 py-3 text-sm font-semibold transition',
                            showFilters ? 'border-white bg-white text-primary-700' : 'border-white/20 bg-white/10 text-white hover:bg-white/15'
                        )}
                    >
                        <FiFilter />
                        Filters
                        {activeFilterCount > 0 && (
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-500 text-xs font-bold text-white">
                                {activeFilterCount}
                            </span>
                        )}
                    </button>
                </div>
            </section>

            {showFilters && (
                <section className={ui.section}>
                    <div className={ui.sectionHeader}>
                        <div>
                            <h2 className="font-display text-2xl font-bold text-text-primary">Filters</h2>
                            <p className="text-sm text-text-tertiary">Narrow the list to your ideal trip setup.</p>
                        </div>
                        {activeFilterCount > 0 && (
                            <button type="button" className={`${ui.button.ghost} ${ui.button.sm}`} onClick={clearFilters}>
                                <FiX />
                                Clear all
                            </button>
                        )}
                    </div>
                    <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
                        <div>
                            <label className={ui.label}>Brand</label>
                            <select className={ui.select} value={filterBrand} onChange={(event) => setFilterBrand(event.target.value)}>
                                <option value="all">All brands</option>
                                {brands.map((brand) => (
                                    <option key={brand} value={brand}>{brand}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={ui.label}>Body type</label>
                            <select className={ui.select} value={filterType} onChange={(event) => setFilterType(event.target.value)}>
                                <option value="all">All types</option>
                                {BODY_TYPES.map((bodyType) => (
                                    <option key={bodyType} value={bodyType}>{bodyType}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={ui.label}>City</label>
                            <select className={ui.select} value={filterCity} onChange={(event) => setFilterCity(event.target.value)}>
                                <option value="all">All cities</option>
                                {cities.map((city) => (
                                    <option key={city} value={city}>{city}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={ui.label}>Transmission</label>
                            <select className={ui.select} value={filterTransmission} onChange={(event) => setFilterTransmission(event.target.value)}>
                                <option value="all">All transmissions</option>
                                <option value="Automatic">Automatic</option>
                                <option value="Manual">Manual</option>
                            </select>
                        </div>
                        <div>
                            <label className={ui.label}>Price range</label>
                            <select className={ui.select} value={filterPrice} onChange={(event) => setFilterPrice(Number(event.target.value))}>
                                {PRICE_RANGES.map((range, index) => (
                                    <option key={range.label} value={index}>{range.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={ui.label}>Sort by</label>
                            <select className={ui.select} value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                                <option value="newest">Newest first</option>
                                <option value="price-low">Price: low to high</option>
                                <option value="price-high">Price: high to low</option>
                                <option value="rating">Highest rated</option>
                            </select>
                        </div>
                    </div>
                </section>
            )}

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="text-sm text-text-secondary">
                    Showing <span className="font-semibold text-text-primary">{filteredVehicles.length}</span> of {vehicles.length} vehicles
                </div>
                <div className="flex flex-wrap gap-2">
                    {['all', 'Sedan', 'SUV', 'MPV', 'Pickup'].map((type) => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => setFilterType(type)}
                            className={type === filterType ? badgeClass('info') : badgeClass('neutral')}
                        >
                            {type === 'all' ? 'All types' : type}
                        </button>
                    ))}
                </div>
            </div>

            {filteredVehicles.length === 0 ? (
                <div className={ui.emptyState}>
                    <div className={ui.emptyIcon}>🚗</div>
                    <h2 className="font-display text-2xl font-semibold text-text-primary">No vehicles found</h2>
                    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-text-secondary">
                        Try adjusting your search or clearing some filters to widen the results.
                    </p>
                    {activeFilterCount > 0 && (
                        <div className="mt-6">
                            <button type="button" className={ui.button.primary} onClick={clearFilters}>
                                Clear filters
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {filteredVehicles.map((vehicle) => {
                        const image = vehicle.thumbnail_url || vehicle.images?.[0];
                        const isFavorite = favorites.has(vehicle.id);

                        return (
                            <Link
                                to={`/vehicles/${vehicle.id}`}
                                key={vehicle.id}
                                className="group overflow-hidden rounded-[32px] border border-border-light bg-surface-primary shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-float"
                            >
                                <div className="relative h-60 overflow-hidden bg-neutral-100">
                                    {image ? (
                                        <img
                                            src={image}
                                            alt={`${vehicle.make} ${vehicle.model}`}
                                            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-5xl">
                                            🚗
                                        </div>
                                    )}

                                    <div className="absolute left-4 top-4 flex gap-2">
                                        <span className={vehicle.is_available ? badgeClass('success') : badgeClass('pending')}>
                                            {vehicle.is_available ? 'Available' : 'Busy'}
                                        </span>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={(event) => toggleFavorite(event, vehicle.id)}
                                        className={cx(
                                            'absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/90 text-base backdrop-blur transition',
                                            isFavorite ? 'text-error-500' : 'text-text-secondary hover:text-error-500'
                                        )}
                                    >
                                        <FiHeart className={isFavorite ? 'fill-current' : ''} />
                                    </button>
                                </div>

                                <div className="space-y-4 p-5">
                                    <div className="flex flex-wrap gap-2">
                                        <span className={badgeClass('info')}>{vehicle.body_type}</span>
                                        <span className={badgeClass('neutral')}>{vehicle.transmission}</span>
                                        {vehicle.color && <span className={badgeClass('neutral')}>{vehicle.color}</span>}
                                    </div>

                                    <div className="space-y-2">
                                        <h2 className="font-display text-2xl font-semibold tracking-tight text-text-primary">
                                            {vehicle.year} {vehicle.make} {vehicle.model}
                                        </h2>
                                        <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
                                            <div className="inline-flex items-center gap-2">
                                                <FiUsers />
                                                {vehicle.seating_capacity} seats
                                            </div>
                                            <div>⛽ {vehicle.fuel_type}</div>
                                        </div>
                                        <div className="inline-flex items-center gap-2 text-sm text-text-tertiary">
                                            <FiMapPin />
                                            {vehicle.pickup_city}{vehicle.pickup_province ? `, ${vehicle.pickup_province}` : ''}
                                        </div>
                                    </div>

                                    <div className="flex items-end justify-between border-t border-border-light pt-4">
                                        <div>
                                            <div className="font-display text-3xl font-bold text-text-primary">
                                                {vehicle.pricing_type === 'fixed'
                                                    ? formatCurrency(vehicle.fixed_price)
                                                    : formatCurrency(vehicle.daily_rate)}
                                            </div>
                                            <div className="text-xs text-text-tertiary">
                                                {vehicle.pricing_type === 'fixed'
                                                    ? `for ${vehicle.fixed_rental_days} days`
                                                    : 'per day'}
                                            </div>
                                        </div>
                                        <div className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-3 py-1 text-sm font-semibold text-warning-700">
                                            <FiStar className="fill-current" />
                                            {vehicle.profiles?.average_rating?.toFixed(1) || 'New'}
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
