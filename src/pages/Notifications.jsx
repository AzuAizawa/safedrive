import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiBell, FiCalendar, FiCheck, FiTruck, FiUser } from 'react-icons/fi';
import BackButton from '../components/BackButton';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { cx, ui } from '../lib/ui';

function NotificationIcon({ type }) {
  const iconMap = {
    booking: <FiCalendar />,
    vehicle: <FiTruck />,
    user: <FiUser />,
  };

  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
      {iconMap[type] || <FiBell />}
    </div>
  );
}

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchNotifications();
    }
  }, [user]);

  const fetchNotifications = async () => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error) {
        setNotifications(data || []);
      }
    } catch (err) {
      console.error('Notifications error:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter((notification) => !notification.is_read).map((notification) => notification.id);
    if (!unread.length) {
      return;
    }

    await supabase.from('notifications').update({ is_read: true }).in('id', unread);
    setNotifications((previous) => previous.map((notification) => ({ ...notification, is_read: true })));
  };

  const markRead = async (id) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications((previous) =>
      previous.map((notification) =>
        notification.id === id ? { ...notification, is_read: true } : notification
      )
    );
  };

  const unreadCount = notifications.filter((notification) => !notification.is_read).length;

  return (
    <div className={ui.pageCompact}>
      <BackButton />

      <div className="flex flex-col gap-4 rounded-[32px] border border-border-light bg-surface-primary px-6 py-6 shadow-soft sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Activity</p>
          <h1 className={ui.pageTitle}>Notifications</h1>
          <p className={ui.pageDescription}>
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
              : 'Everything is read. New bookings, approvals, and messages will appear here.'}
          </p>
        </div>

        {unreadCount > 0 && (
          <button type="button" className={cx(ui.button.secondary, ui.button.sm)} onClick={markAllRead}>
            <FiCheck />
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className={ui.loadingScreen}>
          <div className={ui.spinner} />
          <p className="text-sm font-medium text-text-secondary">Loading notifications...</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className={ui.emptyState}>
          <div className={ui.emptyIcon}>
            <FiBell />
          </div>
          <h2 className="text-lg font-semibold text-text-primary">No notifications yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
            When something needs your attention, we will show it here so you can jump straight into the right booking or listing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const clickable = notification.reference_id && notification.reference_type === 'booking';

            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => {
                  markRead(notification.id);
                  if (clickable) {
                    navigate('/bookings');
                  }
                }}
                className={cx(
                  'w-full rounded-[28px] border px-5 py-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-card',
                  notification.is_read
                    ? 'border-border-light bg-surface-primary'
                    : 'border-primary-200 bg-primary-50/60',
                  !clickable && 'cursor-default hover:translate-y-0 hover:border-border-light hover:shadow-soft'
                )}
              >
                <div className="flex items-start gap-4">
                  <NotificationIcon type={notification.type} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2
                          className={cx(
                            'text-sm',
                            notification.is_read ? 'font-medium text-text-primary' : 'font-semibold text-text-primary'
                          )}
                        >
                          {notification.title}
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-text-secondary">{notification.message}</p>
                      </div>

                      {!notification.is_read && (
                        <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary-500" />
                      )}
                    </div>

                    <p className="mt-3 text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
                      {new Date(notification.created_at).toLocaleString('en-PH', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
