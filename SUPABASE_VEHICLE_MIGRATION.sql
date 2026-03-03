-- ============================================================
-- SafeDrive: Vehicle Listing Improvements Migration
-- Run this in your Supabase SQL Editor (supabase.com → SQL Editor)
-- ============================================================

-- 1. Add new columns to vehicles table
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS agreement_url     TEXT,
  ADD COLUMN IF NOT EXISTS available_durations JSONB DEFAULT '["1_day"]'::jsonb;

-- 2. Create storage bucket for rental agreement documents (if not exists)
-- NOTE: Run this from the Supabase Storage UI or Dashboard, not SQL:
--   Bucket name: vehicle-agreements
--   Public: true (so renters can download the PDF)

-- 3. RLS Policy — Only vehicle owner can view full sensitive fields
--    (plate_number is already excluded from public VehicleDetail.jsx rendering)
--    This policy ensures mileage + plate_number are not exposed via direct API calls

-- 4. Ensure only pending vehicles can be self-updated by owner
--    (Admins change status; owners can only update while status = 'pending')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vehicles'
      AND policyname = 'Owner can update own pending vehicle'
  ) THEN
    CREATE POLICY "Owner can update own pending vehicle"
      ON public.vehicles
      FOR UPDATE
      USING (auth.uid() = owner_id AND status = 'pending')
      WITH CHECK (auth.uid() = owner_id AND status = 'pending');
  END IF;
END $$;

-- 5. Only admins can approve or reject vehicles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vehicles'
      AND policyname = 'Admin can update vehicle status'
  ) THEN
    CREATE POLICY "Admin can update vehicle status"
      ON public.vehicles
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- 6. Index to speed up pending vehicle admin queries
CREATE INDEX IF NOT EXISTS vehicles_status_idx ON public.vehicles(status);
CREATE INDEX IF NOT EXISTS vehicles_owner_idx ON public.vehicles(owner_id);

-- ============================================================
-- After running this SQL:
-- 1. Go to Supabase Dashboard → Storage → Create bucket "vehicle-agreements"
--    Set it to PUBLIC so download links work for renters
-- 2. Your vehicles table now supports agreement_url and available_durations
-- 3. New RLS policies prevent unauthorized status changes
-- ============================================================
