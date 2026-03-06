-- Fix RLS for subscription updates
-- Drop the existing policy just in case it's too restrictive
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- Create a fresh, explicit policy allowing users to update their own row
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Ensure the subscription columns exist (they should, but just in case)
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free' CHECK (subscription_status IN ('free', 'active', 'expired')),
    ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS subscription_payment_id TEXT;

-- Verify RLS is enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
