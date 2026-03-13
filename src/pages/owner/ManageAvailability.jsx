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
        let mounted = true;
        fetchVehicle();
        const safety = setTimeout(() => { if (mounted) setLoading(false); }, 5000);
        return () => { mounted = false; clearTimeout(safety); };
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
        <div className="max-w-[700px] mx-auto">
            <BackButton to="/my-vehicles" label="Back to My Vehicles" />

            <div className="page-header">
                <h1>📅 Schedule — {vehicle.year} {vehicle.make} {vehicle.model}</h1>
                <p>Block dates when your vehicle is unavailable. Booked dates appear automatically.</p>
            </div>

            <div className="mb-6">
                <div className="card mb-4">
                    <div className="card-body flex items-center gap-4">
                        <div className="text-[32px]">🚗</div>
                        <div>
                            <h3 className="text-[16px] font-bold">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                            <p className="text-[13px] text-[var(--text-secondary)]">{vehicle.plate_number}</p>
                        </div>
                    </div>
                </div>
            </div>

            <AvailabilityCalendar vehicleId={id} editable={true} />

            <div className="card mt-6">
                <div className="card-body">
                    <h3 className="text-[14px] font-bold mb-2">💡 How It Works</h3>
                    <ul className="text-[13px] text-[var(--text-secondary)] pl-5 leading-[1.8] m-0 list-disc">
                        <li><strong className="text-[var(--success-600)]">Green</strong> dates are available for booking</li>
                        <li><strong className="text-[var(--error-600)]">Red</strong> dates are blocked by you (click to toggle)</li>
                        <li><strong className="text-[var(--primary-600)]">Blue</strong> dates have active bookings (cannot be changed)</li>
                        <li>Click dates to block/unblock, then hit <strong>Save</strong></li>
                        <li>Rentees will see the blocked dates and cannot book on those days</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
