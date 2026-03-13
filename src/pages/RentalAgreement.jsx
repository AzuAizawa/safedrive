import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiChevronLeft, FiCheck, FiPrinter } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function RentalAgreement() {
    const { bookingId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [booking, setBooking] = useState(null);
    const [agreement, setAgreement] = useState(null);
    const [loading, setLoading] = useState(true);
    const [signing, setSigning] = useState(false);

    useEffect(() => {
        fetchAgreement();
    }, [bookingId]);

    const fetchAgreement = async () => {
        try {
            const { data: bookingData, error: bookingError } = await supabase
                .from('bookings')
                .select('*, vehicles(*), profiles!bookings_renter_id_fkey(*)')
                .eq('id', bookingId)
                .single();

            if (bookingError) throw bookingError;
            setBooking(bookingData);

            // Check for existing agreement
            const { data: agreementData } = await supabase
                .from('rental_agreements')
                .select('*')
                .eq('booking_id', bookingId)
                .single();

            if (agreementData) {
                setAgreement(agreementData);
            } else {
                // Auto-create agreement for confirmed bookings
                const terms = `
TERMS AND CONDITIONS OF RENTAL AGREEMENT

1. RENTAL PERIOD: The vehicle shall be rented from ${new Date(bookingData.start_date).toLocaleDateString()} to ${new Date(bookingData.end_date).toLocaleDateString()}.

2. RENTAL RATE: The daily rental rate is ₱${bookingData.daily_rate?.toLocaleString()} for a total of ${bookingData.total_days} day(s).

3. TOTAL AMOUNT: The total rental amount is ₱${bookingData.total_amount?.toLocaleString()}, inclusive of service fees and security deposit.

4. SECURITY DEPOSIT: A security deposit of ₱${bookingData.security_deposit?.toLocaleString() || '0'} is required and will be refunded upon satisfactory return of the vehicle.

5. VEHICLE CONDITION: The Renter agrees to return the vehicle in the same condition as received, normal wear and tear excepted.

6. FUEL POLICY: The vehicle must be returned with the same fuel level as when picked up. Failure to do so will result in additional charges.

7. PROHIBITED USES: The vehicle shall not be used for illegal purposes, racing, towing, or any activity that may damage the vehicle.

8. INSURANCE & LIABILITY: The Renter shall be responsible for any damage, loss, or theft of the vehicle during the rental period not covered by insurance.

9. TRAFFIC VIOLATIONS: The Renter is responsible for all traffic violations and fines incurred during the rental period.

10. EARLY TERMINATION: Either party may terminate this agreement with proper notice. Refunds will be calculated based on unused rental days minus applicable fees.

11. IDENTITY VERIFICATION: Both parties confirm that their identities have been verified through SafeDrive's identity verification system (Government ID + Selfie Verification).

12. DISPUTE RESOLUTION: Any disputes arising from this agreement shall first be mediated through SafeDrive's dispute resolution process.

13. PHYSICAL VERIFICATION: The Renter is required to undergo a physical identity check at the pickup location. The Owner must verify the Renter's face matches their submitted ID.

14. GOVERNING LAW: This agreement is governed by the laws of the Republic of the Philippines.
        `.trim();

                const { data: newAgreement, error: createError } = await supabase.from('rental_agreements').insert({
                    booking_id: bookingId,
                    owner_id: bookingData.owner_id,
                    renter_id: bookingData.renter_id,
                    vehicle_info: {
                        make: bookingData.vehicles.make,
                        model: bookingData.vehicles.model,
                        year: bookingData.vehicles.year,
                        plate_number: bookingData.vehicles.plate_number,
                        color: bookingData.vehicles.color,
                    },
                    terms_and_conditions: terms,
                    rental_period_start: bookingData.start_date,
                    rental_period_end: bookingData.end_date,
                    daily_rate: bookingData.daily_rate,
                    total_amount: bookingData.total_amount,
                    security_deposit: bookingData.security_deposit,
                    status: 'pending_signatures',
                }).select().single();

                if (createError) {
                    console.error('Agreement creation error:', createError);
                    toast.error(`Error creating agreement: ${createError.message}`);
                    return; // Prevent crash when no agreement returned
                }

                setAgreement(newAgreement);
            }
        } catch (err) {
            console.error('Error in fetchAgreement:', err);
            toast.error(`Failed to load agreement: ${err.message || 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    const signAgreement = async () => {
        setSigning(true);
        try {
            const isOwner = user.id === booking.owner_id;
            const update = isOwner
                ? { owner_signed: true, owner_signed_at: new Date().toISOString() }
                : { renter_signed: true, renter_signed_at: new Date().toISOString() };

            // Check if both signed
            if ((isOwner && agreement.renter_signed) || (!isOwner && agreement.owner_signed)) {
                update.status = 'active';
            }

            const { error } = await supabase
                .from('rental_agreements')
                .update(update)
                .eq('id', agreement.id);

            if (error) throw error;
            toast.success('Agreement signed successfully!');
            fetchAgreement();
        } catch (err) {
            toast.error('Failed to sign agreement');
        } finally {
            setSigning(false);
        }
    };

    if (loading) return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-[3px] border-[var(--border-light)] border-t-[var(--primary-600)] rounded-full animate-spin" /></div>;
    if (!booking || !agreement) return null;

    const isOwner = user.id === booking.owner_id;
    const hasSigned = isOwner ? agreement.owner_signed : agreement.renter_signed;

    return (
        <div>
            <div className="flex justify-between mb-6">
                <button className="btn btn-ghost" onClick={() => navigate(-1)}><FiChevronLeft /> Back</button>
                <button className="btn btn-secondary" onClick={() => window.print()}><FiPrinter /> Print</button>
            </div>

            <div className="max-w-[800px] mx-auto bg-[var(--surface-primary)] border border-[var(--border-light)] rounded-[var(--radius-xl)] p-12 shadow-[var(--shadow-lg)]">
                <div className="text-center mb-8">
                    <div className="flex justify-center mb-2">
                        <div className="navbar-logo w-12 h-12 text-[18px]">SD</div>
                    </div>
                    <h1 className="text-[24px] font-extrabold font-[var(--font-display)] tracking-wider">SAFEDRIVE DIGITAL RENTAL AGREEMENT</h1>
                    <p className="text-[var(--text-tertiary)] text-[13px]">
                        Agreement ID: {agreement.id?.slice(0, 8).toUpperCase()} | Generated: {new Date(agreement.created_at).toLocaleDateString()}
                    </p>
                    <span className={`badge ${agreement.status === 'active' ? 'badge-success' : agreement.status === 'pending_signatures' ? 'badge-pending' : 'badge-info'}`}>
                        {agreement.status.replace('_', ' ')}
                    </span>
                </div>

                <h2 className="text-[14px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mt-6 mb-3 pb-2 border-b-2 border-[var(--border-light)]">PARTIES INVOLVED</h2>
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="p-4 bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                        <div className="text-[11px] font-bold uppercase text-[var(--text-tertiary)] mb-2">Vehicle Owner (Lessor)</div>
                        <div className="font-semibold">ID: {booking.owner_id?.slice(0, 8).toUpperCase()}</div>
                    </div>
                    <div className="p-4 bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                        <div className="text-[11px] font-bold uppercase text-[var(--text-tertiary)] mb-2">Renter (Lessee)</div>
                        <div className="font-semibold">{booking.profiles?.full_name}</div>
                        <div className="text-[13px] text-[var(--text-secondary)]">{booking.profiles?.email}</div>
                    </div>
                </div>

                <h2 className="text-[14px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mt-6 mb-3 pb-2 border-b-2 border-[var(--border-light)]">VEHICLE INFORMATION</h2>
                <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                        { label: 'Vehicle', value: `${agreement.vehicle_info.year} ${agreement.vehicle_info.make} ${agreement.vehicle_info.model}` },
                        { label: 'Plate Number', value: agreement.vehicle_info.plate_number },
                        { label: 'Color', value: agreement.vehicle_info.color },
                    ].map((item, i) => (
                        <div key={i} className="p-3 bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                            <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase">{item.label}</div>
                            <div className="font-semibold mt-1">{item.value}</div>
                        </div>
                    ))}
                </div>

                <h2 className="text-[14px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mt-6 mb-3 pb-2 border-b-2 border-[var(--border-light)]">RENTAL DETAILS</h2>
                <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                        { label: 'Start Date', value: new Date(agreement.rental_period_start).toLocaleDateString() },
                        { label: 'End Date', value: new Date(agreement.rental_period_end).toLocaleDateString() },
                        { label: 'Daily Rate', value: `₱${agreement.daily_rate?.toLocaleString()}` },
                        { label: 'Total Amount', value: `₱${agreement.total_amount?.toLocaleString()}` },
                    ].map((item, i) => (
                        <div key={i} className="p-3 bg-[var(--neutral-50)] rounded-[var(--radius-md)]">
                            <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase">{item.label}</div>
                            <div className="font-bold mt-1 font-[var(--font-display)]">{item.value}</div>
                        </div>
                    ))}
                </div>

                <h2 className="text-[14px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mt-6 mb-3 pb-2 border-b-2 border-[var(--border-light)]">TERMS AND CONDITIONS</h2>
                <div className="whitespace-pre-wrap text-[13px] leading-[1.8] text-[var(--text-secondary)]">
                    {agreement.terms_and_conditions}
                </div>

                {/* Signatures */}
                <div className="grid grid-cols-2 gap-6 mt-8">
                    <div className="text-center p-6 border border-dashed border-[var(--border-medium)] rounded-[var(--radius-lg)]">
                        <div className="border-b-2 border-[var(--text-primary)] mb-3 pb-6 min-h-[40px] font-bold text-[var(--success-600)] flex items-end justify-center">
                            {agreement.owner_signed && '✓ Digitally Signed'}
                        </div>
                        <p className="font-semibold">Vehicle Owner</p>
                        <p className="text-[12px] text-[var(--text-tertiary)]">
                            {agreement.owner_signed ? `Signed: ${new Date(agreement.owner_signed_at).toLocaleString()}` : 'Awaiting signature'}
                        </p>
                    </div>
                    <div className="text-center p-6 border border-dashed border-[var(--border-medium)] rounded-[var(--radius-lg)]">
                        <div className="border-b-2 border-[var(--text-primary)] mb-3 pb-6 min-h-[40px] font-bold text-[var(--success-600)] flex items-end justify-center">
                            {agreement.renter_signed && '✓ Digitally Signed'}
                        </div>
                        <p className="font-semibold">Renter</p>
                        <p className="text-[12px] text-[var(--text-tertiary)]">
                            {agreement.renter_signed ? `Signed: ${new Date(agreement.renter_signed_at).toLocaleString()}` : 'Awaiting signature'}
                        </p>
                    </div>
                </div>

                {!hasSigned && (
                    <div className="text-center mt-8">
                        <button
                            className="btn btn-accent btn-lg"
                            onClick={signAgreement}
                            disabled={signing}
                        >
                            <FiCheck /> {signing ? 'Signing...' : 'Sign This Agreement'}
                        </button>
                        <p className="text-[12px] text-[var(--text-tertiary)] mt-2">
                            By signing, you agree to all terms and conditions stated above.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
