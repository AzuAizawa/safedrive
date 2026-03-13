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
            booking: <FiCalendar className="text-[var(--primary-500)]" />,
            vehicle: <FiTruck className="text-[var(--accent-500)]" />,
            user: <FiUser className="text-[var(--success-500)]" />,
        };
        return icons[type] || <FiBell className="text-[var(--text-tertiary)]" />;
    };

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <div className="max-w-[680px] mx-auto pb-12">
            <BackButton />
            <div className="page-header flex justify-between items-start">
                <div>
                    <h1>🔔 Notifications</h1>
                    <p>{unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up!'}</p>
                </div>
                {unreadCount > 0 && (
                    <button className="btn btn-sm btn-secondary mt-2" onClick={markAllRead}>
                        <FiCheck /> Mark all read
                    </button>
                )}
            </div>

            {loading ? (
                <div className="loading-spinner"><div className="spinner" /></div>
            ) : notifications.length === 0 ? (
                <div className="text-center p-[60px_24px] bg-[var(--surface-secondary)] rounded-[var(--radius-xl)] border border-[var(--border-light)]">
                    <div className="text-[52px] mb-4">🔔</div>
                    <div className="font-bold text-[var(--text-secondary)] mb-2">No notifications yet</div>
                    <div className="text-[14px] text-[var(--text-tertiary)]">
                        You'll be notified about bookings, approvals, and messages here.
                    </div>
                </div>
            ) : (
                <div className="bg-[var(--surface-primary)] rounded-[var(--radius-xl)] border border-[var(--border-light)] overflow-hidden">
                    {notifications.map((n, i) => (
                        <div
                            key={n.id}
                            onClick={() => { markRead(n.id); if (n.reference_id && n.reference_type === 'booking') navigate(`/bookings`); }}
                            className={`flex items-start gap-4 p-[16px_20px] transition-all duration-150 ${i < notifications.length - 1 ? 'border-b border-[var(--border-light)]' : ''} ${n.reference_id ? 'cursor-pointer' : 'default'} ${n.is_read ? 'bg-transparent' : 'bg-[var(--primary-50)]'}`}
                        >
                            <div className="w-9 h-9 rounded-full shrink-0 bg-[var(--surface-secondary)] flex items-center justify-center">
                                {getIcon(n.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className={`text-[14px] ${n.is_read ? 'font-normal' : 'font-bold'}`}>{n.title}</div>
                                <div className="text-[13px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">{n.message}</div>
                                <div className="text-[11px] text-[var(--text-tertiary)] mt-1">
                                    {new Date(n.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                                </div>
                            </div>
                            {!n.is_read && (
                                <div className="w-2 h-2 rounded-full bg-[var(--primary-500)] shrink-0 mt-1.5" />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
