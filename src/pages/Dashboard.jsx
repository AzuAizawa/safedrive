import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUserMode } from '../context/UserModeContext';
import { getDefaultAppPath } from '../lib/navigation';

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const { mode } = useUserMode();

  return <Navigate to={getDefaultAppPath({ isAdmin, mode })} replace />;
}
