import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
        fetchVehicles();
        fetchBrands();
        if (user) fetchFavorites();
    }, []);

    const fetchVehicles = async () => {
        try {
            const { data, error } = await supabase
                .from('vehicles')
                .select('*, profiles!vehicles_owner_id_fkey(full_name, average_rating, avatar_url)')
                .in('status', ['approved', 'listed'])
                .eq('is_available', true)
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
            const matchPrice = v.daily_rate >= priceRange.min && v.daily_rate <= priceRange.max;
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
            <div style={{
                background: 'linear-gradient(135deg, var(--primary-600), var(--primary-800))',
                borderRadius: 'var(--radius-xl)', padding: '32px 36px', marginBottom: 28,
                color: '#fff', position: 'relative', overflow: 'hidden',
            }}>
                <div style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
                <div style={{ position: 'absolute', bottom: -60, right: 60, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
                <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6, fontFamily: 'var(--font-display)' }}>🔍 Browse Vehicles</h1>
                <p style={{ fontSize: 15, opacity: 0.85, marginBottom: 20 }}>Find verified vehicles from trusted owners across the Philippines</p>

                {/* Search Bar */}
                <div style={{ display: 'flex', gap: 10, maxWidth: 700, position: 'relative' }}>
                    <div className="search-input-wrapper" style={{ flex: 1 }}>
                        <FiSearch className="search-icon" style={{ color: 'var(--text-tertiary)' }} />
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Search by brand, model, year, or color..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ paddingLeft: 40, background: 'rgba(255,255,255,0.95)', border: 'none', fontSize: 15 }}
                        />
                    </div>
                    <button
                        className="btn"
                        onClick={() => setShowFilters(!showFilters)}
                        style={{
                            background: showFilters ? '#fff' : 'rgba(255,255,255,0.15)',
                            color: showFilters ? 'var(--primary-600)' : '#fff',
                            border: '1px solid rgba(255,255,255,0.3)',
                            display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600,
                        }}
                    >
                        <FiFilter /> Filters
                        {activeFilterCount > 0 && (
                            <span style={{
                                background: 'var(--accent-500)', color: '#fff', width: 20, height: 20,
                                borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 11, fontWeight: 700,
                            }}>{activeFilterCount}</span>
                        )}
                    </button>
                </div>
            </div>

            {/* Filter Panel */}
            {showFilters && (
                <div className="card" style={{ marginBottom: 24, animation: 'fadeIn 0.2s ease' }}>
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontSize: 15, fontWeight: 700 }}>🎯 Filters</h3>
                        {activeFilterCount > 0 && (
                            <button className="btn btn-ghost btn-sm" onClick={clearFilters} style={{ color: 'var(--error-500)' }}>
                                <FiX /> Clear All
                            </button>
                        )}
                    </div>
                    <div className="card-body">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                            <div className="form-group">
                                <label className="form-label" style={{ fontSize: 12 }}>Brand</label>
                                <select className="form-select" style={{ width: '100%' }} value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>
                                    <option value="all">All Brands</option>
                                    {brands.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label" style={{ fontSize: 12 }}>Body Type</label>
                                <select className="form-select" style={{ width: '100%' }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                                    <option value="all">All Types</option>
                                    {BODY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label" style={{ fontSize: 12 }}>Location</label>
                                <select className="form-select" style={{ width: '100%' }} value={filterCity} onChange={(e) => setFilterCity(e.target.value)}>
                                    <option value="all">All Cities</option>
                                    {cities.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label" style={{ fontSize: 12 }}>Transmission</label>
                                <select className="form-select" style={{ width: '100%' }} value={filterTransmission} onChange={(e) => setFilterTransmission(e.target.value)}>
                                    <option value="all">All</option>
                                    <option value="Automatic">Automatic</option>
                                    <option value="Manual">Manual</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label" style={{ fontSize: 12 }}>Price Range (daily)</label>
                                <select className="form-select" style={{ width: '100%' }} value={filterPrice} onChange={(e) => setFilterPrice(parseInt(e.target.value))}>
                                    {PRICE_RANGES.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label" style={{ fontSize: 12 }}>Sort By</label>
                                <select className="form-select" style={{ width: '100%' }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                    Showing <strong style={{ color: 'var(--text-primary)' }}>{filteredVehicles.length}</strong> of {vehicles.length} vehicles
                    {activeFilterCount > 0 && <span> · {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>}
                </div>
                {/* Quick type chips */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['all', 'Sedan', 'SUV', 'MPV', 'Pickup'].map(type => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type)}
                            className={`badge ${filterType === type ? 'badge-info' : 'badge-neutral'}`}
                            style={{ cursor: 'pointer', padding: '5px 12px', fontSize: 12, fontWeight: 600, transition: 'all 0.15s ease' }}
                        >
                            {type === 'all' ? 'All' : type}
                        </button>
                    ))}
                </div>
            </div>

            {/* Vehicle Grid */}
            {filteredVehicles.length === 0 ? (
                <div className="empty-state" style={{ padding: 64 }}>
                    <div className="empty-state-icon">🚗</div>
                    <h3>No vehicles found</h3>
                    <p>Try adjusting your search or filters to find more vehicles.</p>
                    {activeFilterCount > 0 && (
                        <button className="btn btn-primary" onClick={clearFilters} style={{ marginTop: 12 }}>
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
                                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, background: 'linear-gradient(135deg, var(--neutral-100), var(--neutral-200))' }}>
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
                                    <FiHeart style={favorites.has(vehicle.id) ? { fill: 'var(--error-500)' } : {}} />
                                </button>
                            </div>

                            <div className="vehicle-card-content">
                                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                                    <span className="badge badge-info" style={{ fontSize: 10 }}>{vehicle.body_type}</span>
                                    <span className="badge badge-neutral" style={{ fontSize: 10 }}>{vehicle.transmission}</span>
                                    {vehicle.color && <span className="badge badge-neutral" style={{ fontSize: 10 }}>{vehicle.color}</span>}
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
                                    <span className="amount">₱{vehicle.daily_rate?.toLocaleString()}</span>
                                    <span className="period">/day</span>
                                </div>
                                <div className="vehicle-card-rating">
                                    <FiStar className="star" style={{ fill: '#facc15', color: '#facc15' }} />
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
