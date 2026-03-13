import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    FiBell,
    FiCalendar,
    FiChevronDown,
    FiLogOut,
    FiPlus,
    FiSearch,
    FiSettings,
    FiShield,
    FiTruck,
    FiUser,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useUserMode } from '../context/UserModeContext';
import { getDefaultAppPath } from '../lib/navigation';
import { badgeClass, cx, ui } from '../lib/ui';

function BrandMark() {
    return (
        <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-700 text-base font-black text-white shadow-soft ring-1 ring-primary-300/30">
                SD
            </div>
            <div className="leading-tight">
                <div className="font-display text-lg font-bold tracking-tight text-text-primary sm:text-xl">
                    Safe<span className="text-accent-500">Drive</span>
                </div>
                <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-tertiary">
                    Peer-to-peer rentals
                </div>
            </div>
        </div>
    );
}

export default function Navbar() {
    const { user, profile, signOut, isAdmin, loading } = useAuth();
    const { mode, setMode } = useUserMode();
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

    const homePath = isAdmin ? '/admin' : getDefaultAppPath({ mode });

    const navItems = useMemo(() => {
        if (isAdmin) {
            return [{ to: '/admin', label: 'Admin', icon: FiShield, active: location.pathname.startsWith('/admin') }];
        }

        if (mode === 'lister') {
            return [
                { to: '/my-vehicles', label: 'My Vehicles', icon: FiTruck, active: location.pathname === '/my-vehicles' || location.pathname.startsWith('/vehicles/new') },
                { to: '/bookings', label: 'Bookings', icon: FiCalendar, active: location.pathname === '/bookings' },
            ];
        }

        return [
            { to: '/vehicles', label: 'Browse Cars', icon: FiSearch, active: location.pathname === '/vehicles' || (location.pathname.startsWith('/vehicles/') && !location.pathname.endsWith('/availability')) },
            { to: '/bookings', label: 'My Bookings', icon: FiCalendar, active: location.pathname === '/bookings' },
        ];
    }, [isAdmin, location.pathname, mode]);

    const handleSignOut = async () => {
        setShowDropdown(false);
        const wasAdmin = isAdmin;
        await signOut();
        navigate(wasAdmin ? '/admin-login' : '/', { replace: true });
    };

    const handleModeSwitch = (nextMode) => {
        if (mode === nextMode) {
            setShowDropdown(false);
            return;
        }

        setMode(nextMode);
        setShowDropdown(false);
        navigate(getDefaultAppPath({ mode: nextMode }), { replace: true });
    };

    const getInitials = () => {
        if (profile?.full_name) {
            return profile.full_name
                .split(' ')
                .map((name) => name[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);
        }

        return user?.email?.[0]?.toUpperCase() || 'U';
    };

    if (loading) {
        return (
            <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6 lg:px-8">
                <div className="mx-auto flex max-w-7xl items-center justify-between rounded-[32px] border border-border-light bg-surface-glass px-5 py-4 shadow-soft backdrop-blur-xl">
                    <BrandMark />
                    <div className="h-10 w-10 animate-pulse rounded-full bg-neutral-200" />
                </div>
            </header>
        );
    }

    if (!user) {
        return (
            <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6 lg:px-8">
                <div className="mx-auto flex max-w-7xl items-center justify-between rounded-[32px] border border-border-light bg-surface-glass px-5 py-4 shadow-soft backdrop-blur-xl">
                    <Link to="/">
                        <BrandMark />
                    </Link>
                    <div className="hidden items-center gap-3 sm:flex">
                        <Link to="/login" className={ui.button.ghost}>
                            Sign In
                        </Link>
                        <Link to="/register" className={ui.button.accent}>
                            Get Started
                        </Link>
                    </div>
                </div>
            </header>
        );
    }

    return (
        <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 rounded-[32px] border border-border-light bg-surface-glass px-5 py-4 shadow-soft backdrop-blur-xl">
                <div className="flex min-w-0 items-center gap-6">
                    <Link to={homePath}>
                        <BrandMark />
                    </Link>

                    <nav className="hidden items-center gap-2 lg:flex">
                        {navItems.map((item) => (
                            <Link
                                key={item.to}
                                to={item.to}
                                className={cx(
                                    'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition',
                                    item.active
                                        ? 'bg-primary-50 text-primary-700'
                                        : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                                )}
                            >
                                <item.icon className="text-base" />
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                    {!isAdmin && mode === 'lister' && (
                        <Link to="/vehicles/new" className={cx(ui.button.accent, 'hidden sm:inline-flex')}>
                            <FiPlus />
                            Add Vehicle
                        </Link>
                    )}

                    <button
                        type="button"
                        onClick={() => navigate('/notifications')}
                        className="flex h-11 w-11 items-center justify-center rounded-full border border-border-light bg-surface-elevated text-text-secondary transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                    >
                        <FiBell className="text-lg" />
                    </button>

                    <div className="relative" ref={dropdownRef}>
                        <button
                            type="button"
                            onClick={() => setShowDropdown((open) => !open)}
                            className="flex items-center gap-2 rounded-full border border-border-light bg-surface-elevated px-2.5 py-2 text-left shadow-xs transition hover:border-primary-200 hover:bg-primary-50"
                        >
                            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary-600 text-sm font-bold text-white">
                                {profile?.avatar_url ? (
                                    <img src={profile.avatar_url} alt={profile.full_name} className="h-full w-full object-cover" />
                                ) : (
                                    getInitials()
                                )}
                            </div>
                            <div className="hidden min-w-0 sm:block">
                                <div className="truncate text-sm font-semibold text-text-primary">
                                    {profile?.full_name || 'User'}
                                </div>
                                <div className="truncate text-xs text-text-tertiary">
                                    {isAdmin ? 'Admin account' : mode === 'lister' ? 'Lister mode' : 'Renter mode'}
                                </div>
                            </div>
                            <FiChevronDown className="hidden text-text-tertiary sm:block" />
                        </button>

                        {showDropdown && (
                            <div className="absolute right-0 top-[calc(100%+12px)] z-50 w-[320px] rounded-[28px] border border-border-light bg-surface-glass p-3 shadow-float backdrop-blur-xl">
                                <div className="rounded-3xl border border-border-light bg-surface-secondary p-4">
                                    <div className="text-sm font-bold text-text-primary">
                                        {profile?.full_name || 'User'}
                                    </div>
                                    <div className="mt-1 text-xs text-text-tertiary">{user?.email}</div>
                                    <div className="mt-3">
                                        {isAdmin ? (
                                            <span className={badgeClass('error')}>Admin account</span>
                                        ) : (
                                            <span className={badgeClass(profile?.role === 'verified' ? 'success' : 'pending')}>
                                                {profile?.role === 'verified' ? 'Verified' : 'Verification pending'}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {!isAdmin && (
                                    <div className="mt-3 rounded-3xl border border-border-light bg-surface-primary p-4">
                                        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                                            Switch Experience
                                        </div>
                                        <div className="rounded-full bg-neutral-100/70 p-1">
                                            <div className="grid grid-cols-2 gap-1">
                                                {[
                                                    { value: 'renter', label: 'Renter' },
                                                    { value: 'lister', label: 'Lister' },
                                                ].map((item) => (
                                                    <button
                                                        key={item.value}
                                                        type="button"
                                                        onClick={() => handleModeSwitch(item.value)}
                                                        className={cx(
                                                            'rounded-full px-4 py-2.5 text-sm font-semibold transition',
                                                            mode === item.value
                                                                ? 'bg-surface-primary text-primary-700 shadow-soft'
                                                                : 'text-text-secondary hover:text-text-primary'
                                                        )}
                                                    >
                                                        {item.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <p className="mt-3 text-xs leading-5 text-text-tertiary">
                                            Renter mode focuses on browsing and trips. Lister mode focuses on your vehicles and incoming bookings.
                                        </p>
                                    </div>
                                )}

                                <div className="mt-3 space-y-1">
                                    <button
                                        type="button"
                                        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium text-text-secondary transition hover:bg-surface-elevated hover:text-text-primary"
                                        onClick={() => {
                                            navigate('/profile');
                                            setShowDropdown(false);
                                        }}
                                    >
                                        <FiUser />
                                        Profile
                                    </button>
                                    <button
                                        type="button"
                                        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium text-text-secondary transition hover:bg-surface-elevated hover:text-text-primary"
                                        onClick={() => {
                                            navigate('/settings');
                                            setShowDropdown(false);
                                        }}
                                    >
                                        <FiSettings />
                                        Settings
                                    </button>
                                    <button
                                        type="button"
                                        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium text-error-600 transition hover:bg-error-50"
                                        onClick={handleSignOut}
                                    >
                                        <FiLogOut />
                                        Sign Out
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}
