-- ============================================================
-- SafeDrive: Subscription RLS Fix
-- Run this in Supabase SQL Editor to allow users to update
-- their own subscription status after payment.
-- ============================================================

-- Allow users to update their own subscription fields
-- (subscription_status and subscription_end_date)
-- This is needed for SubscriptionSuccess.jsx to work correctly.

DO $$
BEGIN
  -- Drop existing policy if it blocks subscription updates
  DROP POLICY IF EXISTS "Users can update own subscription" ON profiles;
  
  -- Create a permissive policy for subscription field updates
  CREATE POLICY "Users can update own subscription"
    ON profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
END $$;

-- Also ensure the storage buckets exist
-- Run each INSERT separately if needed
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('vehicle-images', 'vehicle-images', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/jpg']),
  ('vehicle-agreements', 'vehicle-agreements', true, 10485760, ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('documents', 'documents', false, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/jpg']),
  ('selfies', 'selfies', false, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/jpg'])
ON CONFLICT (id) DO NOTHING;

-- Public read policy for vehicle-images
DROP POLICY IF EXISTS "Public read vehicle-images" ON storage.objects;
CREATE POLICY "Public read vehicle-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'vehicle-images');

-- Public read policy for vehicle-agreements
DROP POLICY IF EXISTS "Public read vehicle-agreements" ON storage.objects;
CREATE POLICY "Public read vehicle-agreements"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'vehicle-agreements');

-- Authenticated users can upload to vehicle-images
DROP POLICY IF EXISTS "Auth upload vehicle-images" ON storage.objects;
CREATE POLICY "Auth upload vehicle-images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'vehicle-images' AND auth.role() = 'authenticated');

-- Authenticated users can upload to vehicle-agreements
DROP POLICY IF EXISTS "Auth upload vehicle-agreements" ON storage.objects;
CREATE POLICY "Auth upload vehicle-agreements"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'vehicle-agreements' AND auth.role() = 'authenticated');
