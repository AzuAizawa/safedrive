import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import BackButton from '../../components/BackButton';
import AvailabilityCalendar from '../../components/AvailabilityCalendar';
import toast from 'react-hot-toast';

export default function ManageAvailability() {
    const { id } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [vehicle, setVehicle] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchVehicle();
    }, [id]);

    const fetchVehicle = async () => {
        try {
            const { data, error } = await supabase
                .from('vehicles')
                .select('id, make, model, year, plate_number, owner_id')
                .eq('id', id)
                .single();

            if (error) throw error;

            // Verify user owns this vehicle
            if (data.owner_id !== user.id) {
                toast.error('You can only manage your own vehicles');
                navigate('/my-vehicles');
                return;
            }

            setVehicle(data);
        } catch (err) {
            console.error('Error:', err);
            toast.error('Vehicle not found');
            navigate('/my-vehicles');
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
    if (!vehicle) return null;

    return (
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
            <BackButton to="/my-vehicles" label="Back to My Vehicles" />

            <div className="page-header">
                <h1>📅 Schedule — {vehicle.year} {vehicle.make} {vehicle.model}</h1>
                <p>Block dates when your vehicle is unavailable. Booked dates appear automatically.</p>
            </div>

            <div style={{ marginBottom: 24 }}>
                <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ fontSize: 32 }}>🚗</div>
                        <div>
                            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{vehicle.plate_number}</p>
                        </div>
                    </div>
                </div>
            </div>

            <AvailabilityCalendar vehicleId={id} editable={true} />

            <div className="card" style={{ marginTop: 24 }}>
                <div className="card-body">
                    <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>💡 How It Works</h3>
                    <ul style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 20, lineHeight: 1.8, margin: 0 }}>
                        <li><strong style={{ color: 'var(--success-600)' }}>Green</strong> dates are available for booking</li>
                        <li><strong style={{ color: 'var(--error-600)' }}>Red</strong> dates are blocked by you (click to toggle)</li>
                        <li><strong style={{ color: 'var(--primary-600)' }}>Blue</strong> dates have active bookings (cannot be changed)</li>
                        <li>Click dates to block/unblock, then hit <strong>Save</strong></li>
                        <li>Rentees will see the blocked dates and cannot book on those days</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
