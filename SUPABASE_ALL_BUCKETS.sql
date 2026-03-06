-- SUPABASE STORAGE BUCKETS INITIALIZATION --
-- Run this in your Supabase SQL Editor to fix image and agreement upload errors

----------------------------------------------------------------------------------
-- 1. Create 'vehicle-images' Bucket
----------------------------------------------------------------------------------
insert into storage.buckets (id, name, public) 
values ('vehicle-images', 'vehicle-images', true)
on conflict (id) do nothing;

-- Allow public read access (so anyone viewing cars can see images)
create policy "Public Access to vehicle-images" 
on storage.objects for select 
using (bucket_id = 'vehicle-images');

-- Allow authenticated users to upload their own images
create policy "Authenticated Users can upload vehicle-images" 
on storage.objects for insert 
to authenticated
with check (bucket_id = 'vehicle-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to update/delete their own images
create policy "Users can update their own vehicle-images" 
on storage.objects for update 
to authenticated
using (bucket_id = 'vehicle-images' AND auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own vehicle-images" 
on storage.objects for delete 
to authenticated
using (bucket_id = 'vehicle-images' AND auth.uid()::text = (storage.foldername(name))[1]);


----------------------------------------------------------------------------------
-- 2. Create 'vehicle-agreements' Bucket
----------------------------------------------------------------------------------
insert into storage.buckets (id, name, public) 
values ('vehicle-agreements', 'vehicle-agreements', true)
on conflict (id) do nothing;

-- Allow public read access
create policy "Public Access to vehicle-agreements" 
on storage.objects for select 
using (bucket_id = 'vehicle-agreements');

-- Allow authenticated users to upload their own agreements
create policy "Authenticated Users can upload vehicle-agreements" 
on storage.objects for insert 
to authenticated
with check (bucket_id = 'vehicle-agreements' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to update/delete their own agreements
create policy "Users can update their own vehicle-agreements" 
on storage.objects for update 
to authenticated
using (bucket_id = 'vehicle-agreements' AND auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own vehicle-agreements" 
on storage.objects for delete 
to authenticated
using (bucket_id = 'vehicle-agreements' AND auth.uid()::text = (storage.foldername(name))[1]);

----------------------------------------------------------------------------------
-- ALL DONE! You should now be able to list vehicles properly.
----------------------------------------------------------------------------------
