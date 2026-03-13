import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { FiChevronLeft, FiChevronRight, FiSave, FiLoader } from 'react-icons/fi';
import toast from 'react-hot-toast';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dateToStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AvailabilityCalendar({ vehicleId, editable = false, onDateSelect }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [blockedDates, setBlockedDates] = useState(new Set());
    const [bookedDates, setBookedDates] = useState(new Set());
    const [pendingChanges, setPendingChanges] = useState(new Map()); // dateStr -> 'add' | 'remove'
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = dateToStr(new Date());

    useEffect(() => {
        if (vehicleId) fetchAvailability();
    }, [vehicleId, year, month]);

    const fetchAvailability = async () => {
        setLoading(true);
        try {
            const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month + 1, 0).getDate();
            const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

            // Fetch blocked dates
            const { data: blockData } = await supabase
                .from('vehicle_availability')
                .select('unavailable_date, reason')
                .eq('vehicle_id', vehicleId)
                .gte('unavailable_date', startOfMonth)
                .lte('unavailable_date', endOfMonth);

            const blocked = new Set();
            (blockData || []).forEach(d => {
                if (d.reason === 'blocked' || d.reason === 'maintenance') {
                    blocked.add(d.unavailable_date);
                }
            });
            setBlockedDates(blocked);

            // Fetch booked dates
            const { data: bookings } = await supabase
                .from('bookings')
                .select('start_date, end_date, status')
                .eq('vehicle_id', vehicleId)
                .in('status', ['pending', 'confirmed', 'active'])
                .or(`start_date.lte.${endOfMonth},end_date.gte.${startOfMonth}`);

            const booked = new Set();
            (bookings || []).forEach(b => {
                const start = new Date(b.start_date);
                const end = new Date(b.end_date);
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const ds = dateToStr(d);
                    if (ds >= startOfMonth && ds <= endOfMonth) booked.add(ds);
                }
            });
            setBookedDates(booked);
            setPendingChanges(new Map());
        } catch (err) {
            console.error('Error fetching availability:', err);
        } finally {
            setLoading(false);
        }
    };

    const calendarDays = useMemo(() => {
        const firstDay = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();
        const days = [];

        // Empty cells for days before month starts
        for (let i = 0; i < firstDay; i++) days.push(null);
        for (let d = 1; d <= totalDays; d++) days.push(d);

        return days;
    }, [year, month]);

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    const handleDayClick = (day) => {
        if (!day) return;
        const ds = dateToStr(new Date(year, month, day));

        // Can't modify past dates
        if (ds < today) return;

        // Can't modify booked dates
        if (bookedDates.has(ds)) {
            toast.error('This date has an active booking');
            return;
        }

        if (editable) {
            const newChanges = new Map(pendingChanges);
            const isCurrentlyBlocked = blockedDates.has(ds);
            const pendingAction = newChanges.get(ds);

            if (isCurrentlyBlocked && !pendingAction) {
                newChanges.set(ds, 'remove'); // Mark for unblocking
            } else if (!isCurrentlyBlocked && !pendingAction) {
                newChanges.set(ds, 'add'); // Mark for blocking
            } else {
                newChanges.delete(ds); // Cancel pending change
            }
            setPendingChanges(newChanges);
        }

        if (onDateSelect) onDateSelect(ds);
    };

    const getDayStatus = (day) => {
        if (!day) return 'empty';
        const ds = dateToStr(new Date(year, month, day));

        if (ds < today) return 'past';
        if (bookedDates.has(ds)) return 'booked';

        const pendingAction = pendingChanges.get(ds);
        if (pendingAction === 'add') return 'pending-block';
        if (pendingAction === 'remove') return 'pending-unblock';
        if (blockedDates.has(ds)) return 'blocked';

        return 'available';
    };

    const saveChanges = async () => {
        if (pendingChanges.size === 0) return;
        setSaving(true);
        try {
            const toAdd = [];
            const toRemove = [];
            pendingChanges.forEach((action, dateStr) => {
                if (action === 'add') toAdd.push(dateStr);
                else toRemove.push(dateStr);
            });

            // Remove unblocked dates
            if (toRemove.length > 0) {
                await supabase
                    .from('vehicle_availability')
                    .delete()
                    .eq('vehicle_id', vehicleId)
                    .in('unavailable_date', toRemove);
            }

            // Add blocked dates
            if (toAdd.length > 0) {
                const rows = toAdd.map(date => ({
                    vehicle_id: vehicleId,
                    unavailable_date: date,
                    reason: 'blocked',
                }));
                await supabase.from('vehicle_availability').upsert(rows, {
                    onConflict: 'vehicle_id,unavailable_date',
                });
            }

            toast.success(`Saved ${pendingChanges.size} change${pendingChanges.size > 1 ? 's' : ''}`);
            fetchAvailability();
        } catch (err) {
            console.error('Error saving:', err);
            toast.error('Failed to save changes');
        } finally {
            setSaving(false);
        }
    };

    const statusClasses = {
        available: 'bg-[var(--success-50)] text-[var(--success-700)] border-[var(--success-200)]',
        blocked: 'bg-[var(--error-50)] text-[var(--error-700)] border-[var(--error-200)]',
        booked: 'bg-[var(--primary-50)] text-[var(--primary-700)] border-[var(--primary-200)]',
        past: 'bg-[var(--neutral-50)] text-[var(--neutral-400)] border-transparent',
        'pending-block': 'bg-[var(--error-100)] text-[var(--error-600)] border-[var(--error-400)]',
        'pending-unblock': 'bg-[var(--success-100)] text-[var(--success-600)] border-[var(--success-400)]',
    };

    return (
        <div className="card overflow-visible">
            <div className="card-header flex justify-between items-center">
                <h2 className="text-[16px] font-bold flex items-center gap-2">
                    📅 {editable ? 'Manage Availability' : 'Availability Calendar'}
                </h2>
                {editable && pendingChanges.size > 0 && (
                    <button className="btn btn-accent btn-sm" onClick={saveChanges} disabled={saving}>
                        {saving ? <><FiLoader className="spin" /> Saving...</> : <><FiSave /> Save {pendingChanges.size} Change{pendingChanges.size > 1 ? 's' : ''}</>}
                    </button>
                )}
            </div>

            <div className="card-body">
                {/* Month Navigation */}
                <div className="flex justify-between items-center mb-4">
                    <button className="btn btn-ghost btn-sm" onClick={prevMonth}><FiChevronLeft /></button>
                    <h3 className="text-[16px] font-bold">{MONTHS[month]} {year}</h3>
                    <button className="btn btn-ghost btn-sm" onClick={nextMonth}><FiChevronRight /></button>
                </div>

                {loading ? (
                    <div className="text-center p-10">
                        <div className="spinner mx-auto" />
                    </div>
                ) : (
                    <>
                        {/* Day Headers */}
                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {DAYS.map(d => (
                                <div key={d} className="text-center text-[11px] font-bold text-[var(--text-tertiary)] uppercase py-1">
                                    {d}
                                </div>
                            ))}
                        </div>

                        {/* Calendar Grid */}
                        <div className="grid grid-cols-7 gap-1">
                            {calendarDays.map((day, i) => {
                                const status = getDayStatus(day);
                                const classes = statusClasses[status] || 'text-[var(--text-tertiary)]';
                                const isClickable = editable && day && status !== 'past' && status !== 'booked';
                                const isToday = day && dateToStr(new Date(year, month, day)) === today;

                                return (
                                    <div
                                        key={i}
                                        onClick={() => isClickable && handleDayClick(day)}
                                        className={`aspect-square flex items-center justify-center rounded-[var(--radius-md)] text-[13px] transition-all duration-150 border relative 
                                            ${day ? classes : 'border-transparent'} 
                                            ${isClickable ? 'cursor-pointer hover:scale-110' : 'cursor-default'} 
                                            ${isToday ? 'font-extrabold border-2 border-[var(--accent-500)]' : 'font-semibold'}
                                        `}
                                        title={
                                            status === 'booked' ? 'Booked by a rentee' :
                                                status === 'blocked' ? 'Blocked by owner' :
                                                    status === 'pending-block' ? 'Will be blocked (unsaved)' :
                                                        status === 'pending-unblock' ? 'Will be unblocked (unsaved)' :
                                                            status === 'available' ? 'Available' :
                                                                status === 'past' ? 'Past date' : ''
                                        }
                                    >
                                        {day || ''}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {/* Legend */}
                <div className="flex flex-wrap gap-3 mt-4 text-[12px]">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3.5 h-3.5 rounded-[4px] bg-[var(--success-50)] border border-[var(--success-200)]" />
                        <span className="text-[var(--text-secondary)]">Available</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3.5 h-3.5 rounded-[4px] bg-[var(--primary-50)] border border-[var(--primary-200)]" />
                        <span className="text-[var(--text-secondary)]">Booked</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3.5 h-3.5 rounded-[4px] bg-[var(--error-50)] border border-[var(--error-200)]" />
                        <span className="text-[var(--text-secondary)]">Blocked</span>
                    </div>
                    {editable && (
                        <div className="flex items-center gap-1.5">
                            <div className="w-3.5 h-3.5 rounded-[4px] bg-[var(--error-100)] border-2 border-dashed border-[var(--error-400)]" />
                            <span className="text-[var(--text-secondary)]">Unsaved</span>
                        </div>
                    )}
                </div>

                {editable && (
                    <p className="text-[12px] text-[var(--text-tertiary)] mt-3">
                        💡 Click on available dates to block them. Click blocked dates to unblock. Then hit Save.
                    </p>
                )}
            </div>
        </div>
    );
}
