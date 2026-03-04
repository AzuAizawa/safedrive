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

-- Verified users can INSERT a vehicle listing
DROP POLICY IF EXISTS "Verified users can list vehicles" ON vehicles;
CREATE POLICY "Verified users can list vehicles" ON vehicles
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL AND (
            EXISTS (
                SELECT 1 FROM profiles
                WHERE id = auth.uid()
                AND (role = 'verified' OR verification_status = 'verified')
            ) OR is_admin_user()
        )
    );

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

-- ── STEP 10: Vehicle image/agreement storage buckets ────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'vehicle-images', 'vehicle-images', true, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'vehicle-agreements', 'vehicle-agreements', false, 20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
) ON CONFLICT (id) DO NOTHING;

-- Storage policies for vehicle images (public read, owner write)
DROP POLICY IF EXISTS "Vehicle image upload" ON storage.objects;
CREATE POLICY "Vehicle image upload" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'vehicle-images' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Vehicle images public read" ON storage.objects;
CREATE POLICY "Vehicle images public read" ON storage.objects
    FOR SELECT USING (bucket_id = 'vehicle-images');

DROP POLICY IF EXISTS "Vehicle agreement upload" ON storage.objects;
CREATE POLICY "Vehicle agreement upload" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'vehicle-agreements' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Vehicle agreement read" ON storage.objects;
CREATE POLICY "Vehicle agreement read" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'vehicle-agreements' AND
        (is_admin_user() OR auth.uid()::text = (storage.foldername(name))[1])
    );

-- ── STEP 11: Notifications table (for approve/reject vehicle alerts to users) ───
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
CREATE POLICY "Users can read own notifications" ON notifications
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can mark own notifications read" ON notifications;
CREATE POLICY "Users can mark own notifications read" ON notifications
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can insert notifications" ON notifications;
CREATE POLICY "Admins can insert notifications" ON notifications
    FOR INSERT WITH CHECK (is_admin_user());

-- ── DONE ─────────────────────────────────────────────────────────────────────
-- ✅ Profile save now works (UPDATE policy added)
-- ✅ Document upload now works (storage buckets + policies created)
-- ✅ Vehicle photo/agreement upload now works (vehicle-images/agreements buckets)
-- ✅ Admin panel shows all users/vehicles/bookings (SELECT policies added)
-- ✅ Admin Submitted Documents section loads photos (storage read policy)
-- ✅ Verification toggle persists (RPC functions + admin UPDATE policy)
-- ✅ Approve/Reject notifications delivered to vehicle owner
