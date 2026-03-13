import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { FiHome, FiSearch, FiHeart, FiCalendar, FiBell, FiUser, FiLogOut, FiSettings, FiShield, FiTruck, FiPlus } from 'react-icons/fi';

export default function Navbar() {
    const { user, profile, signOut, isAdmin, isRenter, loading } = useAuth();
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef(null);
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSignOut = async () => {
        setShowDropdown(false);
        const wasAdmin = isAdmin; // capture before signOut clears state
        await signOut();
        // Admins always go back to the admin login portal
        navigate(wasAdmin ? '/admin-login' : '/', { replace: true });
    };

    const getInitials = () => {
        if (profile?.full_name) {
            return profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        }
        return user?.email?.[0]?.toUpperCase() || 'U';
    };

    // While auth is resolving, show a minimal neutral nav to prevent flash
    if (loading) {
        return (
            <nav className="landing-navbar min-h-[64px]">
                <Link to="/" className="navbar-brand">
                    <div className="navbar-logo">SD</div>
                    <span className="navbar-title">Safe<span>Drive</span></span>
                </Link>
            </nav>
        );
    }

    // Landing page navbar (not logged in)
    if (!user) {
        return (
            <nav className="landing-navbar">
                <Link to="/" className="navbar-brand">
                    <div className="navbar-logo">SD</div>
                    <span className="navbar-title">Safe<span>Drive</span></span>
                </Link>
                <div className="navbar-actions">
                    <Link to="/login" className="btn btn-ghost text-white/70">Sign In</Link>
                    <Link to="/register" className="btn btn-accent">Get Started</Link>
                </div>
            </nav>
        );
    }

    return (
        <nav className="navbar">
            <div className="flex items-center gap-8">
                <Link to="/dashboard" className="navbar-brand">
                    <div className="navbar-logo">SD</div>
                    <span className="navbar-title">Safe<span>Drive</span></span>
                </Link>
                <div className="navbar-links">
                    <Link to="/dashboard" className={`navbar-link ${location.pathname === '/dashboard' ? 'active' : ''}`}>
                        <FiHome /> Dashboard
                    </Link>
                    <Link to="/vehicles" className={`navbar-link ${location.pathname.startsWith('/vehicles') ? 'active' : ''}`}>
                        <FiSearch /> Browse Cars
                    </Link>
                    {!isAdmin && (
                        <Link to="/my-vehicles" className={`navbar-link ${location.pathname === '/my-vehicles' ? 'active' : ''}`}>
                            <FiTruck /> My Vehicles
                        </Link>
                    )}
                    {!isAdmin && (
                        <Link to="/bookings" className={`navbar-link ${location.pathname === '/bookings' ? 'active' : ''}`}>
                            <FiCalendar /> Bookings
                        </Link>
                    )}

                    {isAdmin && (
                        <Link to="/admin" className={`navbar-link ${location.pathname.startsWith('/admin') ? 'active' : ''}`}>
                            <FiShield /> Admin
                        </Link>
                    )}
                </div>
            </div>

            <div className="navbar-actions">
                {!isAdmin && (
                    <Link to="/vehicles/new" className="btn btn-accent btn-sm">
                        <FiPlus /> List a Car
                    </Link>
                )}
                <button className="navbar-notification" onClick={() => navigate('/notifications')}>
                    <FiBell />
                </button>
                <div className="relative" ref={dropdownRef}>
                    <button className="navbar-avatar" onClick={() => setShowDropdown(!showDropdown)}>
                        {profile?.avatar_url ? (
                            <img src={profile.avatar_url} alt={profile.full_name} />
                        ) : (
                            getInitials()
                        )}
                    </button>
                    {showDropdown && (
                        <div className="user-dropdown">
                            <div className="px-4 py-3">
                                <div className="font-bold text-sm">{profile?.full_name || 'User'}</div>
                                <div className="text-xs text-[var(--text-tertiary)]">{user?.email}</div>
                                {isAdmin ? (
                                    <span className="badge badge-error inline-flex">Admin Account</span>
                                ) : (
                                    <span className={`badge ${profile?.role === 'verified' ? 'badge-verified' : 'badge-pending'} inline-flex`}>
                                        {profile?.role === 'verified' ? 'Verified' : 'Not Verified'}
                                    </span>
                                )}
                            </div>
                            <div className="user-dropdown-divider" />
                            <button className="user-dropdown-item" onClick={() => { navigate('/profile'); setShowDropdown(false); }}>
                                <FiUser /> Profile
                            </button>
                            {!isAdmin && (
                                <button className="user-dropdown-item" onClick={() => { navigate('/bookings'); setShowDropdown(false); }}>
                                    <FiCalendar /> My Bookings
                                </button>
                            )}
                            <button className="user-dropdown-item" onClick={() => { navigate('/settings'); setShowDropdown(false); }}>
                                <FiSettings /> Settings
                            </button>
                            <div className="user-dropdown-divider" />
                            <button className="user-dropdown-item danger" onClick={handleSignOut}>
                                <FiLogOut /> Sign Out
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </nav>
    );
}
