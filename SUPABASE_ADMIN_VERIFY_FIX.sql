-- ============================================================
-- SUPABASE ADMIN FIX v2 — Run ENTIRE file in Supabase → SQL Editor
-- Fixes:
--   1. Admin panel shows 0 users/vehicles/bookings (RLS blocking reads)
--   2. Submitted Documents keeps loading (storage bucket missing/blocked)
--   3. Verification toggle doesn't persist (RLS blocking writes)
--   4. Profile save fails (RLS blocking UPDATE)
-- ============================================================

-- ── STEP 1: Helper function to check if caller is admin ─────────────────────
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

-- ── STEP 2: Profiles RLS ─────────────────────────────────────────────────────
-- Allow users to read their own profile + admins to read all
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (auth.uid() = id OR is_admin_user());

-- Allow users to update their own profile + admins to update any
DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
CREATE POLICY "Admins can update any profile" ON profiles
    FOR UPDATE USING (auth.uid() = id OR is_admin_user());

-- Allow users to insert their own profile
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- ── STEP 3: Vehicles RLS ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all vehicles" ON vehicles;
CREATE POLICY "Admins can view all vehicles" ON vehicles
    FOR SELECT USING (auth.uid() = owner_id OR is_admin_user() OR status = 'approved');

DROP POLICY IF EXISTS "Admins can update any vehicle" ON vehicles;
CREATE POLICY "Admins can update any vehicle" ON vehicles
    FOR UPDATE USING (auth.uid() = owner_id OR is_admin_user());

-- ── STEP 4: Bookings RLS ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all bookings" ON bookings;
CREATE POLICY "Admins can view all bookings" ON bookings
    FOR SELECT USING (
        auth.uid() = renter_id OR
        auth.uid() = owner_id OR
        is_admin_user()
    );

-- ── STEP 5: Create Storage Buckets ──────────────────────────────────────────
-- Create 'documents' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'documents',
    'documents',
    false,
    10485760,  -- 10MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
) ON CONFLICT (id) DO NOTHING;

-- Create 'selfies' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'selfies',
    'selfies',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
) ON CONFLICT (id) DO NOTHING;

-- ── STEP 6: Storage Policies ────────────────────────────────────────────────
-- Allow authenticated users to upload to their own folder in documents
DROP POLICY IF EXISTS "Users can upload own documents" ON storage.objects;
CREATE POLICY "Users can upload own documents" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'documents' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- Allow authenticated users to upload to their own folder in selfies
DROP POLICY IF EXISTS "Users can upload own selfies" ON storage.objects;
CREATE POLICY "Users can upload own selfies" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'selfies' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- Allow admins to read all documents
DROP POLICY IF EXISTS "Admins can read all documents" ON storage.objects;
CREATE POLICY "Admins can read all documents" ON storage.objects
    FOR SELECT USING (
        (bucket_id IN ('documents', 'selfies') AND is_admin_user()) OR
        (bucket_id IN ('documents', 'selfies') AND auth.uid()::text = (storage.foldername(name))[1])
    );

-- Allow overwrite (upsert) - users can re-upload
DROP POLICY IF EXISTS "Users can update own documents" ON storage.objects;
CREATE POLICY "Users can update own documents" ON storage.objects
    FOR UPDATE USING (
        bucket_id IN ('documents', 'selfies') AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- ── STEP 7: RPC functions for admin verification ─────────────────────────────
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

-- ── STEP 8: Add missing columns ──────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_by UUID;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ── STEP 9: Audit logs access ───────────────────────────────────────────────
DO $$ BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;
        CREATE POLICY "Admins can view audit logs" ON audit_logs
            FOR ALL USING (is_admin_user());
    END IF;
END $$;

-- ── DONE ─────────────────────────────────────────────────────────────────────
-- ✅ Profile save now works (UPDATE policy added)
-- ✅ Document upload now works (storage buckets + policies created)
-- ✅ Admin panel shows all users/vehicles/bookings (SELECT policies added)
-- ✅ Admin Submitted Documents section loads photos (storage read policy)
-- ✅ Verification toggle persists (RPC functions + admin UPDATE policy)
