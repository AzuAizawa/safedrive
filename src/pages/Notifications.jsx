import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiBell, FiCheck, FiCalendar, FiTruck, FiUser } from 'react-icons/fi';
import BackButton from '../components/BackButton';

export default function Notifications() {
    const { user, profile } = useAuth();
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) fetchNotifications();
    }, [user]);

    const fetchNotifications = async () => {
        try {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(50);

            if (!error) setNotifications(data || []);
        } catch (err) {
            console.error('Notifications error:', err);
        } finally {
            setLoading(false);
        }
    };

    const markAllRead = async () => {
        const unread = notifications.filter(n => !n.is_read).map(n => n.id);
        if (!unread.length) return;
        await supabase.from('notifications').update({ is_read: true }).in('id', unread);
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    };

    const markRead = async (id) => {
        await supabase.from('notifications').update({ is_read: true }).eq('id', id);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    };

    const getIcon = (type) => {
        const icons = {
            booking: <FiCalendar style={{ color: 'var(--primary-500)' }} />,
            vehicle: <FiTruck style={{ color: 'var(--accent-500)' }} />,
            user: <FiUser style={{ color: 'var(--success-500)' }} />,
        };
        return icons[type] || <FiBell style={{ color: 'var(--text-tertiary)' }} />;
    };

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <div style={{ maxWidth: 680, margin: '0 auto', paddingBottom: 48 }}>
            <BackButton />
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1>🔔 Notifications</h1>
                    <p>{unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up!'}</p>
                </div>
                {unreadCount > 0 && (
                    <button className="btn btn-sm btn-secondary" onClick={markAllRead} style={{ marginTop: 8 }}>
                        <FiCheck /> Mark all read
                    </button>
                )}
            </div>

            {loading ? (
                <div className="loading-spinner"><div className="spinner" /></div>
            ) : notifications.length === 0 ? (
                <div style={{
                    textAlign: 'center', padding: '60px 24px',
                    background: 'var(--surface-secondary)',
                    borderRadius: 'var(--radius-xl)',
                    border: '1px solid var(--border-light)',
                }}>
                    <div style={{ fontSize: 52, marginBottom: 16 }}>🔔</div>
                    <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>No notifications yet</div>
                    <div style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>
                        You'll be notified about bookings, approvals, and messages here.
                    </div>
                </div>
            ) : (
                <div style={{
                    background: 'var(--surface-primary)',
                    borderRadius: 'var(--radius-xl)',
                    border: '1px solid var(--border-light)',
                    overflow: 'hidden',
                }}>
                    {notifications.map((n, i) => (
                        <div
                            key={n.id}
                            onClick={() => { markRead(n.id); if (n.reference_id && n.reference_type === 'booking') navigate(`/bookings`); }}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: 14,
                                padding: '16px 20px',
                                borderBottom: i < notifications.length - 1 ? '1px solid var(--border-light)' : 'none',
                                cursor: n.reference_id ? 'pointer' : 'default',
                                background: n.is_read ? 'transparent' : 'var(--primary-50)',
                                transition: 'background 0.15s',
                            }}
                        >
                            <div style={{
                                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                                background: 'var(--surface-secondary)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                {getIcon(n.type)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: n.is_read ? 400 : 700, fontSize: 14 }}>{n.title}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>{n.message}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                    {new Date(n.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                                </div>
                            </div>
                            {!n.is_read && (
                                <div style={{
                                    width: 8, height: 8, borderRadius: '50%',
                                    background: 'var(--primary-500)', flexShrink: 0, marginTop: 6,
                                }} />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
