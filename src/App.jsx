import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UserModeProvider, useUserMode } from './context/UserModeContext';
import Navbar from './components/Navbar';
import Landing from './pages/Landing';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import AdminLogin from './pages/auth/AdminLogin';
import Vehicles from './pages/Vehicles';
import VehicleDetail from './pages/VehicleDetail';
import Bookings from './pages/Bookings';
import RentalAgreement from './pages/RentalAgreement';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Notifications from './pages/Notifications';
import Messages from './pages/Messages';
import Subscribe from './pages/Subscribe';
import SubscriptionSuccess from './pages/SubscriptionSuccess';
import SubscriptionFailed from './pages/SubscriptionFailed';
import PaymentSuccess from './pages/PaymentSuccess';
import PaymentFailed from './pages/PaymentFailed';
import CreateVehicle from './pages/owner/CreateVehicle';
import MyVehicles from './pages/owner/MyVehicles';
import ManageAvailability from './pages/owner/ManageAvailability';
import AdminPanel from './pages/admin/AdminPanel';
import AuthCallback from './pages/auth/AuthCallback';
import { getDefaultAppPath } from './lib/navigation';
import { ui } from './lib/ui';

function RouteLoader({ label = 'Loading SafeDrive...' }) {
  return (
    <div className={ui.loadingScreen}>
      <div className={ui.spinner} />
      <p className="text-sm font-medium text-text-secondary">{label}</p>
    </div>
  );
}

function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) return <RouteLoader />;
  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}

function AdminRoute() {
  const { user, isAdmin, isSuperAdmin, loading, profile } = useAuth();
  const { mode } = useUserMode();

  if (loading || (user && !profile)) {
    return <RouteLoader label="Loading admin access..." />;
  }

  if (!user) return <Navigate to="/admin-login" replace />;
  if (!isAdmin && !isSuperAdmin) {
    return <Navigate to={getDefaultAppPath({ mode })} replace />;
  }

  return <Outlet />;
}

function RedirectIfAuth() {
  const { user, loading, isAdmin } = useAuth();
  const { mode } = useUserMode();

  if (loading) return <RouteLoader />;
  if (user) return <Navigate to={getDefaultAppPath({ isAdmin, mode })} replace />;

  return <Outlet />;
}

function DashboardRedirect() {
  const { isAdmin } = useAuth();
  const { mode } = useUserMode();

  return <Navigate to={getDefaultAppPath({ isAdmin, mode })} replace />;
}

function AppLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const isAdminLogin = location.pathname.startsWith('/admin-login');
  const isAdminPanel = location.pathname.startsWith('/admin') && !isAdminLogin;
  const isAuthScreen =
    location.pathname.startsWith('/login') ||
    location.pathname.startsWith('/register') ||
    location.pathname.startsWith('/auth/callback');
  const isFullBleed = isLanding || isAuthScreen || isAdminLogin;

  if (isAdminLogin || isAdminPanel) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-surface-secondary text-text-primary">
      <Navbar />
      {user && !isLanding ? (
        <main className="px-4 pb-12 pt-28 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      ) : (
        <main className={isFullBleed ? '' : 'px-4 pb-12 pt-28 sm:px-6 lg:px-8'}>
          <div className={isFullBleed ? '' : 'mx-auto w-full max-w-7xl'}>
            <Outlet />
          </div>
        </main>
      )}
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <UserModeProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: 'var(--surface-primary)',
                color: 'var(--text-primary)',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--border-light)',
                boxShadow: 'var(--shadow-lg)',
                fontSize: 14,
                fontFamily: 'var(--font-body)',
              },
            }}
          />

          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Landing />} />
              <Route path="/vehicles" element={<Vehicles />} />
              <Route path="/vehicles/:id" element={<VehicleDetail />} />

              <Route element={<RedirectIfAuth />}>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
              </Route>

              <Route path="/admin-login" element={<AdminLogin />} />
              <Route path="/auth/callback" element={<AuthCallback />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<DashboardRedirect />} />
                <Route path="/bookings" element={<Bookings />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/messages/:bookingId" element={<Messages />} />
                <Route path="/subscribe" element={<Subscribe />} />
                <Route path="/subscription/success" element={<SubscriptionSuccess />} />
                <Route path="/subscription/failed" element={<SubscriptionFailed />} />
                <Route path="/payment/success" element={<PaymentSuccess />} />
                <Route path="/payment/failed" element={<PaymentFailed />} />
                <Route path="/agreements/:bookingId" element={<RentalAgreement />} />
                <Route path="/vehicles/new" element={<CreateVehicle />} />
                <Route path="/my-vehicles" element={<MyVehicles />} />
                <Route path="/vehicles/:id/availability" element={<ManageAvailability />} />
              </Route>

              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<AdminPanel />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </UserModeProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
