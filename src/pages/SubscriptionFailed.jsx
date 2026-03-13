import { Link } from 'react-router-dom';
import { FiAlertCircle } from 'react-icons/fi';

export default function SubscriptionFailed() {
    return (
        <div className="max-w-[440px] mx-auto my-[60px] text-center px-6">
            <div className="bg-[var(--surface-primary)] border border-[var(--error-200)] rounded-[var(--radius-xl)] p-12">
                <div className="text-[64px] mb-4">❌</div>
                <h1 className="text-2xl font-extrabold text-[var(--error-600)] mb-2">
                    Payment Unsuccessful
                </h1>
                <p className="text-[var(--text-secondary)] mb-6 leading-[1.7]">
                    Your GCash payment for the SafeDrive Premium subscription could not be completed. Your account has not been charged.
                </p>
                <div className="bg-[var(--error-50)] rounded-[var(--radius-lg)] px-[18px] py-[14px] mb-6 text-left border border-[var(--error-100)]">
                    <div className="flex gap-2.5 items-start text-sm">
                        <FiAlertCircle className="text-[var(--error-500)] shrink-0 mt-0.5" />
                        <div>
                            <div className="font-bold mb-1">Common reasons:</div>
                            <ul className="text-[var(--text-secondary)] leading-[1.8] pl-4 list-disc">
                                <li>Insufficient GCash balance</li>
                                <li>Payment timed out</li>
                                <li>GCash app not authorized</li>
                                <li>Network connection issue</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-2.5">
                    <Link to="/subscribe" className="btn btn-primary w-full justify-center">
                        Try Again
                    </Link>
                    <Link to="/dashboard" className="btn btn-ghost w-full justify-center">
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
