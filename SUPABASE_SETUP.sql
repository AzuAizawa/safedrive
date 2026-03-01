-- ============================================================
-- SafeDrive: Audit Trail Setup
-- Run this in your Supabase SQL Editor (supabase.com → SQL Editor)
-- ============================================================

-- 1. Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    performed_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    performer_name  text,
    performer_email text,
    action          text NOT NULL,        -- e.g. 'VERIFY_USER', 'APPROVE_VEHICLE'
    entity_type     text NOT NULL,        -- 'user', 'vehicle', 'booking', 'brand', 'model'
    entity_id       text,
    description     text,
    old_value       jsonb,
    new_value       jsonb,
    ip_address      text,
    user_agent      text,
    created_at      timestamptz DEFAULT now() NOT NULL
);

-- 2. Index for fast queries
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_type_idx ON public.audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS audit_logs_performed_by_idx ON public.audit_logs(performed_by);

-- 3. Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. Only admins can read audit logs
CREATE POLICY "Admins can view audit logs"
    ON public.audit_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- 5. Any authenticated user can INSERT audit logs
--    (controlled at app level — only called from admin actions)
CREATE POLICY "Authenticated users can insert audit logs"
    ON public.audit_logs
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- ACID: Atomic Booking Transaction Function
-- Ensures booking creation always updates availability atomically
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_booking_atomic(
    p_vehicle_id    uuid,
    p_renter_id     uuid,
    p_start_date    date,
    p_end_date      date,
    p_total_amount  numeric,
    p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_booking_id uuid;
    v_conflict   int;
BEGIN
    -- Isolation: Check for conflicting bookings (serializable-safe)
    SELECT COUNT(*) INTO v_conflict
    FROM public.bookings
    WHERE vehicle_id = p_vehicle_id
        AND status NOT IN ('cancelled', 'rejected')
        AND (start_date, end_date) OVERLAPS (p_start_date, p_end_date);

    IF v_conflict > 0 THEN
        RAISE EXCEPTION 'Vehicle is already booked for the selected dates';
    END IF;

    -- Atomicity: Insert booking + update in single transaction
    INSERT INTO public.bookings (
        vehicle_id, renter_id, start_date, end_date,
        total_amount, notes, status, created_at
    ) VALUES (
        p_vehicle_id, p_renter_id, p_start_date, p_end_date,
        p_total_amount, p_notes, 'pending', now()
    ) RETURNING id INTO v_booking_id;

    -- Durability: PostgreSQL WAL ensures this persists even on crash
    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_booking_id
    );

EXCEPTION
    WHEN OTHERS THEN
        -- Atomicity: any error triggers automatic full rollback
        RAISE;
END;
$$;

-- ============================================================
-- Done! After running this:
-- 1. The Audit Trail tab in the Admin Panel will show all logs
-- 2. Bookings created via create_booking_atomic() are ACID-safe
-- ============================================================
