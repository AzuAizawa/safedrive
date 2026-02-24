import { useNavigate } from 'react-router-dom';
import { FiChevronLeft } from 'react-icons/fi';

export default function BackButton({ label = 'Back', to }) {
    const navigate = useNavigate();

    const handleClick = () => {
        if (to) {
            navigate(to);
        } else {
            navigate(-1);
        }
    };

    return (
        <button
            className="btn btn-ghost"
            onClick={handleClick}
            style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
            <FiChevronLeft /> {label}
        </button>
    );
}
