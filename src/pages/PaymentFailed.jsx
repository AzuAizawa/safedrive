import { useSearchParams, Link } from 'react-router-dom';
import { FiAlertCircle } from 'react-icons/fi';

export default function PaymentFailed() {
    const [searchParams] = useSearchParams();
    const bookingId = searchParams.get('booking_id');

    return (
        <div className="max-w-[480px] mx-auto my-[60px] text-center px-6">
            <div className="bg-[var(--surface-primary)] border border-[var(--error-200)] rounded-[var(--radius-xl)] p-12">
                <div className="text-[72px] mb-4">❌</div>
                <h1 className="text-[28px] font-extrabold text-[var(--error-600)] mb-2">Payment Failed</h1>
                <p className="text-[var(--text-secondary)] mb-6 leading-[1.6]">
                    Your payment could not be processed. Your booking has not been cancelled — you can try again.
                </p>
                <div className="bg-[var(--error-50)] rounded-[var(--radius-lg)] px-5 py-3.5 mb-6 text-left border border-[var(--error-100)]">
                    <div className="flex gap-2.5 items-start text-sm">
                        <FiAlertCircle className="text-[var(--error-500)] shrink-0 mt-0.5" />
                        <div>
                            <div className="font-bold mb-1">Common reasons for failure:</div>
                            <ul className="text-[var(--text-secondary)] leading-[1.8] pl-4 list-disc">
                                <li>Insufficient GCash/bank balance</li>
                                <li>Card declined by issuing bank</li>
                                <li>Payment timed out</li>
                                <li>Network connectivity issue</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-2.5">
                    {bookingId && (
                        <Link to={`/bookings`} className="btn btn-primary w-full justify-center">
                            Try Again — View Booking
                        </Link>
                    )}
                    <Link to="/vehicles" className="btn btn-secondary w-full justify-center">
                        Browse Vehicles
                    </Link>
                </div>
            </div>
        </div>
    );
}
