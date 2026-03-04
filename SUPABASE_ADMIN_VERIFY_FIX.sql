-- ============================================================
-- SUPABASE ADMIN FIX — Run this in Supabase → SQL Editor
-- This fixes TWO things:
--   1. Admin panel shows 0 users/vehicles (RLS blocking reads)
--   2. Verification toggle doesn't persist (RLS blocking writes)
-- ============================================================

-- ── STEP 1: Create a helper function to check if caller is admin ─────────────
-- SECURITY DEFINER means it bypasses RLS for the internal check (no recursion)
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION is_admin_user() TO anon;
GRANT EXECUTE ON FUNCTION is_admin_user() TO authenticated;

-- ── STEP 2: Fix RLS on profiles table ───────────────────────────────────────
-- Allow admins to SELECT all profiles (fixes "0 users" in admin panel)
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (
        auth.uid() = id          -- users can read their own profile
        OR is_admin_user()       -- admins can read everyone's profile
    );

-- Allow admins to UPDATE any profile (fixes verification toggle not saving)
DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
CREATE POLICY "Admins can update any profile" ON profiles
    FOR UPDATE USING (
        auth.uid() = id          -- users can update their own profile
        OR is_admin_user()       -- admins can update any profile
    );

-- ── STEP 3: Fix RLS on vehicles table ───────────────────────────────────────
-- Allow admins to SELECT all vehicles
DROP POLICY IF EXISTS "Admins can view all vehicles" ON vehicles;
CREATE POLICY "Admins can view all vehicles" ON vehicles
    FOR SELECT USING (
        auth.uid() = owner_id
        OR is_admin_user()
    );

-- Allow admins to UPDATE any vehicle (for approve/reject)
DROP POLICY IF EXISTS "Admins can update any vehicle" ON vehicles;
CREATE POLICY "Admins can update any vehicle" ON vehicles
    FOR UPDATE USING (is_admin_user());

-- ── STEP 4: Fix RLS on bookings table ───────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all bookings" ON bookings;
CREATE POLICY "Admins can view all bookings" ON bookings
    FOR SELECT USING (
        auth.uid() = renter_id
        OR auth.uid() = owner_id
        OR is_admin_user()
    );

-- ── STEP 5: Create RPC functions for verification (bypasses RLS) ─────────────
CREATE OR REPLACE FUNCTION admin_verify_user(
    target_user_id UUID,
    new_verification_status TEXT,
    new_role TEXT,
    admin_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_admin_user() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can verify users';
    END IF;
    UPDATE profiles SET
        verification_status = new_verification_status,
        role = new_role,
        verified_by = admin_user_id,
        verified_at = NOW()
    WHERE id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_change_role(
    target_user_id UUID,
    new_role TEXT,
    admin_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_admin_user() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can change roles';
    END IF;
    UPDATE profiles SET role = new_role WHERE id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_verify_user(UUID, TEXT, TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION admin_verify_user(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_change_role(UUID, TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION admin_change_role(UUID, TEXT, UUID) TO authenticated;

-- ── STEP 6: Add missing columns if they don't exist ─────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_by UUID;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ── STEP 7: Allow admins to read audit_logs ──────────────────────────────────
ALTER TABLE IF EXISTS audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;
CREATE POLICY "Admins can view audit logs" ON audit_logs
    FOR ALL USING (is_admin_user());

-- ── DONE ─────────────────────────────────────────────────────────────────────
-- After running this:
-- ✅ Admin panel Users tab will show all users
-- ✅ Admin panel Vehicles/Bookings/Audit tabs will show all data
-- ✅ Verification toggle will persist correctly
-- ✅ Role changes will persist correctly
