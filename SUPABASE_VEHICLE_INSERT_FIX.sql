-- ============================================================
-- SafeDrive: Vehicle Insert RLS Fix
-- Run this in Supabase SQL Editor to ensure users can list cars
-- ============================================================

DO $$
BEGIN
  -- Drop existing insert policy if it exists and is restrictive
  DROP POLICY IF EXISTS "Users can insert their own vehicles" ON vehicles;
  DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON vehicles;
  
  -- Create a permissive policy allowing users to insert a vehicle if they set themselves as owner
  CREATE POLICY "Users can insert their own vehicles"
    ON vehicles
    FOR INSERT
    WITH CHECK (auth.uid() = owner_id);

END $$;
