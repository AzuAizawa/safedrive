import { Link } from 'react-router-dom';
import { FiAlertCircle } from 'react-icons/fi';

export default function SubscriptionFailed() {
    return (
        <div style={{ maxWidth: 440, margin: '60px auto', textAlign: 'center', padding: '0 24px' }}>
            <div style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--error-200)',
                borderRadius: 'var(--radius-xl)',
                padding: 48,
            }}>
                <div style={{ fontSize: 64, marginBottom: 16 }}>❌</div>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--error-600)', marginBottom: 8 }}>
                    Payment Unsuccessful
                </h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.7 }}>
                    Your GCash payment for the SafeDrive Premium subscription could not be completed. Your account has not been charged.
                </p>
                <div style={{
                    background: 'var(--error-50)', borderRadius: 'var(--radius-lg)', padding: '14px 18px',
                    marginBottom: 24, textAlign: 'left', border: '1px solid var(--error-100)',
                }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
                        <FiAlertCircle style={{ color: 'var(--error-500)', flexShrink: 0, marginTop: 2 }} />
                        <div>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>Common reasons:</div>
                            <ul style={{ color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: 16 }}>
                                <li>Insufficient GCash balance</li>
                                <li>Payment timed out</li>
                                <li>GCash app not authorized</li>
                                <li>Network connection issue</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Link to="/subscribe" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                        Try Again
                    </Link>
                    <Link to="/dashboard" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
