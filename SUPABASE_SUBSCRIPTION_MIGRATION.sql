-- ================================================
-- SafeDrive Subscription System Migration
-- Run this in Supabase SQL Editor
-- ================================================

-- 1. Add subscription columns to profiles table
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free' CHECK (subscription_status IN ('free', 'active', 'expired')),
    ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS subscription_payment_id TEXT;

-- 2. Add is_active_listing BOOLEAN to vehicles
--    (separate from is_available which tracks real-time booking availability)
ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS is_active_listing BOOLEAN DEFAULT TRUE;

-- 3. Create a view that auto-enforces subscription rules
--    (optional — mainly for reference, logic is handled in app code)

-- 4. Function to auto-expire subscriptions and deactivate excess listings
--    Call this via a Supabase Edge Function cron or scheduled function
CREATE OR REPLACE FUNCTION enforce_subscription_limits()
RETURNS void AS $$
DECLARE
    expired_user RECORD;
    first_vehicle UUID;
BEGIN
    -- Find users whose subscription has expired but status is still 'active'
    FOR expired_user IN
        SELECT id FROM profiles
        WHERE subscription_status = 'active'
        AND subscription_end_date < NOW()
    LOOP
        -- Update their status to 'expired'
        UPDATE profiles SET subscription_status = 'expired' WHERE id = expired_user.id;

        -- Find their oldest vehicle (first listed)
        SELECT id INTO first_vehicle FROM vehicles
        WHERE owner_id = expired_user.id
        ORDER BY created_at ASC
        LIMIT 1;

        -- Deactivate all their vehicles EXCEPT the oldest one
        IF first_vehicle IS NOT NULL THEN
            UPDATE vehicles
            SET is_active_listing = FALSE, is_available = FALSE
            WHERE owner_id = expired_user.id
            AND id != first_vehicle;

            -- Make sure the oldest one is active
            UPDATE vehicles
            SET is_active_listing = TRUE
            WHERE id = first_vehicle;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Index for fast subscription lookups
CREATE INDEX IF NOT EXISTS idx_profiles_subscription ON profiles(subscription_status, subscription_end_date);
CREATE INDEX IF NOT EXISTS idx_vehicles_owner_active ON vehicles(owner_id, is_active_listing);

-- 6. Add payment_status to bookings if not already present (from previous migration)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'not_applicable';

-- ================================================
-- NOTES:
-- • Run enforce_subscription_limits() daily via Supabase Edge Functions:
--   SELECT enforce_subscription_limits();
-- • is_active_listing = listing is publicly visible
-- • is_available = vehicle is currently available to be booked (time-based)
-- • Free users: only 1 vehicle can have is_active_listing = TRUE
-- • Premium users: all vehicles can be is_active_listing = TRUE
-- ================================================
