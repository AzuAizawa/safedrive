import { useEffect, useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiLoader, FiSave } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { ui } from '../lib/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dateToStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function AvailabilityCalendar({ vehicleId, editable = false, onDateSelect }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [blockedDates, setBlockedDates] = useState(new Set());
    const [bookedDates, setBookedDates] = useState(new Set());
    const [pendingChanges, setPendingChanges] = useState(new Map());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = dateToStr(new Date());

    useEffect(() => {
        if (vehicleId) {
            fetchAvailability();
        }
    }, [vehicleId, year, month]);

    const fetchAvailability = async () => {
        setLoading(true);
        try {
            const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month + 1, 0).getDate();
            const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

            const { data: blockData } = await supabase
                .from('vehicle_availability')
                .select('unavailable_date, reason')
                .eq('vehicle_id', vehicleId)
                .gte('unavailable_date', startOfMonth)
                .lte('unavailable_date', endOfMonth);

            const nextBlocked = new Set();
            (blockData || []).forEach((entry) => {
                if (entry.reason === 'blocked' || entry.reason === 'maintenance') {
                    nextBlocked.add(entry.unavailable_date);
                }
            });
            setBlockedDates(nextBlocked);

            const { data: bookings } = await supabase
                .from('bookings')
                .select('start_date, end_date, status')
                .eq('vehicle_id', vehicleId)
                .in('status', ['pending', 'confirmed', 'active'])
                .or(`start_date.lte.${endOfMonth},end_date.gte.${startOfMonth}`);

            const nextBooked = new Set();
            (bookings || []).forEach((booking) => {
                const start = new Date(booking.start_date);
                const end = new Date(booking.end_date);

                for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
                    const dateString = dateToStr(date);
                    if (dateString >= startOfMonth && dateString <= endOfMonth) {
                        nextBooked.add(dateString);
                    }
                }
            });

            setBookedDates(nextBooked);
            setPendingChanges(new Map());
        } catch (err) {
            console.error('Error fetching availability:', err);
            toast.error('Failed to load availability');
        } finally {
            setLoading(false);
        }
    };

    const calendarDays = useMemo(() => {
        const firstDay = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();
        const days = [];

        for (let i = 0; i < firstDay; i += 1) {
            days.push(null);
        }

        for (let day = 1; day <= totalDays; day += 1) {
            days.push(day);
        }

        return days;
    }, [month, year]);

    const handleDayClick = (day) => {
        if (!day) return;

        const dateString = dateToStr(new Date(year, month, day));
        if (dateString < today) return;

        if (bookedDates.has(dateString)) {
            toast.error('This date has an active booking.');
            return;
        }

        if (editable) {
            const nextChanges = new Map(pendingChanges);
            const currentlyBlocked = blockedDates.has(dateString);
            const pendingAction = nextChanges.get(dateString);

            if (currentlyBlocked && !pendingAction) {
                nextChanges.set(dateString, 'remove');
            } else if (!currentlyBlocked && !pendingAction) {
                nextChanges.set(dateString, 'add');
            } else {
                nextChanges.delete(dateString);
            }

            setPendingChanges(nextChanges);
        }

        if (onDateSelect) {
            onDateSelect(dateString);
        }
    };

    const getDayStatus = (day) => {
        if (!day) return 'empty';

        const dateString = dateToStr(new Date(year, month, day));
        if (dateString < today) return 'past';
        if (bookedDates.has(dateString)) return 'booked';

        const pendingAction = pendingChanges.get(dateString);
        if (pendingAction === 'add') return 'pending-block';
        if (pendingAction === 'remove') return 'pending-unblock';
        if (blockedDates.has(dateString)) return 'blocked';

        return 'available';
    };

    const saveChanges = async () => {
        if (pendingChanges.size === 0) return;

        setSaving(true);
        try {
            const toAdd = [];
            const toRemove = [];

            pendingChanges.forEach((action, dateString) => {
                if (action === 'add') {
                    toAdd.push(dateString);
                } else {
                    toRemove.push(dateString);
                }
            });

            if (toRemove.length > 0) {
                await supabase
                    .from('vehicle_availability')
                    .delete()
                    .eq('vehicle_id', vehicleId)
                    .in('unavailable_date', toRemove);
            }

            if (toAdd.length > 0) {
                const rows = toAdd.map((dateString) => ({
                    vehicle_id: vehicleId,
                    unavailable_date: dateString,
                    reason: 'blocked',
                }));

                await supabase.from('vehicle_availability').upsert(rows, {
                    onConflict: 'vehicle_id,unavailable_date',
                });
            }

            toast.success(`Saved ${pendingChanges.size} change${pendingChanges.size > 1 ? 's' : ''}`);
            fetchAvailability();
        } catch (err) {
            console.error('Error saving availability:', err);
            toast.error('Failed to save availability');
        } finally {
            setSaving(false);
        }
    };

    const statusClasses = {
        available: 'border-success-200 bg-success-50 text-success-700',
        blocked: 'border-error-200 bg-error-50 text-error-700',
        booked: 'border-primary-200 bg-primary-50 text-primary-700',
        past: 'border-transparent bg-neutral-50 text-neutral-400',
        'pending-block': 'border-error-400 bg-error-50 text-error-700 ring-2 ring-error-200/70',
        'pending-unblock': 'border-success-400 bg-success-50 text-success-700 ring-2 ring-success-200/70',
    };

    return (
        <section className={ui.section}>
            <div className={ui.sectionHeader}>
                <div>
                    <h2 className="font-display text-2xl font-bold text-text-primary">
                        {editable ? 'Manage availability' : 'Availability calendar'}
                    </h2>
                    <p className="text-sm text-text-tertiary">
                        {editable
                            ? 'Block days when the vehicle cannot be booked.'
                            : 'View upcoming blocked and booked dates.'}
                    </p>
                </div>
                {editable && pendingChanges.size > 0 && (
                    <button type="button" className={`${ui.button.accent} ${ui.button.sm}`} onClick={saveChanges} disabled={saving}>
                        {saving ? <FiLoader className="animate-spin" /> : <FiSave />}
                        Save {pendingChanges.size} change{pendingChanges.size > 1 ? 's' : ''}
                    </button>
                )}
            </div>

            <div className={ui.sectionBody}>
                <div className="mb-5 flex items-center justify-between">
                    <button type="button" className={`${ui.button.ghost} ${ui.button.sm}`} onClick={() => setCurrentDate(new Date(year, month - 1, 1))}>
                        <FiChevronLeft />
                        Previous
                    </button>
                    <h3 className="font-display text-2xl font-semibold text-text-primary">
                        {MONTHS[month]} {year}
                    </h3>
                    <button type="button" className={`${ui.button.ghost} ${ui.button.sm}`} onClick={() => setCurrentDate(new Date(year, month + 1, 1))}>
                        Next
                        <FiChevronRight />
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className={ui.spinner} />
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                            {DAYS.map((day) => (
                                <div key={day} className="py-2">
                                    {day}
                                </div>
                            ))}
                        </div>
                        <div className="mt-3 grid grid-cols-7 gap-2">
                            {calendarDays.map((day, index) => {
                                const status = getDayStatus(day);
                                const isToday = day && dateToStr(new Date(year, month, day)) === today;
                                const canEdit = editable && day && status !== 'past' && status !== 'booked';

                                return (
                                    <button
                                        key={`${day || 'blank'}-${index}`}
                                        type="button"
                                        onClick={() => canEdit && handleDayClick(day)}
                                        disabled={!canEdit}
                                        className={`${day ? statusClasses[status] : 'border-transparent bg-transparent'} ${isToday ? 'border-2 border-accent-500' : 'border'} aspect-square rounded-2xl text-sm font-semibold transition ${canEdit ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default'} disabled:opacity-100`}
                                        title={
                                            status === 'booked'
                                                ? 'Booked'
                                                : status === 'blocked'
                                                    ? 'Blocked'
                                                    : status === 'pending-block'
                                                        ? 'Will be blocked'
                                                        : status === 'pending-unblock'
                                                            ? 'Will be unblocked'
                                                            : status === 'past'
                                                                ? 'Past date'
                                                                : 'Available'
                                        }
                                    >
                                        {day || ''}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}

                <div className="mt-6 flex flex-wrap gap-4 text-sm text-text-secondary">
                    <div className="flex items-center gap-2">
                        <span className="h-3.5 w-3.5 rounded-full bg-success-50 ring-2 ring-success-200" />
                        Available
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="h-3.5 w-3.5 rounded-full bg-primary-50 ring-2 ring-primary-200" />
                        Booked
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="h-3.5 w-3.5 rounded-full bg-error-50 ring-2 ring-error-200" />
                        Blocked
                    </div>
                    {editable && (
                        <div className="flex items-center gap-2">
                            <span className="h-3.5 w-3.5 rounded-full bg-warning-50 ring-2 ring-warning-200" />
                            Pending change
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
