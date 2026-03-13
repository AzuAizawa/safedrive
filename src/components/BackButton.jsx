import { useNavigate } from 'react-router-dom';
import { FiChevronLeft } from 'react-icons/fi';
import { ui } from '../lib/ui';

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
            type="button"
            onClick={handleClick}
            className={`${ui.button.ghost} mb-2 pl-3 pr-4`}
        >
            <FiChevronLeft /> {label}
        </button>
    );
}
