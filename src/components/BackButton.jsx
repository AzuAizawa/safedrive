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
            className="btn btn-ghost mb-4 inline-flex items-center gap-1"
        >
            <FiChevronLeft /> {label}
        </button>
    );
}
