import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiArrowRight, FiCheckCircle } from 'react-icons/fi';
import { supabase } from '../lib/supabase';
import { checkInvoiceStatus, formatPHP } from '../lib/xendit';
import { ui } from '../lib/ui';

export default function PaymentSuccess() {
    const [searchParams] = useSearchParams();
    const bookingId = searchParams.get('booking_id');
    const [booking, setBooking] = useState(null);
    const [loading, setLoading] = useState(Boolean(bookingId));
    const [verifying, setVerifying] = useState(false);

    useEffect(() => {
        if (!bookingId) {
            return;
        }

        let isActive = true;

        const loadAndVerify = async () => {
            try {
                // 1. Fetch the booking
                const { data, error: fetchError } = await supabase
                    .from('bookings')
                    .select('*, vehicles(make, model, year, thumbnail_url)')
                    .eq('id', bookingId)
                    .single();

                if (fetchError) {
                    console.error('Error loading booking:', fetchError);
                }

                if (!isActive) return;
                setBooking(data || null);

                // 2. Verify payment with Xendit if invoice exists
                if (data?.xendit_invoice_id) {
                    setVerifying(true);
                    try {
                        const invoiceStatus = await checkInvoiceStatus(data.xendit_invoice_id);
                        if (invoiceStatus.status === 'PAID' || invoiceStatus.status === 'SETTLED') {
                            // Confirmed paid — update DB
                            await supabase
                                .from('bookings')
                                .update({ payment_status: 'paid' })
                                .eq('id', bookingId);

                            // Notify the owner
                            if (data.owner_id) {
                                await supabase.from('notifications').insert({
                                    user_id: data.owner_id,
                                    title: 'Payment Received! 💰',
                                    message: `Payment of ${formatPHP(data.total_amount)} confirmed for ${data.vehicles?.year} ${data.vehicles?.make} ${data.vehicles?.model}.`,
                                    type: 'payment',
                                    reference_id: bookingId,
                                    reference_type: 'booking',
                                });
                            }

                            if (isActive) {
                                setBooking((prev) => ({ ...prev, payment_status: 'paid' }));
                            }
                        }
                    } catch (err) {
                        console.error('Verification error:', err);
                    } finally {
                        if (isActive) setVerifying(false);
                    }
                }
            } finally {
                if (isActive) {
                    setLoading(false);
                }
            }
        };

        loadAndVerify();

        return () => {
            isActive = false;
        };
    }, [bookingId]);

    if (loading) {
        return (
            <div className={ui.loadingScreen}>
                <div className={ui.spinner} />
                <p className="text-sm font-medium text-text-secondary">Verifying your payment...</p>
            </div>
        );
    }

    return (
        <div className="mx-auto mt-28 max-w-2xl">
            <div className="rounded-[36px] border border-success-200 bg-surface-primary p-8 text-center shadow-soft sm:p-10">
                <div className="mx-auto flex h-18 w-18 items-center justify-center rounded-full bg-success-50 text-4xl text-success-700">
                    <FiCheckCircle />
                </div>
                <h1 className="mt-5 font-display text-4xl font-bold text-success-700">Payment successful</h1>
                <p className="mt-3 text-sm leading-7 text-text-secondary">
                    Your payment was received via Xendit and your booking is now confirmed. The funds are held
                    securely and will be distributed after your rental period ends.
                </p>

                {verifying && (
                    <div className="mt-4 flex items-center justify-center gap-2 text-sm text-text-tertiary">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-border-light border-t-primary-600" />
                        Confirming with payment provider...
                    </div>
                )}

                {booking && (
                    <div className="mt-6 rounded-3xl border border-border-light bg-surface-secondary p-5 text-left">
                        <div className="font-semibold text-text-primary">Booking summary</div>
                        <div className="mt-4 space-y-2 text-sm text-text-secondary">
                            <div className="flex justify-between gap-4">
                                <span>Vehicle</span>
                                <span className="font-semibold text-text-primary">{booking.vehicles?.make} {booking.vehicles?.model} {booking.vehicles?.year}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span>Duration</span>
                                <span className="font-semibold text-text-primary">{booking.total_days} day{booking.total_days !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span>Payment Status</span>
                                <span className="font-semibold capitalize text-success-700">{booking.payment_status || 'Verifying...'}</span>
                            </div>
                            <div className="flex justify-between gap-4 border-t border-border-light pt-3">
                                <span className="font-semibold text-text-primary">Total paid</span>
                                <span className="font-display text-2xl font-bold text-success-700">{formatPHP(booking.total_amount)}</span>
                            </div>
                        </div>
                    </div>
                )}

                <div className="mt-6 flex flex-col gap-3">
                    <Link to="/bookings" className={`${ui.button.primary} w-full justify-center`}>
                        <FiArrowRight /> View my bookings
                    </Link>
                    <Link to="/vehicles" className={`${ui.button.secondary} w-full justify-center`}>
                        Browse more vehicles
                    </Link>
                </div>
            </div>
        </div>
    );
}
