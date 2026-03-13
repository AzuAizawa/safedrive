import { Link, useSearchParams } from 'react-router-dom';
import { FiAlertCircle } from 'react-icons/fi';
import { ui } from '../lib/ui';

export default function PaymentFailed() {
    const [searchParams] = useSearchParams();
    const bookingId = searchParams.get('booking_id');

    return (
        <div className="mx-auto mt-28 max-w-2xl">
            <div className="rounded-[36px] border border-error-200 bg-surface-primary p-8 text-center shadow-soft sm:p-10">
                <div className="text-6xl">✕</div>
                <h1 className="mt-4 font-display text-4xl font-bold text-error-700">Payment failed</h1>
                <p className="mt-3 text-sm leading-7 text-text-secondary">
                    Your payment could not be processed. The booking was not cancelled, so you can try again.
                </p>

                <div className="mt-6 rounded-3xl border border-error-200 bg-error-50 p-5 text-left">
                    <div className="flex gap-3 text-sm text-error-700">
                        <FiAlertCircle className="mt-0.5 shrink-0" />
                        <div>
                            <div className="font-semibold">Common reasons for failure</div>
                            <ul className="mt-2 space-y-1 leading-6 text-text-secondary">
                                <li>Insufficient balance</li>
                                <li>Card or provider declined the payment</li>
                                <li>Payment timed out</li>
                                <li>Network issues interrupted the flow</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                    {bookingId && (
                        <Link to="/bookings" className={`${ui.button.primary} w-full justify-center`}>
                            Retry from my bookings
                        </Link>
                    )}
                    <Link to="/vehicles" className={`${ui.button.secondary} w-full justify-center`}>
                        Browse vehicles
                    </Link>
                </div>
            </div>
        </div>
    );
}
