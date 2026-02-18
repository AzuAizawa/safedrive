import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Landing from './pages/Landing';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Dashboard from './pages/Dashboard';
import Vehicles from './pages/Vehicles';
import VehicleDetail from './pages/VehicleDetail';
import Bookings from './pages/Bookings';
import RentalAgreement from './pages/RentalAgreement';
import Profile from './pages/Profile';
import CreateVehicle from './pages/owner/CreateVehicle';
import MyVehicles from './pages/owner/MyVehicles';
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
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function OwnerRoute() {
  const { user, isOwner, isAdmin, loading } = useAuth();
  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isOwner && !isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function AppLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const isLanding = location.pathname === '/';

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
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/vehicles" element={<Vehicles />} />
            <Route path="/vehicles/:id" element={<VehicleDetail />} />

            {/* Protected Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/bookings" element={<Bookings />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/agreements/:bookingId" element={<RentalAgreement />} />
            </Route>

            {/* Owner Routes */}
            <Route element={<OwnerRoute />}>
              <Route path="/vehicles/new" element={<CreateVehicle />} />
              <Route path="/my-vehicles" element={<MyVehicles />} />
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
