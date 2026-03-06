-- This script adds the missing RLS policies to allow the auto-creation of rental agreements.
-- Often, whichever user clicks "Agreement" first (owner or renter) triggers the INSERT.
-- Therefore, both the owner and the renter need INSERT usage for their own bookings.

BEGIN;

-- Ensure the rental_agreements table has RLS enabled
ALTER TABLE public.rental_agreements ENABLE ROW LEVEL SECURITY;

-- 1. Anyone involved in the booking (owner or renter) can view the agreement
DROP POLICY IF EXISTS "Participants can view their agreements" ON public.rental_agreements;
CREATE POLICY "Participants can view their agreements" 
ON public.rental_agreements FOR SELECT
USING (auth.uid() = owner_id OR auth.uid() = renter_id);

-- 2. Anyone involved in the booking can INSERT (auto-create) the agreement
DROP POLICY IF EXISTS "Participants can insert agreements" ON public.rental_agreements;
CREATE POLICY "Participants can insert agreements" 
ON public.rental_agreements FOR INSERT
WITH CHECK (auth.uid() = owner_id OR auth.uid() = renter_id);

-- 3. Anyone involved in the booking can UPDATE the agreement (to sign it)
DROP POLICY IF EXISTS "Participants can update agreements" ON public.rental_agreements;
CREATE POLICY "Participants can update agreements" 
ON public.rental_agreements FOR UPDATE
USING (auth.uid() = owner_id OR auth.uid() = renter_id);

COMMIT;
