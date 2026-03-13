import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import BackButton from '../../components/BackButton';
import AvailabilityCalendar from '../../components/AvailabilityCalendar';
import { ui } from '../../lib/ui';

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
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('vehicles')
                .select('id, make, model, year, plate_number, owner_id')
                .eq('id', id)
                .single();

            if (error) throw error;

            if (data.owner_id !== user.id) {
                toast.error('You can only manage your own vehicles.');
                navigate('/my-vehicles');
                return;
            }

            setVehicle(data);
        } catch (err) {
            console.error('Error loading vehicle:', err);
            toast.error('Vehicle not found');
            navigate('/my-vehicles');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className={ui.loadingScreen}>
                <div className={ui.spinner} />
                <p className="text-sm font-medium text-text-secondary">Loading vehicle schedule...</p>
            </div>
        );
    }

    if (!vehicle) return null;

    return (
        <div className={ui.pageNarrow}>
            <BackButton to="/my-vehicles" label="Back to my vehicles" />

            <div className={ui.pageHeader}>
                <h1 className={ui.pageTitle}>
                    Schedule for {vehicle.year} {vehicle.make} {vehicle.model}
                </h1>
                <p className={ui.pageDescription}>
                    Block the dates when this vehicle should not accept bookings. Existing bookings appear automatically on the calendar.
                </p>
            </div>

            <section className={ui.section}>
                <div className="flex items-center gap-4 px-5 py-5 sm:px-6">
                    <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-neutral-100 text-3xl">
                        🚗
                    </div>
                    <div>
                        <div className="font-semibold text-text-primary">
                            {vehicle.year} {vehicle.make} {vehicle.model}
                        </div>
                        <div className="text-sm text-text-tertiary">{vehicle.plate_number}</div>
                    </div>
                </div>
            </section>

            <AvailabilityCalendar vehicleId={id} editable={true} />

            <section className={ui.section}>
                <div className={ui.sectionBody}>
                    <h2 className="font-display text-2xl font-semibold text-text-primary">How it works</h2>
                    <ul className="mt-4 space-y-2 text-sm leading-7 text-text-secondary">
                        <li>Available dates stay open for renters to request.</li>
                        <li>Blocked dates are controlled by you and stay unavailable.</li>
                        <li>Booked dates come from active reservations and cannot be edited here.</li>
                        <li>Save your changes after selecting the dates you want to block or reopen.</li>
                    </ul>
                </div>
            </section>
        </div>
    );
}
