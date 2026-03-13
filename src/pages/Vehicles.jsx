import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiSearch, FiMapPin, FiUsers, FiSettings, FiStar, FiHeart, FiFilter, FiX, FiGrid, FiList } from 'react-icons/fi';
import toast from 'react-hot-toast';

const PRICE_RANGES = [
    { label: 'All Prices', min: 0, max: Infinity },
    { label: '₱0 – ₱1,500', min: 0, max: 1500 },
    { label: '₱1,500 – ₱3,000', min: 1500, max: 3000 },
    { label: '₱3,000 – ₱5,000', min: 3000, max: 5000 },
    { label: '₱5,000+', min: 5000, max: Infinity },
];

const BODY_TYPES = ['Sedan', 'SUV', 'MPV', 'Van', 'Hatchback', 'Pickup', 'Crossover', 'Coupe'];

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
    const [filterPrice, setFilterPrice] = useState(0); // index into PRICE_RANGES
    const [sortBy, setSortBy] = useState('newest');
    const [favorites, setFavorites] = useState(new Set());
    const [showFilters, setShowFilters] = useState(false);
    const [brands, setBrands] = useState([]);

    useEffect(() => {
        let mounted = true;
        fetchVehicles();
        fetchBrands();
        if (user) fetchFavorites();

        const safety = setTimeout(() => { if (mounted) setLoading(false); }, 5000);
        return () => { mounted = false; clearTimeout(safety); };
    }, [location.key]);

    const fetchVehicles = async () => {
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
            setVehicles([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchBrands = async () => {
        try {
            const { data } = await supabase.from('car_brands').select('name').eq('is_active', true).order('name');
            setBrands(data?.map(b => b.name) || []);
        } catch { setBrands([]); }
    };

    const fetchFavorites = async () => {
        try {
            const { data } = await supabase.from('favorites').select('vehicle_id').eq('user_id', user.id);
            setFavorites(new Set(data?.map(f => f.vehicle_id) || []));
        } catch { setFavorites(new Set()); }
    };

    const toggleFavorite = async (e, vehicleId) => {
        e.preventDefault();
        e.stopPropagation();
        if (!user) {
            toast.error('Please sign in to save favorites');
            return;
        }

        if (favorites.has(vehicleId)) {
            await supabase.from('favorites').delete().eq('user_id', user.id).eq('vehicle_id', vehicleId);
            setFavorites(prev => { const next = new Set(prev); next.delete(vehicleId); return next; });
            toast.success('Removed from favorites');
        } else {
            await supabase.from('favorites').insert({ user_id: user.id, vehicle_id: vehicleId });
            setFavorites(prev => new Set([...prev, vehicleId]));
            toast.success('Added to favorites');
        }
    };

    const priceRange = PRICE_RANGES[filterPrice];

    const filteredVehicles = vehicles
        .filter(v => {
            const matchSearch = `${v.make} ${v.model} ${v.year} ${v.color}`.toLowerCase().includes(searchTerm.toLowerCase());
            const matchType = filterType === 'all' || v.body_type === filterType;
            const matchBrand = filterBrand === 'all' || v.make === filterBrand;
            const matchCity = filterCity === 'all' || v.pickup_city === filterCity;
            const matchTransmission = filterTransmission === 'all' || v.transmission === filterTransmission;
            // For fixed pricing, the daily_rate in DB is actually computed as (fixed_price / fixed_rental_days)
            // so we can just use daily_rate safely for filtering
            const matchPrice = (v.daily_rate || 0) >= priceRange.min && (v.daily_rate || 0) <= priceRange.max;
            return matchSearch && matchType && matchBrand && matchCity && matchTransmission && matchPrice;
        })
        .sort((a, b) => {
            if (sortBy === 'price-low') return a.daily_rate - b.daily_rate;
            if (sortBy === 'price-high') return b.daily_rate - a.daily_rate;
            if (sortBy === 'rating') return (b.profiles?.average_rating || 0) - (a.profiles?.average_rating || 0);
            return new Date(b.created_at) - new Date(a.created_at);
        });

    const cities = [...new Set(vehicles.map(v => v.pickup_city).filter(Boolean))].sort();
    const activeFilterCount = [filterType !== 'all', filterBrand !== 'all', filterCity !== 'all', filterTransmission !== 'all', filterPrice !== 0].filter(Boolean).length;

    const clearFilters = () => {
        setFilterType('all');
        setFilterBrand('all');
        setFilterCity('all');
        setFilterTransmission('all');
        setFilterPrice(0);
        setSearchTerm('');
    };

    if (loading) {
        return <div className="loading-spinner"><div className="spinner" /></div>;
    }

    return (
        <div>
            {/* Hero Header */}
            <div className="bg-gradient-to-br from-[var(--primary-600)] to-[var(--primary-800)] rounded-[var(--radius-xl)] px-9 py-8 mb-7 text-white relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-[180px] h-[180px] rounded-full bg-white/5" />
                <div className="absolute -bottom-[60px] right-[60px] w-30 h-30 rounded-full bg-white/5" />
                <h1 className="text-[28px] font-extrabold mb-1.5 font-[var(--font-display)]">🔍 Browse Vehicles</h1>
                <p className="text-[15px] opacity-85 mb-5">Find verified vehicles from trusted owners across the Philippines</p>

                {/* Search Bar */}
                <div className="flex gap-2.5 max-w-[700px] relative">
                    <div className="search-input-wrapper flex-1">
                        <FiSearch className="search-icon text-[var(--text-tertiary)]" />
                        <input
                            type="text"
                            className="form-input pl-10 bg-white/95 border-none text-[15px]"
                        />
                    </div>
                    <button
                        className={`btn flex items-center gap-1.5 font-semibold border border-white/30 ${showFilters ? 'bg-white text-[var(--primary-600)]' : 'bg-white/15 text-white'}`}
                    >
                        <FiFilter /> Filters
                        {activeFilterCount > 0 && (
                            <span className="bg-[var(--accent-500)] text-white w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold">{activeFilterCount}</span>
                        )}
                    </button>
                </div>
            </div>

            {/* Filter Panel */}
            {showFilters && (
                <div className="card mb-6 animate-[fadeIn_0.2s_ease]">
                    <div className="card-header flex justify-between items-center">
                        <h3 className="text-[15px] font-bold">🎯 Filters</h3>
                        {activeFilterCount > 0 && (
                            <button className="btn btn-ghost btn-sm text-[var(--error-500)]" onClick={clearFilters}>
                                <FiX /> Clear All
                            </button>
                        )}
                    </div>
                    <div className="card-body">
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
                            <div className="form-group">
                                <label className="form-label text-[12px]">Brand</label>
                                <select className="form-select w-full" value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>
                                    <option value="all">All Brands</option>
                                    {brands.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label text-[12px]">Body Type</label>
                                <select className="form-select w-full" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                                    <option value="all">All Types</option>
                                    {BODY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label text-[12px]">Location</label>
                                <select className="form-select w-full" value={filterCity} onChange={(e) => setFilterCity(e.target.value)}>
                                    <option value="all">All Cities</option>
                                    {cities.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label text-[12px]">Transmission</label>
                                <select className="form-select w-full" value={filterTransmission} onChange={(e) => setFilterTransmission(e.target.value)}>
                                    <option value="all">All</option>
                                    <option value="Automatic">Automatic</option>
                                    <option value="Manual">Manual</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label text-[12px]">Price Range (daily)</label>
                                <select className="form-select w-full" value={filterPrice} onChange={(e) => setFilterPrice(parseInt(e.target.value))}>
                                    {PRICE_RANGES.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label text-[12px]">Sort By</label>
                                <select className="form-select w-full" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                                    <option value="newest">Newest First</option>
                                    <option value="price-low">Price: Low → High</option>
                                    <option value="price-high">Price: High → Low</option>
                                    <option value="rating">Highest Rated</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Results Summary + Quick Filter Chips */}
            <div className="flex justify-between items-center mb-5 flex-wrap gap-3">
                <div className="text-sm text-[var(--text-secondary)]">
                    Showing <strong className="text-[var(--text-primary)]">{filteredVehicles.length}</strong> of {vehicles.length} vehicles
                    {activeFilterCount > 0 && <span> · {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>}
                </div>
                {/* Quick type chips */}
                <div className="flex gap-1.5 flex-wrap">
                    {['all', 'Sedan', 'SUV', 'MPV', 'Pickup'].map(type => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type)}
                            className={`badge ${filterType === type ? 'badge-info' : 'badge-neutral'} cursor-pointer px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ease-in-out`}
                        >
                            {type === 'all' ? 'All' : type}
                        </button>
                    ))}
                </div>
            </div>

            {/* Vehicle Grid */}
            {filteredVehicles.length === 0 ? (
                <div className="empty-state p-16">
                    <div className="empty-state-icon">🚗</div>
                    <h3>No vehicles found</h3>
                    <p>Try adjusting your search or filters to find more vehicles.</p>
                    {activeFilterCount > 0 && (
                        <button className="btn btn-primary mt-3" onClick={clearFilters}>
                            Clear All Filters
                        </button>
                    )}
                </div>
            ) : (
                <div className="vehicles-grid">
                    {filteredVehicles.map((vehicle) => (
                        <Link to={`/vehicles/${vehicle.id}`} key={vehicle.id} className="vehicle-card">
                            <div className="vehicle-card-image">
                                {vehicle.thumbnail_url || vehicle.images?.[0] ? (
                                    <img src={vehicle.thumbnail_url || vehicle.images[0]} alt={`${vehicle.make} ${vehicle.model}`} />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[48px] bg-gradient-to-br from-[var(--neutral-100)] to-[var(--neutral-200)]">
                                        🚗
                                    </div>
                                )}
                                <span className={`vehicle-card-badge ${vehicle.is_available ? 'available' : 'rented'}`}>
                                    {vehicle.is_available ? 'Available' : 'Rented'}
                                </span>
                                <button
                                    className={`vehicle-card-favorite ${favorites.has(vehicle.id) ? 'active' : ''}`}
                                    onClick={(e) => toggleFavorite(e, vehicle.id)}
                                >
                                    <FiHeart className={`${favorites.has(vehicle.id) ? 'fill-[var(--error-500)]' : ''}`} />
                                </button>
                            </div>

                            <div className="vehicle-card-content">
                                <div className="flex gap-1.5 mb-1.5">
                                    <span className="badge badge-info text-[10px]">{vehicle.body_type}</span>
                                    <span className="badge badge-neutral text-[10px]">{vehicle.transmission}</span>
                                    {vehicle.color && <span className="badge badge-neutral text-[10px]">{vehicle.color}</span>}
                                </div>
                                <div className="vehicle-card-title">{vehicle.year} {vehicle.make} {vehicle.model}</div>
                                <div className="vehicle-card-specs">
                                    <div className="vehicle-card-spec"><FiUsers /> {vehicle.seating_capacity} seats</div>
                                    <div className="vehicle-card-spec">⛽ {vehicle.fuel_type}</div>
                                </div>
                                <div className="vehicle-card-location">
                                    <FiMapPin /> {vehicle.pickup_city}{vehicle.pickup_province ? `, ${vehicle.pickup_province}` : ''}
                                </div>
                            </div>

                            <div className="vehicle-card-footer">
                                <div className="vehicle-card-price">
                                    {vehicle.pricing_type === 'fixed' ? (
                                        <>
                                            <span className="amount text-base">₱{vehicle.fixed_price?.toLocaleString()}</span>
                                            <span className="period text-[12px]"> for {vehicle.fixed_rental_days}d</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="amount">₱{vehicle.daily_rate?.toLocaleString()}</span>
                                            <span className="period">/day</span>
                                        </>
                                    )}
                                </div>
                                <div className="vehicle-card-rating">
                                    <FiStar className="star fill-[#facc15] text-[#facc15]" />
                                    {vehicle.profiles?.average_rating?.toFixed(1) || 'New'}
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
