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
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'center' }}>
                <div style={{ padding: '40px 32px' }}>
                    {/* Icon */}
                    <div style={{
                        width: 80, height: 80, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #fff7ed, #fef3c7)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 24px', fontSize: 36,
                    }}>
                        <FiShield style={{ color: '#d97706' }} />
                    </div>

                    {/* Title */}
                    <h2 style={{
                        fontSize: 22, fontWeight: 800,
                        fontFamily: 'var(--font-display)',
                        marginBottom: 12,
                        color: 'var(--text-primary)',
                    }}>
                        Verification Required
                    </h2>

                    {/* Description */}
                    <p style={{
                        fontSize: 15, color: 'var(--text-secondary)',
                        lineHeight: 1.6, marginBottom: 8, maxWidth: 360, margin: '0 auto 24px',
                    }}>
                        You need to verify your identity before you can <strong>{action}</strong>.
                        This ensures everyone on SafeDrive is trusted and safe.
                    </p>

                    {/* What's needed */}
                    <div style={{
                        background: 'var(--neutral-50, #f9fafb)',
                        borderRadius: 'var(--radius-md, 8px)',
                        padding: '16px 20px',
                        marginBottom: 28,
                        textAlign: 'left',
                    }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                            What you'll need:
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {[
                                '🪪 2 Valid Government IDs (front & back)',
                                '📸 A clear selfie photo for face verification',
                            ].map((item, i) => (
                                <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {item}
                                </div>
                            ))}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10 }}>
                            ⏱️ Review takes 24-48 hours after submission
                        </div>
                    </div>

                    {/* Buttons */}
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                        <button
                            className="btn btn-secondary"
                            onClick={onClose}
                            style={{ flex: 1, maxWidth: 160 }}
                        >
                            <FiArrowLeft /> Go Back
                        </button>
                        <button
                            className="btn btn-accent"
                            onClick={handleVerify}
                            style={{ flex: 1, maxWidth: 200 }}
                        >
                            Get Verified <FiArrowRight />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
