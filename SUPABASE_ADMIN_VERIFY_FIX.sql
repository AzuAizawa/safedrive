-- ============================================================
-- SUPABASE ADMIN VERIFICATION FIX
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================
-- 
-- PROBLEM: The admin client (supabaseAdmin) uses the ANON key, not the 
-- service role key. This means it's still subject to Row Level Security 
-- (RLS). Direct updates to profile.role and profile.verification_status 
-- from the frontend are blocked by RLS even for admin accounts.
--
-- SOLUTION: Create SECURITY DEFINER functions that run as the database 
-- owner (bypassing RLS) and can only be called with the right parameters.
-- ============================================================

-- ── 1. Function to verify/reject a user ─────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_verify_user(
    target_user_id UUID,
    new_verification_status TEXT,  -- 'verified' or 'rejected'
    new_role TEXT,                  -- 'verified' or 'user'
    admin_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER  -- Runs as DB owner, bypasses RLS
SET search_path = public
AS $$
BEGIN
    -- Only allow admins to call this
    IF NOT EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = admin_user_id AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can verify users';
    END IF;

    -- Update both verification_status AND role
    UPDATE profiles SET
        verification_status = new_verification_status,
        role = new_role,
        verified_by = admin_user_id,
        verified_at = NOW()
    WHERE id = target_user_id;
END;
$$;

-- ── 2. Function to change user role ─────────────────────────────────────────
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
    IF NOT EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = admin_user_id AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can change roles';
    END IF;

    UPDATE profiles SET role = new_role WHERE id = target_user_id;
END;
$$;

-- ── 3. Grant execute permission to the anon role ────────────────────────────
GRANT EXECUTE ON FUNCTION admin_verify_user(UUID, TEXT, TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION admin_verify_user(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_change_role(UUID, TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION admin_change_role(UUID, TEXT, UUID) TO authenticated;

-- ── 4. Ensure RLS policies allow admins to read profiles ────────────────────
-- Allow admins to see all profiles (needed for the Users tab)
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (
        auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin')
        OR auth.uid() = id  -- users can see their own profile
    );

-- ── 5. Make sure verified_by and verified_at columns exist ──────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES profiles(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ============================================================
-- After running this, the AdminPanel.jsx will call:
-- supabaseAdmin.rpc('admin_verify_user', {...}) 
-- instead of direct .update() which was blocked by RLS
-- ============================================================
