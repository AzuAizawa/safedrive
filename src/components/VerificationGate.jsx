import { useNavigate } from 'react-router-dom';
import { FiShield, FiArrowLeft, FiArrowRight } from 'react-icons/fi';

export default function VerificationGate({ isOpen, onClose, action = 'rent a car' }) {
    const navigate = useNavigate();

    if (!isOpen) return null;

    const handleVerify = () => {
        onClose();
        navigate('/profile');
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal max-w-[480px] text-center" onClick={(e) => e.stopPropagation()}>
                <div className="px-8 py-10">
                    {/* Icon */}
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#fff7ed] to-[#fef3c7] flex items-center justify-center mx-auto mb-6 text-[36px]">
                        <FiShield className="text-[#d97706]" />
                    </div>

                    {/* Title */}
                    <h2 className="text-[22px] font-extrabold font-[var(--font-display)] mb-3 text-[var(--text-primary)]">
                        Verification Required
                    </h2>

                    {/* Description */}
                    <p className="text-[15px] text-[var(--text-secondary)] leading-[1.6] max-w-[360px] mx-auto mb-6">
                        You need to verify your identity before you can <strong>{action}</strong>.
                        This ensures everyone on SafeDrive is trusted and safe.
                    </p>

                    {/* What's needed */}
                    <div className="bg-[var(--neutral-50,#f9fafb)] rounded-[var(--radius-md,8px)] px-5 py-4 mb-7 text-left">
                        <div className="text-[13px] font-bold text-[var(--text-primary)] mb-2.5">
                            What you'll need:
                        </div>
                        <div className="flex flex-col gap-2">
                            {[
                                '🪪 2 Valid Government IDs (front & back)',
                                '📸 A clear selfie photo for face verification',
                            ].map((item, i) => (
                                <div key={i} className="text-[13px] text-[var(--text-secondary)] flex items-center gap-2">
                                    {item}
                                </div>
                            ))}
                        </div>
                        <div className="text-[12px] text-[var(--text-tertiary)] mt-2.5">
                            ⏱️ Review takes 24-48 hours after submission
                        </div>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 justify-center">
                        <button
                            className="btn btn-secondary flex-1 max-w-[160px]"
                        >
                            <FiArrowLeft /> Go Back
                        </button>
                        <button
                            className="btn btn-accent flex-1 max-w-[200px]"
                        >
                            Get Verified <FiArrowRight />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
