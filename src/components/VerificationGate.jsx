import { useNavigate } from 'react-router-dom';
import { FiShield, FiArrowLeft, FiArrowRight } from 'react-icons/fi';
import { ui } from '../lib/ui';

export default function VerificationGate({ isOpen, onClose, action = 'rent a car' }) {
    const navigate = useNavigate();

    if (!isOpen) return null;

    const handleVerify = () => {
        onClose();
        navigate('/profile');
    };

    return (
        <div className={ui.modalOverlay} onClick={onClose}>
            <div className={`${ui.modalPanel} max-w-[480px] text-center`} onClick={(e) => e.stopPropagation()}>
                <div className="px-6 py-8 sm:px-8 sm:py-10">
                    <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-accent-200 bg-accent-50 text-4xl text-accent-700">
                        <FiShield />
                    </div>

                    <h2 className="mb-3 font-display text-2xl font-extrabold text-text-primary">
                        Verification Required
                    </h2>

                    <p className="mx-auto mb-6 max-w-[360px] text-sm leading-7 text-text-secondary sm:text-[15px]">
                        You need to verify your identity before you can <strong>{action}</strong>.
                        This keeps the marketplace trusted and safe for everyone.
                    </p>

                    <div className="mb-7 rounded-3xl border border-border-light bg-surface-secondary px-5 py-4 text-left">
                        <div className="mb-2.5 text-sm font-bold text-text-primary">
                            What you&apos;ll need:
                        </div>
                        <div className="flex flex-col gap-2">
                            {[
                                '2 valid government IDs (front and back)',
                                'A clear selfie photo for face verification',
                            ].map((item, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm text-text-secondary">
                                    <span className="text-primary-600">•</span>
                                    {item}
                                </div>
                            ))}
                        </div>
                        <div className="mt-2.5 text-xs text-text-tertiary">
                            Review takes 24-48 hours after submission.
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                        <button
                            type="button"
                            onClick={onClose}
                            className={`${ui.button.secondary} flex-1 sm:max-w-[160px]`}
                        >
                            <FiArrowLeft /> Go Back
                        </button>
                        <button
                            type="button"
                            onClick={handleVerify}
                            className={`${ui.button.accent} flex-1 sm:max-w-[200px]`}
                        >
                            Get Verified <FiArrowRight />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
