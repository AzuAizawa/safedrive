import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { FiCheckCircle, FiArrowRight } from 'react-icons/fi';
import { formatPHP } from '../lib/paymongo';

export default function PaymentSuccess() {
    const [searchParams] = useSearchParams();
    const bookingId = searchParams.get('booking_id');
    const [booking, setBooking] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (bookingId) {
            // Mark booking as payment_status = 'paid'
            supabase.from('bookings')
                .update({ payment_status: 'paid', status: 'accepted' })
                .eq('id', bookingId)
                .then(({ error }) => {
                    if (error) console.error('Error updating booking:', error);
                });

            // Fetch booking details for display
            supabase.from('bookings')
                .select('*, vehicles(make, model, year, thumbnail_url)')
                .eq('id', bookingId)
                .single()
                .then(({ data }) => {
                    setBooking(data);
                    setLoading(false);
                });
        } else {
            setLoading(false);
        }
    }, [bookingId]);

    if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

    return (
        <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center', padding: '0 24px' }}>
            <div style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--success-200)',
                borderRadius: 'var(--radius-xl)',
                padding: 48,
            }}>
                <div style={{ fontSize: 72, marginBottom: 16 }}>✅</div>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--success-100)', color: 'var(--success-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 20px' }}>
                    <FiCheckCircle />
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--success-700)', marginBottom: 8 }}>Payment Successful!</h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
                    Your payment has been received. Your booking is now confirmed!
                </p>

                {booking && (
                    <div style={{
                        background: 'var(--surface-secondary)',
                        borderRadius: 'var(--radius-lg)',
                        padding: '20px 24px',
                        marginBottom: 24,
                        textAlign: 'left',
                    }}>
                        <div style={{ fontWeight: 700, marginBottom: 12 }}>Booking Summary</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Vehicle</span>
                            <span style={{ fontWeight: 600 }}>{booking.vehicles?.make} {booking.vehicles?.model} {booking.vehicles?.year}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
                            <span style={{ fontWeight: 600 }}>{booking.total_days} day{booking.total_days !== 1 ? 's' : ''}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid var(--border-light)', paddingTop: 10, marginTop: 8 }}>
                            <span style={{ fontWeight: 700 }}>Total Paid</span>
                            <span style={{ fontWeight: 800, color: 'var(--success-600)', fontSize: 16 }}>{formatPHP(booking.total_amount)}</span>
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Link to="/bookings" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                        <FiArrowRight /> View My Bookings
                    </Link>
                    <Link to="/vehicles" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
                        Browse More Vehicles
                    </Link>
                </div>
            </div>
        </div>
    );
}
