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

                const { data: newAgreement } = await supabase.from('rental_agreements').insert({
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

                setAgreement(newAgreement);
            }
        } catch (err) {
            console.error('Error:', err);
            toast.error('Failed to load agreement');
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

    if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
    if (!booking || !agreement) return null;

    const isOwner = user.id === booking.owner_id;
    const hasSigned = isOwner ? agreement.owner_signed : agreement.renter_signed;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
                <button className="btn btn-ghost" onClick={() => navigate(-1)}><FiChevronLeft /> Back</button>
                <button className="btn btn-secondary" onClick={() => window.print()}><FiPrinter /> Print</button>
            </div>

            <div className="agreement-document">
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                        <div className="navbar-logo" style={{ width: 48, height: 48, fontSize: 18 }}>SD</div>
                    </div>
                    <h1>SAFEDRIVE DIGITAL RENTAL AGREEMENT</h1>
                    <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
                        Agreement ID: {agreement.id?.slice(0, 8).toUpperCase()} | Generated: {new Date(agreement.created_at).toLocaleDateString()}
                    </p>
                    <span className={`badge ${agreement.status === 'active' ? 'badge-success' : agreement.status === 'pending_signatures' ? 'badge-pending' : 'badge-info'}`}>
                        {agreement.status.replace('_', ' ')}
                    </span>
                </div>

                <h2>PARTIES INVOLVED</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div style={{ padding: 16, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>Vehicle Owner (Lessor)</div>
                        <div style={{ fontWeight: 600 }}>ID: {booking.owner_id?.slice(0, 8).toUpperCase()}</div>
                    </div>
                    <div style={{ padding: 16, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>Renter (Lessee)</div>
                        <div style={{ fontWeight: 600 }}>{booking.profiles?.full_name}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{booking.profiles?.email}</div>
                    </div>
                </div>

                <h2>VEHICLE INFORMATION</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                    {[
                        { label: 'Vehicle', value: `${agreement.vehicle_info.year} ${agreement.vehicle_info.make} ${agreement.vehicle_info.model}` },
                        { label: 'Plate Number', value: agreement.vehicle_info.plate_number },
                        { label: 'Color', value: agreement.vehicle_info.color },
                    ].map((item, i) => (
                        <div key={i} style={{ padding: 12, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{item.label}</div>
                            <div style={{ fontWeight: 600, marginTop: 4 }}>{item.value}</div>
                        </div>
                    ))}
                </div>

                <h2>RENTAL DETAILS</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
                    {[
                        { label: 'Start Date', value: new Date(agreement.rental_period_start).toLocaleDateString() },
                        { label: 'End Date', value: new Date(agreement.rental_period_end).toLocaleDateString() },
                        { label: 'Daily Rate', value: `₱${agreement.daily_rate?.toLocaleString()}` },
                        { label: 'Total Amount', value: `₱${agreement.total_amount?.toLocaleString()}` },
                    ].map((item, i) => (
                        <div key={i} style={{ padding: 12, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{item.label}</div>
                            <div style={{ fontWeight: 700, marginTop: 4, fontFamily: 'var(--font-display)' }}>{item.value}</div>
                        </div>
                    ))}
                </div>

                <h2>TERMS AND CONDITIONS</h2>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)' }}>
                    {agreement.terms_and_conditions}
                </div>

                {/* Signatures */}
                <div className="agreement-signature">
                    <div className="agreement-signature-box">
                        <div className="signature-line">
                            {agreement.owner_signed && '✓ Digitally Signed'}
                        </div>
                        <p style={{ fontWeight: 600 }}>Vehicle Owner</p>
                        <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                            {agreement.owner_signed ? `Signed: ${new Date(agreement.owner_signed_at).toLocaleString()}` : 'Awaiting signature'}
                        </p>
                    </div>
                    <div className="agreement-signature-box">
                        <div className="signature-line">
                            {agreement.renter_signed && '✓ Digitally Signed'}
                        </div>
                        <p style={{ fontWeight: 600 }}>Renter</p>
                        <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                            {agreement.renter_signed ? `Signed: ${new Date(agreement.renter_signed_at).toLocaleString()}` : 'Awaiting signature'}
                        </p>
                    </div>
                </div>

                {!hasSigned && (
                    <div style={{ textAlign: 'center', marginTop: 32 }}>
                        <button
                            className="btn btn-accent btn-lg"
                            onClick={signAgreement}
                            disabled={signing}
                        >
                            <FiCheck /> {signing ? 'Signing...' : 'Sign This Agreement'}
                        </button>
                        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
                            By signing, you agree to all terms and conditions stated above.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
