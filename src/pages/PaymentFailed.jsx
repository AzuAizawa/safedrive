import { useSearchParams, Link } from 'react-router-dom';
import { FiAlertCircle } from 'react-icons/fi';

export default function PaymentFailed() {
    const [searchParams] = useSearchParams();
    const bookingId = searchParams.get('booking_id');

    return (
        <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center', padding: '0 24px' }}>
            <div style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--error-200)',
                borderRadius: 'var(--radius-xl)',
                padding: 48,
            }}>
                <div style={{ fontSize: 72, marginBottom: 16 }}>❌</div>
                <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--error-600)', marginBottom: 8 }}>Payment Failed</h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
                    Your payment could not be processed. Your booking has not been cancelled — you can try again.
                </p>
                <div style={{
                    background: 'var(--error-50)', borderRadius: 'var(--radius-lg)',
                    padding: '14px 20px', marginBottom: 24, textAlign: 'left',
                    border: '1px solid var(--error-100)',
                }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
                        <FiAlertCircle style={{ color: 'var(--error-500)', flexShrink: 0, marginTop: 2 }} />
                        <div>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>Common reasons for failure:</div>
                            <ul style={{ color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: 16 }}>
                                <li>Insufficient GCash/bank balance</li>
                                <li>Card declined by issuing bank</li>
                                <li>Payment timed out</li>
                                <li>Network connectivity issue</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {bookingId && (
                        <Link to={`/bookings`} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                            Try Again — View Booking
                        </Link>
                    )}
                    <Link to="/vehicles" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
                        Browse Vehicles
                    </Link>
                </div>
            </div>
        </div>
    );
}
