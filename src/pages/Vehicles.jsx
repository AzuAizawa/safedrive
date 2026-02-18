import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiSearch, FiMapPin, FiUsers, FiSettings, FiStar, FiHeart } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function Vehicles() {
    const { user } = useAuth();
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all');
    const [filterCity, setFilterCity] = useState('all');
    const [sortBy, setSortBy] = useState('newest');
    const [favorites, setFavorites] = useState(new Set());

    useEffect(() => {
        fetchVehicles();
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
        } finally {
            setLoading(false);
        }
    };

    const fetchFavorites = async () => {
        const { data } = await supabase.from('favorites').select('vehicle_id').eq('user_id', user.id);
        setFavorites(new Set(data?.map(f => f.vehicle_id) || []));
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

    const filteredVehicles = vehicles
        .filter(v => {
            const matchSearch = `${v.make} ${v.model} ${v.year}`.toLowerCase().includes(searchTerm.toLowerCase());
            const matchType = filterType === 'all' || v.body_type === filterType;
            const matchCity = filterCity === 'all' || v.pickup_city === filterCity;
            return matchSearch && matchType && matchCity;
        })
        .sort((a, b) => {
            if (sortBy === 'price-low') return a.daily_rate - b.daily_rate;
            if (sortBy === 'price-high') return b.daily_rate - a.daily_rate;
            if (sortBy === 'rating') return (b.profiles?.average_rating || 0) - (a.profiles?.average_rating || 0);
            return new Date(b.created_at) - new Date(a.created_at);
        });

    const cities = [...new Set(vehicles.map(v => v.pickup_city).filter(Boolean))];

    if (loading) {
        return <div className="loading-spinner"><div className="spinner" /></div>;
    }

    return (
        <div>
            <div className="page-header">
                <h1>🔍 Browse Vehicles</h1>
                <p>Find verified vehicles from trusted owners across the Philippines</p>
            </div>

            {/* Filter Bar */}
            <div className="filter-bar">
                <div className="search-input-wrapper">
                    <FiSearch className="search-icon" />
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Search by make, model, or year..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select className="form-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                    <option value="all">All Types</option>
                    <option value="Sedan">Sedan</option>
                    <option value="SUV">SUV</option>
                    <option value="MPV">MPV</option>
                    <option value="Van">Van</option>
                </select>
                <select className="form-select" value={filterCity} onChange={(e) => setFilterCity(e.target.value)}>
                    <option value="all">All Cities</option>
                    {cities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="form-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="newest">Newest First</option>
                    <option value="price-low">Price: Low to High</option>
                    <option value="price-high">Price: High to Low</option>
                    <option value="rating">Highest Rated</option>
                </select>
            </div>

            <div style={{ marginBottom: 16, fontSize: 14, color: 'var(--text-secondary)' }}>
                Showing <strong>{filteredVehicles.length}</strong> vehicles
            </div>

            {filteredVehicles.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-icon">🚗</div>
                    <h3>No vehicles found</h3>
                    <p>Try adjusting your search or filters to find more vehicles.</p>
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
                                <div className="vehicle-card-type">{vehicle.body_type}</div>
                                <div className="vehicle-card-title">{vehicle.year} {vehicle.make} {vehicle.model}</div>
                                <div className="vehicle-card-specs">
                                    <div className="vehicle-card-spec"><FiSettings /> {vehicle.transmission}</div>
                                    <div className="vehicle-card-spec"><FiUsers /> {vehicle.seating_capacity} seats</div>
                                    <div className="vehicle-card-spec">⛽ {vehicle.fuel_type}</div>
                                </div>
                                <div className="vehicle-card-location">
                                    <FiMapPin /> {vehicle.pickup_city}, {vehicle.pickup_province}
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
