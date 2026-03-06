-- ============================================================
-- SafeDrive: Storage Bucket Fix
-- Bug: The `vehicle-agreements` bucket doesn't exist, causing 
-- vehicles with uploaded agreements to hang on submission.
-- ============================================================

-- Insert the storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-agreements', 'vehicle-agreements', true)
ON CONFLICT (id) DO NOTHING;

-- Grant public read access to the agreements
CREATE POLICY "Public can view rental agreements" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'vehicle-agreements');

-- Allow authenticated users to upload their own agreements
CREATE POLICY "Users can upload their own rental agreements" 
ON storage.objects FOR INSERT 
WITH CHECK (
    bucket_id = 'vehicle-agreements' 
    AND auth.role() = 'authenticated'
);

-- Allow users to update/delete their own agreements
CREATE POLICY "Users can update their own rental agreements" 
ON storage.objects FOR UPDATE 
WITH CHECK (
    bucket_id = 'vehicle-agreements' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own rental agreements" 
ON storage.objects FOR DELETE 
USING (
    bucket_id = 'vehicle-agreements' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);
