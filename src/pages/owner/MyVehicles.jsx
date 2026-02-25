import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { FiPlus, FiEdit, FiEye, FiTrash2, FiCalendar } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../../components/BackButton';

export default function MyVehicles() {
    const { user } = useAuth();
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchMyVehicles();
    }, []);

    const fetchMyVehicles = async () => {
        try {
            const { data, error } = await supabase
                .from('vehicles')
                .select('*')
                .eq('owner_id', user.id)
                .order('created_at', { ascending: false });
            if (error) throw error;
            setVehicles(data || []);
        } catch (err) {
            console.error('Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const toggleAvailability = async (vehicleId, currentStatus) => {
        const { error } = await supabase.from('vehicles').update({ is_available: !currentStatus }).eq('id', vehicleId);
        if (error) { toast.error('Failed to update'); return; }
        toast.success(currentStatus ? 'Vehicle unlisted' : 'Vehicle listed');
        fetchMyVehicles();
    };

    const deleteVehicle = async (vehicleId) => {
        if (!confirm('Are you sure you want to delete this vehicle?')) return;
        const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
        if (error) { toast.error('Failed to delete'); return; }
        toast.success('Vehicle deleted');
        fetchMyVehicles();
    };

    if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

    return (
        <div>
            <BackButton />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
                <div className="page-header" style={{ marginBottom: 0 }}>
                    <h1>🚘 My Vehicles</h1>
                    <p>Manage your vehicle listings on SafeDrive</p>
                </div>
                <Link to="/vehicles/new" className="btn btn-accent"><FiPlus /> Add Vehicle</Link>
            </div>

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
                                <th>Body Type</th>
                                <th>Daily Rate</th>
                                <th>Status</th>
                                <th>Available</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {vehicles.map(v => (
                                <tr key={v.id}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--neutral-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🚗</div>
                                            <div>
                                                <div style={{ fontWeight: 700 }}>{v.year} {v.make} {v.model}</div>
                                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{v.plate_number} • {v.color}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td><span className="badge badge-info">{v.body_type}</span></td>
                                    <td style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>₱{v.daily_rate?.toLocaleString()}</td>
                                    <td>
                                        <span className={`badge ${v.status === 'approved' || v.status === 'listed' ? 'badge-success' : v.status === 'pending' ? 'badge-pending' : 'badge-error'}`}>
                                            {v.status}
                                        </span>
                                    </td>
                                    <td>
                                        <button
                                            className={`btn btn-sm ${v.is_available ? 'btn-success' : 'btn-secondary'}`}
                                            onClick={() => toggleAvailability(v.id, v.is_available)}
                                            disabled={v.status !== 'approved' && v.status !== 'listed'}
                                        >
                                            {v.is_available ? 'Listed' : 'Unlisted'}
                                        </button>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <Link to={`/vehicles/${v.id}`} className="btn btn-ghost btn-sm btn-icon"><FiEye /></Link>
                                            <Link to={`/vehicles/${v.id}/availability`} className="btn btn-ghost btn-sm btn-icon" title="Manage Schedule"><FiCalendar /></Link>
                                            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => deleteVehicle(v.id)} style={{ color: 'var(--error-500)' }}><FiTrash2 /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
