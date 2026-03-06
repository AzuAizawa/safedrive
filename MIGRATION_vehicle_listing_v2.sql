-- =====================================================================
-- SafeDrive Migration: Vehicle Listing v2
-- Run this in your Supabase SQL Editor (Settings > SQL Editor)
-- =====================================================================

-- 1. Add new columns to the vehicles table
--    (IF NOT EXISTS prevents errors if run again)

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS pricing_type TEXT DEFAULT 'flexible' CHECK (pricing_type IN ('flexible', 'fixed')),
  ADD COLUMN IF NOT EXISTS fixed_price NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS fixed_rental_days INTEGER,
  ADD COLUMN IF NOT EXISTS contact_info TEXT,
  ADD COLUMN IF NOT EXISTS orcr_url TEXT;

-- 2. Backfill: set existing rows to 'flexible'
UPDATE vehicles SET pricing_type = 'flexible' WHERE pricing_type IS NULL;

-- 3. Make pricing_type NOT NULL after backfill
ALTER TABLE vehicles ALTER COLUMN pricing_type SET NOT NULL;

-- =====================================================================
-- Optional: Verify the columns were added
-- =====================================================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'vehicles'
-- ORDER BY ordinal_position;
