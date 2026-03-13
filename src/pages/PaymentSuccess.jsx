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
        <div className="max-w-[520px] mx-auto my-[60px] text-center px-6">
            <div className="bg-[var(--surface-primary)] border border-[var(--success-200)] rounded-[var(--radius-xl)] p-12">
                <div className="text-[72px] mb-4">✅</div>
                <div className="w-16 h-16 rounded-full bg-[var(--success-100)] text-[var(--success-600)] flex items-center justify-center text-[32px] mx-auto mb-5">
                    <FiCheckCircle />
                </div>
                <h1 className="text-[28px] font-extrabold text-[var(--success-700)] mb-2">Payment Successful!</h1>
                <p className="text-[var(--text-secondary)] mb-6 leading-[1.6]">
                    Your payment has been received. Your booking is now confirmed!
                </p>

                {booking && (
                    <div className="bg-[var(--surface-secondary)] rounded-[var(--radius-lg)] px-6 py-5 mb-6 text-left">
                        <div className="font-bold mb-3">Booking Summary</div>
                        <div className="flex justify-between text-sm mb-1.5">
                            <span className="text-[var(--text-secondary)]">Vehicle</span>
                            <span className="font-semibold">{booking.vehicles?.make} {booking.vehicles?.model} {booking.vehicles?.year}</span>
                        </div>
                        <div className="flex justify-between text-sm mb-1.5">
                            <span className="text-[var(--text-secondary)]">Duration</span>
                            <span className="font-semibold">{booking.total_days} day{booking.total_days !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex justify-between text-sm border-t border-[var(--border-light)] pt-2.5 mt-2">
                            <span className="font-bold">Total Paid</span>
                            <span className="font-extrabold text-[var(--success-600)] text-base">{formatPHP(booking.total_amount)}</span>
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-2.5">
                    <Link to="/bookings" className="btn btn-primary w-full justify-center">
                        <FiArrowRight /> View My Bookings
                    </Link>
                    <Link to="/vehicles" className="btn btn-secondary w-full justify-center">
                        Browse More Vehicles
                    </Link>
                </div>
            </div>
        </div>
    );
}
