import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { FiHome, FiSearch, FiHeart, FiCalendar, FiBell, FiUser, FiLogOut, FiSettings, FiShield, FiTruck, FiPlus } from 'react-icons/fi';

export default function Navbar() {
    const { user, profile, signOut, isAdmin, isRenter } = useAuth();
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
        await signOut();
        navigate('/');
    };

    const getInitials = () => {
        if (profile?.full_name) {
            return profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        }
        return user?.email?.[0]?.toUpperCase() || 'U';
    };

    // Landing page navbar
    if (!user) {
        return (
            <nav className="landing-navbar">
                <Link to="/" className="navbar-brand">
                    <div className="navbar-logo">SD</div>
                    <span className="navbar-title">Safe<span>Drive</span></span>
                </Link>
                <div className="navbar-actions">
                    <Link to="/login" className="btn btn-ghost" style={{ color: 'rgba(255,255,255,0.7)' }}>Sign In</Link>
                    <Link to="/register" className="btn btn-accent">Get Started</Link>
                </div>
            </nav>
        );
    }

    return (
        <nav className="navbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
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
                <div style={{ position: 'relative' }} ref={dropdownRef}>
                    <button className="navbar-avatar" onClick={() => setShowDropdown(!showDropdown)}>
                        {profile?.avatar_url ? (
                            <img src={profile.avatar_url} alt={profile.full_name} />
                        ) : (
                            getInitials()
                        )}
                    </button>
                    {showDropdown && (
                        <div className="user-dropdown">
                            <div style={{ padding: '12px 16px' }}>
                                <div style={{ fontWeight: 700, fontSize: 14 }}>{profile?.full_name || 'User'}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{user?.email}</div>
                                {isAdmin ? (
                                    <span className="badge badge-error" style={{ display: 'inline-flex' }}>Admin Account</span>
                                ) : (
                                    <>
                                        <span className={`badge ${profile?.verification_status === 'verified' ? 'badge-verified' : 'badge-pending'}`} style={{ display: 'inline-flex' }}>
                                            {profile?.verification_status || 'pending'}
                                        </span>
                                        <span className="badge badge-info" style={{ display: 'inline-flex' }}>
                                            {profile?.role === 'user' ? 'Not Verified' : profile?.role === 'verified' ? 'Verified' : profile?.role || 'user'}
                                        </span>
                                    </>
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
