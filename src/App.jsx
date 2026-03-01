import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Landing from './pages/Landing';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import AdminLogin from './pages/auth/AdminLogin';
import Dashboard from './pages/Dashboard';
import Vehicles from './pages/Vehicles';
import VehicleDetail from './pages/VehicleDetail';
import Bookings from './pages/Bookings';
import RentalAgreement from './pages/RentalAgreement';
import Profile from './pages/Profile';
import CreateVehicle from './pages/owner/CreateVehicle';
import MyVehicles from './pages/owner/MyVehicles';
import ManageAvailability from './pages/owner/ManageAvailability';
import AdminPanel from './pages/admin/AdminPanel';
import AuthCallback from './pages/auth/AuthCallback';

function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AdminRoute() {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/admin-login" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function RenterRoute() {
  const { user, isRenter, loading } = useAuth();
  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isRenter) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function RedirectIfAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function AppLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const isAdminLogin = location.pathname.startsWith('/admin-login');

  if (isAdminLogin) {
    return <Outlet />;
  }

  return (
    <>
      <Navbar />
      {user && !isLanding ? (
        <main className="main-content">
          <div className="container">
            <Outlet />
          </div>
        </main>
      ) : (
        <Outlet />
      )}
    </>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'var(--surface-primary)',
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-light)',
              boxShadow: 'var(--shadow-lg)',
              fontSize: 14,
              fontFamily: 'var(--font-body)',
            },
          }}
        />

        <Routes>
          <Route element={<AppLayout />}>
            {/* Public Routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/vehicles" element={<Vehicles />} />
            <Route path="/vehicles/:id" element={<VehicleDetail />} />

            {/* Auth Routes — redirect to dashboard if already logged in */}
            <Route element={<RedirectIfAuth />}>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
            </Route>
            {/* Admin login portal — completely separate */}
            <Route path="/admin-login" element={<AdminLogin />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Protected Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/bookings" element={<Bookings />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/agreements/:bookingId" element={<RentalAgreement />} />
            </Route>

            {/* Renter (vehicle owner) Routes */}
            <Route element={<RenterRoute />}>
              <Route path="/vehicles/new" element={<CreateVehicle />} />
              <Route path="/my-vehicles" element={<MyVehicles />} />
              <Route path="/vehicles/:id/availability" element={<ManageAvailability />} />
            </Route>

            {/* Admin Routes */}
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminPanel />} />
            </Route>
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
