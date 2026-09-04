-- ============================================================================
-- SAFEDRIVE 2.0 - CHAPTERED DATABASE MASTER REFERENCE
-- Consolidated: 2026-07-27
-- ============================================================================
--
-- IMPORTANT: THIS IS A REFERENCE ARCHIVE, NOT ONE TOP-TO-BOTTOM MIGRATION.
-- Chapter 1 contains historical reset/repair/cleanup/seed material for different
-- database states. Never run the entire file blindly. Back up first, use staging,
-- read the selected chapter prerequisites, and apply only the required chapter.
-- The original standalone SQL files were removed only after their full text and
-- SHA-256 hashes were verified against the chapters below. Each chapter retains
-- its original source label and hash so its provenance can still be audited.
--
-- CURRENT JUNE-JULY APPLY ORDER:
--  3. 2026-06-15 arrival location evidence
--  4. 2026-06-17 financial integrity hardening
--  5. 2026-06-18 booking overlap constraint
--  6. 2026-06-18 payout uniqueness guard
--  7. 2026-06-26 payment webhook idempotency guard
--  8. 2026-06-26 subscription active uniqueness guard
--  9. 2026-07-16 vehicle and KYC access hardening
-- 10. 2026-07-22 guest inquiries
-- 11. 2026-07-22 private sensitive storage
-- 12. 2026-07-22 trusted user audit triggers
-- 13. 2026-07-22 support message notifications
-- 14. Operations, agreements, deposits, retention, ledger, and reconciliation
-- 15. Authenticated service fallbacks for inquiries and privacy requests
-- 16. Read-only post-migration verification
-- 17. 2026-08-31 security and integrity hardening (payments RLS, PII key guard)

-- ============================================================================
-- CHAPTER 1 - SOURCE: database_scripts/MASTER LIST.sql
-- SOURCE SHA256: 55113067887c08cadd6ea2dd31408abd15f7a1652622fb3a91fa94bc5612f33e
-- ============================================================================

-- SafeDrive Master Database Script Archive
-- Generated: 2026-05-15 19:57:29
--
-- This file consolidates the previous database_scripts files into one master SQL file.
-- It is meant to preserve the scripts in one place.
-- Do not blindly run the entire file top-to-bottom in production.
-- Instead, use the section headers below and run only the section that matches your task.
--
-- Table of Contents
-- 1. README.md
-- 2. final_full_reset_schema.sql
-- 3. final_schema_alignment.sql
-- 4. repair_api_grants_and_login_rls.sql
-- 5. harden_booking_state_updates.sql
-- 6. allow_booking_counterparty_profile_reads.sql
-- 7. add_login_block_controls.sql
-- 8. fix_pii_encryption_null_key.sql
-- 9. fix_notification_insert_policy.sql
-- 10. add_ticket_message_attachments.sql
-- 11. add_car_fuel_detail_columns.sql
-- 12. remove_secondary_id_number.sql
-- 13. add_platform_settings_and_vehicle_gps.sql
-- 14. add_booking_extensions.sql
-- 15. enable_expired_booking_extensions.sql
-- 16. enforce_supported_payout_methods.sql
-- 17. flush_all_except_selected_accounts.sql
-- 18. sample_car_catalog_seed.sql

-- ============================================================================
-- 1. README.md
-- ============================================================================

-- # SafeDrive Database Scripts
--
-- Use only these current scripts.
--
-- ## 1. Full clean reset
--
-- Run this only when you intentionally want to wipe and rebuild SafeDrive public tables:
--
-- ```text
-- final_full_reset_schema.sql
-- ```
--
-- After a reset, existing Supabase Auth users remain, but public profile rows are recreated only when users log in or when you insert them manually.
--
-- ## 2. Existing database alignment
--
-- Run this when the database already has data and you only need the latest columns, RLS policies, grants, and constraints:
--
-- ```text
-- final_schema_alignment.sql
-- ```
--
-- ## 3. Login/grants repair
--
-- Run this if login works but the app shows errors like `permission denied for table profiles`:
--
-- ```text
-- repair_api_grants_and_login_rls.sql
-- ```
--
-- ## Restore a super admin
--
-- Replace the email and run this manually after a reset if needed:
--
-- ```sql
-- insert into public.profiles (id, email, full_name, role, verified_status, is_lister, deleted_at)
-- select id, email, email, 'super_admin', 'verified', false, null
-- from auth.users
-- where lower(email) = lower('YOUR_EMAIL_HERE')
-- on conflict (id) do update
-- set role = 'super_admin',
--     verified_status = 'verified',
--     deleted_at = null,
--     updated_at = now();
-- ```
--

-- ============================================================================
-- 2. final_full_reset_schema.sql
-- ============================================================================

-- SafeDrive 2.0 Final Full Reset Schema
-- WARNING: This script drops the current SafeDrive tables in the public schema
-- and recreates the finalized database design from scratch.
-- Use this only if you want a clean reset.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS public.ticket_messages CASCADE;
DROP TABLE IF EXISTS public.support_tickets CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.security_logs CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.booking_reviews CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.bookings CASCADE;
DROP TABLE IF EXISTS public.car_documents CASCADE;
DROP TABLE IF EXISTS public.car_images CASCADE;
DROP TABLE IF EXISTS public.car_renewals CASCADE;
DROP TABLE IF EXISTS public.cars CASCADE;
DROP TABLE IF EXISTS public.car_models CASCADE;
DROP TABLE IF EXISTS public.car_brands CASCADE;
DROP TABLE IF EXISTS public.verification_images CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Drop helper functions so the fresh definitions below are authoritative
DROP FUNCTION IF EXISTS public.handle_pii_encryption() CASCADE;
DROP FUNCTION IF EXISTS public.encrypt_pii(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.decrypt_pii(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;

-- 1. Profiles
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  phone TEXT,
  secondary_phone TEXT,
  address TEXT,
  birthday DATE,
  driver_license TEXT,
  national_id TEXT,
  secondary_id_type TEXT,
  verified_status TEXT DEFAULT 'unverified'
    CHECK (verified_status IN ('unverified', 'pending', 'verified', 'rejected')),
  role TEXT DEFAULT 'user'
    CHECK (role IN ('user', 'admin', 'super_admin')),
  is_lister BOOLEAN DEFAULT false,
  rejection_reason TEXT,
  avatar_url TEXT,
  gender TEXT,
  payout_method TEXT
    CHECK (payout_method IS NULL OR payout_method IN ('GCash', 'Maya')),
  payout_account_name TEXT,
  payout_account_number TEXT,
  emergency_contact_number TEXT,
  login_blocked_until TIMESTAMP WITH TIME ZONE,
  login_block_reason TEXT,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Encryption helpers for PII fields
CREATE OR REPLACE FUNCTION public.encrypt_pii(content TEXT) RETURNS TEXT AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  IF content IS NULL THEN
    RETURN NULL;
  END IF;
  IF content LIKE 'pgp:%' THEN
    RETURN content;
  END IF;

  encryption_key := COALESCE(
    NULLIF(current_setting('app.settings.encryption_key', true), ''),
    'safedrive-dev-secret-key-fallback'
  );

  RETURN 'pgp:' || encode(
    pgp_sym_encrypt(content, encryption_key),
    'base64'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.decrypt_pii(encrypted_content TEXT) RETURNS TEXT AS $$
DECLARE
  raw_base64 TEXT;
  encryption_key TEXT;
BEGIN
  IF encrypted_content IS NULL THEN
    RETURN NULL;
  END IF;
  IF encrypted_content NOT LIKE 'pgp:%' THEN
    RETURN encrypted_content;
  END IF;

  raw_base64 := substring(encrypted_content FROM 5);
  encryption_key := COALESCE(
    NULLIF(current_setting('app.settings.encryption_key', true), ''),
    'safedrive-dev-secret-key-fallback'
  );

  RETURN pgp_sym_decrypt(
    decode(raw_base64, 'base64'),
    encryption_key
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_pii_encryption() RETURNS trigger AS $$
BEGIN
  IF NEW.driver_license IS NOT NULL THEN
    NEW.driver_license := public.encrypt_pii(NEW.driver_license);
  END IF;
  IF NEW.national_id IS NOT NULL THEN
    NEW.national_id := public.encrypt_pii(NEW.national_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_pii_encrypt
  BEFORE INSERT OR UPDATE OF driver_license, national_id
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_pii_encryption();

CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  privileged BOOLEAN;
BEGIN
  privileged := public.is_admin()
    OR current_user IN ('postgres', 'service_role', 'supabase_admin');

  IF privileged THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> OLD.id THEN
    RAISE EXCEPTION 'Only the owning user or an admin can update this profile';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Users cannot change their own role';
  END IF;

  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'Users cannot change verification rejection reasons';
  END IF;

  IF NEW.login_blocked_until IS DISTINCT FROM OLD.login_blocked_until
     OR NEW.login_block_reason IS DISTINCT FROM OLD.login_block_reason THEN
    RAISE EXCEPTION 'Users cannot change login block settings';
  END IF;

  IF NEW.verified_status IS DISTINCT FROM OLD.verified_status THEN
    IF NOT (
      OLD.verified_status IN ('unverified', 'rejected')
      AND NEW.verified_status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Users cannot self-approve or directly change verification status';
    END IF;
  END IF;

  IF OLD.verified_status = 'verified' AND (
    NEW.first_name IS DISTINCT FROM OLD.first_name
    OR NEW.middle_name IS DISTINCT FROM OLD.middle_name
    OR NEW.last_name IS DISTINCT FROM OLD.last_name
    OR NEW.full_name IS DISTINCT FROM OLD.full_name
    OR NEW.birthday IS DISTINCT FROM OLD.birthday
    OR NEW.driver_license IS DISTINCT FROM OLD.driver_license
    OR NEW.national_id IS DISTINCT FROM OLD.national_id
    OR NEW.secondary_id_type IS DISTINCT FROM OLD.secondary_id_type
  ) THEN
    RAISE EXCEPTION 'Verified identity fields require admin review to change';
  END IF;

  IF NEW.is_lister IS DISTINCT FROM OLD.is_lister
     AND OLD.verified_status <> 'verified' THEN
    RAISE EXCEPTION 'Only verified users can change lister mode';
  END IF;

  IF OLD.deleted_at IS NOT NULL
     AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'Deleted profiles cannot be reactivated by the user';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_profile_sensitive_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_sensitive_fields();

-- 2. Verification Images
CREATE TABLE public.verification_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  image_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  provenance_status TEXT NOT NULL DEFAULT 'unknown' CHECK (provenance_status IN ('unknown', 'credential_present', 'credential_missing', 'credential_invalid')),
  provenance_source TEXT,
  provenance_summary TEXT,
  ai_suspicion_score NUMERIC CHECK (ai_suspicion_score IS NULL OR (ai_suspicion_score >= 0 AND ai_suspicion_score <= 1)),
  ai_detector_name TEXT,
  ai_detector_version TEXT,
  review_flag TEXT NOT NULL DEFAULT 'none' CHECK (review_flag IN ('none', 'needs_admin_review', 'approved_after_review', 'rejected_after_review')),
  review_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Car Brands
CREATE TABLE public.car_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Car Models
CREATE TABLE public.car_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES public.car_brands(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  body_type TEXT NOT NULL,
  seats INTEGER DEFAULT 4 NOT NULL,
  fuel_type TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Cars
CREATE TABLE public.cars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  model_id UUID REFERENCES public.car_models(id) NOT NULL,
  plate_number TEXT UNIQUE NOT NULL,
  mileage INTEGER,
  price_per_day NUMERIC NOT NULL,
  location TEXT,
  fuel_category TEXT,
  fuel_subtype TEXT,
  additional_info TEXT,
  contact_number TEXT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'active', 'inactive', 'renewal_required')),
  rejection_reason TEXT,
  last_verified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Car Renewals
CREATE TABLE public.car_renewals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID REFERENCES public.cars(id) ON DELETE CASCADE NOT NULL,
  lister_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  orcr_document_path TEXT NOT NULL,
  lto_receipt_path TEXT NOT NULL,
  mvir_path TEXT NOT NULL,
  emission_test_path TEXT NOT NULL,
  updated_car_photos_path TEXT NOT NULL,
  current_mileage NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP WITH TIME ZONE
);

-- 7. Car Images
CREATE TABLE public.car_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID REFERENCES public.cars(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Car Documents
CREATE TABLE public.car_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID REFERENCES public.cars(id) ON DELETE CASCADE NOT NULL,
  document_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  provenance_status TEXT NOT NULL DEFAULT 'unknown' CHECK (provenance_status IN ('unknown', 'credential_present', 'credential_missing', 'credential_invalid')),
  provenance_source TEXT,
  provenance_summary TEXT,
  ai_suspicion_score NUMERIC CHECK (ai_suspicion_score IS NULL OR (ai_suspicion_score >= 0 AND ai_suspicion_score <= 1)),
  ai_detector_name TEXT,
  ai_detector_version TEXT,
  review_flag TEXT NOT NULL DEFAULT 'none' CHECK (review_flag IN ('none', 'needs_admin_review', 'approved_after_review', 'rejected_after_review')),
  review_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Bookings
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID REFERENCES public.cars(id) NOT NULL,
  renter_id UUID REFERENCES public.profiles(id) NOT NULL,
  owner_id UUID REFERENCES public.profiles(id) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days INTEGER NOT NULL,
  base_price NUMERIC NOT NULL,
  commission NUMERIC NOT NULL,
  total_price NUMERIC NOT NULL,
  downpayment_amount NUMERIC NOT NULL,
  balance_amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'rejected', 'awaiting_payment', 'downpayment_paid', 'active', 'fully_paid')),
  owner_response_deadline TIMESTAMP WITH TIME ZONE,
  payment_deadline TIMESTAMP WITH TIME ZONE,
  paymongo_checkout_id TEXT,
  paymongo_balance_checkout_id TEXT,
  renter_completed BOOLEAN DEFAULT false,
  owner_completed BOOLEAN DEFAULT false,
  pickup_time TEXT,
  dropoff_time TEXT,
  lister_arrived_at TIMESTAMP WITH TIME ZONE,
  renter_arrived_at TIMESTAMP WITH TIME ZONE,
  lister_arrival_photo_url TEXT,
  renter_arrival_photo_url TEXT,
  lister_arrival_latitude NUMERIC(9,6),
  lister_arrival_longitude NUMERIC(9,6),
  lister_arrival_accuracy_meters NUMERIC,
  lister_arrival_location_captured_at TIMESTAMP WITH TIME ZONE,
  renter_arrival_latitude NUMERIC(9,6),
  renter_arrival_longitude NUMERIC(9,6),
  renter_arrival_accuracy_meters NUMERIC,
  renter_arrival_location_captured_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Payments
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.bookings(id) NOT NULL,
  amount NUMERIC NOT NULL,
  payment_type TEXT NOT NULL
    CHECK (payment_type IN ('downpayment', 'balance', 'extension', 'security_deposit', 'refund', 'payout')),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'completed')),
  transaction_id TEXT,
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Audit Log
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. Security Logs
CREATE TABLE public.security_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'login_success',
      'login_failed',
      'logout',
      'otp_sent',
      'otp_verified',
      'otp_failed',
      'authenticator_challenge_started',
      'authenticator_verified',
      'authenticator_failed',
      'lockout_started',
      'lockout_ended',
      'password_changed',
      'password_reset_requested',
      'password_reset_completed',
      'session_timeout',
      'suspicious_activity',
      'webhook_signature_verified',
      'webhook_signature_failed'
    )),
  auth_method TEXT
    CHECK (auth_method IN ('password', 'email_otp', 'authenticator', 'recovery_code', 'support_recovery')),
  status TEXT NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failed', 'info')),
  ip_address INET,
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. Booking Reviews
CREATE TABLE public.booking_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  car_id UUID NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role IN ('renter', 'owner')),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (booking_id, reviewer_id)
);

-- 14. Subscriptions
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  plan_type TEXT NOT NULL,
  additional_slots INTEGER NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'cancelled')),
  provider_checkout_id TEXT,
  provider_payment_id TEXT,
  amount_centavos BIGINT CHECK (amount_centavos IS NULL OR amount_centavos > 0),
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  read BOOLEAN DEFAULT false,
  link TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 16. Support Tickets
CREATE TABLE public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  participant_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  tag TEXT DEFAULT 'general',
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 17. Ticket Messages
CREATE TABLE public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  message TEXT NOT NULL,
  attachment_name TEXT,
  attachment_mime_type TEXT,
  attachment_storage_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_support_tickets_tag
  ON public.support_tickets(tag);

CREATE INDEX idx_support_tickets_booking_id
  ON public.support_tickets(booking_id);

CREATE INDEX idx_support_tickets_participant_user_id
  ON public.support_tickets(participant_user_id);

CREATE INDEX idx_security_logs_user_id
  ON public.security_logs(user_id);

CREATE INDEX idx_security_logs_event_type
  ON public.security_logs(event_type);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Helper function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
      AND deleted_at IS NULL
  );
END;
$$;

-- Profiles policies
CREATE POLICY "Users can read own profile" ON public.profiles
FOR SELECT USING (
  auth.uid() = id
  OR public.is_admin()
);

CREATE POLICY "Booking participants can read counterparty profile" ON public.profiles
FOR SELECT USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE (
      (b.renter_id = auth.uid() AND b.owner_id = profiles.id)
      OR (b.owner_id = auth.uid() AND b.renter_id = profiles.id)
    )
  )
);

CREATE POLICY "Users can insert own profile" ON public.profiles
FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can update any profile" ON public.profiles
FOR UPDATE USING (public.is_admin());

-- Verification images policies
CREATE POLICY "Users can manage own verification images" ON public.verification_images
FOR ALL USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Booking participants can read meetup verification images" ON public.verification_images
FOR SELECT USING (
  public.is_admin()
  OR (
    image_type IN ('selfie', 'selfie_with_id')
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE (
        (b.renter_id = verification_images.user_id AND b.owner_id = auth.uid())
        OR (b.owner_id = verification_images.user_id AND b.renter_id = auth.uid())
      )
    )
  )
);

-- Catalog policies
CREATE POLICY "Catalog read access brands" ON public.car_brands
FOR SELECT USING (true);

CREATE POLICY "Catalog write access brands" ON public.car_brands
FOR ALL USING (public.is_admin());

CREATE POLICY "Catalog read access models" ON public.car_models
FOR SELECT USING (true);

CREATE POLICY "Catalog write access models" ON public.car_models
FOR ALL USING (public.is_admin());

-- Cars policies
CREATE POLICY "Cars read access" ON public.cars
FOR SELECT USING (true);

CREATE POLICY "Owners can insert cars" ON public.cars
FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update own cars" ON public.cars
FOR UPDATE USING (auth.uid() = owner_id OR public.is_admin());

CREATE POLICY "Owners can delete own cars" ON public.cars
FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY "Admins can delete cars" ON public.cars
FOR DELETE USING (public.is_admin());

-- Car renewals policies
CREATE POLICY "Listers see own renewals" ON public.car_renewals
FOR SELECT USING (auth.uid() = lister_id OR public.is_admin());

CREATE POLICY "Listers can insert renewals" ON public.car_renewals
FOR INSERT WITH CHECK (auth.uid() = lister_id);

CREATE POLICY "Admins can update renewals" ON public.car_renewals
FOR UPDATE USING (public.is_admin());

-- Car images policies
CREATE POLICY "Car images read access" ON public.car_images
FOR SELECT USING (true);

CREATE POLICY "Owners can manage car images" ON public.car_images
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM public.cars
    WHERE id = car_images.car_id
      AND owner_id = auth.uid()
  )
  OR public.is_admin()
);

-- Car documents policies
CREATE POLICY "Owners and admins see car documents" ON public.car_documents
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.cars
    WHERE id = car_documents.car_id
      AND owner_id = auth.uid()
  )
  OR public.is_admin()
);

CREATE POLICY "Owners can insert car documents" ON public.car_documents
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cars
    WHERE id = car_documents.car_id
      AND owner_id = auth.uid()
  )
);

-- Booking policies
CREATE POLICY "Participants see bookings" ON public.bookings
FOR SELECT USING (
  auth.uid() = renter_id
  OR auth.uid() = owner_id
  OR public.is_admin()
);

CREATE POLICY "Renters can create bookings" ON public.bookings
FOR INSERT WITH CHECK (auth.uid() = renter_id);

CREATE POLICY "Admins can update bookings" ON public.bookings
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Payment policies
CREATE POLICY "Participants see payments" ON public.payments
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE id = payments.booking_id
      AND (renter_id = auth.uid() OR owner_id = auth.uid())
  )
  OR public.is_admin()
);

CREATE POLICY "Participants insert payments" ON public.payments
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE id = payments.booking_id
      AND (renter_id = auth.uid() OR owner_id = auth.uid())
  )
  OR public.is_admin()
);

CREATE POLICY "Admins update payments" ON public.payments
FOR UPDATE USING (public.is_admin());

-- Audit and security log policies
CREATE POLICY "Admin read audit log" ON public.audit_log
FOR SELECT USING (public.is_admin());

CREATE POLICY "System insert audit log" ON public.audit_log
FOR INSERT WITH CHECK (true);

CREATE POLICY "Admin read security logs" ON public.security_logs
FOR SELECT USING (public.is_admin());

CREATE POLICY "System insert security logs" ON public.security_logs
FOR INSERT WITH CHECK (true);

-- Review policies
CREATE POLICY "Participants can create booking reviews" ON public.booking_reviews
FOR INSERT WITH CHECK (
  auth.uid() = reviewer_id
  AND EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = booking_reviews.booking_id
      AND b.status = 'completed'
      AND (b.renter_id = auth.uid() OR b.owner_id = auth.uid())
  )
);

CREATE POLICY "Participants and admins can read booking reviews" ON public.booking_reviews
FOR SELECT USING (
  public.is_admin()
  OR auth.uid() = reviewer_id
  OR auth.uid() = reviewee_id
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = booking_reviews.booking_id
      AND (
        b.status = 'completed'
        OR b.renter_id = auth.uid()
        OR b.owner_id = auth.uid()
      )
  )
);

-- Subscription policies
CREATE POLICY "Users see own subscriptions" ON public.subscriptions
FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Admins manage subscriptions" ON public.subscriptions
FOR ALL USING (public.is_admin());

-- Notification policies
CREATE POLICY "Users read own notifications" ON public.notifications
FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Users update own notifications" ON public.notifications
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert notifications" ON public.notifications
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Support ticket policies
CREATE POLICY "Users can create own tickets" ON public.support_tickets
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can create tickets for users" ON public.support_tickets
FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Users and admins can read tickets" ON public.support_tickets
FOR SELECT USING (
  auth.uid() = user_id
  OR auth.uid() = participant_user_id
  OR public.is_admin()
);

CREATE POLICY "Admins can update tickets" ON public.support_tickets
FOR UPDATE USING (public.is_admin());

CREATE POLICY "Users and admins can create ticket messages" ON public.ticket_messages
FOR INSERT WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1
    FROM public.support_tickets
    WHERE id = ticket_messages.ticket_id
      AND (
        user_id = auth.uid()
        OR participant_user_id = auth.uid()
        OR public.is_admin()
      )
  )
);

CREATE POLICY "Users and admins can read ticket messages" ON public.ticket_messages
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.support_tickets
    WHERE id = ticket_messages.ticket_id
      AND (
        user_id = auth.uid()
        OR participant_user_id = auth.uid()
        OR public.is_admin()
      )
  )
);

-- Optional starter catalog data
INSERT INTO public.car_brands (name)
VALUES ('Toyota'), ('Honda'), ('Mitsubishi'), ('Nissan')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 3. final_schema_alignment.sql
-- ============================================================================

-- SafeDrive final schema alignment for the current capstone version.
-- Run this on an existing database that was created before the final schema cleanup.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS secondary_phone TEXT,
ADD COLUMN IF NOT EXISTS secondary_id_type TEXT,
ADD COLUMN IF NOT EXISTS gender TEXT,
ADD COLUMN IF NOT EXISTS payout_method TEXT,
ADD COLUMN IF NOT EXISTS payout_account_name TEXT,
ADD COLUMN IF NOT EXISTS payout_account_number TEXT,
ADD COLUMN IF NOT EXISTS emergency_contact_number TEXT,
ADD COLUMN IF NOT EXISTS login_blocked_until TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS login_block_reason TEXT,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'admin', 'super_admin'));

UPDATE public.profiles
SET
  payout_method = NULL,
  payout_account_name = NULL,
  payout_account_number = NULL
WHERE payout_method IS NOT NULL
  AND payout_method NOT IN ('GCash', 'Maya');

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_payout_method_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_payout_method_check
  CHECK (payout_method IS NULL OR payout_method IN ('GCash', 'Maya'));

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
      AND deleted_at IS NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.encrypt_pii(content TEXT) RETURNS TEXT AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  IF content IS NULL THEN
    RETURN NULL;
  END IF;
  IF content LIKE 'pgp:%' THEN
    RETURN content;
  END IF;

  encryption_key := COALESCE(
    NULLIF(current_setting('app.settings.encryption_key', true), ''),
    'safedrive-dev-secret-key-fallback'
  );

  RETURN 'pgp:' || encode(
    pgp_sym_encrypt(content, encryption_key),
    'base64'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.decrypt_pii(encrypted_content TEXT) RETURNS TEXT AS $$
DECLARE
  raw_base64 TEXT;
  encryption_key TEXT;
BEGIN
  IF encrypted_content IS NULL THEN
    RETURN NULL;
  END IF;
  IF encrypted_content NOT LIKE 'pgp:%' THEN
    RETURN encrypted_content;
  END IF;

  raw_base64 := substring(encrypted_content FROM 5);
  encryption_key := COALESCE(
    NULLIF(current_setting('app.settings.encryption_key', true), ''),
    'safedrive-dev-secret-key-fallback'
  );

  RETURN pgp_sym_decrypt(
    decode(raw_base64, 'base64'),
    encryption_key
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_pii_encryption() RETURNS trigger AS $$
BEGIN
  IF NEW.driver_license IS NOT NULL THEN
     NEW.driver_license := public.encrypt_pii(NEW.driver_license);
  END IF;
  IF NEW.national_id IS NOT NULL THEN
     NEW.national_id := public.encrypt_pii(NEW.national_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS on_pii_encrypt ON public.profiles;
CREATE TRIGGER on_pii_encrypt
  BEFORE INSERT OR UPDATE OF driver_license, national_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_pii_encryption();

CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  privileged BOOLEAN;
BEGIN
  privileged := public.is_admin()
    OR current_user IN ('postgres', 'service_role', 'supabase_admin');

  IF privileged THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> OLD.id THEN
    RAISE EXCEPTION 'Only the owning user or an admin can update this profile';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Users cannot change their own role';
  END IF;

  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'Users cannot change verification rejection reasons';
  END IF;

  IF NEW.login_blocked_until IS DISTINCT FROM OLD.login_blocked_until
     OR NEW.login_block_reason IS DISTINCT FROM OLD.login_block_reason THEN
    RAISE EXCEPTION 'Users cannot change login block settings';
  END IF;

  IF NEW.verified_status IS DISTINCT FROM OLD.verified_status THEN
    IF NOT (
      OLD.verified_status IN ('unverified', 'rejected')
      AND NEW.verified_status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Users cannot self-approve or directly change verification status';
    END IF;
  END IF;

  IF OLD.verified_status = 'verified' AND (
    NEW.first_name IS DISTINCT FROM OLD.first_name
    OR NEW.middle_name IS DISTINCT FROM OLD.middle_name
    OR NEW.last_name IS DISTINCT FROM OLD.last_name
    OR NEW.full_name IS DISTINCT FROM OLD.full_name
    OR NEW.birthday IS DISTINCT FROM OLD.birthday
    OR NEW.driver_license IS DISTINCT FROM OLD.driver_license
    OR NEW.national_id IS DISTINCT FROM OLD.national_id
    OR NEW.secondary_id_type IS DISTINCT FROM OLD.secondary_id_type
  ) THEN
    RAISE EXCEPTION 'Verified identity fields require admin review to change';
  END IF;

  IF NEW.is_lister IS DISTINCT FROM OLD.is_lister
     AND OLD.verified_status <> 'verified' THEN
    RAISE EXCEPTION 'Only verified users can change lister mode';
  END IF;

  IF OLD.deleted_at IS NOT NULL
     AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'Deleted profiles cannot be reactivated by the user';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_sensitive_fields ON public.profiles;
CREATE TRIGGER protect_profile_sensitive_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_sensitive_fields();

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS pickup_time TEXT,
ADD COLUMN IF NOT EXISTS dropoff_time TEXT,
ADD COLUMN IF NOT EXISTS lister_arrived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS renter_arrived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS lister_arrival_photo_url TEXT,
ADD COLUMN IF NOT EXISTS renter_arrival_photo_url TEXT,
ADD COLUMN IF NOT EXISTS lister_arrival_latitude NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS lister_arrival_longitude NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS lister_arrival_accuracy_meters NUMERIC,
ADD COLUMN IF NOT EXISTS lister_arrival_location_captured_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS renter_arrival_latitude NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS renter_arrival_longitude NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS renter_arrival_accuracy_meters NUMERIC,
ADD COLUMN IF NOT EXISTS renter_arrival_location_captured_at TIMESTAMPTZ;

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can update bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can update bookings" ON public.bookings;
CREATE POLICY "Admins can update bookings" ON public.bookings
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.security_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'login_success',
      'login_failed',
      'logout',
      'otp_sent',
      'otp_verified',
      'otp_failed',
      'authenticator_challenge_started',
      'authenticator_verified',
      'authenticator_failed',
      'lockout_started',
      'lockout_ended',
      'password_changed',
      'password_reset_requested',
      'password_reset_completed',
      'suspicious_activity',
      'webhook_signature_verified',
      'webhook_signature_failed'
    )
  ),
  auth_method TEXT CHECK (auth_method IN ('password', 'email_otp', 'authenticator', 'recovery_code', 'support_recovery')),
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'info')),
  ip_address INET,
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.security_logs
DROP CONSTRAINT IF EXISTS security_logs_event_type_check;

ALTER TABLE public.security_logs
ADD CONSTRAINT security_logs_event_type_check
CHECK (
  event_type IN (
    'login_success',
    'login_failed',
    'logout',
    'otp_sent',
    'otp_verified',
    'otp_failed',
    'authenticator_challenge_started',
    'authenticator_verified',
    'authenticator_failed',
    'lockout_started',
    'lockout_ended',
    'password_changed',
    'password_reset_requested',
    'password_reset_completed',
    'session_timeout',
    'suspicious_activity',
    'webhook_signature_verified',
    'webhook_signature_failed'
  )
);

DROP POLICY IF EXISTS "Admin read security logs" ON public.security_logs;
CREATE POLICY "Admin read security logs" ON public.security_logs
FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "System insert security logs" ON public.security_logs;
CREATE POLICY "System insert security logs" ON public.security_logs
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
FOR SELECT USING (
  auth.uid() = id
  OR public.is_admin()
);

DROP POLICY IF EXISTS "Booking participants can read counterparty profile" ON public.profiles;
CREATE POLICY "Booking participants can read counterparty profile" ON public.profiles
FOR SELECT USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE (
      (b.renter_id = auth.uid() AND b.owner_id = profiles.id)
      OR (b.owner_id = auth.uid() AND b.renter_id = profiles.id)
    )
  )
);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile" ON public.profiles
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Booking participants can read meetup verification images" ON public.verification_images;
CREATE POLICY "Booking participants can read meetup verification images" ON public.verification_images
FOR SELECT USING (
  public.is_admin()
  OR (
    image_type IN ('selfie', 'selfie_with_id')
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE (
        (b.renter_id = verification_images.user_id AND b.owner_id = auth.uid())
        OR (b.owner_id = verification_images.user_id AND b.renter_id = auth.uid())
      )
    )
  )
);

ALTER TABLE public.support_tickets
ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.support_tickets
DROP CONSTRAINT IF EXISTS support_tickets_status_check;

ALTER TABLE public.support_tickets
ADD CONSTRAINT support_tickets_status_check
CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'));

ALTER TABLE public.support_tickets
ALTER COLUMN status SET DEFAULT 'open';

ALTER TABLE public.ticket_messages
ADD COLUMN IF NOT EXISTS attachment_name TEXT,
ADD COLUMN IF NOT EXISTS attachment_mime_type TEXT,
ADD COLUMN IF NOT EXISTS attachment_storage_path TEXT;

ALTER TABLE public.cars
ADD COLUMN IF NOT EXISTS fuel_category TEXT,
ADD COLUMN IF NOT EXISTS fuel_subtype TEXT;

DROP POLICY IF EXISTS "Users manage own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

CREATE POLICY "Users read own notifications" ON public.notifications
FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Users update own notifications" ON public.notifications
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert notifications" ON public.notifications
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);


-- ============================================================================
-- 4. repair_api_grants_and_login_rls.sql
-- ============================================================================

-- SafeDrive repair for login failures after rebuilding/resetting public tables.
--
-- Current symptom:
--   Admin profile check failed: permission denied for table profiles
--
-- Real cause:
--   The public tables were recreated, but Supabase API roles were not granted
--   table privileges. RLS policies are not enough by themselves; PostgREST first
--   requires GRANT privileges for anon/authenticated roles.
--
-- Run this whole file once in Supabase SQL Editor.

-- 1. Let Supabase API roles use the public schema.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Restore table privileges expected by the Supabase client.
-- RLS still controls which rows each user can access.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 3. Make future tables/functions inherit the same Supabase API grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT EXECUTE ON FUNCTIONS TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT EXECUTE ON FUNCTIONS TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT EXECUTE ON FUNCTIONS TO service_role;

-- 4. Harden the admin helper. It runs as the function owner and bypasses RLS,
-- which prevents recursive profile policy failures.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
      AND deleted_at IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

-- 5. Keep profile login reads simple.
-- Do not reference bookings here; login/admin role checks must not depend on
-- permissions on another table.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
FOR SELECT USING (
  auth.uid() = id
  OR public.is_admin()
);

DROP POLICY IF EXISTS "Booking participants can read counterparty profile" ON public.profiles;
CREATE POLICY "Booking participants can read counterparty profile" ON public.profiles
FOR SELECT USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE (
      (b.renter_id = auth.uid() AND b.owner_id = profiles.id)
      OR (b.owner_id = auth.uid() AND b.renter_id = profiles.id)
    )
  )
);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile" ON public.profiles
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Booking participants can read meetup verification images" ON public.verification_images;
CREATE POLICY "Booking participants can read meetup verification images" ON public.verification_images
FOR SELECT USING (
  public.is_admin()
  OR (
    image_type IN ('selfie', 'selfie_with_id')
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE (
        (b.renter_id = verification_images.user_id AND b.owner_id = auth.uid())
        OR (b.owner_id = verification_images.user_id AND b.renter_id = auth.uid())
      )
    )
  )
);

-- 6. Prevent normal users from self-approving, changing roles, or altering
-- verified identity fields directly through the Supabase API.
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  privileged BOOLEAN;
BEGIN
  privileged := public.is_admin()
    OR current_user IN ('postgres', 'service_role', 'supabase_admin');

  IF privileged THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> OLD.id THEN
    RAISE EXCEPTION 'Only the owning user or an admin can update this profile';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Users cannot change their own role';
  END IF;

  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'Users cannot change verification rejection reasons';
  END IF;

  IF NEW.verified_status IS DISTINCT FROM OLD.verified_status THEN
    IF NOT (
      OLD.verified_status IN ('unverified', 'rejected')
      AND NEW.verified_status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Users cannot self-approve or directly change verification status';
    END IF;
  END IF;

  IF OLD.verified_status = 'verified' AND (
    NEW.first_name IS DISTINCT FROM OLD.first_name
    OR NEW.middle_name IS DISTINCT FROM OLD.middle_name
    OR NEW.last_name IS DISTINCT FROM OLD.last_name
    OR NEW.full_name IS DISTINCT FROM OLD.full_name
    OR NEW.birthday IS DISTINCT FROM OLD.birthday
    OR NEW.driver_license IS DISTINCT FROM OLD.driver_license
    OR NEW.national_id IS DISTINCT FROM OLD.national_id
    OR NEW.secondary_id_type IS DISTINCT FROM OLD.secondary_id_type
  ) THEN
    RAISE EXCEPTION 'Verified identity fields require admin review to change';
  END IF;

  IF NEW.is_lister IS DISTINCT FROM OLD.is_lister
     AND OLD.verified_status <> 'verified' THEN
    RAISE EXCEPTION 'Only verified users can change lister mode';
  END IF;

  IF OLD.deleted_at IS NOT NULL
     AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'Deleted profiles cannot be reactivated by the user';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_sensitive_fields ON public.profiles;
CREATE TRIGGER protect_profile_sensitive_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_sensitive_fields();

-- 7. Verify the grants and policies that affect the current login failure.
SELECT
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

SELECT
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'profiles'
ORDER BY policyname;


-- ============================================================================
-- 5. harden_booking_state_updates.sql
-- ============================================================================

-- SafeDrive booking state hardening
--
-- Run this in Supabase SQL Editor after deploying the booking-action API.
-- It removes broad participant-side booking updates so booking status changes
-- must go through trusted server-side flows.

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can update bookings" ON public.bookings;

CREATE POLICY "Admins can update bookings" ON public.bookings
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());


-- ============================================================================
-- 6. allow_booking_counterparty_profile_reads.sql
-- ============================================================================

-- Allow renter and lister to read each other's limited booking-related profile data
-- and meetup-safe verification images through normal booking joins.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Booking participants can read counterparty profile" ON public.profiles;
CREATE POLICY "Booking participants can read counterparty profile" ON public.profiles
FOR SELECT USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE (
      (b.renter_id = auth.uid() AND b.owner_id = profiles.id)
      OR (b.owner_id = auth.uid() AND b.renter_id = profiles.id)
    )
  )
);

DROP POLICY IF EXISTS "Booking participants can read meetup verification images" ON public.verification_images;
CREATE POLICY "Booking participants can read meetup verification images" ON public.verification_images
FOR SELECT USING (
  public.is_admin()
  OR (
    image_type IN ('selfie', 'selfie_with_id')
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE (
        (b.renter_id = verification_images.user_id AND b.owner_id = auth.uid())
        OR (b.owner_id = verification_images.user_id AND b.renter_id = auth.uid())
      )
    )
  )
);


-- ============================================================================
-- 7. add_login_block_controls.sql
-- ============================================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS login_blocked_until TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS login_block_reason TEXT;

CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  privileged BOOLEAN;
BEGIN
  privileged := public.is_admin()
    OR current_user IN ('postgres', 'service_role', 'supabase_admin');

  IF privileged THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> OLD.id THEN
    RAISE EXCEPTION 'Only the owning user or an admin can update this profile';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Users cannot change their own role';
  END IF;

  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'Users cannot change verification rejection reasons';
  END IF;

  IF NEW.login_blocked_until IS DISTINCT FROM OLD.login_blocked_until
     OR NEW.login_block_reason IS DISTINCT FROM OLD.login_block_reason THEN
    RAISE EXCEPTION 'Users cannot change login block settings';
  END IF;

  IF NEW.verified_status IS DISTINCT FROM OLD.verified_status THEN
    IF NOT (
      OLD.verified_status IN ('unverified', 'rejected')
      AND NEW.verified_status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Users cannot self-approve or directly change verification status';
    END IF;
  END IF;

  IF OLD.verified_status = 'verified' AND (
    NEW.first_name IS DISTINCT FROM OLD.first_name
    OR NEW.middle_name IS DISTINCT FROM OLD.middle_name
    OR NEW.last_name IS DISTINCT FROM OLD.last_name
    OR NEW.full_name IS DISTINCT FROM OLD.full_name
    OR NEW.birthday IS DISTINCT FROM OLD.birthday
    OR NEW.driver_license IS DISTINCT FROM OLD.driver_license
    OR NEW.national_id IS DISTINCT FROM OLD.national_id
    OR NEW.secondary_id_type IS DISTINCT FROM OLD.secondary_id_type
  ) THEN
    RAISE EXCEPTION 'Verified identity fields require admin review to change';
  END IF;

  IF NEW.is_lister IS DISTINCT FROM OLD.is_lister
     AND OLD.verified_status <> 'verified' THEN
    RAISE EXCEPTION 'Only verified users can change lister mode';
  END IF;

  IF OLD.deleted_at IS NOT NULL
     AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'Deleted profiles cannot be reactivated by the user';
  END IF;

  RETURN NEW;
END;
$$;


-- ============================================================================
-- 8. fix_pii_encryption_null_key.sql
-- ============================================================================

-- SafeDrive PII Encryption Repair
-- Fixes encrypt_pii/decrypt_pii so missing app.settings.encryption_key does not silently turn driver_license/national_id into NULL.
-- Run this in Supabase SQL Editor on an existing live project.

CREATE OR REPLACE FUNCTION public.encrypt_pii(content TEXT) RETURNS TEXT AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  IF content IS NULL THEN
    RETURN NULL;
  END IF;
  IF content LIKE 'pgp:%' THEN
    RETURN content;
  END IF;

  encryption_key := COALESCE(
    NULLIF(current_setting('app.settings.encryption_key', true), ''),
    'safedrive-dev-secret-key-fallback'
  );

  RETURN 'pgp:' || encode(
    pgp_sym_encrypt(content, encryption_key),
    'base64'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.decrypt_pii(encrypted_content TEXT) RETURNS TEXT AS $$
DECLARE
  raw_base64 TEXT;
  encryption_key TEXT;
BEGIN
  IF encrypted_content IS NULL THEN
    RETURN NULL;
  END IF;
  IF encrypted_content NOT LIKE 'pgp:%' THEN
    RETURN encrypted_content;
  END IF;

  raw_base64 := substring(encrypted_content FROM 5);
  encryption_key := COALESCE(
    NULLIF(current_setting('app.settings.encryption_key', true), ''),
    'safedrive-dev-secret-key-fallback'
  );

  RETURN pgp_sym_decrypt(
    decode(raw_base64, 'base64'),
    encryption_key
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_pii_encryption() RETURNS trigger AS $$
BEGIN
  IF NEW.driver_license IS NOT NULL THEN
    NEW.driver_license := public.encrypt_pii(NEW.driver_license);
  END IF;
  IF NEW.national_id IS NOT NULL THEN
    NEW.national_id := public.encrypt_pii(NEW.national_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_pii_encrypt ON public.profiles;
CREATE TRIGGER on_pii_encrypt
  BEFORE INSERT OR UPDATE OF driver_license, national_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_pii_encryption();


-- ============================================================================
-- 9. fix_notification_insert_policy.sql
-- ============================================================================

DROP POLICY IF EXISTS "Users manage own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

CREATE POLICY "Users read own notifications" ON public.notifications
FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Users update own notifications" ON public.notifications
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert notifications" ON public.notifications
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);


-- ============================================================================
-- 10. add_ticket_message_attachments.sql
-- ============================================================================

ALTER TABLE public.ticket_messages
ADD COLUMN IF NOT EXISTS attachment_name TEXT,
ADD COLUMN IF NOT EXISTS attachment_mime_type TEXT,
ADD COLUMN IF NOT EXISTS attachment_storage_path TEXT;


-- ============================================================================
-- 11. add_car_fuel_detail_columns.sql
-- ============================================================================

ALTER TABLE public.cars
ADD COLUMN IF NOT EXISTS fuel_category TEXT,
ADD COLUMN IF NOT EXISTS fuel_subtype TEXT;


-- ============================================================================
-- 12. remove_secondary_id_number.sql
-- ============================================================================

-- SafeDrive cleanup: stop storing optional secondary ID numbers
-- Run this on the live database after deploying the app changes.

UPDATE public.profiles
SET
  secondary_id_number = NULL,
  national_id = NULL
WHERE secondary_id_number IS NOT NULL
   OR national_id IS NOT NULL;

DROP TRIGGER IF EXISTS on_pii_encrypt ON public.profiles;

CREATE OR REPLACE FUNCTION public.handle_pii_encryption() RETURNS trigger AS $$
BEGIN
  IF NEW.driver_license IS NOT NULL THEN
    NEW.driver_license := public.encrypt_pii(NEW.driver_license);
  END IF;
  IF NEW.national_id IS NOT NULL THEN
    NEW.national_id := public.encrypt_pii(NEW.national_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_pii_encrypt
  BEFORE INSERT OR UPDATE OF driver_license, national_id
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_pii_encryption();

ALTER TABLE public.profiles
DROP COLUMN IF EXISTS secondary_id_number;


-- ============================================================================
-- 13. add_platform_settings_and_vehicle_gps.sql
-- ============================================================================

begin;

alter table public.cars
add column if not exists gps_available boolean not null default false;

alter table public.cars
add column if not exists security_deposit_amount numeric not null default 0;

alter table public.cars
drop constraint if exists cars_security_deposit_amount_check;

alter table public.cars
add constraint cars_security_deposit_amount_check
  check (security_deposit_amount >= 0 and security_deposit_amount <= 100000);

create table if not exists public.platform_settings (
  id text primary key default 'default',
  commission_rate numeric not null default 0.10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_settings_commission_rate_check
    check (commission_rate >= 0 and commission_rate <= 1)
);

insert into public.platform_settings (id, commission_rate)
values ('default', 0.10)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

drop policy if exists "Authenticated users can read platform settings" on public.platform_settings;
create policy "Authenticated users can read platform settings"
on public.platform_settings
for select
to authenticated
using (true);

drop policy if exists "Super admins can manage platform settings" on public.platform_settings;
create policy "Super admins can manage platform settings"
on public.platform_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
  )
);

commit;


-- ============================================================================
-- 14. add_booking_extensions.sql
-- ============================================================================

create table if not exists public.booking_extensions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  renter_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  current_end_date date not null,
  requested_end_date date not null,
  extension_days integer not null check (extension_days > 0),
  requested_total_days integer not null check (requested_total_days > 0),
  reason text not null,
  fuel_top_up_amount numeric not null default 0 check (fuel_top_up_amount >= 0),
  extension_amount numeric not null default 0 check (extension_amount >= 0),
  total_additional_amount numeric not null default 0 check (total_additional_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid', 'cancelled', 'expired')),
  owner_decision_note text,
  payment_deadline timestamptz,
  paymongo_checkout_id text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_extensions_requested_end_after_current check (requested_end_date > current_end_date)
);

create index if not exists booking_extensions_booking_id_idx
  on public.booking_extensions (booking_id, created_at desc);

create index if not exists booking_extensions_status_idx
  on public.booking_extensions (status);

create or replace function public.set_booking_extensions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists booking_extensions_set_updated_at on public.booking_extensions;
create trigger booking_extensions_set_updated_at
before update on public.booking_extensions
for each row execute function public.set_booking_extensions_updated_at();

alter table public.booking_extensions enable row level security;

drop policy if exists "Participants can read booking extensions" on public.booking_extensions;
create policy "Participants can read booking extensions"
on public.booking_extensions
for select
using (auth.uid() = renter_id or auth.uid() = owner_id);

drop policy if exists "Renters can create booking extensions" on public.booking_extensions;
create policy "Renters can create booking extensions"
on public.booking_extensions
for insert
with check (auth.uid() = renter_id);

drop policy if exists "Participants can update booking extensions" on public.booking_extensions;
create policy "Participants can update booking extensions"
on public.booking_extensions
for update
using (auth.uid() = renter_id or auth.uid() = owner_id)
with check (auth.uid() = renter_id or auth.uid() = owner_id);

alter table public.payments
  drop constraint if exists payments_payment_type_check;

alter table public.payments
  add constraint payments_payment_type_check
  check (payment_type in ('downpayment', 'balance', 'extension', 'security_deposit', 'refund', 'payout'));


-- ============================================================================
-- 15. enable_expired_booking_extensions.sql
-- ============================================================================

alter table public.booking_extensions
  drop constraint if exists booking_extensions_status_check;

alter table public.booking_extensions
  add constraint booking_extensions_status_check
  check (status in ('pending', 'approved', 'rejected', 'paid', 'cancelled', 'expired'));


-- ============================================================================
-- 16. enforce_supported_payout_methods.sql
-- ============================================================================

-- Normalize older unsupported payout methods and enforce the current release rules.
-- SafeDrive now only supports GCash and Maya as payout destinations.

UPDATE public.profiles
SET
  payout_method = NULL,
  payout_account_name = NULL,
  payout_account_number = NULL
WHERE payout_method IS NOT NULL
  AND payout_method NOT IN ('GCash', 'Maya');

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_payout_method_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_payout_method_check
  CHECK (payout_method IS NULL OR payout_method IN ('GCash', 'Maya'));


-- ============================================================================
-- 17. flush_all_except_selected_accounts.sql
-- ============================================================================

-- SafeDrive flush script
-- Purpose: remove all system data except the accounts you explicitly keep.
--
-- Before running:
-- 1. Replace the sample emails in keep_emails with the exact accounts you want to preserve.
-- 2. Review carefully. This permanently deletes data for every other account.
-- 3. Recommended: take a backup first.
--
-- Preservation rule:
-- - The listed accounts stay in auth.users and public.profiles.
-- - Related user data is preserved only when every directly linked user on that record is also in the keep list.
-- - Static lookup tables such as car_brands and car_models are left untouched.

begin;

do $$
declare
  keep_emails text[] := array[
    'superadmin@example.com',
    'replace-second-account@example.com'
  ];
begin
  create temporary table tmp_keep_users on commit drop as
  select distinct id
  from auth.users
  where lower(email) = any (
    select lower(email_value)
    from unnest(keep_emails) as email_value
  );

  if not exists (select 1 from tmp_keep_users) then
    raise exception 'No keep users matched the provided email list. Aborting flush.';
  end if;

  create temporary table tmp_keep_cars on commit drop as
  select id
  from public.cars
  where owner_id in (select id from tmp_keep_users);

  create temporary table tmp_keep_bookings on commit drop as
  select id
  from public.bookings
  where renter_id in (select id from tmp_keep_users)
    and owner_id in (select id from tmp_keep_users);

  delete from public.ticket_messages
  where sender_id not in (select id from tmp_keep_users)
     or ticket_id in (
       select id
       from public.support_tickets
       where user_id not in (select id from tmp_keep_users)
          or (booking_id is not null and booking_id not in (select id from tmp_keep_bookings))
     );

  delete from public.support_tickets
  where user_id not in (select id from tmp_keep_users)
     or (booking_id is not null and booking_id not in (select id from tmp_keep_bookings));

  delete from public.notifications
  where user_id not in (select id from tmp_keep_users);

  delete from public.subscriptions
  where user_id not in (select id from tmp_keep_users);

  delete from public.security_logs
  where user_id not in (select id from tmp_keep_users);

  delete from public.audit_log
  where user_id not in (select id from tmp_keep_users);

  delete from public.verification_images
  where user_id not in (select id from tmp_keep_users);

  delete from public.booking_reviews
  where booking_id not in (select id from tmp_keep_bookings)
     or reviewer_id not in (select id from tmp_keep_users)
     or reviewee_id not in (select id from tmp_keep_users);

  delete from public.payments
  where booking_id not in (select id from tmp_keep_bookings)
    and (
      subscription_id is null
      or subscription_id not in (
        select id from public.subscriptions where user_id in (select id from tmp_keep_users)
      )
    );

  delete from public.car_documents
  where car_id not in (select id from tmp_keep_cars);

  delete from public.car_images
  where car_id not in (select id from tmp_keep_cars);

  delete from public.car_renewals
  where car_id not in (select id from tmp_keep_cars);

  delete from public.bookings
  where id not in (select id from tmp_keep_bookings);

  delete from public.cars
  where id not in (select id from tmp_keep_cars);

  delete from public.profiles
  where id not in (select id from tmp_keep_users);

  delete from auth.users
  where id not in (select id from tmp_keep_users);
end $$;

commit;


-- ============================================================================
-- 18. sample_car_catalog_seed.sql
-- ============================================================================

-- SafeDrive sample car catalog seed
-- Run this after the main schema if you want a fuller starter catalog.

INSERT INTO public.car_brands (name)
VALUES
  ('Toyota'),
  ('Honda'),
  ('Mitsubishi'),
  ('Nissan'),
  ('Hyundai'),
  ('Kia'),
  ('Suzuki'),
  ('Ford'),
  ('Isuzu'),
  ('Chevrolet')
ON CONFLICT (name) DO NOTHING;

WITH models_to_insert AS (
  SELECT *
  FROM (
    VALUES
      ('Toyota', 'Vios', 'sedan', 5, 'gasoline'),
      ('Toyota', 'Wigo', 'hatchback', 5, 'gasoline'),
      ('Toyota', 'Innova', 'mpv', 7, 'diesel'),
      ('Toyota', 'Fortuner', 'suv', 7, 'diesel'),
      ('Toyota', 'Hilux', 'pickup', 5, 'diesel'),

      ('Honda', 'City', 'sedan', 5, 'gasoline'),
      ('Honda', 'Civic', 'sedan', 5, 'gasoline'),
      ('Honda', 'Brio', 'hatchback', 5, 'gasoline'),
      ('Honda', 'BR-V', 'suv', 7, 'gasoline'),
      ('Honda', 'CR-V', 'suv', 5, 'gasoline'),

      ('Mitsubishi', 'Mirage G4', 'sedan', 5, 'gasoline'),
      ('Mitsubishi', 'Montero Sport', 'suv', 7, 'diesel'),
      ('Mitsubishi', 'Xpander', 'mpv', 7, 'gasoline'),
      ('Mitsubishi', 'L300', 'van', 12, 'diesel'),
      ('Mitsubishi', 'Strada', 'pickup', 5, 'diesel'),

      ('Nissan', 'Almera', 'sedan', 5, 'gasoline'),
      ('Nissan', 'Livina', 'mpv', 7, 'gasoline'),
      ('Nissan', 'Navara', 'pickup', 5, 'diesel'),
      ('Nissan', 'Terra', 'suv', 7, 'diesel'),
      ('Nissan', 'Kicks', 'suv', 5, 'hybrid'),

      ('Hyundai', 'Accent', 'sedan', 5, 'gasoline'),
      ('Hyundai', 'Stargazer', 'mpv', 7, 'gasoline'),
      ('Hyundai', 'Tucson', 'suv', 5, 'gasoline'),
      ('Hyundai', 'Staria', 'van', 11, 'diesel'),

      ('Kia', 'Soluto', 'sedan', 5, 'gasoline'),
      ('Kia', 'Seltos', 'suv', 5, 'gasoline'),
      ('Kia', 'Carnival', 'van', 8, 'diesel'),
      ('Kia', 'Sonet', 'suv', 5, 'gasoline'),

      ('Suzuki', 'Dzire', 'sedan', 5, 'gasoline'),
      ('Suzuki', 'Ertiga', 'mpv', 7, 'gasoline'),
      ('Suzuki', 'Jimny', 'suv', 4, 'gasoline'),
      ('Suzuki', 'Carry', 'pickup', 2, 'gasoline'),

      ('Ford', 'Everest', 'suv', 7, 'diesel'),
      ('Ford', 'Ranger', 'pickup', 5, 'diesel'),
      ('Ford', 'Territory', 'suv', 5, 'gasoline'),

      ('Isuzu', 'D-Max', 'pickup', 5, 'diesel'),
      ('Isuzu', 'mu-X', 'suv', 7, 'diesel'),
      ('Isuzu', 'Traviz', 'pickup', 3, 'diesel'),

      ('Chevrolet', 'Spark', 'hatchback', 5, 'gasoline'),
      ('Chevrolet', 'Tracker', 'suv', 5, 'gasoline'),
      ('Chevrolet', 'Trailblazer', 'suv', 7, 'diesel')
  ) AS model_data(brand_name, model_name, body_type, seats, fuel_type)
)
INSERT INTO public.car_models (brand_id, name, body_type, seats, fuel_type)
SELECT
  brand.id,
  model_data.model_name,
  model_data.body_type,
  model_data.seats,
  model_data.fuel_type
FROM models_to_insert AS model_data
JOIN public.car_brands AS brand
  ON brand.name = model_data.brand_name
WHERE NOT EXISTS (
  SELECT 1
  FROM public.car_models existing
  WHERE existing.brand_id = brand.id
    AND lower(existing.name) = lower(model_data.model_name)
);




-- ============================================================================
-- CHAPTER 2 - SOURCE: database_scripts/SAFE_DRIVE_LIVE_DB_UPDATE.sql
-- SOURCE SHA256: 9bb92704220028f6225409d55c6bbb08419657a0d15a93a2b1e213fadc1ec41e
-- ============================================================================

-- SafeDrive latest live database update
-- Run this in Supabase SQL Editor for the current May 2026 feature set.
--
-- What this covers:
-- 1. vehicle GPS as a feature option only
-- 2. per-car security deposit
-- 3. platform commission settings table + RLS
-- 4. booking extension table and policies
-- 5. extension status support for "expired"
-- 6. payments.payment_type support for "extension"
-- 7. payout-method cleanup so only GCash and Maya remain supported
-- 8. C2PA / Content Credentials provenance review fields for uploaded evidence
-- 9. admin user/security/support policy repairs for the May 2026 QA pass

begin;

-- ============================================================================
-- 1. Cars: GPS availability + security deposit
-- ============================================================================

alter table public.cars
add column if not exists gps_available boolean not null default false;

alter table public.cars
add column if not exists security_deposit_amount numeric not null default 0;

alter table public.cars
drop constraint if exists cars_security_deposit_amount_check;

alter table public.cars
add constraint cars_security_deposit_amount_check
  check (security_deposit_amount >= 0 and security_deposit_amount <= 100000);

-- ============================================================================
-- 2. Platform settings: super admin commission control
-- ============================================================================

create table if not exists public.platform_settings (
  id text primary key default 'default',
  commission_rate numeric not null default 0.10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_settings_commission_rate_check
    check (commission_rate >= 0 and commission_rate <= 1)
);

insert into public.platform_settings (id, commission_rate)
values ('default', 0.10)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

drop policy if exists "Authenticated users can read platform settings" on public.platform_settings;
create policy "Authenticated users can read platform settings"
on public.platform_settings
for select
to authenticated
using (true);

drop policy if exists "Super admins can manage platform settings" on public.platform_settings;
create policy "Super admins can manage platform settings"
on public.platform_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
  )
);

-- ============================================================================
-- 3. Booking extensions
-- ============================================================================

create table if not exists public.booking_extensions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  renter_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  current_end_date date not null,
  requested_end_date date not null,
  extension_days integer not null check (extension_days > 0),
  requested_total_days integer not null check (requested_total_days > 0),
  reason text not null,
  fuel_top_up_amount numeric not null default 0 check (fuel_top_up_amount >= 0),
  extension_amount numeric not null default 0 check (extension_amount >= 0),
  total_additional_amount numeric not null default 0 check (total_additional_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid', 'cancelled', 'expired')),
  owner_decision_note text,
  payment_deadline timestamptz,
  paymongo_checkout_id text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_extensions_requested_end_after_current check (requested_end_date > current_end_date)
);

create index if not exists booking_extensions_booking_id_idx
  on public.booking_extensions (booking_id, created_at desc);

create index if not exists booking_extensions_status_idx
  on public.booking_extensions (status);

create or replace function public.set_booking_extensions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists booking_extensions_set_updated_at on public.booking_extensions;
create trigger booking_extensions_set_updated_at
before update on public.booking_extensions
for each row execute function public.set_booking_extensions_updated_at();

alter table public.booking_extensions enable row level security;

drop policy if exists "Participants can read booking extensions" on public.booking_extensions;
create policy "Participants can read booking extensions"
on public.booking_extensions
for select
using (auth.uid() = renter_id or auth.uid() = owner_id);

drop policy if exists "Renters can create booking extensions" on public.booking_extensions;
create policy "Renters can create booking extensions"
on public.booking_extensions
for insert
with check (auth.uid() = renter_id);

drop policy if exists "Participants can update booking extensions" on public.booking_extensions;
create policy "Participants can update booking extensions"
on public.booking_extensions
for update
using (auth.uid() = renter_id or auth.uid() = owner_id)
with check (auth.uid() = renter_id or auth.uid() = owner_id);

-- Make sure older live DBs also allow "expired" if the table already existed.
alter table public.booking_extensions
  drop constraint if exists booking_extensions_status_check;

alter table public.booking_extensions
  add constraint booking_extensions_status_check
  check (status in ('pending', 'approved', 'rejected', 'paid', 'cancelled', 'expired'));

-- ============================================================================
-- 4. Payments: allow extension payment type
-- ============================================================================

alter table public.payments
  drop constraint if exists payments_payment_type_check;

alter table public.payments
  add constraint payments_payment_type_check
  check (payment_type in ('downpayment', 'balance', 'extension', 'security_deposit', 'refund', 'payout'));

-- ============================================================================
-- 5. Payout methods: only GCash and Maya supported now
-- ============================================================================

update public.profiles
set
  payout_method = null,
  payout_account_name = null,
  payout_account_number = null
where payout_method is not null
  and payout_method not in ('GCash', 'Maya');

alter table public.profiles drop constraint if exists profiles_payout_method_check;
alter table public.profiles
  add constraint profiles_payout_method_check
  check (payout_method is null or payout_method in ('GCash', 'Maya'));

-- ============================================================================
-- 6. Upload provenance review fields
-- ============================================================================

alter table public.verification_images
  add column if not exists provenance_status text not null default 'unknown',
  add column if not exists provenance_source text,
  add column if not exists provenance_summary text,
  add column if not exists ai_suspicion_score numeric,
  add column if not exists ai_detector_name text,
  add column if not exists ai_detector_version text,
  add column if not exists review_flag text not null default 'none',
  add column if not exists review_reason text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.verification_images
  drop constraint if exists verification_images_provenance_status_check;

alter table public.verification_images
  add constraint verification_images_provenance_status_check
  check (provenance_status in ('unknown', 'credential_present', 'credential_missing', 'credential_invalid'));

alter table public.verification_images
  drop constraint if exists verification_images_ai_suspicion_score_check;

alter table public.verification_images
  add constraint verification_images_ai_suspicion_score_check
  check (ai_suspicion_score is null or (ai_suspicion_score >= 0 and ai_suspicion_score <= 1));

alter table public.verification_images
  drop constraint if exists verification_images_review_flag_check;

alter table public.verification_images
  add constraint verification_images_review_flag_check
  check (review_flag in ('none', 'needs_admin_review', 'approved_after_review', 'rejected_after_review'));

create index if not exists verification_images_provenance_status_idx
  on public.verification_images (provenance_status);

create index if not exists verification_images_review_flag_idx
  on public.verification_images (review_flag);

-- Missing C2PA / Content Credentials metadata is normal and is not evidence
-- that an uploaded identity document is false. Clear only the legacy automatic
-- flag created for that exact reason; human review flags are preserved.
update public.verification_images
set
  review_flag = 'none',
  review_reason = null
where provenance_status = 'credential_missing'
  and review_flag = 'needs_admin_review'
  and review_reason = 'No C2PA / Content Credentials marker found.';

alter table public.car_documents
  add column if not exists provenance_status text not null default 'unknown',
  add column if not exists provenance_source text,
  add column if not exists provenance_summary text,
  add column if not exists ai_suspicion_score numeric,
  add column if not exists ai_detector_name text,
  add column if not exists ai_detector_version text,
  add column if not exists review_flag text not null default 'none',
  add column if not exists review_reason text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.car_documents
  drop constraint if exists car_documents_provenance_status_check;

alter table public.car_documents
  add constraint car_documents_provenance_status_check
  check (provenance_status in ('unknown', 'credential_present', 'credential_missing', 'credential_invalid'));

alter table public.car_documents
  drop constraint if exists car_documents_ai_suspicion_score_check;

alter table public.car_documents
  add constraint car_documents_ai_suspicion_score_check
  check (ai_suspicion_score is null or (ai_suspicion_score >= 0 and ai_suspicion_score <= 1));

alter table public.car_documents
  drop constraint if exists car_documents_review_flag_check;

alter table public.car_documents
  add constraint car_documents_review_flag_check
  check (review_flag in ('none', 'needs_admin_review', 'approved_after_review', 'rejected_after_review'));

create index if not exists car_documents_provenance_status_idx
  on public.car_documents (provenance_status);

create index if not exists car_documents_review_flag_idx
  on public.car_documents (review_flag);

update public.car_documents
set
  review_flag = 'none',
  review_reason = null
where provenance_status = 'credential_missing'
  and review_flag = 'needs_admin_review'
  and review_reason = 'No C2PA / Content Credentials marker found.';

-- ============================================================================
-- 7. Admin QA support: users, security logs, and support tickets
-- ============================================================================

alter table public.security_logs
  drop constraint if exists security_logs_event_type_check;

alter table public.security_logs
  add constraint security_logs_event_type_check
  check (
    event_type in (
      'login_success',
      'login_failed',
      'logout',
      'otp_sent',
      'otp_verified',
      'otp_failed',
      'authenticator_challenge_started',
      'authenticator_verified',
      'authenticator_failed',
      'lockout_started',
      'lockout_ended',
      'password_changed',
      'password_reset_requested',
      'password_reset_completed',
      'session_timeout',
      'suspicious_activity',
      'webhook_signature_verified',
      'webhook_signature_failed'
    )
  );

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated;
grant usage, select on all sequences in schema public to anon;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema public to anon;
grant execute on all functions in schema public to service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'super_admin')
  );
$$;

grant execute on function public.is_admin() to authenticated;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
using (auth.uid() = id or public.is_admin());

drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
on public.profiles
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can manage own verification images" on public.verification_images;
create policy "Users can manage own verification images"
on public.verification_images
for all
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Admin read security logs" on public.security_logs;
create policy "Admin read security logs"
on public.security_logs
for select
using (public.is_admin());

drop policy if exists "System insert security logs" on public.security_logs;
create policy "System insert security logs"
on public.security_logs
for insert
with check (true);

drop policy if exists "Admins can create tickets for users" on public.support_tickets;
create policy "Admins can create tickets for users"
on public.support_tickets
for insert
with check (public.is_admin());

alter table public.support_tickets
  add column if not exists participant_user_id uuid references public.profiles(id) on delete set null;

create index if not exists support_tickets_participant_user_id_idx
  on public.support_tickets (participant_user_id);

drop policy if exists "Users can create own tickets" on public.support_tickets;
create policy "Users can create own tickets"
on public.support_tickets
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users and admins can read tickets" on public.support_tickets;
create policy "Users and admins can read tickets"
on public.support_tickets
for select
using (
  auth.uid() = user_id
  or auth.uid() = participant_user_id
  or public.is_admin()
);

drop policy if exists "Users and admins can create ticket messages" on public.ticket_messages;
create policy "Users and admins can create ticket messages"
on public.ticket_messages
for insert
with check (
  auth.uid() = sender_id
  and exists (
    select 1
    from public.support_tickets
    where id = ticket_messages.ticket_id
      and (
        user_id = auth.uid()
        or participant_user_id = auth.uid()
        or public.is_admin()
      )
  )
);

drop policy if exists "Users and admins can read ticket messages" on public.ticket_messages;
create policy "Users and admins can read ticket messages"
on public.ticket_messages
for select
using (
  exists (
    select 1
    from public.support_tickets
    where id = ticket_messages.ticket_id
      and (
        user_id = auth.uid()
        or participant_user_id = auth.uid()
        or public.is_admin()
      )
  )
);

drop policy if exists "Participants see bookings" on public.bookings;
create policy "Participants see bookings"
on public.bookings
for select
using (
  auth.uid() = renter_id
  or auth.uid() = owner_id
  or public.is_admin()
);

drop policy if exists "Renters can create bookings" on public.bookings;
create policy "Renters can create bookings"
on public.bookings
for insert
with check (auth.uid() = renter_id);

drop policy if exists "Authenticated users can read completed booking reviews" on public.booking_reviews;
create policy "Authenticated users can read completed booking reviews"
on public.booking_reviews
for select
to authenticated
using (
  public.is_admin()
  or auth.uid() = reviewer_id
  or auth.uid() = reviewee_id
  or exists (
    select 1
    from public.bookings
    where bookings.id = booking_reviews.booking_id
      and bookings.status = 'completed'
  )
);

-- Repair invalid states created before extension payment was enforced before completion.
update public.booking_extensions
set
  status = 'cancelled',
  owner_decision_note = coalesce(
    owner_decision_note,
    'System cancelled this unpaid extension because the booking was already completed.'
  )
where status in ('pending', 'approved')
  and exists (
    select 1
    from public.bookings
    where bookings.id = booking_extensions.booking_id
      and bookings.status = 'completed'
  );

commit;


-- ============================================================================
-- CHAPTER 3 - SOURCE: database_scripts/2026-06-15_arrival_location_evidence.sql
-- SOURCE SHA256: 2c101039823df866913543c6c2a30b0a7455c4cfcbefae67bbd14a18e65a84c3
-- ============================================================================

-- Optional arrival location evidence for pickup/no-show review.
-- Run this against the live Supabase database before relying on location storage.

alter table public.bookings
  add column if not exists renter_arrival_latitude numeric(9,6),
  add column if not exists renter_arrival_longitude numeric(9,6),
  add column if not exists renter_arrival_accuracy_meters numeric,
  add column if not exists renter_arrival_location_captured_at timestamp with time zone,
  add column if not exists lister_arrival_latitude numeric(9,6),
  add column if not exists lister_arrival_longitude numeric(9,6),
  add column if not exists lister_arrival_accuracy_meters numeric,
  add column if not exists lister_arrival_location_captured_at timestamp with time zone;

comment on column public.bookings.renter_arrival_latitude is
  'Optional renter geolocation latitude captured during arrival check-in.';
comment on column public.bookings.renter_arrival_longitude is
  'Optional renter geolocation longitude captured during arrival check-in.';
comment on column public.bookings.renter_arrival_accuracy_meters is
  'Browser-reported renter geolocation accuracy in meters.';
comment on column public.bookings.renter_arrival_location_captured_at is
  'Client-reported timestamp for optional renter location capture.';
comment on column public.bookings.lister_arrival_latitude is
  'Optional lister geolocation latitude captured during arrival check-in.';
comment on column public.bookings.lister_arrival_longitude is
  'Optional lister geolocation longitude captured during arrival check-in.';
comment on column public.bookings.lister_arrival_accuracy_meters is
  'Browser-reported lister geolocation accuracy in meters.';
comment on column public.bookings.lister_arrival_location_captured_at is
  'Client-reported timestamp for optional lister location capture.';


-- ============================================================================
-- CHAPTER 4 - SOURCE: database_scripts/2026-06-17_financial_integrity_hardening.sql
-- SOURCE SHA256: 07afd616c059e172d66d6474346ed2cbe290fd0be5f85c4b5bd128f0cfd358af
-- ============================================================================

-- SafeDrive financial integrity hardening
-- Apply after deploying api/create-booking.ts and the booking extension API routes.
-- Goal: users can still request bookings/extensions through the app, but pricing,
-- payments, and extension state changes are finalized by trusted server routes.

begin;

-- Booking creation now goes through /api/create-booking so the server recalculates
-- base price, commission, downpayment, balance, date limits, and overlap checks.
drop policy if exists "Renters can create bookings" on public.bookings;
drop policy if exists "Admins can create bookings" on public.bookings;

create policy "Admins can create bookings"
on public.bookings
for insert
with check (public.is_admin());

-- Payments should be created by PayMongo webhooks, payout/refund automation, or
-- admin/server flows only. Booking participants must not be able to insert their
-- own arbitrary completed payment records from the browser.
drop policy if exists "Participants insert payments" on public.payments;
drop policy if exists "Admins can insert payments" on public.payments;

create policy "Admins can insert payments"
on public.payments
for insert
with check (public.is_admin());

-- Booking extension requests and decisions now go through server APIs so the
-- requested amount, approval state, expiry, and payment transition cannot be
-- edited directly by a hostile browser client.
drop policy if exists "Renters can create booking extensions" on public.booking_extensions;
drop policy if exists "Admins can create booking extensions" on public.booking_extensions;

create policy "Admins can create booking extensions"
on public.booking_extensions
for insert
with check (public.is_admin());

drop policy if exists "Participants can update booking extensions" on public.booking_extensions;
drop policy if exists "Admins can update booking extensions" on public.booking_extensions;

create policy "Admins can update booking extensions"
on public.booking_extensions
for update
using (public.is_admin())
with check (public.is_admin());

commit;


-- ============================================================================
-- CHAPTER 5 - SOURCE: database_scripts/2026-06-18_booking_overlap_constraint.sql
-- SOURCE SHA256: 3aa6004758c197bb0d84de1a79659c36b0a686dc9bdddbfe1a5c328a94914b06
-- ============================================================================

-- SafeDrive booking overlap hardening
-- Apply after checking there are no existing overlapping active bookings.
-- This closes the race where two renters submit overlapping requests at the same time.

begin;

create extension if not exists btree_gist;

alter table public.bookings
drop constraint if exists bookings_no_active_date_overlap;

alter table public.bookings
add constraint bookings_no_active_date_overlap
exclude using gist (
  car_id with =,
  daterange(start_date, end_date, '[]') with &&
)
where (
  status in (
    'pending',
    'confirmed',
    'awaiting_payment',
    'downpayment_paid',
    'fully_paid',
    'active'
  )
);

commit;


-- ============================================================================
-- CHAPTER 6 - SOURCE: database_scripts/2026-06-18_payout_uniqueness_guard.sql
-- SOURCE SHA256: c4a805a2011f88e5b3be4eafe991700ce0b8180fcc3dcbb5bcf3945086af7f0a
-- ============================================================================

-- Prevent duplicate active payout records for the same booking.
-- Before applying, resolve any duplicate rows returned by:
-- select booking_id, count(*)
-- from public.payments
-- where payment_type = 'payout' and status in ('pending', 'completed')
-- group by booking_id
-- having count(*) > 1;

create unique index if not exists payments_one_active_payout_per_booking
on public.payments (booking_id)
where payment_type = 'payout'
  and status in ('pending', 'completed');


-- ============================================================================
-- CHAPTER 7 - SOURCE: database_scripts/2026-06-26_payment_webhook_idempotency_guard.sql
-- SOURCE SHA256: 0568ca75fc9d76f9b0a94d6a11e35590c1627311de568cee8c943a6c8ed5efd6
-- ============================================================================

-- Prevent duplicate completed PayMongo checkout payment rows from repeated webhooks.
-- Before applying, resolve duplicates returned by:
-- select booking_id, payment_type, transaction_id, count(*)
-- from public.payments
-- where status = 'completed'
--   and payment_type in ('downpayment', 'balance', 'extension', 'security_deposit')
--   and transaction_id is not null
-- group by booking_id, payment_type, transaction_id
-- having count(*) > 1;

create unique index if not exists payments_one_completed_checkout_event
on public.payments (booking_id, payment_type, transaction_id)
where status = 'completed'
  and payment_type in ('downpayment', 'balance', 'extension', 'security_deposit')
  and transaction_id is not null;


-- ============================================================================
-- CHAPTER 8 - SOURCE: database_scripts/2026-06-26_subscription_active_uniqueness_guard.sql
-- SOURCE SHA256: 5a10ccd2c106616226069fcdf5bf8889b22db59ef170d1d80aaf4653a81b766e
-- ============================================================================

-- Keep subscription activation idempotent and prevent duplicate active plans.
-- Before applying, resolve duplicates returned by:
-- select user_id, count(*)
-- from public.subscriptions
-- where status = 'active'
-- group by user_id
-- having count(*) > 1;

create unique index if not exists subscriptions_one_active_plan_per_user
on public.subscriptions (user_id)
where status = 'active';


-- ============================================================================
-- CHAPTER 9 - SOURCE: database_scripts/2026-07-16_vehicle_and_kyc_access_hardening.sql
-- SOURCE SHA256: 24fd77da09b9628e44e899b06020bce8904d2c1e9910e3dab9e0bf666fc7e578
-- ============================================================================

-- SafeDrive production access hardening.
-- Apply only after the June 2026 integrity migrations listed in README.md.
-- This preserves normal lister submission/editing while preventing client-side
-- self-approval and limiting counterparty access to KYC images.

begin;

create or replace function public.protect_car_submission_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  privileged boolean;
begin
  privileged := public.is_admin()
    or current_user in ('postgres', 'service_role', 'supabase_admin');

  if privileged then
    return new;
  end if;

  if auth.uid() is null or new.owner_id <> auth.uid() then
    raise exception 'Only the listing owner can create or update this vehicle';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and verified_status = 'verified'
      and deleted_at is null
  ) then
    raise exception 'Identity verification is required before listing a vehicle';
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.rejection_reason := null;
    new.last_verified_at := null;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'Vehicle ownership cannot be changed by the lister';
  end if;

  if new.rejection_reason is distinct from old.rejection_reason
     or new.last_verified_at is distinct from old.last_verified_at then
    raise exception 'Vehicle review fields can only be changed by an administrator';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'rejected' and new.status = 'pending')
      or (old.status = 'approved' and new.status = 'inactive')
      or (old.status = 'inactive' and new.status = 'approved')
    ) then
      raise exception 'Listers cannot change vehicle approval status';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_car_submission_fields on public.cars;
create trigger protect_car_submission_fields
before insert or update on public.cars
for each row execute function public.protect_car_submission_fields();

create or replace function public.notify_admins_of_vehicle_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, message, type, link)
  select
    id,
    'Vehicle approval needed',
    'A lister submitted a vehicle for review.',
    'info',
    '/admin/vehicle-approval'
  from public.profiles
  where role in ('admin', 'super_admin')
    and deleted_at is null;

  return new;
end;
$$;

drop trigger if exists notify_admins_of_vehicle_submission on public.cars;
create trigger notify_admins_of_vehicle_submission
after insert on public.cars
for each row execute function public.notify_admins_of_vehicle_submission();

create or replace function public.notify_admins_of_pending_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verified_status = 'pending'
     and old.verified_status is distinct from new.verified_status then
    insert into public.notifications (user_id, title, message, type, link)
    select
      id,
      'Identity verification needed',
      'A user submitted identity verification for review.',
      'info',
      '/admin/users'
    from public.profiles
    where role in ('admin', 'super_admin')
      and deleted_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_admins_of_pending_verification on public.profiles;
create trigger notify_admins_of_pending_verification
after update of verified_status on public.profiles
for each row execute function public.notify_admins_of_pending_verification();

drop policy if exists "Booking participants can read meetup verification images" on public.verification_images;
create policy "Active booking participants can read meetup verification images"
on public.verification_images
for select
using (
  public.is_admin()
  or (
    image_type in ('selfie', 'selfie_with_id')
    and exists (
      select 1
      from public.bookings b
      where b.status in ('fully_paid', 'active', 'completed')
        and (
          (b.renter_id = verification_images.user_id and b.owner_id = auth.uid())
          or (b.owner_id = verification_images.user_id and b.renter_id = auth.uid())
        )
    )
  )
);

-- Browser clients may only create notifications for themselves. System, webhook,
-- cron, and server API routes use the service role and bypass these policies.
drop policy if exists "Authenticated users can insert notifications" on public.notifications;
drop policy if exists "Users can insert own notifications" on public.notifications;
drop policy if exists "Admins can insert notifications" on public.notifications;

create policy "Users can insert own notifications"
on public.notifications
for insert
with check (auth.uid() = user_id);

create policy "Admins can insert notifications"
on public.notifications
for insert
with check (public.is_admin());

-- General support tickets are routed to administrators. Cross-user inquiry
-- tickets are created only through /api/create-car-inquiry after the API checks
-- the vehicle owner, preventing arbitrary notification spam.
drop policy if exists "Users can create own tickets" on public.support_tickets;
drop policy if exists "Admins can create tickets for users" on public.support_tickets;

create policy "Users can create own unassigned tickets"
on public.support_tickets
for insert
with check (auth.uid() = user_id and participant_user_id is null);

create policy "Admins can create tickets for users"
on public.support_tickets
for insert
with check (public.is_admin());

create or replace function public.notify_support_ticket_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.participant_user_id is not null then
    insert into public.notifications (user_id, title, message, type, link)
    values (
      new.participant_user_id,
      'New car inquiry',
      'A renter opened a vehicle inquiry. Reply from the Support page.',
      'support',
      '/support'
    );
  else
    insert into public.notifications (user_id, title, message, type, link)
    select
      id,
      'New support ticket submitted',
      new.subject || ' needs review from the support queue.',
      'support',
      '/admin/support'
    from public.profiles
    where role in ('admin', 'super_admin')
      and deleted_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_support_ticket_created on public.support_tickets;
create trigger notify_support_ticket_created
after insert on public.support_tickets
for each row execute function public.notify_support_ticket_created();

-- Only administrators and trusted server routes may create audit/security rows.
-- Normal browser activity must be recorded by a validated server flow to be
-- treated as trustworthy evidence.
drop policy if exists "System insert audit log" on public.audit_log;
drop policy if exists "Admins can insert audit log" on public.audit_log;
create policy "Admins can insert audit log"
on public.audit_log
for insert
with check (public.is_admin());

drop policy if exists "System insert security logs" on public.security_logs;
drop policy if exists "Admins can insert security logs" on public.security_logs;
create policy "Admins can insert security logs"
on public.security_logs
for insert
with check (public.is_admin());

commit;


-- ============================================================================
-- CHAPTER 10 - SOURCE: database_scripts/2026-07-22_guest_inquiries.sql
-- SOURCE SHA256: 6457cc41e43540542ba5e7be231d43061c96dd3b436131311071c326bfd3c706
-- ============================================================================

-- Public guest inquiry queue.
-- Anonymous callers never write this table directly. The public API validates,
-- rate-limits, and inserts with the Supabase service role.

begin;

create table if not exists public.guest_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) between 5 and 320),
  phone text,
  subject text not null check (char_length(subject) between 3 and 160),
  topics text[] not null default '{}',
  message text not null check (char_length(message) between 5 and 3000),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'closed')),
  admin_reply text,
  replied_at timestamptz,
  review_started_at timestamptz,
  resolved_at timestamptz,
  assigned_admin_id uuid references public.profiles(id) on delete set null,
  request_fingerprint text not null,
  source text not null default 'public_contact',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upgrade an existing SafeDrive database without dropping guest inquiries.
alter table public.guest_inquiries
  add column if not exists topics text[] not null default '{}',
  add column if not exists review_started_at timestamptz,
  add column if not exists resolved_at timestamptz;

update public.guest_inquiries
set topics = array[subject]
where coalesce(cardinality(topics), 0) = 0;

-- Preserve the real reply time for inquiries resolved before resolved_at was
-- introduced. Do not use now(), because that would falsify the history.
update public.guest_inquiries
set resolved_at = replied_at
where status = 'resolved'
  and resolved_at is null
  and replied_at is not null;

create index if not exists guest_inquiries_status_created_idx
  on public.guest_inquiries (status, created_at desc);

create index if not exists guest_inquiries_email_created_idx
  on public.guest_inquiries (lower(email), created_at desc);

create index if not exists guest_inquiries_fingerprint_created_idx
  on public.guest_inquiries (request_fingerprint, created_at desc);

alter table public.guest_inquiries enable row level security;

drop policy if exists "Admins can read guest inquiries" on public.guest_inquiries;
create policy "Admins can read guest inquiries"
on public.guest_inquiries
for select
using (public.is_admin());

drop policy if exists "Admins can update guest inquiries" on public.guest_inquiries;
create policy "Admins can update guest inquiries"
on public.guest_inquiries
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Super admins can delete guest inquiries" on public.guest_inquiries;
create policy "Super admins can delete guest inquiries"
on public.guest_inquiries
for delete
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'super_admin'
      and deleted_at is null
  )
);

-- Threaded user inquiries: a signed-in person's inquiry is linked to their
-- account and becomes a back-and-forth conversation in `guest_inquiry_messages`;
-- a true guest (no token) has no linked user and stays a one-email exchange.
alter table public.guest_inquiries
  add column if not exists submitted_by_user_id uuid references public.profiles(id) on delete set null;

alter table public.guest_inquiries
  drop constraint if exists guest_inquiries_message_check_min;
-- The base table CHECK still enforces 10-3000; relax it to 5-3000 for quick
-- questions. `char_length(message) between 10 and 3000` is inlined on the column
-- so drop/re-add via a named constraint is not possible - use a table CHECK.
do $$
begin
  alter table public.guest_inquiries drop constraint guest_inquiries_message_check;
exception when undefined_object then null; end $$;
alter table public.guest_inquiries
  add constraint guest_inquiries_message_check check (char_length(message) between 5 and 3000);

drop policy if exists "Inquirer reads own inquiries" on public.guest_inquiries;
create policy "Inquirer reads own inquiries"
on public.guest_inquiries
for select
using (public.is_admin() or submitted_by_user_id = auth.uid());

create table if not exists public.guest_inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.guest_inquiries(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_role text not null check (sender_role in ('inquirer', 'admin')),
  message text not null check (char_length(message) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index if not exists idx_guest_inquiry_messages_inquiry
  on public.guest_inquiry_messages (inquiry_id, created_at);

alter table public.guest_inquiry_messages enable row level security;

drop policy if exists "Inquiry participants read messages" on public.guest_inquiry_messages;
create policy "Inquiry participants read messages"
on public.guest_inquiry_messages
for select
using (
  public.is_admin()
  or exists (
    select 1 from public.guest_inquiries gi
    where gi.id = guest_inquiry_messages.inquiry_id
      and gi.submitted_by_user_id = auth.uid()
  )
);

drop policy if exists "Inquirer posts follow-up messages" on public.guest_inquiry_messages;
create policy "Inquirer posts follow-up messages"
on public.guest_inquiry_messages
for insert
with check (
  sender_role = 'inquirer'
  and sender_id = auth.uid()
  and exists (
    select 1 from public.guest_inquiries gi
    where gi.id = guest_inquiry_messages.inquiry_id
      and gi.submitted_by_user_id = auth.uid()
      and gi.status not in ('resolved', 'closed')
  )
);
-- Admin messages are inserted only by the service-role reply route.

create or replace function public.set_guest_inquiry_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_guest_inquiry_updated_at on public.guest_inquiries;
create trigger set_guest_inquiry_updated_at
before update on public.guest_inquiries
for each row execute function public.set_guest_inquiry_updated_at();

create or replace function public.notify_admins_of_guest_inquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, message, type, link)
  select
    id,
    'Guest inquiry needs a reply',
    new.name || ' asked about ' || new.subject || '. Open Guest Inquiries to review it.',
    'support',
    '/admin/guest-inquiries?inquiry=' || new.id::text
  from public.profiles
  where role in ('admin', 'super_admin')
    and deleted_at is null;

  return new;
end;
$$;

drop trigger if exists notify_admins_of_guest_inquiry on public.guest_inquiries;
create trigger notify_admins_of_guest_inquiry
after insert on public.guest_inquiries
for each row execute function public.notify_admins_of_guest_inquiry();

commit;


-- ============================================================================
-- CHAPTER 11 - SOURCE: database_scripts/2026-07-22_private_sensitive_storage.sql
-- SOURCE SHA256: 804d68796a2e037ec5c3d444b6d3048f239e159e98b19ae99ea9c9fc44e78b46
-- ============================================================================

-- Keep KYC files and new support attachments out of public storage URLs.
-- Existing listing photos remain in vehicle-documents because they are public
-- catalog assets; only new support attachments move to a dedicated bucket.

begin;

insert into storage.buckets (id, name, public)
values ('user-verification', 'user-verification', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('vehicle-private-documents', 'vehicle-private-documents', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('car-documents', 'car-documents', false)
on conflict (id) do update set public = false;

-- A KYC selfie must never double as a publicly addressable profile avatar.
update public.profiles
set avatar_url = null
where avatar_url like '%/storage/v1/object/public/user-verification/%'
   or avatar_url like '%/user-verification/%';

drop policy if exists "Users upload own private verification files" on storage.objects;
create policy "Users upload own private verification files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'user-verification'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update own private verification files" on storage.objects;
create policy "Users update own private verification files"
on storage.objects for update to authenticated
using (
  bucket_id = 'user-verification'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'user-verification'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Authorized users read private verification files" on storage.objects;
create policy "Authorized users read private verification files"
on storage.objects for select to authenticated
using (
  bucket_id = 'user-verification'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or (
      name ~ '(^|/)selfie(_with_id)?\.[^/]+$'
      and exists (
        select 1
        from public.bookings b
        where b.status in ('fully_paid', 'active', 'completed')
          and (
            (b.renter_id::text = (storage.foldername(name))[1] and b.owner_id = auth.uid())
            or (b.owner_id::text = (storage.foldername(name))[1] and b.renter_id = auth.uid())
          )
      )
    )
  )
);

drop policy if exists "Users delete own private verification files" on storage.objects;
create policy "Users delete own private verification files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'user-verification'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

drop policy if exists "Ticket participants upload private attachments" on storage.objects;
create policy "Ticket participants upload private attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  and (storage.foldername(name))[1] = 'support-tickets'
  and exists (
    select 1
    from public.support_tickets t
    where t.id::text = (storage.foldername(name))[2]
      and (
        t.user_id = auth.uid()
        or t.participant_user_id = auth.uid()
        or public.is_admin()
      )
  )
);

drop policy if exists "Ticket participants read private attachments" on storage.objects;
create policy "Ticket participants read private attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  and (storage.foldername(name))[1] = 'support-tickets'
  and exists (
    select 1
    from public.support_tickets t
    where t.id::text = (storage.foldername(name))[2]
      and (
        t.user_id = auth.uid()
        or t.participant_user_id = auth.uid()
        or public.is_admin()
      )
  )
);

drop policy if exists "Ticket participants update private attachments" on storage.objects;
create policy "Ticket participants update private attachments"
on storage.objects for update to authenticated
using (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.support_tickets t
    where t.id::text = (storage.foldername(name))[2]
      and (t.user_id = auth.uid() or t.participant_user_id = auth.uid() or public.is_admin())
  )
)
with check (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.support_tickets t
    where t.id::text = (storage.foldername(name))[2]
      and (t.user_id = auth.uid() or t.participant_user_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists "Ticket participants delete private attachments" on storage.objects;
create policy "Ticket participants delete private attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.support_tickets t
    where t.id::text = (storage.foldername(name))[2]
      and (t.user_id = auth.uid() or t.participant_user_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists "Vehicle owners upload private documents" on storage.objects;
create policy "Vehicle owners upload private documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'vehicle-private-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.cars c
    where c.id::text = (storage.foldername(name))[2] and c.owner_id = auth.uid()
  )
);

drop policy if exists "Authorized users read private vehicle documents" on storage.objects;
create policy "Authorized users read private vehicle documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'vehicle-private-documents'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or (
      name like '%/rental_agreement%'
      and exists (
        select 1 from public.bookings b
        where b.car_id::text = (storage.foldername(name))[2]
          and b.renter_id = auth.uid()
          and b.status in ('downpayment_paid', 'fully_paid', 'active', 'completed')
      )
    )
  )
);

drop policy if exists "Vehicle owners update private documents" on storage.objects;
create policy "Vehicle owners update private documents"
on storage.objects for update to authenticated
using (
  bucket_id = 'vehicle-private-documents'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
)
with check (
  bucket_id = 'vehicle-private-documents'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

drop policy if exists "Vehicle owners delete private documents" on storage.objects;
create policy "Vehicle owners delete private documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'vehicle-private-documents'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

drop policy if exists "Vehicle owners upload renewal documents" on storage.objects;
create policy "Vehicle owners upload renewal documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'car-documents'
  and (storage.foldername(name))[1] = 'renewals'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (
    select 1 from public.cars c
    where c.id::text = (storage.foldername(name))[3] and c.owner_id = auth.uid()
  )
);

drop policy if exists "Authorized users read renewal documents" on storage.objects;
create policy "Authorized users read renewal documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'car-documents'
  and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin())
);

drop policy if exists "Vehicle owners update renewal documents" on storage.objects;
create policy "Vehicle owners update renewal documents"
on storage.objects for update to authenticated
using (
  bucket_id = 'car-documents'
  and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin())
)
with check (
  bucket_id = 'car-documents'
  and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin())
);

drop policy if exists "Vehicle owners delete renewal documents" on storage.objects;
create policy "Vehicle owners delete renewal documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'car-documents'
  and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin())
);

commit;


-- ============================================================================
-- CHAPTER 12 - SOURCE: database_scripts/2026-07-22_trusted_user_audit_triggers.sql
-- SOURCE SHA256: 4d60405eb44baaeea7f0d59ec3b9c1c2a09540d448df85e1be95ea94240e0108
-- ============================================================================

-- Record user-owned lifecycle events inside PostgreSQL so a modified browser
-- cannot forge, suppress, or impersonate audit entries.

begin;

create or replace function public.audit_vehicle_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
begin
  actor_id := coalesce(auth.uid(), case when tg_op = 'DELETE' then old.owner_id else new.owner_id end);

  if tg_op = 'INSERT' then
    insert into public.audit_log (user_id, action, entity_type, entity_id, details)
    values (
      actor_id,
      'vehicle_submitted',
      'car',
      new.id,
      jsonb_build_object('plate', new.plate_number, 'price', new.price_per_day)
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'approved' and new.status = 'inactive' then
      insert into public.audit_log (user_id, action, entity_type, entity_id, details)
      values (actor_id, 'vehicle_disabled', 'car', new.id,
        jsonb_build_object('plate', new.plate_number, 'previous_status', old.status, 'new_status', new.status));
    elsif old.status = 'inactive' and new.status = 'approved' then
      insert into public.audit_log (user_id, action, entity_type, entity_id, details)
      values (actor_id, 'vehicle_enabled', 'car', new.id,
        jsonb_build_object('plate', new.plate_number, 'previous_status', old.status, 'new_status', new.status));
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log (user_id, action, entity_type, entity_id, details)
    values (
      actor_id,
      case when public.is_admin() then 'vehicle_deleted_by_admin' else 'vehicle_deleted_by_lister' end,
      'car',
      old.id,
      jsonb_build_object('plate', old.plate_number)
    );
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists audit_vehicle_lifecycle on public.cars;
create trigger audit_vehicle_lifecycle
after insert or update of status or delete on public.cars
for each row execute function public.audit_vehicle_lifecycle();

create or replace function public.audit_verification_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verified_status = 'pending'
     and old.verified_status is distinct from new.verified_status
     and auth.uid() = new.id then
    insert into public.audit_log (user_id, action, entity_type, entity_id)
    values (new.id, 'verification_submitted', 'profile', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists audit_verification_submission on public.profiles;
create trigger audit_verification_submission
after update of verified_status on public.profiles
for each row execute function public.audit_verification_submission();

create or replace function public.audit_car_renewal_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (user_id, action, entity_type, entity_id, details)
  values (
    coalesce(auth.uid(), new.lister_id),
    'car_renewal_submitted',
    'car',
    new.car_id,
    jsonb_build_object('renewal_id', new.id, 'current_mileage', new.current_mileage)
  );
  return new;
end;
$$;

drop trigger if exists audit_car_renewal_submission on public.car_renewals;
create trigger audit_car_renewal_submission
after insert on public.car_renewals
for each row execute function public.audit_car_renewal_submission();

commit;


-- ============================================================================
-- CHAPTER 13 - SOURCE: database_scripts/2026-07-22_support_message_notifications.sql
-- SOURCE SHA256: 55d8cb6950d290ed4560d06cb2ca0d1859300f5c15bb92ed60e686e896042c02
-- ============================================================================

-- Notify the correct ticket participant after a reply. The first message is
-- excluded because ticket-creation routing already sends that notification.

begin;

create or replace function public.notify_support_message_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket_record public.support_tickets%rowtype;
  sender_is_admin boolean;
begin
  if not exists (
    select 1 from public.ticket_messages m
    where m.ticket_id = new.ticket_id and m.id <> new.id
  ) then
    return new;
  end if;

  select * into ticket_record
  from public.support_tickets
  where id = new.ticket_id;

  select exists (
    select 1 from public.profiles p
    where p.id = new.sender_id and p.role in ('admin', 'super_admin')
  ) into sender_is_admin;

  if sender_is_admin then
    insert into public.notifications (user_id, title, message, type, link)
    values (
      ticket_record.user_id,
      'Support replied to your ticket',
      ticket_record.subject || ' has a new response from SafeDrive Support.',
      'support',
      '/support'
    );
  elsif ticket_record.participant_user_id is not null then
    insert into public.notifications (user_id, title, message, type, link)
    values (
      case
        when new.sender_id = ticket_record.user_id then ticket_record.participant_user_id
        else ticket_record.user_id
      end,
      'New inquiry reply',
      ticket_record.subject || ' has a new reply.',
      'support',
      '/support'
    );
  else
    insert into public.notifications (user_id, title, message, type, link)
    select
      p.id,
      'Support ticket reply received',
      ticket_record.subject || ' has a new customer reply.',
      'support',
      '/admin/support'
    from public.profiles p
    where p.role in ('admin', 'super_admin') and p.deleted_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_support_message_created on public.ticket_messages;
create trigger notify_support_message_created
after insert on public.ticket_messages
for each row execute function public.notify_support_message_created();

commit;


-- ============================================================================
-- CHAPTER 14 - OPERATIONS, AGREEMENTS, DEPOSITS, RETENTION, AND LEDGER
-- ============================================================================

begin;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin' and deleted_at is null
  );
$$;

-- Upgrade prerequisites for databases that already ran Chapters 3-13. Keep
-- these ALTER statements in Chapter 14 so operators do not need to rerun the
-- historical reset or alignment chapters.
alter table public.cars
  add column if not exists security_deposit_amount numeric not null default 0;

alter table public.cars
  drop constraint if exists cars_price_per_day_check;
alter table public.cars
  add constraint cars_price_per_day_check
  check (price_per_day >= 500 and price_per_day <= 100000) not valid;

-- Philippine four-wheel plate format: 3 letters, optional space/hyphen, 3-4
-- digits. Rejects malformed input (e.g. ABC12345) at the database, matching the
-- client-side check in src/lib/vehicleValidation.ts. Validated: every existing
-- row already conforms.
alter table public.cars
  drop constraint if exists cars_plate_number_format;
alter table public.cars
  add constraint cars_plate_number_format
  check (plate_number ~ '^[A-Z]{3}[ -]?[0-9]{3,4}$');

alter table public.cars
  drop constraint if exists cars_security_deposit_amount_check;
alter table public.cars
  add constraint cars_security_deposit_amount_check
  check (security_deposit_amount >= 0 and security_deposit_amount <= 100000);

alter table public.payments
  drop constraint if exists payments_payment_type_check;
alter table public.payments
  add constraint payments_payment_type_check
  check (payment_type in ('downpayment', 'balance', 'extension', 'security_deposit', 'refund', 'payout'));

-- Agreement versioning. Every booking keeps the exact approved version.
alter table public.car_documents
  add column if not exists content_sha256 text;

create table if not exists public.car_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  document_id uuid references public.car_documents(id) on delete set null,
  version_number integer not null check (version_number > 0),
  storage_path text not null,
  content_sha256 text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (car_id, version_number)
);

create unique index if not exists car_agreement_one_approved_version
  on public.car_agreement_versions (car_id)
  where status = 'approved';

-- Agreement snapshots are immutable evidence once versioned. Owners and
-- ordinary admins may replace the current document through the review flow,
-- but they cannot directly delete a storage object referenced by history.
drop policy if exists "Vehicle owners delete private documents" on storage.objects;
create policy "Vehicle owners delete private documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'vehicle-private-documents'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  and not exists (
    select 1
    from public.car_agreement_versions agreement_version
    where agreement_version.storage_path = storage.objects.name
  )
);

alter table public.bookings
  add column if not exists agreement_version_id uuid references public.car_agreement_versions(id) on delete restrict,
  add column if not exists agreement_storage_path_snapshot text,
  add column if not exists agreement_sha256_snapshot text,
  add column if not exists payment_processing_fee numeric(12,2) not null default 0;

create table if not exists public.booking_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  agreement_version_id uuid not null references public.car_agreement_versions(id) on delete restrict,
  renter_id uuid not null references public.profiles(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  acceptance_text_version text not null default '2026-07-27',
  unique (booking_id, renter_id, agreement_version_id)
);

-- Backfill one approved snapshot for already-approved listings without changing
-- an existing booking. New bookings must select the approved version.
insert into public.car_agreement_versions (
  car_id, document_id, version_number, storage_path, content_sha256, status, uploaded_by, approved_at
)
select distinct on (d.car_id)
  d.car_id,
  d.id,
  1,
  d.storage_path,
  d.content_sha256,
  case when c.status in ('approved', 'active', 'inactive') then 'approved' else 'pending' end,
  c.owner_id,
  case when c.status in ('approved', 'active', 'inactive') then coalesce(c.last_verified_at, d.created_at, now()) else null end
from public.car_documents d
join public.cars c on c.id = d.car_id
where d.document_type = 'rental_agreement'
  and not exists (
    select 1 from public.car_agreement_versions v where v.car_id = d.car_id
  )
order by d.car_id, d.created_at desc;

create or replace function public.queue_rental_agreement_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
begin
  if new.document_type <> 'rental_agreement' then return new; end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.car_agreement_versions where car_id = new.car_id;

  update public.car_agreement_versions
  set status = 'superseded'
  where car_id = new.car_id and status = 'approved';

  insert into public.car_agreement_versions (
    car_id, document_id, version_number, storage_path, content_sha256, status, uploaded_by
  )
  select new.car_id, new.id, next_version, new.storage_path, new.content_sha256, 'pending', c.owner_id
  from public.cars c where c.id = new.car_id;

  update public.cars
  set status = 'pending', last_verified_at = null
  where id = new.car_id and status in ('approved', 'active', 'inactive');
  return new;
end;
$$;

drop trigger if exists queue_rental_agreement_version on public.car_documents;
create trigger queue_rental_agreement_version
after insert on public.car_documents
for each row execute function public.queue_rental_agreement_version();

create or replace function public.return_materially_changed_car_to_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('approved', 'active', 'inactive') and (
    old.model_id is distinct from new.model_id or
    old.plate_number is distinct from new.plate_number or
    old.mileage is distinct from new.mileage or
    old.price_per_day is distinct from new.price_per_day or
    old.security_deposit_amount is distinct from new.security_deposit_amount or
    old.location is distinct from new.location or
    old.fuel_category is distinct from new.fuel_category or
    old.fuel_subtype is distinct from new.fuel_subtype or
    old.gps_available is distinct from new.gps_available or
    old.additional_info is distinct from new.additional_info
  ) then
    new.status := 'pending';
    new.last_verified_at := null;
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists return_materially_changed_car_to_review on public.cars;
create trigger return_materially_changed_car_to_review
before update on public.cars
for each row execute function public.return_materially_changed_car_to_review();

create or replace function public.approve_latest_car_agreement_with_vehicle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_version uuid;
begin
  if new.status = 'approved' and old.status is distinct from new.status then
    select id into selected_version
    from public.car_agreement_versions
    where car_id = new.id and status = 'pending'
    order by version_number desc limit 1;

    if selected_version is not null then
      update public.car_agreement_versions
      set status = 'superseded'
      where car_id = new.id and status = 'approved';

      update public.car_agreement_versions
      set status = 'approved', approved_by = auth.uid(), approved_at = now()
      where id = selected_version;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists approve_latest_car_agreement_with_vehicle on public.cars;
create trigger approve_latest_car_agreement_with_vehicle
after update of status on public.cars
for each row execute function public.approve_latest_car_agreement_with_vehicle();

-- Insurance evidence and warnings. These fields are evidence for review, not a
-- claim by SafeDrive that a policy necessarily covers peer-to-peer rental.
alter table public.cars
  add column if not exists registration_expiry date,
  add column if not exists ctpl_expiry date,
  add column if not exists comprehensive_insurance_expiry date,
  add column if not exists insurer_rental_use_confirmed boolean not null default false,
  add column if not exists insurance_verification_status text not null default 'not_reviewed';

do $$ begin
  alter table public.cars add constraint cars_insurance_verification_status_check
    check (insurance_verification_status in ('not_reviewed', 'pending', 'verified', 'warning', 'expired', 'rejected'));
exception when duplicate_object then null; end $$;

create or replace function public.return_materially_changed_car_to_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('approved', 'active', 'inactive') and (
    old.model_id is distinct from new.model_id or old.plate_number is distinct from new.plate_number or
    old.mileage is distinct from new.mileage or old.price_per_day is distinct from new.price_per_day or
    old.security_deposit_amount is distinct from new.security_deposit_amount or old.location is distinct from new.location or
    old.fuel_category is distinct from new.fuel_category or old.fuel_subtype is distinct from new.fuel_subtype or
    old.gps_available is distinct from new.gps_available or old.contact_number is distinct from new.contact_number or
    old.additional_info is distinct from new.additional_info or
    old.registration_expiry is distinct from new.registration_expiry or old.ctpl_expiry is distinct from new.ctpl_expiry or
    old.comprehensive_insurance_expiry is distinct from new.comprehensive_insurance_expiry or
    old.insurer_rental_use_confirmed is distinct from new.insurer_rental_use_confirmed
  ) then
    new.status := 'pending';
    new.last_verified_at := null;
    new.rejection_reason := null;
    new.insurance_verification_status := 'pending';
  end if;
  return new;
end;
$$;

-- Replacing public listing images is also a material change. Keep the listing
-- out of the catalog until an admin has reviewed the new visual evidence.
create or replace function public.return_car_image_change_to_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_car_id uuid;
begin
  affected_car_id := coalesce(new.car_id, old.car_id);
  update public.cars
  set status = 'pending', last_verified_at = null, rejection_reason = null
  where id = affected_car_id and status in ('approved', 'active', 'inactive');
  return coalesce(new, old);
end;
$$;

drop trigger if exists return_car_image_change_to_review on public.car_images;
create trigger return_car_image_change_to_review
after insert or update or delete on public.car_images
for each row execute function public.return_car_image_change_to_review();

create or replace function public.enforce_vehicle_insurance_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' then
    if new.registration_expiry is null or new.registration_expiry < current_date then
      raise exception 'Current registration expiry is required before approval';
    end if;
    if new.ctpl_expiry is null or new.ctpl_expiry < current_date then
      raise exception 'Current CTPL expiry is required before approval';
    end if;
    if not new.insurer_rental_use_confirmed then
      raise exception 'Lister must confirm rental-use disclosure with the insurer before approval';
    end if;
    new.insurance_verification_status := case
      when new.comprehensive_insurance_expiry is null then 'warning'
      when new.comprehensive_insurance_expiry < current_date then 'warning'
      else 'verified'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_vehicle_insurance_approval on public.cars;
create trigger enforce_vehicle_insurance_approval
before update of status on public.cars
for each row execute function public.enforce_vehicle_insurance_approval();

-- Slot-limit enforcement so a lister cannot keep more live listings than the
-- plan they are paying for (base 5 + any active subscription's additional
-- slots). deactivate_cars_over_slot_limit pauses the newest listings beyond the
-- allowance, keeping the oldest; it is called on the explicit "Switch to Free
-- now" cancel (api/cancel-subscription.ts rpc) and on lazy expiry (trigger).
-- The upgrade webhook uses status 'cancelled', not 'expired', so mid-upgrade
-- housekeeping never trips the expiry trigger.
create or replace function public.deactivate_cars_over_slot_limit(p_owner uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  allowance integer;
  affected integer;
begin
  select 5 + coalesce(max(additional_slots), 0)
    into allowance
    from public.subscriptions
    where user_id = p_owner and status = 'active';
  allowance := coalesce(allowance, 5);

  with excess as (
    select id
    from public.cars
    where owner_id = p_owner and status in ('approved', 'active')
    order by created_at asc
    offset allowance
  )
  update public.cars c
    set status = 'inactive'
    from excess
    where c.id = excess.id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.deactivate_cars_over_slot_limit(uuid) from public, anon, authenticated;

create or replace function public.trg_subscription_expiry_slot_enforce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status = 'expired' then
    perform public.deactivate_cars_over_slot_limit(new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists subscription_expiry_slot_enforce on public.subscriptions;
create trigger subscription_expiry_slot_enforce
  after update on public.subscriptions
  for each row execute function public.trg_subscription_expiry_slot_enforce();

create or replace function public.trg_enforce_live_car_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowance integer;
  live_count integer;
begin
  if old.status = 'inactive' and new.status in ('approved', 'active') then
    select 5 + coalesce(max(additional_slots), 0)
      into allowance
      from public.subscriptions
      where user_id = new.owner_id and status = 'active';
    allowance := coalesce(allowance, 5);

    select count(*)
      into live_count
      from public.cars
      where owner_id = new.owner_id
        and status in ('approved', 'active')
        and id <> new.id;

    if live_count >= allowance then
      raise exception
        'Vehicle slot limit reached: your current plan allows % live listing(s). Upgrade your plan to reactivate more.',
        allowance
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_live_car_limit on public.cars;
create trigger enforce_live_car_limit
  before update on public.cars
  for each row execute function public.trg_enforce_live_car_limit();

-- Lister maintenance and personal-use blackouts.
create table if not exists public.vehicle_unavailability (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text not null check (char_length(reason) between 3 and 500),
  category text not null default 'maintenance'
    check (category in ('maintenance', 'repair', 'personal_use', 'inspection', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

do $$ begin
  alter table public.vehicle_unavailability
  add constraint vehicle_unavailability_no_overlap
  exclude using gist (car_id with =, daterange(start_date, end_date, '[]') with &&);
exception when duplicate_object then null; end $$;

create or replace function public.prevent_blackout_booking_conflict()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.bookings b
    where b.car_id = new.car_id
      and b.status in ('pending', 'confirmed', 'awaiting_payment', 'downpayment_paid', 'fully_paid', 'active')
      and daterange(b.start_date, b.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'Vehicle blackout conflicts with an active or paid booking';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_blackout_booking_conflict on public.vehicle_unavailability;
create trigger prevent_blackout_booking_conflict
before insert or update on public.vehicle_unavailability
for each row execute function public.prevent_blackout_booking_conflict();

create or replace function public.prevent_booking_blackout_conflict()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('pending', 'confirmed', 'awaiting_payment', 'downpayment_paid', 'fully_paid', 'active') and exists (
    select 1 from public.vehicle_unavailability u
    where u.car_id = new.car_id
      and daterange(u.start_date, u.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'Selected dates overlap a vehicle maintenance or availability blackout';
  end if;
  return new;
end;
$$;

-- Renter-facing read of a listed car's blackout ranges (dates + category only,
-- never the free-text reason). The "Owners manage vehicle blackouts" RLS policy
-- only exposes an owner's own rows, so the booking calendar in
-- src/pages/CarDetailPage.tsx calls this SECURITY DEFINER function to grey out
-- owner-blocked dates instead of letting the request fail on the trigger below.
create or replace function public.get_car_blackout_ranges(p_car_id uuid)
returns table(start_date date, end_date date, category text)
language sql
security definer
set search_path = public
stable
as $$
  select u.start_date, u.end_date, u.category
  from public.vehicle_unavailability u
  join public.cars c on c.id = u.car_id
  where u.car_id = p_car_id
    and c.status in ('approved', 'active')
    and u.end_date >= current_date;
$$;

grant execute on function public.get_car_blackout_ranges(uuid) to anon, authenticated;

drop trigger if exists prevent_booking_blackout_conflict on public.bookings;
create trigger prevent_booking_blackout_conflict
before insert or update of car_id, start_date, end_date, status on public.bookings
for each row execute function public.prevent_booking_blackout_conflict();

-- Independent pickup and return evidence from both parties.
create table if not exists public.trip_condition_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  reporter_role text not null check (reporter_role in ('renter', 'lister')),
  phase text not null check (phase in ('pickup', 'return')),
  odometer_reading integer not null check (odometer_reading >= 0),
  fuel_or_battery_level integer not null check (fuel_or_battery_level between 0 and 100),
  damage_notes text not null default '',
  latitude numeric(9,6),
  longitude numeric(9,6),
  location_accuracy_meters numeric,
  location_consent boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (booking_id, reporter_id, phase)
);

alter table public.trip_condition_reports
  drop constraint if exists trip_condition_reports_location_values_check,
  add constraint trip_condition_reports_location_values_check check (
    (latitude is null or latitude between -90 and 90)
    and (longitude is null or longitude between -180 and 180)
    and (location_accuracy_meters is null or location_accuracy_meters >= 0)
    and (location_consent or (latitude is null and longitude is null and location_accuracy_meters is null))
  );

-- Lighter trip reports: the odometer / fuel typed readings are now optional
-- (the odometer + fuel photos carry the evidence), and a report can be
-- submitted with an incomplete photo set as long as it is explicitly flagged
-- `evidence_waived` - that flag is surfaced to a super admin in any deposit
-- dispute so the party that skipped evidence is on record.
alter table public.trip_condition_reports
  alter column odometer_reading drop not null,
  alter column fuel_or_battery_level drop not null,
  add column if not exists evidence_waived boolean not null default false;

create table if not exists public.trip_condition_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.trip_condition_reports(id) on delete cascade,
  category text not null check (category in ('front', 'back', 'left', 'right', 'interior', 'odometer', 'fuel_or_battery', 'damage')),
  storage_path text not null,
  captured_at timestamptz not null default now(),
  unique (report_id, category)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-condition-evidence',
  'trip-condition-evidence',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Separate refundable security-deposit state; deposits never count as revenue.
create table if not exists public.security_deposits (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  renter_id uuid not null references public.profiles(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  amount_centavos bigint not null check (amount_centavos >= 0),
  status text not null default 'required'
    check (status in ('required', 'awaiting_payment', 'paid', 'return_review', 'claim_open', 'no_claim', 'refund_pending', 'deduction_approved', 'released', 'partially_released', 'claimed', 'failed')),
  provider_payment_id text,
  provider_checkout_id text,
  provider_refund_id text,
  claim_deadline timestamptz,
  paid_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.security_deposits
  add column if not exists provider_checkout_id text;

-- Preserve PayMongo identifiers for subscription reconciliation. These ALTER
-- statements also upgrade databases created from an earlier master version.
alter table public.subscriptions
  add column if not exists provider_checkout_id text,
  add column if not exists provider_payment_id text,
  add column if not exists amount_centavos bigint,
  add column if not exists paid_at timestamptz,
  -- Set by api/cancel-subscription.ts. The plan is a one-time 30-day purchase
  -- with no auto-renewal, so cancelling only marks intent: status and end_date
  -- are left alone, every perk is kept until end_date, and the normal lazy
  -- expiry then flips it to 'expired'.
  add column if not exists cancelled_at timestamptz;

alter table public.subscriptions
  drop constraint if exists subscriptions_amount_centavos_check;
alter table public.subscriptions
  add constraint subscriptions_amount_centavos_check
  check (amount_centavos is null or amount_centavos > 0);

create unique index if not exists subscriptions_provider_checkout_unique
  on public.subscriptions(provider_checkout_id)
  where provider_checkout_id is not null;
create unique index if not exists subscriptions_provider_payment_unique
  on public.subscriptions(provider_payment_id)
  where provider_payment_id is not null;

create table if not exists public.security_deposit_claims (
  id uuid primary key default gen_random_uuid(),
  security_deposit_id uuid not null references public.security_deposits(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  amount_centavos bigint not null check (amount_centavos > 0),
  reason text not null check (char_length(reason) between 10 and 3000),
  evidence jsonb not null default '[]'::jsonb,
  renter_response text,
  status text not null default 'submitted'
    check (status in ('submitted', 'renter_responded', 'approved', 'partially_approved', 'rejected', 'withdrawn')),
  approved_amount_centavos bigint,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists security_deposit_one_open_claim
  on public.security_deposit_claims (security_deposit_id)
  where status in ('submitted', 'renter_responded');

-- Data-subject request queue and actual retention decisions.
create table if not exists public.data_retention_requests (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid references public.profiles(id) on delete set null,
  requester_email text not null,
  request_type text not null check (request_type in ('access', 'correction', 'deletion', 'anonymization', 'restriction')),
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'identity_check', 'approved', 'executed', 'denied', 'cancelled', 'legal_hold')),
  request_details text not null,
  decision_reason text,
  legal_hold_reason text,
  assigned_to uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.retention_policy_rules (
  record_category text primary key,
  retention_days integer,
  rationale text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.retention_policy_rules (record_category, retention_days, rationale)
values
  ('abandoned_guest_inquiry', 90, 'Minimize unused visitor data'),
  ('resolved_guest_inquiry', 365, 'Answer history and service quality'),
  ('rejected_kyc_after_appeal', 90, 'Short appeal and fraud-review window'),
  ('support_case', 730, 'Dispute and service history'),
  ('trip_condition_no_dispute', 730, 'Vehicle-condition evidence window'),
  ('financial_source_record', 1825, 'Five-year BIR accounting/source-record baseline'),
  ('agreement_acceptance', 3650, 'Written-contract evidence; confirm with Philippine counsel'),
  ('security_audit_log', 730, 'Security investigation and accountability'),
  ('unsuccessful_login_telemetry', 90, 'Short security telemetry window unless incident-related')
on conflict (record_category) do update
set retention_days = excluded.retention_days, rationale = excluded.rationale, updated_at = now();

-- Lightweight double-entry ledger. Money is always integer centavos.
alter table public.platform_settings
  add column if not exists ledger_activated_at timestamptz,
  add column if not exists payment_processing_fee_rate numeric(8,6) not null default 0,
  add column if not exists payment_processing_fixed_centavos integer not null default 0;

update public.platform_settings
set ledger_activated_at = coalesce(ledger_activated_at, now())
where id = 'default';

-- Configurable reservation downpayment share and cancellation-refund policy.
-- api/create-booking.ts reads these and snapshots them onto each booking row so
-- a later change never rewrites an existing booking's terms.
alter table public.platform_settings
  add column if not exists downpayment_rate numeric not null default 0.5,
  add column if not exists refund_full_hours integer not null default 24,
  add column if not exists refund_late_renter_percent numeric not null default 50;

alter table public.platform_settings
  drop constraint if exists platform_settings_downpayment_rate_check;
alter table public.platform_settings
  add constraint platform_settings_downpayment_rate_check
  check (downpayment_rate >= 0.2 and downpayment_rate <= 1.0);
alter table public.platform_settings
  drop constraint if exists platform_settings_refund_full_hours_check;
alter table public.platform_settings
  add constraint platform_settings_refund_full_hours_check
  check (refund_full_hours >= 0 and refund_full_hours <= 720);
alter table public.platform_settings
  drop constraint if exists platform_settings_refund_late_renter_percent_check;
alter table public.platform_settings
  add constraint platform_settings_refund_late_renter_percent_check
  check (refund_late_renter_percent >= 0 and refund_late_renter_percent <= 100);

alter table public.bookings
  add column if not exists downpayment_rate_snapshot numeric,
  add column if not exists refund_full_hours_snapshot integer,
  add column if not exists refund_late_renter_percent_snapshot numeric;

-- Configurable operational timings for the trip lifecycle. Unlike the financial
-- terms above these are NOT snapshotted per booking - they are read live:
--   arrival_checkin_lead_hours       how early before pickup the arrival
--                                    check-in opens (api/booking-action.ts).
--   deposit_claim_window_hours       how long the lister has to file a
--                                    security-deposit claim after completion,
--                                    read when api/booking-action.ts sets
--                                    security_deposits.claim_deadline.
--   lister_completion_timeout_hours  after the renter completes, how long the
--                                    system waits for the lister before
--                                    auto-completing (api/expire-booking-deadlines.ts).
alter table public.platform_settings
  add column if not exists arrival_checkin_lead_hours integer not null default 3,
  add column if not exists deposit_claim_window_hours integer not null default 24,
  add column if not exists lister_completion_timeout_hours integer not null default 18;

alter table public.platform_settings
  drop constraint if exists platform_settings_arrival_checkin_lead_hours_check;
alter table public.platform_settings
  add constraint platform_settings_arrival_checkin_lead_hours_check
  check (arrival_checkin_lead_hours >= 0 and arrival_checkin_lead_hours <= 48);
alter table public.platform_settings
  drop constraint if exists platform_settings_deposit_claim_window_hours_check;
alter table public.platform_settings
  add constraint platform_settings_deposit_claim_window_hours_check
  check (deposit_claim_window_hours >= 1 and deposit_claim_window_hours <= 168);
alter table public.platform_settings
  drop constraint if exists platform_settings_lister_completion_timeout_hours_check;
alter table public.platform_settings
  add constraint platform_settings_lister_completion_timeout_hours_check
  check (lister_completion_timeout_hours >= 1 and lister_completion_timeout_hours <= 72);

-- Completion timestamps so api/expire-booking-deadlines.ts can auto-complete a
-- booking when the renter has finished but the lister has not confirmed within
-- lister_completion_timeout_hours.
alter table public.bookings
  add column if not exists renter_completed_at timestamptz,
  add column if not exists owner_completed_at timestamptz;

-- Public-facing contact / privacy email shown on Terms, Privacy Policy, Sign Up,
-- and the auth pages. A super admin edits it directly (contact info, not a
-- financial/policy value, so it does not go through the consensus vote).
alter table public.platform_settings
  add column if not exists contact_email text not null default 'admin.no.reply.360@gmail.com';

create or replace function public.get_platform_contact_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(contact_email), ''), 'admin.no.reply.360@gmail.com')
  from public.platform_settings
  where id = 'default';
$$;
grant execute on function public.get_platform_contact_email() to anon, authenticated;

create or replace function public.set_platform_contact_email(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := lower(trim(p_email));
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change the platform contact email';
  end if;
  if cleaned !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(cleaned) > 320 then
    raise exception 'Enter a valid email address';
  end if;
  update public.platform_settings
    set contact_email = cleaned, updated_at = now()
    where id = 'default';
  insert into public.audit_log (user_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'platform_contact_email_updated', 'platform_settings', 'default',
      jsonb_build_object('contact_email', cleaned));
  return cleaned;
end;
$$;
revoke all on function public.set_platform_contact_email(text) from public, anon;
grant execute on function public.set_platform_contact_email(text) to authenticated;

-- Multi-super-admin consensus for platform_settings changes. A super admin
-- proposes; it needs ceil(2N/3) approvals (N = current super-admin count,
-- re-checked on every vote) before it is applied. One pending proposal at a
-- time. The "Super admins can manage platform settings" ALL policy is dropped
-- so the only write path is these SECURITY DEFINER functions.
drop policy if exists "Super admins can manage platform settings" on public.platform_settings;

create table if not exists public.platform_setting_change_requests (
  id uuid primary key default gen_random_uuid(),
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  changes jsonb not null,
  snapshot jsonb not null,
  reason text check (reason is null or char_length(reason) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'rejected', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days')
);

create unique index if not exists platform_setting_change_one_pending
  on public.platform_setting_change_requests ((status))
  where status = 'pending';

create table if not exists public.platform_setting_change_votes (
  request_id uuid not null
    references public.platform_setting_change_requests(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  vote text not null check (vote in ('approve', 'reject')),
  voted_at timestamptz not null default now(),
  primary key (request_id, voter_id)
);

alter table public.platform_setting_change_requests enable row level security;
alter table public.platform_setting_change_votes enable row level security;

drop policy if exists "Super admins read setting change requests"
  on public.platform_setting_change_requests;
create policy "Super admins read setting change requests"
  on public.platform_setting_change_requests
  for select using (public.is_super_admin());

drop policy if exists "Super admins read setting change votes"
  on public.platform_setting_change_votes;
create policy "Super admins read setting change votes"
  on public.platform_setting_change_votes
  for select using (public.is_super_admin());

create or replace function public.validate_platform_setting_change(p_changes jsonb)
returns void
language plpgsql
immutable
as $$
declare
  k text;
  v numeric;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'No settings to change';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if jsonb_typeof(p_changes -> k) <> 'number' then
      raise exception 'Setting % must be a number', k;
    end if;
    v := (p_changes ->> k)::numeric;
    if k = 'commission_rate' then
      if v < 0 or v > 1 then raise exception 'commission_rate must be 0-1'; end if;
    elsif k = 'payment_processing_fee_rate' then
      if v < 0 or v > 0.25 then raise exception 'payment_processing_fee_rate must be 0-0.25'; end if;
    elsif k = 'payment_processing_fixed_centavos' then
      if v < 0 or v > 100000 or v <> floor(v) then raise exception 'payment_processing_fixed_centavos must be a whole number 0-100000'; end if;
    elsif k = 'downpayment_rate' then
      if v < 0.2 or v > 1 then raise exception 'downpayment_rate must be 0.2-1.0'; end if;
    elsif k = 'refund_full_hours' then
      if v < 0 or v > 720 or v <> floor(v) then raise exception 'refund_full_hours must be a whole number 0-720'; end if;
    elsif k = 'refund_late_renter_percent' then
      if v < 0 or v > 100 then raise exception 'refund_late_renter_percent must be 0-100'; end if;
    elsif k = 'arrival_checkin_lead_hours' then
      if v < 0 or v > 48 or v <> floor(v) then raise exception 'arrival_checkin_lead_hours must be a whole number 0-48'; end if;
    elsif k = 'deposit_claim_window_hours' then
      if v < 1 or v > 168 or v <> floor(v) then raise exception 'deposit_claim_window_hours must be a whole number 1-168'; end if;
    elsif k = 'lister_completion_timeout_hours' then
      if v < 1 or v > 72 or v <> floor(v) then raise exception 'lister_completion_timeout_hours must be a whole number 1-72'; end if;
    else
      raise exception 'Setting % is not configurable', k;
    end if;
  end loop;
end;
$$;

create or replace function public.platform_settings_snapshot()
returns jsonb
language sql
stable
as $$
  select to_jsonb(s) - 'id' - 'created_at' - 'updated_at' - 'ledger_activated_at'
  from public.platform_settings s
  where s.id = 'default';
$$;

create or replace function public._resolve_platform_setting_change(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.platform_setting_change_requests%rowtype;
  n int;
  threshold int;
  approvals int;
  rejects int;
  k text;
begin
  select * into req from public.platform_setting_change_requests
    where id = p_request_id for update;
  if not found or req.status <> 'pending' then
    return coalesce(req.status, 'missing');
  end if;

  if now() > req.expires_at then
    update public.platform_setting_change_requests
      set status = 'expired', resolved_at = now() where id = p_request_id;
    return 'expired';
  end if;

  select count(*) into n from public.profiles
    where role = 'super_admin' and deleted_at is null;
  threshold := greatest(1, ceil(n * 2.0 / 3.0)::int);

  select
    count(*) filter (where vote = 'approve'),
    count(*) filter (where vote = 'reject')
    into approvals, rejects
  from public.platform_setting_change_votes where request_id = p_request_id;

  if approvals >= threshold then
    for k in select jsonb_object_keys(req.changes) loop
      execute format(
        'update public.platform_settings set %I = $1, updated_at = now() where id = ''default''',
        k
      ) using (req.changes ->> k)::numeric;
    end loop;
    update public.platform_setting_change_requests
      set status = 'applied', resolved_at = now() where id = p_request_id;
    insert into public.audit_log (user_id, action, entity_type, entity_id, details)
      values (req.proposed_by, 'platform_setting_change_applied', 'platform_settings',
        p_request_id::text,
        jsonb_build_object('changes', req.changes, 'snapshot', req.snapshot,
          'approvals', approvals, 'threshold', threshold, 'super_admins', n));
    return 'applied';
  elsif (n - rejects) < threshold then
    update public.platform_setting_change_requests
      set status = 'rejected', resolved_at = now() where id = p_request_id;
    insert into public.audit_log (user_id, action, entity_type, entity_id, details)
      values (req.proposed_by, 'platform_setting_change_rejected', 'platform_settings',
        p_request_id::text,
        jsonb_build_object('changes', req.changes, 'approvals', approvals,
          'rejects', rejects, 'threshold', threshold, 'super_admins', n));
    return 'rejected';
  end if;

  return 'pending';
end;
$$;

create or replace function public.propose_platform_setting_change(
  p_changes jsonb, p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can propose a settings change';
  end if;
  if exists (select 1 from public.platform_setting_change_requests where status = 'pending') then
    raise exception 'Another settings change is already pending review';
  end if;
  perform public.validate_platform_setting_change(p_changes);

  insert into public.platform_setting_change_requests (proposed_by, changes, snapshot, reason)
    values (auth.uid(), p_changes, public.platform_settings_snapshot(), nullif(trim(p_reason), ''))
    returning id into new_id;

  insert into public.platform_setting_change_votes (request_id, voter_id, vote)
    values (new_id, auth.uid(), 'approve');

  insert into public.audit_log (user_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'platform_setting_change_proposed', 'platform_settings',
      new_id::text, jsonb_build_object('changes', p_changes));

  perform public._resolve_platform_setting_change(new_id);
  return new_id;
end;
$$;

create or replace function public.vote_platform_setting_change(
  p_request_id uuid, p_vote text
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can vote';
  end if;
  if p_vote not in ('approve', 'reject') then
    raise exception 'Vote must be approve or reject';
  end if;
  if not exists (
    select 1 from public.platform_setting_change_requests
    where id = p_request_id and status = 'pending'
  ) then
    raise exception 'That change request is no longer open';
  end if;

  insert into public.platform_setting_change_votes (request_id, voter_id, vote)
    values (p_request_id, auth.uid(), p_vote)
  on conflict (request_id, voter_id)
    do update set vote = excluded.vote, voted_at = now();

  return public._resolve_platform_setting_change(p_request_id);
end;
$$;

create or replace function public.cancel_platform_setting_change(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can cancel a proposal';
  end if;
  update public.platform_setting_change_requests
    set status = 'cancelled', resolved_at = now()
    where id = p_request_id and status = 'pending'
      and proposed_by = auth.uid();
  if not found then
    raise exception 'Only the proposer can cancel an open proposal';
  end if;
  insert into public.audit_log (user_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'platform_setting_change_cancelled', 'platform_settings',
      p_request_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.validate_platform_setting_change(jsonb) from public, anon, authenticated;
revoke all on function public.platform_settings_snapshot() from public, anon, authenticated;
revoke all on function public._resolve_platform_setting_change(uuid) from public, anon, authenticated;
grant execute on function public.propose_platform_setting_change(jsonb, text) to authenticated;
grant execute on function public.vote_platform_setting_change(uuid, text) to authenticated;
grant execute on function public.cancel_platform_setting_change(uuid) to authenticated;

create table if not exists public.financial_accounts (
  code text primary key,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  active boolean not null default true
);

insert into public.financial_accounts (code, name, account_type) values
  ('1010', 'PayMongo clearing', 'asset'),
  ('1020', 'Cash and bank', 'asset'),
  ('2010', 'Lister payable', 'liability'),
  ('2020', 'Refundable security deposits', 'liability'),
  ('2030', 'Refund payable', 'liability'),
  ('2040', 'Deferred platform fees', 'liability'),
  ('4010', 'Platform commission revenue', 'revenue'),
  ('4020', 'Payment fee recovery', 'revenue'),
  ('5010', 'Payment processing fees', 'expense')
on conflict (code) do update set name = excluded.name, account_type = excluded.account_type;

create table if not exists public.ledger_journals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete restrict,
  event_key text not null unique,
  event_type text not null,
  provider_reference text,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  effective_at timestamptz not null default now(),
  finalized_at timestamptz,
  finalized_by uuid references public.profiles(id) on delete set null,
  reversal_of uuid references public.ledger_journals(id) on delete restrict,
  correction_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- A single PayMongo checkout can legitimately produce more than one journal
-- (for example, downpayment + balance). Event keys provide idempotency; the
-- provider reference is intentionally a non-unique lookup key.
drop index if exists public.ledger_journals_provider_reference_unique;
create index if not exists ledger_journals_provider_reference_idx
  on public.ledger_journals(provider_reference)
  where provider_reference is not null;

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.ledger_journals(id) on delete restrict,
  account_code text not null references public.financial_accounts(code) on delete restrict,
  debit_centavos bigint not null default 0 check (debit_centavos >= 0),
  credit_centavos bigint not null default 0 check (credit_centavos >= 0),
  party_user_id uuid references public.profiles(id) on delete set null,
  memo text,
  created_at timestamptz not null default now(),
  check ((debit_centavos > 0 and credit_centavos = 0) or (credit_centavos > 0 and debit_centavos = 0))
);

create index if not exists ledger_entries_journal_idx on public.ledger_entries(journal_id);
create index if not exists ledger_journals_booking_idx on public.ledger_journals(booking_id, effective_at);

create or replace function public.finalize_ledger_journal(p_journal_id uuid, p_actor uuid default auth.uid())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  debits bigint;
  credits bigint;
begin
  if not (public.is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Super admin or service role required';
  end if;
  select coalesce(sum(debit_centavos),0), coalesce(sum(credit_centavos),0)
  into debits, credits from public.ledger_entries where journal_id = p_journal_id;
  if debits = 0 or debits <> credits then
    raise exception 'Ledger journal is not balanced: debits %, credits %', debits, credits;
  end if;
  update public.ledger_journals
  set status = 'finalized', finalized_at = now(), finalized_by = p_actor
  where id = p_journal_id and status = 'draft';
  if not found then raise exception 'Journal is missing or already finalized'; end if;
end;
$$;

create or replace function public.prevent_finalized_ledger_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'ledger_journals' then
    if old.status = 'finalized' then
      raise exception 'Finalized journals are append-only; create a reversal and corrected journal';
    end if;
  elsif tg_table_name = 'ledger_entries' then
    if exists (
      select 1 from public.ledger_journals where id = old.journal_id and status = 'finalized'
    ) then
      raise exception 'Finalized ledger entries cannot be edited or deleted';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Correct finalized journals atomically. The original is preserved; this RPC
-- creates an exact reversal plus a separately finalized corrected journal.
create or replace function public.create_ledger_correction(
  p_original_journal_id uuid,
  p_reason text,
  p_corrected_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  original public.ledger_journals%rowtype;
  reversal_id uuid := gen_random_uuid();
  corrected_id uuid := gen_random_uuid();
  correction_nonce text := gen_random_uuid()::text;
  item jsonb;
  entry_count integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Super admin required';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A correction reason of at least 10 characters is required';
  end if;
  if jsonb_typeof(p_corrected_entries) <> 'array' or jsonb_array_length(p_corrected_entries) < 2 then
    raise exception 'At least two corrected ledger entries are required';
  end if;

  select * into original
  from public.ledger_journals
  where id = p_original_journal_id and status = 'finalized'
  for share;
  if not found then
    raise exception 'Finalized original journal not found';
  end if;

  insert into public.ledger_journals (
    id, booking_id, event_key, event_type, effective_at, reversal_of,
    correction_reason, metadata
  ) values (
    reversal_id, original.booking_id, 'reversal:' || original.id || ':' || correction_nonce,
    'ledger_reversal', now(), original.id, trim(p_reason),
    jsonb_build_object('original_event_key', original.event_key)
  );

  insert into public.ledger_entries (
    journal_id, account_code, debit_centavos, credit_centavos, party_user_id, memo
  )
  select reversal_id, account_code, credit_centavos, debit_centavos, party_user_id,
    'Reversal of ' || original.event_key || coalesce(': ' || memo, '')
  from public.ledger_entries
  where journal_id = original.id;

  perform public.finalize_ledger_journal(reversal_id, auth.uid());

  insert into public.ledger_journals (
    id, booking_id, event_key, event_type, effective_at, reversal_of,
    correction_reason, metadata
  ) values (
    corrected_id, original.booking_id, 'correction:' || original.id || ':' || correction_nonce,
    'ledger_correction', now(), original.id, trim(p_reason),
    jsonb_build_object('original_event_key', original.event_key)
  );

  for item in select value from jsonb_array_elements(p_corrected_entries)
  loop
    if not exists (
      select 1 from public.financial_accounts
      where code = item->>'account_code' and active
    ) then
      raise exception 'Unknown or inactive financial account: %', item->>'account_code';
    end if;
    insert into public.ledger_entries (
      journal_id, account_code, debit_centavos, credit_centavos, party_user_id, memo
    ) values (
      corrected_id,
      item->>'account_code',
      greatest(0, coalesce((item->>'debit_centavos')::bigint, 0)),
      greatest(0, coalesce((item->>'credit_centavos')::bigint, 0)),
      nullif(item->>'party_user_id', '')::uuid,
      nullif(trim(item->>'memo'), '')
    );
    entry_count := entry_count + 1;
  end loop;

  perform public.finalize_ledger_journal(corrected_id, auth.uid());

  insert into public.audit_log (user_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'ledger_journal_corrected', 'ledger_journal', original.id,
    jsonb_build_object(
      'reason', trim(p_reason),
      'reversal_journal_id', reversal_id,
      'corrected_journal_id', corrected_id,
      'corrected_entry_count', entry_count
    )
  );

  return jsonb_build_object(
    'original_journal_id', original.id,
    'reversal_journal_id', reversal_id,
    'corrected_journal_id', corrected_id
  );
end;
$$;

revoke all on function public.create_ledger_correction(uuid, text, jsonb) from public;
grant execute on function public.create_ledger_correction(uuid, text, jsonb) to authenticated;

drop trigger if exists prevent_finalized_journal_change on public.ledger_journals;
create trigger prevent_finalized_journal_change
before update or delete on public.ledger_journals
for each row execute function public.prevent_finalized_ledger_change();

drop trigger if exists prevent_finalized_entry_change on public.ledger_entries;
create trigger prevent_finalized_entry_change
before update or delete on public.ledger_entries
for each row execute function public.prevent_finalized_ledger_change();

create table if not exists public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  check (period_end >= period_start)
);

create table if not exists public.reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.reconciliation_runs(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  issue_type text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  provider_reference text,
  local_reference text,
  provider_amount_centavos bigint,
  local_amount_centavos bigint,
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'ignored')),
  resolution text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS: participants can manage their own operational evidence; finance and
-- retention are super-admin only.
alter table public.car_agreement_versions enable row level security;
alter table public.booking_agreement_acceptances enable row level security;
alter table public.vehicle_unavailability enable row level security;
alter table public.trip_condition_reports enable row level security;
alter table public.trip_condition_photos enable row level security;
alter table public.security_deposits enable row level security;
alter table public.security_deposit_claims enable row level security;
alter table public.data_retention_requests enable row level security;
alter table public.retention_policy_rules enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.ledger_journals enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.reconciliation_items enable row level security;

drop policy if exists "Users read relevant agreement versions" on public.car_agreement_versions;
create policy "Users read relevant agreement versions" on public.car_agreement_versions
for select using (
  public.is_admin()
  or exists (
    select 1 from public.cars c
    where c.id = car_id
      and (c.owner_id = auth.uid() or c.status = 'approved')
  )
  or exists (
    select 1 from public.bookings b
    where b.agreement_version_id = public.car_agreement_versions.id
      and auth.uid() in (b.renter_id, b.owner_id)
  )
);

drop policy if exists "Renters accept booking agreement" on public.booking_agreement_acceptances;
create policy "Renters accept booking agreement" on public.booking_agreement_acceptances
for insert with check (renter_id = auth.uid() and exists (select 1 from public.bookings b where b.id = booking_id and b.renter_id = auth.uid()));
drop policy if exists "Participants read agreement acceptance" on public.booking_agreement_acceptances;
create policy "Participants read agreement acceptance" on public.booking_agreement_acceptances
for select using (public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id and auth.uid() in (b.renter_id, b.owner_id)));

drop policy if exists "Owners manage vehicle blackouts" on public.vehicle_unavailability;
create policy "Owners manage vehicle blackouts" on public.vehicle_unavailability
for all using (
  public.is_admin()
  or (
    owner_id = auth.uid()
    and exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid())
  )
) with check (
  public.is_admin()
  or (
    owner_id = auth.uid()
    and exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid())
  )
);

drop policy if exists "Participants read trip reports" on public.trip_condition_reports;
create policy "Participants read trip reports" on public.trip_condition_reports
for select using (public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id and auth.uid() in (b.renter_id, b.owner_id)));
drop policy if exists "Participants submit trip reports" on public.trip_condition_reports;
-- Reports are inserted only by the authenticated server endpoint after it
-- verifies booking state, reporter role, required categories, and objects.

drop policy if exists "Participants read trip photos" on public.trip_condition_photos;
create policy "Participants read trip photos" on public.trip_condition_photos
for select using (public.is_admin() or exists (
  select 1 from public.trip_condition_reports r join public.bookings b on b.id = r.booking_id
  where r.id = report_id and auth.uid() in (b.renter_id, b.owner_id)
));
drop policy if exists "Participants add trip photos" on public.trip_condition_photos;
-- Photo metadata is likewise server-only; participants keep read access.

drop policy if exists "Participants read security deposits" on public.security_deposits;
create policy "Participants read security deposits" on public.security_deposits
for select using (public.is_admin() or auth.uid() in (renter_id, owner_id));
drop policy if exists "Participants read deposit claims" on public.security_deposit_claims;
create policy "Participants read deposit claims" on public.security_deposit_claims
for select using (public.is_admin() or exists (select 1 from public.security_deposits d where d.id = security_deposit_id and auth.uid() in (d.renter_id, d.owner_id)));
drop policy if exists "Lister submits deposit claim" on public.security_deposit_claims;
-- Claims are created only through the server endpoint so the 48-hour window,
-- amount cap, return report, and evidence snapshot cannot be bypassed.

drop policy if exists "Super admins manage retention requests" on public.data_retention_requests;
create policy "Super admins manage retention requests" on public.data_retention_requests for all using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "Admins read retention rules" on public.retention_policy_rules;
create policy "Admins read retention rules" on public.retention_policy_rules for select using (public.is_admin());
drop policy if exists "Super admins manage retention rules" on public.retention_policy_rules;
create policy "Super admins manage retention rules" on public.retention_policy_rules for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "Super admins read financial accounts" on public.financial_accounts;
create policy "Super admins read financial accounts" on public.financial_accounts for select using (public.is_super_admin());
drop policy if exists "Super admins manage ledger journals" on public.ledger_journals;
create policy "Super admins manage ledger journals" on public.ledger_journals for all using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "Super admins manage ledger entries" on public.ledger_entries;
create policy "Super admins manage ledger entries" on public.ledger_entries for all using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "Super admins manage reconciliation runs" on public.reconciliation_runs;
create policy "Super admins manage reconciliation runs" on public.reconciliation_runs for all using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "Super admins manage reconciliation items" on public.reconciliation_items;
create policy "Super admins manage reconciliation items" on public.reconciliation_items for all using (public.is_super_admin()) with check (public.is_super_admin());

-- Private trip-photo storage. Object path: <booking-id>/<user-id>/<report-id>/<category>.<ext>
drop policy if exists "Participants upload trip condition evidence" on storage.objects;
create policy "Participants upload trip condition evidence" on storage.objects
for insert to authenticated with check (
  bucket_id = 'trip-condition-evidence'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (
    select 1 from public.bookings b
    where b.id::text = (storage.foldername(name))[1]
      and auth.uid() in (b.renter_id, b.owner_id)
  )
);
drop policy if exists "Participants read trip condition evidence" on storage.objects;
create policy "Participants read trip condition evidence" on storage.objects
for select to authenticated using (
  bucket_id = 'trip-condition-evidence'
  and exists (
    select 1 from public.bookings b
    where b.id::text = (storage.foldername(name))[1]
      and (auth.uid() in (b.renter_id, b.owner_id) or public.is_admin())
  )
);
drop policy if exists "Submitters delete unlinked trip condition evidence" on storage.objects;
create policy "Submitters delete unlinked trip condition evidence" on storage.objects
for delete to authenticated using (
  bucket_id = 'trip-condition-evidence'
  and (storage.foldername(name))[2] = auth.uid()::text
  and not exists (
    select 1 from public.trip_condition_photos p where p.storage_path = name
  )
);

commit;

-- ============================================================================
-- CHAPTER 15 - SOURCE: database_scripts/2026-08-26_authenticated_service_fallbacks.sql
-- ============================================================================

-- Safe Vercel fallback paths for public inquiries and authenticated privacy
-- requests. This does not expose either table for unrestricted writes:
-- validation and insertion stay inside narrowly scoped security-definer RPCs.

begin;

drop policy if exists "Users read own retention requests" on public.data_retention_requests;
create policy "Users read own retention requests"
on public.data_retention_requests for select
using (subject_user_id = auth.uid());

create or replace function public.submit_data_retention_request(p_request_type text, p_details text)
returns table (id uuid, status text, due_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_request public.data_retention_requests%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_request_type not in ('access', 'correction', 'deletion', 'anonymization', 'restriction') then
    raise exception 'Choose a valid request type';
  end if;
  if char_length(trim(coalesce(p_details, ''))) not between 10 and 3000 then
    raise exception 'Provide 10 to 3,000 characters of detail';
  end if;
  select lower(email) into v_email from auth.users where auth.users.id = v_user_id;
  if v_email is null then raise exception 'Authenticated email not found'; end if;
  if exists (
    select 1 from public.data_retention_requests request
    where request.subject_user_id = v_user_id
      and request.request_type = p_request_type
      and request.status in ('submitted', 'identity_check', 'under_review', 'approved', 'legal_hold')
  ) then
    raise exception 'You already have an open request of this type';
  end if;
  insert into public.data_retention_requests (
    subject_user_id, requester_email, request_type, request_details, due_at
  ) values (
    v_user_id, v_email, p_request_type, trim(p_details), now() + interval '30 days'
  ) returning * into v_request;
  insert into public.notifications (user_id, title, message, type, link)
  select profile.id, 'New Privacy Data Request',
    v_email || ' submitted a ' || p_request_type || ' request. Verify identity and review any legal or operational hold before acting.',
    'warning', '/admin/retention-requests?request=' || v_request.id::text
  from public.profiles profile
  where profile.role = 'super_admin' and profile.deleted_at is null;
  insert into public.audit_log (user_id, action, entity_type, entity_id, details)
  values (
    v_user_id, 'data_retention_request_submitted', 'data_retention_request', v_request.id,
    jsonb_build_object('request_type', p_request_type, 'due_at', v_request.due_at)
  );
  return query select v_request.id, v_request.status, v_request.due_at;
end;
$$;

revoke all on function public.submit_data_retention_request(text, text) from public, anon;
grant execute on function public.submit_data_retention_request(text, text) to authenticated;

create or replace function public.submit_guest_inquiry(
  p_name text, p_email text, p_phone text, p_topics text[], p_message text, p_request_fingerprint text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_topics text[] := coalesce(p_topics, '{}'::text[]);
  v_allowed_topics constant text[] := array[
    'What is SafeDrive / how it works', 'Renting a vehicle', 'Booking availability',
    'Cancellation or rescheduling', 'Driver requirements', 'Listing a vehicle / vehicle eligibility',
    'Vehicle requirements', 'Account registration or verification', 'Payments, fees, or refunds',
    'Locations or service area', 'Safety or insurance', 'Complaint or safety concern',
    'Privacy or personal data', 'Business or partnership', 'Technical problem', 'Other'
  ];
begin
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 120
     or char_length(v_email) not between 5 and 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or cardinality(v_topics) < 1
     or exists (select 1 from unnest(v_topics) topic where not topic = any(v_allowed_topics))
     or char_length(trim(coalesce(p_message, ''))) not between 10 and 3000
     or char_length(coalesce(p_phone, '')) > 40 then
    raise exception 'Enter a valid inquiry';
  end if;
  if (select count(*) from public.guest_inquiries inquiry
      where lower(inquiry.email) = v_email and inquiry.created_at >= now() - interval '1 hour') >= 5 then
    raise exception 'Too many inquiries were submitted. Please wait before trying again.';
  end if;
  insert into public.guest_inquiries (
    name, email, phone, subject, topics, message, request_fingerprint, source
  ) values (
    trim(p_name), v_email, nullif(trim(coalesce(p_phone, '')), ''),
    left(array_to_string(v_topics, ', '), 160), v_topics, trim(p_message),
    coalesce(nullif(p_request_fingerprint, ''), 'anonymous-' || gen_random_uuid()::text),
    'inquiry_widget'
  ) returning guest_inquiries.id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_guest_inquiry(text, text, text, text[], text, text) from public;
grant execute on function public.submit_guest_inquiry(text, text, text, text[], text, text) to anon, authenticated;

commit;

-- ============================================================================
-- CHAPTER 16 - READ-ONLY POST-MIGRATION VERIFICATION
-- Safe to run as read-only checks after the dated migrations.
-- ============================================================================

-- Expected tables and private storage buckets.
select
  to_regclass('public.guest_inquiries') as guest_inquiries_table,
  to_regclass('public.booking_extensions') as booking_extensions_table,
  to_regclass('public.audit_log') as audit_log_table,
  to_regclass('public.security_logs') as security_logs_table,
  to_regclass('public.car_agreement_versions') as agreement_versions_table,
  to_regclass('public.booking_agreement_acceptances') as agreement_acceptances_table,
  to_regclass('public.vehicle_unavailability') as vehicle_unavailability_table,
  to_regclass('public.trip_condition_reports') as trip_reports_table,
  to_regclass('public.trip_condition_photos') as trip_photos_table,
  to_regclass('public.security_deposits') as security_deposits_table,
  to_regclass('public.security_deposit_claims') as deposit_claims_table,
  to_regclass('public.data_retention_requests') as retention_requests_table,
  to_regclass('public.ledger_journals') as ledger_journals_table,
  to_regclass('public.ledger_entries') as ledger_entries_table,
  to_regclass('public.reconciliation_runs') as reconciliation_runs_table,
  to_regclass('public.reconciliation_items') as reconciliation_items_table;

select id, name, public
from storage.buckets
where id in (
  'user-verification',
  'support-attachments',
  'vehicle-private-documents',
  'car-documents',
  'trip-condition-evidence'
)
order by id;

-- Expected: ledger activation plus both renter processing-fee controls.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'platform_settings'
  and column_name in (
    'ledger_activated_at',
    'payment_processing_fee_rate',
    'payment_processing_fixed_centavos'
  )
order by column_name;

-- Expected: the chart of accounts seeded in Chapter 14 (at least eight rows).
select code, name, account_type, active
from public.financial_accounts
order by code;

-- Optional arrival evidence columns. Expected: eight rows.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'bookings'
  and column_name in (
    'renter_arrival_latitude',
    'renter_arrival_longitude',
    'renter_arrival_accuracy_meters',
    'renter_arrival_location_captured_at',
    'lister_arrival_latitude',
    'lister_arrival_longitude',
    'lister_arrival_accuracy_meters',
    'lister_arrival_location_captured_at'
  )
order by column_name;

-- Expected financial/availability guards.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'payments_one_active_payout_per_booking',
    'payments_one_completed_checkout_event',
    'subscriptions_one_active_plan_per_user',
    'car_agreement_one_approved_version',
    'security_deposit_one_open_claim'
  )
order by indexname;

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname in (
  'bookings_no_active_date_overlap',
  'vehicle_unavailability_no_overlap',
  'cars_price_per_day_check',
  'cars_plate_number_format',
  'cars_security_deposit_amount_check',
  'trip_condition_reports_booking_id_reporter_id_phase_key'
)
order by table_name, conname;

-- Expected trusted triggers.
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
    'protect_car_submission_fields',
    'notify_admins_of_vehicle_submission',
    'notify_admins_of_pending_verification',
    'notify_support_ticket_created',
    'notify_admins_of_guest_inquiry',
    'set_guest_inquiry_updated_at',
    'audit_vehicle_lifecycle',
    'audit_verification_submission',
    'audit_car_renewal_submission',
    'notify_support_message_created',
    'queue_rental_agreement_version',
    'return_materially_changed_car_to_review',
    'approve_latest_car_agreement_with_vehicle',
    'enforce_vehicle_insurance_approval',
    'enforce_live_car_limit',
    'subscription_expiry_slot_enforce',
    'prevent_blackout_booking_conflict',
    'prevent_booking_blackout_conflict',
    'prevent_finalized_journal_change',
    'prevent_finalized_entry_change'
  )
order by trigger_name, event_manipulation;

-- Review policies for sensitive surfaces. Inspect the returned expressions;
-- existence alone is not proof that an unrelated account is denied.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
  and (
    tablename in (
      'guest_inquiries',
      'car_agreement_versions',
      'booking_agreement_acceptances',
      'vehicle_unavailability',
      'trip_condition_reports',
      'trip_condition_photos',
      'security_deposits',
      'security_deposit_claims',
      'data_retention_requests',
      'ledger_journals',
      'ledger_entries',
      'reconciliation_runs',
      'reconciliation_items'
    )
    or (schemaname = 'storage' and tablename = 'objects')
  )
order by schemaname, tablename, policyname;

-- These conflict queries should return zero rows after cleanup/guards.
select
  a.car_id,
  a.id as booking_a,
  b.id as booking_b,
  daterange(a.start_date, a.end_date, '[]') as range_a,
  daterange(b.start_date, b.end_date, '[]') as range_b
from public.bookings a
join public.bookings b
  on b.car_id = a.car_id
 and b.id > a.id
 and daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]')
where a.status in ('pending', 'confirmed', 'awaiting_payment', 'downpayment_paid', 'fully_paid', 'active')
  and b.status in ('pending', 'confirmed', 'awaiting_payment', 'downpayment_paid', 'fully_paid', 'active');

select booking_id, count(*)
from public.payments
where payment_type = 'payout' and status in ('pending', 'completed')
group by booking_id
having count(*) > 1;

select booking_id, payment_type, transaction_id, count(*)
from public.payments
where status = 'completed'
  and payment_type in ('downpayment', 'balance', 'extension', 'security_deposit')
  and transaction_id is not null
group by booking_id, payment_type, transaction_id
having count(*) > 1;

select user_id, count(*)
from public.subscriptions
where status = 'active'
group by user_id
having count(*) > 1;

select security_deposit_id, count(*)
from public.security_deposit_claims
where status in ('submitted', 'renter_responded')
group by security_deposit_id
having count(*) > 1;

-- Expected: zero rows. Every ledger journal must balance exactly in centavos.
select
  j.id,
  sum(e.debit_centavos) as debit_centavos,
  sum(e.credit_centavos) as credit_centavos
from public.ledger_journals j
left join public.ledger_entries e on e.journal_id = j.id
group by j.id
having coalesce(sum(e.debit_centavos), 0) = 0
    or coalesce(sum(e.debit_centavos), 0) <> coalesce(sum(e.credit_centavos), 0);

-- Expected functions/RPCs. Every column should contain a function name.
select
  to_regprocedure('public.finalize_ledger_journal(uuid,uuid)') as finalize_ledger_journal,
  to_regprocedure('public.create_ledger_correction(uuid,text,jsonb)') as create_ledger_correction,
  to_regprocedure('public.submit_data_retention_request(text,text)') as submit_data_retention_request,
  to_regprocedure('public.submit_guest_inquiry(text,text,text,text[],text,text)') as submit_guest_inquiry,
  to_regprocedure('public.is_super_admin()') as is_super_admin;

-- End of the dated verification chapter. Re-run this CHAPTER 16 block after
-- applying CHAPTER 17 below.


-- ============================================================================
-- CHAPTER 17 - SECURITY & INTEGRITY HARDENING
-- SOURCE: database_scripts/2026-08-31_security_and_integrity_hardening.sql
-- ============================================================================
--
-- Additive migration. Apply like the other dated chapters: select from this
-- CHAPTER 17 heading through its `commit;` and run it once, on staging first,
-- then production. It changes no data. Re-run the CHAPTER 16 verification and
-- `npm run check:live-roles` afterwards.
--
-- Prerequisite: the Supabase project must have `app.settings.encryption_key`
-- set to an independent random value (see section 17.2). Setting it is a
-- project/database GUC change, e.g.
--   alter database postgres set app.settings.encryption_key = '<64-hex value>';
-- and then reconnect. Without it, section 17.2 makes KYC writes fail loudly
-- instead of silently storing weak ciphertext.

begin;

-- ----------------------------------------------------------------------------
-- 17.1  public.payments: server-only writes
-- ----------------------------------------------------------------------------
-- The browser only ever SELECTs from public.payments. Every write (checkout
-- confirmation, refund, payout, manual fallback) runs in an api/ handler with
-- the service-role key, which bypasses RLS. The original "Participants insert
-- payments" policy let a booking participant fabricate a row with any status,
-- amount, or payment_type -- e.g. a fake completed downpayment to inflate a
-- manual refund review (api/booking-action.ts getCapturedBookingPaymentTotal),
-- or a fake pending payout to block payout automation
-- (api/lib/payoutAutomation.ts). Remove participant and plain-authenticated
-- write access; keep participant/admin read access unchanged.

drop policy if exists "Participants insert payments" on public.payments;
drop policy if exists "Admins update payments" on public.payments;

revoke insert, update, delete on public.payments from authenticated;
revoke insert, update, delete on public.payments from anon;

-- "Participants see payments" (SELECT) from Chapter 1 stays in force.

-- ----------------------------------------------------------------------------
-- 17.2  PII encryption: refuse the shared fallback key
-- ----------------------------------------------------------------------------
-- Previously encrypt_pii/decrypt_pii fell back to a literal key committed in
-- this file when app.settings.encryption_key was unset, so driver_license /
-- national_id were effectively stored in the clear. encrypt_pii now raises so a
-- misconfigured project fails at write time; decrypt_pii warns and returns NULL
-- (unchanged externally) but no longer pretends the fallback key is real.

CREATE OR REPLACE FUNCTION public.encrypt_pii(content TEXT) RETURNS TEXT AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  IF content IS NULL THEN
    RETURN NULL;
  END IF;
  IF content LIKE 'pgp:%' THEN
    RETURN content;
  END IF;

  encryption_key := NULLIF(current_setting('app.settings.encryption_key', true), '');
  IF encryption_key IS NULL OR encryption_key = 'safedrive-dev-secret-key-fallback' THEN
    RAISE EXCEPTION 'app.settings.encryption_key is not configured; refusing to store weak PII ciphertext';
  END IF;

  RETURN 'pgp:' || encode(
    pgp_sym_encrypt(content, encryption_key),
    'base64'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- decrypt_pii is called directly from the browser by admin screens
-- (src/pages/admin/AdminUsersPage.tsx, AdminVehicleApprovalPage.tsx) through
-- supabase.rpc('decrypt_pii', ...). It is SECURITY DEFINER with no caller check,
-- so today any authenticated user who can read another profile's encrypted
-- driver_license / national_id (booking counterparties can, per Chapter 1 RLS)
-- can decrypt it. Add an is_admin() gate inside the function instead of removing
-- the grant, so the admin screens keep working and everyone else gets NULL.
CREATE OR REPLACE FUNCTION public.decrypt_pii(encrypted_content TEXT) RETURNS TEXT AS $$
DECLARE
  raw_base64 TEXT;
  encryption_key TEXT;
BEGIN
  IF encrypted_content IS NULL THEN
    RETURN NULL;
  END IF;
  IF encrypted_content NOT LIKE 'pgp:%' THEN
    RETURN encrypted_content;
  END IF;

  IF NOT public.is_admin() THEN
    RETURN NULL;
  END IF;

  encryption_key := NULLIF(current_setting('app.settings.encryption_key', true), '');
  IF encryption_key IS NULL OR encryption_key = 'safedrive-dev-secret-key-fallback' THEN
    RAISE WARNING 'app.settings.encryption_key is not configured; PII cannot be decrypted';
    RETURN NULL;
  END IF;

  raw_base64 := substring(encrypted_content FROM 5);
  RETURN pgp_sym_decrypt(
    decode(raw_base64, 'base64'),
    encryption_key
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'decrypt_pii failed (wrong key or corrupt value)';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 17.3  Stop exposing the write-side PII helpers to callers
-- ----------------------------------------------------------------------------
-- Chapter 1 ran `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon`
-- (and to authenticated). encrypt_pii and the encryption trigger are only ever
-- invoked by the profiles trigger, never by app code, so no caller needs them.
-- decrypt_pii keeps its grant (admin screens call it) but now self-checks
-- is_admin() above.

REVOKE EXECUTE ON FUNCTION public.encrypt_pii(TEXT) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii(TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_pii_encryption() FROM anon, authenticated, public;

commit;

-- ============================================================================
-- PHASE 9 - Forensic fields on security_logs
-- SOURCE: scratchpad phase9_security_log_fields.sql
-- ============================================================================
-- The security log already captured ip_address and user_agent; the admin UI
-- just never showed them. These columns add the pieces a real auth log needs
-- but SafeDrive lacked: the actor's role/lister flag at the moment of the
-- event (roles change - snapshot them), the Supabase session id so a login can
-- be tied to its later logout, and the failure reason / attempted email as
-- first-class columns (previously only inside details JSON, and only for some
-- events). No backfill: older rows keep NULLs and the UI falls back to
-- details->>'portal' / details->>'reason' / details->>'email'.
alter table public.security_logs
  add column if not exists actor_role text
    check (actor_role is null or actor_role in ('user', 'admin', 'super_admin')),
  add column if not exists actor_is_lister boolean,
  add column if not exists session_id text,
  add column if not exists failure_reason text,
  add column if not exists target_email text;

create index if not exists idx_security_logs_created_at
  on public.security_logs(created_at desc);
create index if not exists idx_security_logs_session_id
  on public.security_logs(session_id)
  where session_id is not null;

-- ============================================================================
-- PHASE 10 - Public rating aggregates (Airbnb / Turo style)
-- SOURCE: scratchpad phase10_rating_functions.sql
-- ============================================================================
-- One rating per direction per booking (renter -> trip, lister -> renter). The
-- renter's single rating is aggregated two ways from the same rows: by car_id
-- (the car's rating) and by reviewee_id/owner (the lister's rating). No schema
-- change. These SECURITY DEFINER functions expose only aggregates + public
-- review text (no PII beyond a first name/avatar) so logged-out visitors can
-- see ratings on Browse and the car page.
--
-- Double-blind: a review is only counted / shown once BOTH parties reviewed the
-- booking, or 14 days have passed since the trip completed - prevents
-- retaliation and "rate me and I'll rate you" trades.

create or replace function public._review_is_published(
  p_booking_id uuid, p_reviewer_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.booking_reviews rr
    where rr.booking_id = p_booking_id and rr.reviewer_id <> p_reviewer_id
  )
  or exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and coalesce(greatest(b.owner_completed_at, b.renter_completed_at), b.updated_at)
          < now() - interval '14 days'
  );
$$;

create or replace function public.get_car_rating_summaries()
returns table(car_id uuid, average numeric, review_count integer)
language sql stable security definer set search_path = public
as $$
  select r.car_id,
         round(avg(r.rating)::numeric, 2) as average,
         count(*)::int as review_count
  from public.booking_reviews r
  join public.bookings b on b.id = r.booking_id
  where r.reviewer_role = 'renter'
    and b.status = 'completed'
    and public._review_is_published(r.booking_id, r.reviewer_id)
  group by r.car_id;
$$;
grant execute on function public.get_car_rating_summaries() to anon, authenticated;

create or replace function public.get_lister_rating_summaries()
returns table(lister_id uuid, average numeric, review_count integer, trip_count integer)
language sql stable security definer set search_path = public
as $$
  select r.reviewee_id as lister_id,
         round(avg(r.rating)::numeric, 2) as average,
         count(*)::int as review_count,
         (select count(distinct b2.id)::int
            from public.bookings b2
            where b2.owner_id = r.reviewee_id and b2.status = 'completed') as trip_count
  from public.booking_reviews r
  join public.bookings b on b.id = r.booking_id
  where r.reviewer_role = 'renter'
    and b.status = 'completed'
    and public._review_is_published(r.booking_id, r.reviewer_id)
  group by r.reviewee_id;
$$;
grant execute on function public.get_lister_rating_summaries() to anon, authenticated;

create or replace function public.get_public_car_reviews(p_car_id uuid)
returns table(
  id uuid, rating integer, feedback text, created_at timestamptz,
  reviewer_name text, reviewer_avatar text
)
language sql stable security definer set search_path = public
as $$
  select r.id, r.rating, r.feedback, r.created_at,
         coalesce(nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'Renter'),
         p.avatar_url
  from public.booking_reviews r
  join public.bookings b on b.id = r.booking_id
  left join public.profiles p on p.id = r.reviewer_id
  where r.car_id = p_car_id
    and r.reviewer_role = 'renter'
    and b.status = 'completed'
    and public._review_is_published(r.booking_id, r.reviewer_id)
  order by r.created_at desc
  limit 50;
$$;
grant execute on function public.get_public_car_reviews(uuid) to anon, authenticated;

-- Renter reputation for a lister deciding on a booking request. Authenticated
-- only. Same double-blind rule; returns aggregates + a few recent comments.
create or replace function public.get_renter_reputation(p_renter_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with published as (
    select r.rating, r.feedback, r.created_at
    from public.booking_reviews r
    join public.bookings b on b.id = r.booking_id
    where r.reviewer_role = 'owner'
      and r.reviewee_id = p_renter_id
      and b.status = 'completed'
      and public._review_is_published(r.booking_id, r.reviewer_id)
  )
  select jsonb_build_object(
    'average', (select round(avg(rating)::numeric, 2) from published),
    'review_count', (select count(*)::int from published),
    'trip_count', (
      select count(distinct b3.id)::int
      from public.bookings b3
      where b3.renter_id = p_renter_id and b3.status = 'completed'
    ),
    'recent', coalesce((
      select jsonb_agg(x)
      from (
        select rating, feedback, created_at
        from published
        where coalesce(nullif(trim(feedback), ''), '') <> ''
        order by created_at desc
        limit 3
      ) x
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.get_renter_reputation(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- CHAPTER 17 verification (read-only). Expected results noted inline.
-- ----------------------------------------------------------------------------

-- Expected: no INSERT/UPDATE/DELETE policy on public.payments; SELECT only.
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'payments'
order by policyname;

-- Expected: authenticated has SELECT on payments but not INSERT/UPDATE/DELETE.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'payments'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

-- Expected: encrypt_pii / handle_pii_encryption executable by service_role only;
-- decrypt_pii also executable by authenticated (admin screens; it self-checks
-- is_admin()). No 'anon' rows for any of the three.
select p.proname, r.rolname as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(p.proacl) a
join pg_roles r on r.oid = a.grantee
where n.nspname = 'public'
  and p.proname in ('encrypt_pii', 'decrypt_pii', 'handle_pii_encryption')
  and a.privilege_type = 'EXECUTE'
order by p.proname, grantee;

-- Manual: as a non-admin authenticated user,
--   select public.decrypt_pii('pgp:...<another user''s ciphertext>...');
-- must return NULL.

-- Manual: on a project WITHOUT app.settings.encryption_key set, running
--   select public.encrypt_pii('test');
-- must RAISE, not return a 'pgp:' value.

-- ============================================================================
-- CHAPTER 19 - Granular admin permissions (RBAC checklist)   [Phase 1 of 6]
-- SOURCE: project_docs/RBAC_DESIGN.md
-- ============================================================================
-- Adds a per-admin permission checklist on top of the existing role column.
--
--   profiles.role stays: 'user' | 'admin' | 'super_admin'
--     super_admin  -> implicitly holds EVERY permission, always. Created only by
--                     direct SQL (see chapter header lines 98-112). No UI path.
--     admin        -> holds only the keys granted in public.admin_permissions.
--     user         -> no admin surface.
--
-- This chapter is ADDITIVE and SAFE TO RE-RUN. It creates tables + helpers +
-- seeds + backfills every existing admin with the full default operational set,
-- so nothing changes on deploy. Swapping the RLS policies and /api role checks
-- to public.admin_can(...) is Phase 3 - a separate change.

-- 19.1  Catalog of the 9 operational permission keys ------------------------

create table if not exists public.admin_permission_catalog (
  key         text primary key,
  job_label   text not null,
  description text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.admin_permission_catalog enable row level security;

drop policy if exists "Staff read permission catalog" on public.admin_permission_catalog;
create policy "Staff read permission catalog"
  on public.admin_permission_catalog for select
  using (public.is_admin());

insert into public.admin_permission_catalog (key, job_label, description, sort_order) values
  ('users.verify',     'Verify users',       'Approve, reject, and re-review user identity (KYC); send verification decision emails.', 10),
  ('users.moderate',   'Moderate users',     'Block and unblock a user''s ability to sign in.', 20),
  ('vehicles.review',  'Verify cars',        'Approve, reject, revoke, and re-review vehicles and renewals; send vehicle decision emails.', 30),
  ('vehicles.delete',  'Delete cars',        'Permanently delete a vehicle record.', 40),
  ('catalog.manage',   'Manage catalog',     'Add and remove car brands and models.', 50),
  ('support.handle',   'Handle tickets',     'Reply to, close, reopen, and open support tickets on behalf of users.', 60),
  ('inquiries.handle', 'Handle inquiries',   'Claim, reply to, and resolve user and guest inquiries.', 70),
  ('audit.view',       'View audit trail',   'Read the accountable business/admin action audit trail.', 80),
  ('security.view',    'View security logs', 'Read the authentication and security event log.', 90)
on conflict (key) do update
  set job_label = excluded.job_label,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- 19.2  Per-admin grants (the checklist itself) ----------------------------

create table if not exists public.admin_permissions (
  admin_id       uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.admin_permission_catalog(key) on delete cascade,
  granted_by     uuid references public.profiles(id) on delete set null,
  granted_at     timestamptz not null default now(),
  primary key (admin_id, permission_key)
);

create index if not exists admin_permissions_admin_idx
  on public.admin_permissions (admin_id);

alter table public.admin_permissions enable row level security;

-- An admin may read their own grants; a super admin reads everyone's.
drop policy if exists "Read own grants, super admin reads all" on public.admin_permissions;
create policy "Read own grants, super admin reads all"
  on public.admin_permissions for select
  using (admin_id = auth.uid() or public.is_super_admin());

-- Only a super admin may change grants. The /admin/admins module normally
-- writes with the service-role key; this policy keeps the table safe even for a
-- direct PostgREST call.
drop policy if exists "Super admins write grants" on public.admin_permissions;
create policy "Super admins write grants"
  on public.admin_permissions for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- 19.3  Templates (presets that just pre-tick the checklist) ---------------

create table if not exists public.admin_permission_templates (
  id              text primary key,
  label           text not null,
  permission_keys text[] not null default '{}',
  sort_order      int  not null default 0
);

alter table public.admin_permission_templates enable row level security;

drop policy if exists "Staff read permission templates" on public.admin_permission_templates;
create policy "Staff read permission templates"
  on public.admin_permission_templates for select
  using (public.is_admin());

insert into public.admin_permission_templates (id, label, permission_keys, sort_order) values
  ('verification_officer', 'Verification Officer',
     array['users.verify','users.moderate','vehicles.review','catalog.manage','audit.view'], 10),
  ('support_agent', 'Support Agent',
     array['support.handle','inquiries.handle','users.verify','audit.view'], 20),
  ('fleet_admin', 'Catalog / Fleet Admin',
     array['vehicles.review','vehicles.delete','catalog.manage','audit.view'], 30),
  ('compliance_viewer', 'Compliance Viewer',
     array['audit.view','security.view'], 40),
  ('general_admin', 'General Admin',
     array['users.verify','users.moderate','vehicles.review','catalog.manage',
           'support.handle','inquiries.handle','audit.view','security.view'], 50)
on conflict (id) do update
  set label = excluded.label,
      permission_keys = excluded.permission_keys,
      sort_order = excluded.sort_order;

-- 19.4  Admin account lifecycle columns -----------------------------------

alter table public.profiles
  add column if not exists admin_disabled_at timestamptz,
  add column if not exists admin_created_by  uuid references public.profiles(id) on delete set null;

-- 19.5  The gate helpers -------------------------------------------------

-- Browser callers: reads auth.uid() from the JWT. SECURITY DEFINER so it can
-- see profiles/grants regardless of the caller's own RLS. STABLE = evaluated
-- once per statement.
create or replace function public.admin_can(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.admin_permissions ap
      join public.profiles p on p.id = ap.admin_id
      where ap.admin_id = auth.uid()
        and ap.permission_key = p_key
        and p.role = 'admin'
        and p.deleted_at is null
        and p.admin_disabled_at is null
    );
$$;

revoke all on function public.admin_can(text) from public, anon;
grant execute on function public.admin_can(text) to authenticated;

-- Server callers: /api handlers that already resolved the user id from the
-- bearer token with the service-role client pass it explicitly.
create or replace function public.admin_can_for(p_uid uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.profiles p
      where p.id = p_uid and p.role = 'super_admin' and p.deleted_at is null
    )
    or exists (
      select 1
      from public.admin_permissions ap
      join public.profiles p on p.id = ap.admin_id
      where ap.admin_id = p_uid
        and ap.permission_key = p_key
        and p.role = 'admin'
        and p.deleted_at is null
        and p.admin_disabled_at is null
    );
$$;

revoke all on function public.admin_can_for(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_can_for(uuid, text) to service_role;

-- 19.6  Backfill: every current admin keeps the full default operational set
-- so behaviour is identical until Phase 3. Re-runnable.
insert into public.admin_permissions (admin_id, permission_key, granted_by)
select p.id, c.key, null
from public.profiles p
cross join public.admin_permission_catalog c
where p.role = 'admin'
  and p.deleted_at is null
on conflict (admin_id, permission_key) do nothing;

-- 19.7  Audit-log action names the /admin/admins module will write (reference):
--   admin_account_created, admin_permission_granted, admin_permission_revoked,
--   admin_account_disabled, admin_account_enabled

-- 19.8  Verification -----------------------------------------------------
-- select key, job_label from public.admin_permission_catalog order by sort_order;
-- select admin_id, array_agg(permission_key order by permission_key) as keys
--   from public.admin_permissions group by admin_id;
-- As an admin or super-admin session:  select public.admin_can('vehicles.review');
-- As a super-admin session:            select public.admin_can('finance.payouts'); -- true (super admin = all)

-- ============================================================================
-- CHAPTER 20 - RBAC enforcement (Phase 3): is_admin() -> admin_can(<key>)
-- SOURCE: project_docs/RBAC_DESIGN.md section 5
-- ============================================================================
-- Replaces the coarse "any admin" gate on the operational tables with the
-- per-admin checklist from Chapter 19. A super_admin still passes every check
-- (admin_can() returns true for them unconditionally), so super-admin workflows
-- are unaffected. Every backfilled admin holds all 9 keys, so on the day this
-- runs a plain admin also sees no change - the difference only appears once a
-- super admin removes a key from someone in /admin/admins.
--
-- NOT touched (kept as-is): profiles SELECT and bookings SELECT stay is_admin()
-- (the admin shell needs them); all finance / ledger / reconciliation /
-- retention / platform_settings policies stay is_super_admin(); audit_log and
-- notifications INSERT stay is_admin() (any privileged action writes them).
--
-- ROLLBACK: re-run Chapter 7 / Chapter 9 blocks (they recreate the is_admin()
-- versions of these same named policies), then drop trigger
-- enforce_admin_profile_permission.

-- 20.1  Catalog: catalog.manage -----------------------------------------
drop policy if exists "Catalog write access brands" on public.car_brands;
create policy "Catalog write access brands" on public.car_brands
  for all using (public.admin_can('catalog.manage'))
  with check (public.admin_can('catalog.manage'));

drop policy if exists "Catalog write access models" on public.car_models;
create policy "Catalog write access models" on public.car_models
  for all using (public.admin_can('catalog.manage'))
  with check (public.admin_can('catalog.manage'));

-- 20.2  Vehicles: vehicles.review (approve/reject/revoke/re-review) +
--       vehicles.delete (delete a car record) -----------------------------
drop policy if exists "Owners can update own cars" on public.cars;
create policy "Owners can update own cars" on public.cars
  for update using (auth.uid() = owner_id or public.admin_can('vehicles.review'))
  with check (auth.uid() = owner_id or public.admin_can('vehicles.review'));

drop policy if exists "Admins can delete cars" on public.cars;
create policy "Admins can delete cars" on public.cars
  for delete using (public.admin_can('vehicles.delete'));

drop policy if exists "Owners and admins see car documents" on public.car_documents;
create policy "Owners and admins see car documents" on public.car_documents
  for select using (
    exists (
      select 1 from public.cars
      where id = car_documents.car_id and owner_id = auth.uid()
    )
    or public.admin_can('vehicles.review')
  );

-- car_documents had no admin UPDATE policy before, so the vehicle-approval page
-- silently updated 0 rows when stamping review_flag. Add the correct one.
drop policy if exists "Vehicle reviewers update car documents" on public.car_documents;
create policy "Vehicle reviewers update car documents" on public.car_documents
  for update using (public.admin_can('vehicles.review'))
  with check (public.admin_can('vehicles.review'));

drop policy if exists "Admins can update renewals" on public.car_renewals;
create policy "Admins can update renewals" on public.car_renewals
  for update using (public.admin_can('vehicles.review'));

-- 20.3  Users / KYC: users.verify + users.moderate --------------------------
-- One UPDATE policy admits either kind of user-admin; the column-level split
-- (verification fields vs login-block fields) is enforced by the trigger below.
drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile" on public.profiles
  for update
  using (public.admin_can('users.verify') or public.admin_can('users.moderate'))
  with check (public.admin_can('users.verify') or public.admin_can('users.moderate'));

create or replace function public.enforce_admin_profile_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Server code (service_role) and a user editing their own row are handled by
  -- protect_profile_sensitive_fields(); this trigger only constrains an
  -- authenticated *admin* to the checklist key that matches their edit.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if not public.is_admin() or public.is_super_admin() then
    return new;
  end if;

  if (new.verified_status  is distinct from old.verified_status
      or new.rejection_reason is distinct from old.rejection_reason)
     and not public.admin_can('users.verify') then
    raise exception 'Changing verification status requires the users.verify permission';
  end if;

  if (new.login_blocked_until is distinct from old.login_blocked_until
      or new.login_block_reason is distinct from old.login_block_reason)
     and not public.admin_can('users.moderate') then
    raise exception 'Changing a login block requires the users.moderate permission';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_admin_profile_permission on public.profiles;
create trigger enforce_admin_profile_permission
  before update on public.profiles
  for each row execute function public.enforce_admin_profile_permission();

drop policy if exists "Users can manage own verification images" on public.verification_images;
create policy "Users can manage own verification images" on public.verification_images
  for all
  using (auth.uid() = user_id or public.admin_can('users.verify'))
  with check (auth.uid() = user_id or public.admin_can('users.verify'));

-- 20.4  Support tickets: support.handle -----------------------------------
drop policy if exists "Admins can create tickets for users" on public.support_tickets;
create policy "Admins can create tickets for users" on public.support_tickets
  for insert with check (public.admin_can('support.handle'));

drop policy if exists "Admins can update tickets" on public.support_tickets;
create policy "Admins can update tickets" on public.support_tickets
  for update using (public.admin_can('support.handle'));

drop policy if exists "Users and admins can read tickets" on public.support_tickets;
create policy "Users and admins can read tickets" on public.support_tickets
  for select using (
    auth.uid() = user_id
    or auth.uid() = participant_user_id
    or public.admin_can('support.handle')
  );

drop policy if exists "Users and admins can read ticket messages" on public.ticket_messages;
create policy "Users and admins can read ticket messages" on public.ticket_messages
  for select using (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_messages.ticket_id
        and (
          t.user_id = auth.uid()
          or t.participant_user_id = auth.uid()
          or public.admin_can('support.handle')
        )
    )
  );

drop policy if exists "Users and admins can create ticket messages" on public.ticket_messages;
create policy "Users and admins can create ticket messages" on public.ticket_messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_messages.ticket_id
        and (
          t.user_id = auth.uid()
          or t.participant_user_id = auth.uid()
          or public.admin_can('support.handle')
        )
    )
  );

-- 20.5  User / guest inquiries: inquiries.handle -------------------------
drop policy if exists "Admins can read guest inquiries" on public.guest_inquiries;
create policy "Admins can read guest inquiries" on public.guest_inquiries
  for select using (public.admin_can('inquiries.handle'));

drop policy if exists "Admins can update guest inquiries" on public.guest_inquiries;
create policy "Admins can update guest inquiries" on public.guest_inquiries
  for update using (public.admin_can('inquiries.handle'))
  with check (public.admin_can('inquiries.handle'));

-- 20.6  Logs: audit.view / security.view --------------------------------
drop policy if exists "Admin read audit log" on public.audit_log;
create policy "Admin read audit log" on public.audit_log
  for select using (public.admin_can('audit.view'));

drop policy if exists "Admin read security logs" on public.security_logs;
create policy "Admin read security logs" on public.security_logs
  for select using (public.admin_can('security.view'));

-- 20.7  Verification ----------------------------------------------------
-- As a plain admin missing 'catalog.manage':
--   insert into public.car_brands (name) values ('x');   -- must fail (RLS)
-- As the same admin with the key granted: the insert succeeds.
-- select public.admin_can('audit.view');  -- reflects the current checklist

-- ============================================================================
-- CHAPTER 21 - RBAC gap closure (Phase 3b)
-- SOURCE: project_docs/RBAC_DESIGN.md
-- ============================================================================
-- Small follow-ups found while reviewing Chapter 20:
--  * bookings UPDATE was still is_admin(). No browser admin screen writes
--    bookings (every change goes through api/booking-action.ts with the
--    service-role key), and a booking status change moves money, so a plain
--    admin should not be able to raw-update one. Tighten to super admin.
--  * put public.admin_permissions in the realtime publication so a checklist
--    change reaches the affected admin's open session within seconds (the
--    client also polls every 45s as a fallback).

drop policy if exists "Admins can update bookings" on public.bookings;
create policy "Admins can update bookings" on public.bookings
  for update using (public.is_super_admin())
  with check (public.is_super_admin());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'admin_permissions'
     )
  then
    execute 'alter publication supabase_realtime add table public.admin_permissions';
  end if;
end $$;

-- ============================================================================
-- CHAPTER 22 - Renter<->lister conversation fixes
-- SOURCE: project_docs/RBAC_DESIGN.md review pass
-- ============================================================================
-- A car listing's "Ask the lister" opens a support_tickets row with
-- participant_user_id set - a renter<->lister conversation that SafeDrive only
-- monitors. Two fixes:
--  * when an admin replies to such a conversation, BOTH members must be
--    notified (the old trigger notified only the ticket opener / renter).
--  * the message-sender trigger already routes member<->member replies to the
--    other party; keep that, just also cover the admin case.

create or replace function public.notify_support_message_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket_record public.support_tickets%rowtype;
  sender_is_admin boolean;
begin
  if not exists (
    select 1 from public.ticket_messages m
    where m.ticket_id = new.ticket_id and m.id <> new.id
  ) then
    return new;
  end if;

  select * into ticket_record
  from public.support_tickets
  where id = new.ticket_id;

  select exists (
    select 1 from public.profiles p
    where p.id = new.sender_id and p.role in ('admin', 'super_admin')
  ) into sender_is_admin;

  if sender_is_admin then
    if ticket_record.participant_user_id is not null then
      -- Conversation ticket: notify both members that SafeDrive stepped in.
      insert into public.notifications (user_id, title, message, type, link)
      select uid,
        'SafeDrive replied in your conversation',
        ticket_record.subject || ' has a new message from SafeDrive Support.',
        'support', '/support'
      from (values (ticket_record.user_id), (ticket_record.participant_user_id)) as t(uid)
      where uid is not null;
    else
      insert into public.notifications (user_id, title, message, type, link)
      values (
        ticket_record.user_id,
        'Support replied to your ticket',
        ticket_record.subject || ' has a new response from SafeDrive Support.',
        'support',
        '/support'
      );
    end if;
  elsif ticket_record.participant_user_id is not null then
    insert into public.notifications (user_id, title, message, type, link)
    values (
      case
        when new.sender_id = ticket_record.user_id then ticket_record.participant_user_id
        else ticket_record.user_id
      end,
      'New inquiry reply',
      ticket_record.subject || ' has a new reply.',
      'support',
      '/support'
    );
  else
    insert into public.notifications (user_id, title, message, type, link)
    select
      p.id,
      'Support ticket reply received',
      ticket_record.subject || ' has a new customer reply.',
      'support',
      '/admin/support'
    from public.profiles p
    where p.role in ('admin', 'super_admin') and p.deleted_at is null;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- CHAPTER 23 - Vehicle renewal review wiring
-- SOURCE: project_docs/RBAC_DESIGN.md review pass
-- ============================================================================
-- Before this chapter the renewal flow was half-built: a lister could submit
-- car_renewals rows from /car-renewals, but nothing set a car to
-- 'renewal_required' and no admin screen reviewed the submissions. This wires
-- both ends.

-- 23.1  Notify admins when a lister submits renewal documents.
create or replace function public.notify_car_renewal_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, message, type, link)
  select p.id,
    'Vehicle renewal submitted',
    'A lister submitted updated compliance documents for review.',
    'vehicle',
    '/admin/vehicle-renewals'
  from public.profiles p
  where p.role in ('admin', 'super_admin') and p.deleted_at is null;
  return new;
end;
$$;

drop trigger if exists notify_car_renewal_submitted on public.car_renewals;
create trigger notify_car_renewal_submitted
  after insert on public.car_renewals
  for each row execute function public.notify_car_renewal_submitted();

-- 23.2  Auto-flag vehicles whose compliance documents have expired. Meant to be
-- called once a day from the scheduler (api/flag-expired-vehicle-documents.ts).
-- Idempotent: a car already 'renewal_required' is skipped. Returns the count.
create or replace function public.flag_vehicles_needing_renewal()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  flagged int := 0;
  car_row record;
begin
  for car_row in
    select c.id, c.owner_id, c.plate_number
    from public.cars c
    where c.status in ('approved', 'active')
      and (
        c.registration_expiry < current_date
        or c.ctpl_expiry < current_date
        or c.comprehensive_insurance_expiry < current_date
      )
  loop
    update public.cars
      set status = 'renewal_required', updated_at = now()
      where id = car_row.id;

    insert into public.notifications (user_id, title, message, type, link)
      values (
        car_row.owner_id,
        'Vehicle renewal required',
        'A compliance document for ' || car_row.plate_number ||
          ' has expired. Submit updated documents to relist the vehicle.',
        'vehicle',
        '/car-renewals'
      );

    insert into public.audit_log (user_id, action, entity_type, entity_id, details)
      values (
        car_row.owner_id, 'vehicle_renewal_required', 'car', car_row.id,
        jsonb_build_object('reason', 'document_expiry', 'auto', true)
      );

    flagged := flagged + 1;
  end loop;
  return flagged;
end;
$$;

revoke all on function public.flag_vehicles_needing_renewal() from public, anon, authenticated;
grant execute on function public.flag_vehicles_needing_renewal() to service_role;

-- 23.3  Read access to a submitted renewal for the reviewing admin. Listers
-- already have "Listers see own renewals"; add the admin side keyed to the
-- vehicles.review permission (Chapter 20 changed the UPDATE policy to the same
-- key but left SELECT on is_admin()).
drop policy if exists "Listers see own renewals" on public.car_renewals;
create policy "Listers see own renewals" on public.car_renewals
  for select using (auth.uid() = lister_id or public.admin_can('vehicles.review'));

-- ============================================================================
-- CHAPTER 24 - Server-side login throttle (Password Verification Auth Hook)
-- SOURCE: project_docs/RBAC_DESIGN.md - authentication hardening
-- ============================================================================
-- src/lib/authLockout.ts is a browser-side (localStorage) progressive lockout:
-- helpful UX feedback, but a scripted attacker hitting Supabase /token directly
-- bypasses it entirely and is never even logged. This chapter moves the same
-- progressive rule to the SERVER, enforced by Supabase itself on every password
-- attempt, keyed to the account (not the browser).
--
-- ACTIVATION (not automatic): after running this chapter, go to
--   Supabase Dashboard - Authentication - Hooks - "Password Verification
--   Attempt" - and select the Postgres function public.password_verification_
--   hook. Test immediately with a spare account and keep a second admin session
--   open. INSTANT ROLLBACK: unregister the hook in the same screen.
--
-- Fail-safe: any unexpected error inside the function returns "continue" so a
-- bug here can never lock everyone out.

create table if not exists public.auth_failed_attempts (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  attempts          int  not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until      timestamptz
);

alter table public.auth_failed_attempts enable row level security;
-- No policies on purpose: only the SECURITY DEFINER hook and service_role touch it.

create or replace function public.password_verification_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid          uuid;
  pw_valid     boolean;
  rec          public.auth_failed_attempts%rowtype;
  now_ts       timestamptz := now();
  threshold    constant int := 5;   -- attempts per lock step
  step_minutes constant int := 5;   -- lock 5 min at 5 fails, 10 at 10, ...
  window_hours constant int := 24;  -- failure counter resets after this
  new_attempts int;
begin
  uid := nullif(event->>'user_id', '')::uuid;
  pw_valid := coalesce((event->>'valid')::boolean, true);

  if uid is null then
    return jsonb_build_object('decision', 'continue');
  end if;

  select * into rec from public.auth_failed_attempts where user_id = uid;

  -- Currently locked - reject even a correct password until it expires.
  if rec.user_id is not null
     and rec.locked_until is not null
     and rec.locked_until > now_ts then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Too many failed sign-in attempts. Please wait a few minutes and try again.'
    );
  end if;

  if pw_valid then
    delete from public.auth_failed_attempts where user_id = uid;
    return jsonb_build_object('decision', 'continue');
  end if;

  -- A failed attempt. Start a fresh 24h window if this is the first failure or
  -- the previous window has lapsed.
  if rec.user_id is null
     or now_ts - rec.window_started_at > make_interval(hours => window_hours) then
    new_attempts := 1;
    insert into public.auth_failed_attempts (user_id, attempts, window_started_at, locked_until)
      values (uid, 1, now_ts, null)
    on conflict (user_id) do update
      set attempts = 1, window_started_at = now_ts, locked_until = null;
  else
    new_attempts := rec.attempts + 1;
    update public.auth_failed_attempts
      set attempts = new_attempts,
          locked_until = case
            when new_attempts % threshold = 0
            then now_ts + make_interval(mins => (new_attempts / threshold) * step_minutes)
            else locked_until
          end
      where user_id = uid;
  end if;

  if new_attempts % threshold = 0 then
    -- Best-effort server-side log so scripted attacks become visible.
    begin
      insert into public.security_logs (event_type, status, auth_method, user_id, failure_reason, details)
      values ('lockout_started', 'failed', 'password', uid,
        format('%s failed attempts - locked %s minutes (server hook)',
          new_attempts, (new_attempts / threshold) * step_minutes),
        jsonb_build_object('source', 'password_verification_hook'));
    exception when others then null;
    end;

    return jsonb_build_object(
      'decision', 'reject',
      'message', format('Too many failed sign-in attempts. Locked for %s minutes.',
        (new_attempts / threshold) * step_minutes)
    );
  end if;

  return jsonb_build_object('decision', 'continue');
exception
  when others then
    -- A bug here must never block sign-in.
    return jsonb_build_object('decision', 'continue');
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.password_verification_hook(jsonb) to supabase_auth_admin;
grant all on public.auth_failed_attempts to supabase_auth_admin;
revoke all on function public.password_verification_hook(jsonb) from anon, authenticated, public;

-- Optional housekeeping - call from a scheduler if you like, harmless if not.
create or replace function public.purge_auth_failed_attempts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  delete from public.auth_failed_attempts
  where window_started_at < now() - interval '48 hours'
    and (locked_until is null or locked_until < now());
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ============================================================================
-- CHAPTER 25 - Allow deleting a staff account without losing the audit trail
-- SOURCE: project_docs/RBAC_DESIGN.md - admin governance
-- ============================================================================
-- audit_log.user_id pointed at profiles(id) with NO on-delete action, so a
-- profile that had ever acted could not be removed at all (only disabled).
-- Switch it to ON DELETE SET NULL: deleting a departed admin now succeeds, and
-- their past audit rows survive with user_id = NULL. entity_id (text, not a FK)
-- still carries the affected account's id, and /api/admin-delete records an
-- 'admin_account_deleted' row naming the person + who removed them before the
-- delete, and permission-change rows snapshot the admin name/email in details,
-- so accountability is preserved. The UI shows "Former staff" for a NULL actor.

do $$
declare
  fk_name text;
begin
  select conname into fk_name
  from pg_constraint
  where conrelid = 'public.audit_log'::regclass
    and contype = 'f'
    and conkey = array[
      (select attnum from pg_attribute
       where attrelid = 'public.audit_log'::regclass and attname = 'user_id')
    ];
  if fk_name is not null then
    execute format('alter table public.audit_log drop constraint %I', fk_name);
  end if;
  alter table public.audit_log
    add constraint audit_log_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete set null;
end $$;

-- ============================================================================
-- CHAPTER 26 - Data-subject request execution: scripted anonymization +
--              self-service withdrawal
-- ============================================================================
-- Real-world DPA / GDPR practice: a "delete my account" request is reviewed,
-- and an approved deletion is almost always satisfied by ANONYMIZATION when
-- financial / contract / dispute records must be retained. Before this chapter
-- an admin did that by hand in the SQL editor - easy to miss a column or a
-- storage object. anonymize_user() does the whole scrub in one transaction and
-- returns a report of what it cleared plus what still needs a human review.
--
-- Also: let a user withdraw their own pending request (the 'cancelled' status
-- already exists in the CHECK constraint - no schema change needed).

-- ----------------------------------------------------------------------------
-- 26.1  Self-service withdrawal of an open data-retention request
-- ----------------------------------------------------------------------------
create or replace function public.withdraw_data_retention_request(p_request_id uuid)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.data_retention_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_request
  from public.data_retention_requests
  where data_retention_requests.id = p_request_id;

  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.subject_user_id is distinct from v_user_id then
    raise exception 'You can only withdraw your own request';
  end if;
  if v_request.status not in ('submitted', 'identity_check', 'under_review') then
    raise exception 'This request can no longer be withdrawn (status: %)', v_request.status;
  end if;

  update public.data_retention_requests
  set status = 'cancelled',
      decision_reason = coalesce(decision_reason, '') ||
        case when decision_reason is null or decision_reason = '' then '' else ' ' end ||
        'Withdrawn by the requester on ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '.',
      updated_at = now()
  where data_retention_requests.id = p_request_id;

  insert into public.notifications (user_id, title, message, type, link)
  select profile.id, 'Privacy Request Withdrawn',
    v_request.requester_email || ' withdrew their ' || v_request.request_type || ' request.',
    'info', '/admin/retention-requests?request=' || p_request_id::text
  from public.profiles profile
  where profile.role = 'super_admin' and profile.deleted_at is null;

  insert into public.audit_log (user_id, action, entity_type, entity_id, details)
  values (
    v_user_id, 'data_retention_request_withdrawn', 'data_retention_request', p_request_id,
    jsonb_build_object('request_type', v_request.request_type, 'previous_status', v_request.status)
  );

  return query select p_request_id, 'cancelled'::text;
end;
$$;

revoke all on function public.withdraw_data_retention_request(uuid) from public, anon;
grant execute on function public.withdraw_data_retention_request(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 26.2  Scripted anonymization of a regular user account
-- ----------------------------------------------------------------------------
create or replace function public.anonymize_user(p_user_id uuid, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_open_bookings integer;
  v_cars integer := 0;
  v_vimages integer := 0;
  v_notifs integer := 0;
  v_audit integer := 0;
  v_manual jsonb;
  v_report jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can anonymize a user';
  end if;

  select * into v_target from public.profiles where profiles.id = p_user_id;
  if not found then
    raise exception 'User % not found', p_user_id;
  end if;
  if v_target.role in ('admin', 'super_admin') then
    raise exception 'Demote this staff account to a regular user before anonymizing it';
  end if;
  if v_target.deleted_at is not null then
    raise exception 'This account is already anonymized / deleted';
  end if;

  -- A live rental must finish (payout, dispute window) before identity data
  -- is scrubbed.
  select count(*) into v_open_bookings
  from public.bookings b
  where (b.renter_id = p_user_id or b.owner_id = p_user_id)
    and b.status in ('confirmed', 'awaiting_payment', 'downpayment_paid', 'fully_paid', 'active');
  if v_open_bookings > 0 then
    raise exception 'User still has % booking(s) in progress. Complete or resolve them before anonymizing.', v_open_bookings;
  end if;

  -- 1. Structured profile PII -> blanked; account soft-deleted.
  update public.profiles set
    email = 'deleted+' || left(p_user_id::text, 8) || '@safedrive.invalid',
    full_name = 'Deleted user',
    first_name = null, middle_name = null, last_name = null,
    phone = null, secondary_phone = null, address = null, birthday = null,
    driver_license = null, national_id = null, secondary_id_type = null,
    avatar_url = null, gender = null,
    payout_method = null, payout_account_name = null, payout_account_number = null,
    emergency_contact_number = null, login_block_reason = null,
    is_lister = false,
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now()
  where profiles.id = p_user_id;

  -- 2. Verification images: storage objects + rows.
  delete from storage.objects
  where bucket_id = 'user-verification'
    and (storage.foldername(name))[1] = p_user_id::text;
  get diagnostics v_vimages = row_count;
  delete from public.verification_images where user_id = p_user_id;

  -- 3. Car listings pulled offline, free-text contact fields cleared.
  update public.cars set
    status = 'inactive',
    contact_number = null,
    additional_info = null,
    updated_at = now()
  where owner_id = p_user_id;
  get diagnostics v_cars = row_count;

  -- 4. Booking arrival geolocation + photos (both roles).
  update public.bookings set
    renter_arrival_latitude = null, renter_arrival_longitude = null,
    renter_arrival_accuracy_meters = null, renter_arrival_location_captured_at = null,
    renter_arrival_photo_url = null
  where renter_id = p_user_id;
  update public.bookings set
    lister_arrival_latitude = null, lister_arrival_longitude = null,
    lister_arrival_accuracy_meters = null, lister_arrival_location_captured_at = null,
    lister_arrival_photo_url = null
  where owner_id = p_user_id;

  -- 5. Trip-condition report geolocation for this reporter.
  update public.trip_condition_reports set
    latitude = null, longitude = null, location_accuracy_meters = null
  where reporter_id = p_user_id;

  -- 6. Notifications addressed to this user (text may embed a name).
  delete from public.notifications where user_id = p_user_id;
  get diagnostics v_notifs = row_count;

  -- 7. Redact known PII keys from this user's own audit rows.
  update public.audit_log set
    details = details
      - 'email' - 'admin_email' - 'renter_email' - 'owner_email'
      - 'full_name' - 'admin_name' - 'name' - 'phone'
  where user_id = p_user_id
    and details ?| array['email','admin_email','renter_email','owner_email',
                         'full_name','admin_name','name','phone'];
  get diagnostics v_audit = row_count;

  -- 8. Retention-request contact email.
  update public.data_retention_requests
  set requester_email = 'redacted@safedrive.invalid'
  where subject_user_id = p_user_id;

  -- Free-text records a human still has to review (cannot auto-scrub without
  -- destroying dispute / safety evidence).
  select jsonb_build_object(
    'review_feedback', (
      select count(*) from public.booking_reviews r
      where (r.reviewer_id = p_user_id or r.reviewee_id = p_user_id)
        and coalesce(r.feedback, '') <> ''
    ),
    'support_messages', (
      select count(*) from public.ticket_messages m where m.sender_id = p_user_id
    ),
    'trip_condition_notes', (
      select count(*) from public.trip_condition_reports t
      where t.reporter_id = p_user_id and coalesce(t.damage_notes, '') <> ''
    ),
    'guest_inquiries', (
      select count(*) from public.guest_inquiries g where g.submitted_by_user_id = p_user_id
    )
  ) into v_manual;

  v_report := jsonb_build_object(
    'user_id', p_user_id,
    'anonymized_at', now(),
    'actor_id', v_actor,
    'request_id', p_request_id,
    'profile_pii_cleared', true,
    'verification_objects_deleted', v_vimages,
    'cars_deactivated', v_cars,
    'notifications_deleted', v_notifs,
    'audit_rows_redacted', v_audit,
    'needs_manual_review', v_manual
  );

  insert into public.audit_log (user_id, action, entity_type, entity_id, details)
  values (v_actor, 'user_anonymized', 'profile', p_user_id, v_report);

  return v_report;
end;
$$;

revoke all on function public.anonymize_user(uuid, uuid) from public, anon;
grant execute on function public.anonymize_user(uuid, uuid) to authenticated;

-- ============================================================================
-- CHAPTER 27 - Cancellation accountability + two-sided reliability signals
-- ============================================================================
-- Mirrors the mature P2P-rental model (Airbnb host cancellation policy /
-- Superhost metrics, Turo All-Star Host, marketplace seller cancellation
-- rates):
--   * reviews (stars)          = quality,     per vehicle, after a completed trip
--   * cancellation/completion  = reliability, per account, computed from behaviour
-- A "late" cancellation is one made inside the booking's own
-- refund_full_hours window - the SAME threshold the renter already faces, so
-- both sides are treated symmetrically.

-- ----------------------------------------------------------------------------
-- 27.1  One row per cancelled booking, whoever cancelled.
-- ----------------------------------------------------------------------------
create table if not exists public.booking_cancellations (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  cancelled_by_role text not null check (cancelled_by_role in ('renter', 'lister')),
  cancelled_by_id uuid references public.profiles(id) on delete set null,
  lister_id uuid references public.profiles(id) on delete set null,
  renter_id uuid references public.profiles(id) on delete set null,
  car_id uuid references public.cars(id) on delete set null,
  reason text,
  hours_before_pickup numeric,
  was_late boolean not null default false,
  had_captured_payment boolean not null default false,
  cancelled_at timestamptz not null default now()
);

create index if not exists booking_cancellations_lister_idx
  on public.booking_cancellations (lister_id, cancelled_at);
create index if not exists booking_cancellations_renter_idx
  on public.booking_cancellations (renter_id, cancelled_at);

alter table public.booking_cancellations enable row level security;

drop policy if exists "Participants read booking cancellations" on public.booking_cancellations;
create policy "Participants read booking cancellations"
on public.booking_cancellations for select
using (lister_id = auth.uid() or renter_id = auth.uid() or public.is_admin());
-- No insert/update/delete policy: only the service-role API handler writes here.

grant select on public.booking_cancellations to authenticated;

-- ----------------------------------------------------------------------------
-- 27.2  Lister reliability (rolling 365 days). anon + authenticated: a renter
--       browsing a car needs this before booking.
-- ----------------------------------------------------------------------------
create or replace function public.get_lister_reliability(p_lister_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with completed as (
    select count(*)::int as n
    from public.bookings b
    where b.owner_id = p_lister_id
      and b.status = 'completed'
      and b.end_date >= (now() - interval '365 days')::date
  ),
  cancels as (
    select
      count(*)::int as n,
      count(*) filter (where c.was_late)::int as late_n
    from public.booking_cancellations c
    where c.lister_id = p_lister_id
      and c.cancelled_by_role = 'lister'
      and c.cancelled_at >= now() - interval '365 days'
  )
  select jsonb_build_object(
    'completed_trips', (select n from completed),
    'cancellations', (select n from cancels),
    'late_cancellations', (select late_n from cancels),
    'total', (select n from completed) + (select n from cancels),
    'has_enough_history', ((select n from completed) + (select n from cancels)) >= 3,
    'cancellation_rate',
      case
        when ((select n from completed) + (select n from cancels)) >= 3
        then round(
          (select n from cancels)::numeric
          / nullif((select n from completed) + (select n from cancels), 0) * 100,
          0
        )
        else null
      end
  );
$$;
grant execute on function public.get_lister_reliability(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 27.3  Renter reliability (rolling 365 days). authenticated only - a lister
--       seeing who booked them.
-- ----------------------------------------------------------------------------
create or replace function public.get_renter_reliability(p_renter_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with completed as (
    select count(*)::int as n
    from public.bookings b
    where b.renter_id = p_renter_id
      and b.status = 'completed'
      and b.end_date >= (now() - interval '365 days')::date
  ),
  cancels as (
    select count(*)::int as n
    from public.booking_cancellations c
    where c.renter_id = p_renter_id
      and c.cancelled_by_role = 'renter'
      and c.was_late
      and c.cancelled_at >= now() - interval '365 days'
  )
  select jsonb_build_object(
    'completed_trips', (select n from completed),
    'cancellations', (select n from cancels),
    'total', (select n from completed) + (select n from cancels),
    'has_enough_history', ((select n from completed) + (select n from cancels)) >= 3,
    'cancellation_rate',
      case
        when ((select n from completed) + (select n from cancels)) >= 3
        then round(
          (select n from cancels)::numeric
          / nullif((select n from completed) + (select n from cancels), 0) * 100,
          0
        )
        else null
      end
  );
$$;
grant execute on function public.get_renter_reliability(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 27.4  Renter may review a lister who cancelled their booking (Airbnb-style).
--       Additive to the existing "completed booking" INSERT policy - Postgres
--       ORs multiple permissive policies for the same command.
-- ----------------------------------------------------------------------------
drop policy if exists "Renter reviews a lister cancellation" on public.booking_reviews;
create policy "Renter reviews a lister cancellation" on public.booking_reviews
for insert with check (
  auth.uid() = reviewer_id
  and reviewer_role = 'renter'
  and exists (
    select 1
    from public.booking_cancellations bc
    join public.bookings b on b.id = bc.booking_id
    where bc.booking_id = booking_reviews.booking_id
      and bc.cancelled_by_role = 'lister'
      and b.renter_id = auth.uid()
      and booking_reviews.reviewee_id = b.owner_id
      and booking_reviews.car_id = b.car_id
  )
);

drop policy if exists "Read booking cancellation reviews" on public.booking_reviews;
create policy "Read booking cancellation reviews" on public.booking_reviews
for select using (
  exists (
    select 1 from public.booking_cancellations bc
    where bc.booking_id = booking_reviews.booking_id
      and bc.cancelled_by_role = 'lister'
  )
);

-- ----------------------------------------------------------------------------
-- 27.5  Public car reviews now also surface a lister-cancellation review, with
--       a flag so the UI can badge it. The numeric star averages
--       (get_car_rating_summaries / get_lister_rating_summaries) stay
--       completed-trip only - a cancellation review never moves the trip score.
-- ----------------------------------------------------------------------------
-- Return signature gains a column, so the old function must be dropped first.
drop function if exists public.get_public_car_reviews(uuid);
create or replace function public.get_public_car_reviews(p_car_id uuid)
returns table(
  id uuid, rating integer, feedback text, created_at timestamptz,
  reviewer_name text, reviewer_avatar text, is_cancellation_review boolean
)
language sql stable security definer set search_path = public
as $$
  select r.id, r.rating, r.feedback, r.created_at,
         coalesce(nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'Renter'),
         p.avatar_url,
         false as is_cancellation_review
  from public.booking_reviews r
  join public.bookings b on b.id = r.booking_id
  left join public.profiles p on p.id = r.reviewer_id
  where r.car_id = p_car_id
    and r.reviewer_role = 'renter'
    and b.status = 'completed'
    and public._review_is_published(r.booking_id, r.reviewer_id)
  union all
  select r.id, r.rating, r.feedback, r.created_at,
         coalesce(nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'Renter'),
         p.avatar_url,
         true as is_cancellation_review
  from public.booking_reviews r
  join public.booking_cancellations bc on bc.booking_id = r.booking_id
  left join public.profiles p on p.id = r.reviewer_id
  where r.car_id = p_car_id
    and r.reviewer_role = 'renter'
    and bc.cancelled_by_role = 'lister'
  order by created_at desc
  limit 50;
$$;
grant execute on function public.get_public_car_reviews(uuid) to anon, authenticated;

-- ============================================================================
-- CHAPTER 28 - Editable verification ETA messages
-- ============================================================================
-- The "how long does verification take" wording was hard-coded ("24 hours /
-- 1-3 business days"). During a peak season an admin needs to change that
-- expectation without a redeploy so users do not complain that day 3 passed
-- with no decision. This is display text, not a money or policy value, so a
-- single super admin edits it directly - same model as the platform contact
-- email, no proposal / vote.

alter table public.platform_settings
  add column if not exists user_verification_eta_message text not null
    default 'Most identity reviews finish within 24 hours. Complex cases may take 1 to 3 business days.',
  add column if not exists vehicle_verification_eta_message text not null
    default 'Most vehicle reviews finish within 24 hours. Complex cases may take 1 to 3 business days.';

create or replace function public.get_verification_eta_messages()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_message', coalesce(
      nullif(trim(user_verification_eta_message), ''),
      'Most identity reviews finish within 24 hours. Complex cases may take 1 to 3 business days.'
    ),
    'vehicle_message', coalesce(
      nullif(trim(vehicle_verification_eta_message), ''),
      'Most vehicle reviews finish within 24 hours. Complex cases may take 1 to 3 business days.'
    )
  )
  from public.platform_settings
  where id = 'default';
$$;
grant execute on function public.get_verification_eta_messages() to anon, authenticated;

create or replace function public.set_verification_eta_messages(
  p_user_message text,
  p_vehicle_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user text := trim(coalesce(p_user_message, ''));
  v_vehicle text := trim(coalesce(p_vehicle_message, ''));
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change the verification ETA messages';
  end if;
  if char_length(v_user) not between 10 and 400
     or char_length(v_vehicle) not between 10 and 400 then
    raise exception 'Each message must be 10 to 400 characters';
  end if;

  update public.platform_settings
  set user_verification_eta_message = v_user,
      vehicle_verification_eta_message = v_vehicle,
      updated_at = now()
  where id = 'default';

  insert into public.audit_log (user_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'verification_eta_messages_updated', 'platform_settings', 'default',
    jsonb_build_object('user_message', v_user, 'vehicle_message', v_vehicle)
  );

  return jsonb_build_object('user_message', v_user, 'vehicle_message', v_vehicle);
end;
$$;
revoke all on function public.set_verification_eta_messages(text, text) from public, anon;
grant execute on function public.set_verification_eta_messages(text, text) to authenticated;

-- ============================================================================
-- CHAPTER 29 - Driver's licence validity + transmission (AT / AT-MT) gating
-- ============================================================================
-- The KYC review captured licence photos but no structured expiry or the
-- Philippine licence's transmission restriction (the back of the current LTO
-- card states AT or AT/MT). This chapter adds:
--   * profiles.license_expiry / license_transmission - admin-set during review
--   * profiles.license_update_pending - the renter flags a re-submission
--   * cars.transmission - lister-set, 'automatic' | 'manual'
-- Enforcement (api/create-booking.ts) is deliberately CONSERVATIVE: the gate
-- only bites on EXPLICIT values - an unset renter or car is nudged in the UI,
-- never hard-blocked - so the platform is not frozen the moment this ships.

alter table public.profiles
  add column if not exists license_expiry date,
  add column if not exists license_transmission text,
  add column if not exists license_update_pending boolean not null default false,
  add column if not exists license_expiry_notified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_license_transmission_check'
  ) then
    alter table public.profiles add constraint profiles_license_transmission_check
      check (license_transmission is null
             or license_transmission in ('automatic_only', 'manual_and_automatic'));
  end if;
end $$;

alter table public.cars
  add column if not exists transmission text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cars_transmission_check'
  ) then
    alter table public.cars add constraint cars_transmission_check
      check (transmission is null or transmission in ('automatic', 'manual'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 29.1  User-facing guard: a verified user still cannot self-edit licence
--       validity/restriction; they may only RAISE license_update_pending.
-- ----------------------------------------------------------------------------
create or replace function public.protect_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  privileged boolean;
begin
  privileged := public.is_admin()
    or current_user in ('postgres', 'service_role', 'supabase_admin');

  if privileged then
    return new;
  end if;

  if auth.uid() is null or auth.uid() <> old.id then
    raise exception 'Only the owning user or an admin can update this profile';
  end if;

  if new.role is distinct from old.role then
    raise exception 'Users cannot change their own role';
  end if;

  if new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'Users cannot change verification rejection reasons';
  end if;

  if new.login_blocked_until is distinct from old.login_blocked_until
     or new.login_block_reason is distinct from old.login_block_reason then
    raise exception 'Users cannot change login block settings';
  end if;

  if new.verified_status is distinct from old.verified_status then
    if not (
      old.verified_status in ('unverified', 'rejected')
      and new.verified_status = 'pending'
    ) then
      raise exception 'Users cannot self-approve or directly change verification status';
    end if;
  end if;

  if old.verified_status = 'verified' and (
    new.first_name is distinct from old.first_name
    or new.middle_name is distinct from old.middle_name
    or new.last_name is distinct from old.last_name
    or new.full_name is distinct from old.full_name
    or new.birthday is distinct from old.birthday
    or new.driver_license is distinct from old.driver_license
    or new.national_id is distinct from old.national_id
    or new.secondary_id_type is distinct from old.secondary_id_type
  ) then
    raise exception 'Verified identity fields require admin review to change';
  end if;

  if new.license_expiry is distinct from old.license_expiry
     or new.license_transmission is distinct from old.license_transmission
     or new.license_expiry_notified_at is distinct from old.license_expiry_notified_at then
    raise exception 'Driver''s licence validity is set by an admin during review';
  end if;

  if new.license_update_pending is distinct from old.license_update_pending
     and not (old.license_update_pending = false and new.license_update_pending = true) then
    raise exception 'Only an admin can clear a pending licence update';
  end if;

  if new.is_lister is distinct from old.is_lister
     and old.verified_status <> 'verified' then
    raise exception 'Only verified users can change lister mode';
  end if;

  if old.deleted_at is not null
     and new.deleted_at is distinct from old.deleted_at then
    raise exception 'Deleted profiles cannot be reactivated by the user';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_sensitive_fields on public.profiles;
create trigger protect_profile_sensitive_fields
  before update on public.profiles
  for each row execute function public.protect_profile_sensitive_fields();

-- ----------------------------------------------------------------------------
-- 29.2  Admin-facing guard: editing licence validity needs users.verify.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_admin_profile_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if not public.is_admin() or public.is_super_admin() then
    return new;
  end if;

  if (new.verified_status  is distinct from old.verified_status
      or new.rejection_reason is distinct from old.rejection_reason)
     and not public.admin_can('users.verify') then
    raise exception 'Changing verification status requires the users.verify permission';
  end if;

  if (new.license_expiry is distinct from old.license_expiry
      or new.license_transmission is distinct from old.license_transmission
      or new.license_update_pending is distinct from old.license_update_pending)
     and not public.admin_can('users.verify') then
    raise exception 'Changing driver''s licence details requires the users.verify permission';
  end if;

  if (new.login_blocked_until is distinct from old.login_blocked_until
      or new.login_block_reason is distinct from old.login_block_reason)
     and not public.admin_can('users.moderate') then
    raise exception 'Changing a login block requires the users.moderate permission';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_admin_profile_permission on public.profiles;
create trigger enforce_admin_profile_permission
  before update on public.profiles
  for each row execute function public.enforce_admin_profile_permission();

-- ----------------------------------------------------------------------------
-- 29.3  A transmission change is a material listing change -> back to review.
-- ----------------------------------------------------------------------------
create or replace function public.return_materially_changed_car_to_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('approved', 'active', 'inactive') and (
    old.model_id is distinct from new.model_id or old.plate_number is distinct from new.plate_number or
    old.mileage is distinct from new.mileage or old.price_per_day is distinct from new.price_per_day or
    old.security_deposit_amount is distinct from new.security_deposit_amount or old.location is distinct from new.location or
    old.fuel_category is distinct from new.fuel_category or old.fuel_subtype is distinct from new.fuel_subtype or
    old.gps_available is distinct from new.gps_available or old.contact_number is distinct from new.contact_number or
    old.additional_info is distinct from new.additional_info or
    old.transmission is distinct from new.transmission or
    old.registration_expiry is distinct from new.registration_expiry or old.ctpl_expiry is distinct from new.ctpl_expiry or
    old.comprehensive_insurance_expiry is distinct from new.comprehensive_insurance_expiry or
    old.insurer_rental_use_confirmed is distinct from new.insurer_rental_use_confirmed
  ) then
    new.status := 'pending';
    new.last_verified_at := null;
    new.rejection_reason := null;
    new.insurance_verification_status := 'pending';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 29.4  Cron helper: notify a renter whose licence is expiring / expired.
--       Called by api/flag-expiring-licenses.ts (CRON_SECRET). Deduped by
--       license_expiry_notified_at so a user is nudged at most weekly.
-- ----------------------------------------------------------------------------
create or replace function public.notify_expiring_licenses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select id, license_expiry
    from public.profiles
    where deleted_at is null
      and verified_status = 'verified'
      and license_expiry is not null
      and license_expiry <= (current_date + 30)
      and (license_expiry_notified_at is null
           or license_expiry_notified_at < now() - interval '7 days')
  loop
    insert into public.notifications (user_id, title, message, type, link)
    values (
      r.id,
      case when r.license_expiry < current_date
           then 'Driver''s licence expired'
           else 'Driver''s licence expiring soon' end,
      case when r.license_expiry < current_date
           then 'Your driver''s licence expired on ' || to_char(r.license_expiry, 'Mon DD, YYYY')
                || '. Submit an updated licence from Account & Identity so an admin can renew your access.'
           else 'Your driver''s licence expires on ' || to_char(r.license_expiry, 'Mon DD, YYYY')
                || '. Submit an updated licence from Account & Identity to avoid a booking hold.' end,
      case when r.license_expiry < current_date then 'error' else 'warning' end,
      '/verify'
    );

    update public.profiles
    set license_expiry_notified_at = now()
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.notify_expiring_licenses() from public, anon, authenticated;

-- ============================================================================
-- CHAPTER 30 - Early return (early-out) requests
-- ============================================================================
-- The mirror image of booking_extensions: a renter asks to hand the car back
-- BEFORE the booked end date. Standard P2P practice (Turo / Getaround): early
-- return is a convenience for both sides, NOT a money-back event - the trip
-- period is the renter's. Any refund is a discretionary lister goodwill
-- amount, released through the same manual admin refund review as every other
-- out-of-band refund. All writes go through api/booking-early-return-action.ts
-- with the service-role key; the client only reads the request state.

create table if not exists public.booking_early_returns (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  renter_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  current_end_date date not null,
  requested_end_date date not null,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  owner_decision_note text,
  goodwill_refund_amount numeric not null default 0 check (goodwill_refund_amount >= 0),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_early_returns_earlier
    check (requested_end_date < current_end_date)
);

create index if not exists booking_early_returns_booking_id_idx
  on public.booking_early_returns (booking_id, created_at desc);
create index if not exists booking_early_returns_status_idx
  on public.booking_early_returns (status);

create or replace function public.set_booking_early_returns_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists booking_early_returns_set_updated_at on public.booking_early_returns;
create trigger booking_early_returns_set_updated_at
before update on public.booking_early_returns
for each row execute function public.set_booking_early_returns_updated_at();

alter table public.booking_early_returns enable row level security;

drop policy if exists "Participants read early returns" on public.booking_early_returns;
create policy "Participants read early returns"
on public.booking_early_returns for select
using (auth.uid() = renter_id or auth.uid() = owner_id or public.is_admin());
-- No insert/update/delete policy: only the service-role API handler writes here.

grant select on public.booking_early_returns to authenticated;

-- ============================================================================
-- CHAPTER 31 - Pickup no-show / non-return incidents + fault attribution
-- ============================================================================
-- When something goes wrong at the handover, the affected booking must not
-- silently stay `active` and the INNOCENT party must not take the reputation
-- hit. This chapter adds:
--   * bookings.dispute_status - a sub-flag ('none' | 'open' | 'resolved') so an
--     un-returned or contested trip is out of the "active flow" (e.g. the
--     lister can then take the car offline) without inventing a new booking
--     status that would ripple through every filter.
--   * booking_cancellations.strike_waived - a cancellation the system knows was
--     not the party's fault (previous renter overstayed; car reported stolen /
--     damaged): still recorded, but excluded from the completion rate and the
--     auto-pause strike count.
-- The resolution logic lives in api/booking-incident-action.ts.

alter table public.bookings
  add column if not exists dispute_status text not null default 'none';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_dispute_status_check') then
    alter table public.bookings add constraint bookings_dispute_status_check
      check (dispute_status in ('none', 'open', 'resolved'));
  end if;
end $$;

alter table public.booking_cancellations
  add column if not exists strike_waived boolean not null default false;

-- Reliability RPCs (CHAPTER 27) now ignore a waived cancellation.
create or replace function public.get_lister_reliability(p_lister_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with completed as (
    select count(*)::int as n
    from public.bookings b
    where b.owner_id = p_lister_id
      and b.status = 'completed'
      and b.end_date >= (now() - interval '365 days')::date
  ),
  cancels as (
    select
      count(*)::int as n,
      count(*) filter (where c.was_late)::int as late_n
    from public.booking_cancellations c
    where c.lister_id = p_lister_id
      and c.cancelled_by_role = 'lister'
      and not coalesce(c.strike_waived, false)
      and c.cancelled_at >= now() - interval '365 days'
  )
  select jsonb_build_object(
    'completed_trips', (select n from completed),
    'cancellations', (select n from cancels),
    'late_cancellations', (select late_n from cancels),
    'total', (select n from completed) + (select n from cancels),
    'has_enough_history', ((select n from completed) + (select n from cancels)) >= 3,
    'cancellation_rate',
      case
        when ((select n from completed) + (select n from cancels)) >= 3
        then round(
          (select n from cancels)::numeric
          / nullif((select n from completed) + (select n from cancels), 0) * 100,
          0
        )
        else null
      end
  );
$$;
grant execute on function public.get_lister_reliability(uuid) to anon, authenticated;

create or replace function public.get_renter_reliability(p_renter_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with completed as (
    select count(*)::int as n
    from public.bookings b
    where b.renter_id = p_renter_id
      and b.status = 'completed'
      and b.end_date >= (now() - interval '365 days')::date
  ),
  cancels as (
    select count(*)::int as n
    from public.booking_cancellations c
    where c.renter_id = p_renter_id
      and c.cancelled_by_role = 'renter'
      and c.was_late
      and not coalesce(c.strike_waived, false)
      and c.cancelled_at >= now() - interval '365 days'
  )
  select jsonb_build_object(
    'completed_trips', (select n from completed),
    'cancellations', (select n from cancels),
    'total', (select n from completed) + (select n from cancels),
    'has_enough_history', ((select n from completed) + (select n from cancels)) >= 3,
    'cancellation_rate',
      case
        when ((select n from completed) + (select n from cancels)) >= 3
        then round(
          (select n from cancels)::numeric
          / nullif((select n from completed) + (select n from cancels), 0) * 100,
          0
        )
        else null
      end
  );
$$;
grant execute on function public.get_renter_reliability(uuid) to authenticated;

-- ============================================================================
-- CHAPTER 32 - Payout account number length guard
-- ============================================================================
-- The client already strips payout_account_number to digits only, but had no
-- upper bound (tester found a wallet field accepting an arbitrarily long
-- string). Bound it at the database too, matching the client's 16-digit cap,
-- so a bypassed/old client can never write past what the UI allows.

update public.profiles
set payout_account_number = left(regexp_replace(payout_account_number, '[^0-9]', '', 'g'), 16)
where payout_account_number is not null;

alter table public.profiles drop constraint if exists profiles_payout_account_number_check;
alter table public.profiles
  add constraint profiles_payout_account_number_check
  check (payout_account_number is null or payout_account_number ~ '^[0-9]{0,16}$');

-- ============================================================================
-- CHAPTER 33 - Registration/CTPL/comprehensive belong to renewal, not Edit Listing
-- ============================================================================
-- Tester feedback: the quick "Edit Listing" editor let a lister silently
-- retype registration/CTPL/comprehensive expiry with no supporting document,
-- and the annual renewal flow only ever collected the OR/CR + 4 physical
-- inspection documents - never a CTPL or comprehensive-insurance document,
-- and never the new dates themselves (an admin re-typed them blind from a
-- window.prompt() after eyeballing the OR/CR photo). This chapter moves
-- expiry editing entirely into the lister-submitted, admin-reviewed renewal
-- record: car_renewals now carries the three new expiry dates plus CTPL and
-- comprehensive document paths, so approval reads real submitted data
-- instead of a blind prompt. No new API handler - this is a direct,
-- RLS-scoped table write from ListerCarRenewalPage.tsx and
-- AdminVehicleRenewalsPage.tsx, same as the rest of car_renewals.

alter table public.car_renewals
  add column if not exists registration_expiry date,
  add column if not exists ctpl_expiry date,
  add column if not exists comprehensive_insurance_expiry date,
  add column if not exists ctpl_document_path text,
  add column if not exists comprehensive_document_path text;

-- ============================================================================
-- CHAPTER 34 - Remove the security deposit feature entirely
-- ============================================================================
-- The refundable security-deposit flow (separate deposit checkout, claim
-- review, auto-release, its own ledger liability account, and the payout gate
-- waiting on it) is removed end to end - tables, columns, constraints, the
-- dedicated ledger account, and every trigger/function that referenced them.
-- Diagnostic check first confirmed zero deposits/claims/deposit payments/
-- finalized deposit ledger journals exist, so this is a clean removal with no
-- historical data or finalized (append-only) ledger entries to reconcile.
-- Every process that read from these tables (arrival check-in gate, payout
-- automation, booking completion, the PayMongo webhook, refund receipts) has
-- already been updated in the same change to no longer depend on them, so
-- none of those flows are left half-wired.

drop table if exists public.security_deposit_claims;
drop table if exists public.security_deposits;

alter table public.cars
  drop column if exists security_deposit_amount;

alter table public.platform_settings
  drop column if exists deposit_claim_window_hours;

alter table public.payments
  drop constraint if exists payments_payment_type_check;
alter table public.payments
  add constraint payments_payment_type_check
  check (payment_type in ('downpayment', 'balance', 'extension', 'refund', 'payout'));

drop index if exists public.payments_one_completed_checkout_event;
create unique index if not exists payments_one_completed_checkout_event
on public.payments (booking_id, payment_type, transaction_id)
where status = 'completed'
  and payment_type in ('downpayment', 'balance', 'extension')
  and transaction_id is not null;

delete from public.financial_accounts where code = '2020';

-- Recreated without the security_deposit_amount comparison - the column no
-- longer exists, so leaving it in would break every future car update.
create or replace function public.return_materially_changed_car_to_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('approved', 'active', 'inactive') and (
    old.model_id is distinct from new.model_id or old.plate_number is distinct from new.plate_number or
    old.mileage is distinct from new.mileage or old.price_per_day is distinct from new.price_per_day or
    old.location is distinct from new.location or
    old.fuel_category is distinct from new.fuel_category or old.fuel_subtype is distinct from new.fuel_subtype or
    old.gps_available is distinct from new.gps_available or old.contact_number is distinct from new.contact_number or
    old.additional_info is distinct from new.additional_info or
    old.transmission is distinct from new.transmission or
    old.registration_expiry is distinct from new.registration_expiry or old.ctpl_expiry is distinct from new.ctpl_expiry or
    old.comprehensive_insurance_expiry is distinct from new.comprehensive_insurance_expiry or
    old.insurer_rental_use_confirmed is distinct from new.insurer_rental_use_confirmed
  ) then
    new.status := 'pending';
    new.last_verified_at := null;
    new.rejection_reason := null;
    new.insurance_verification_status := 'pending';
  end if;
  return new;
end;
$$;

-- Recreated without the deposit_claim_window_hours branch - the column no
-- longer exists, so a proposal referencing it should be rejected the same
-- way any other unknown setting key is.
create or replace function public.validate_platform_setting_change(p_changes jsonb)
returns void
language plpgsql
immutable
as $$
declare
  k text;
  v numeric;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'No settings to change';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if jsonb_typeof(p_changes -> k) <> 'number' then
      raise exception 'Setting % must be a number', k;
    end if;
    v := (p_changes ->> k)::numeric;
    if k = 'commission_rate' then
      if v < 0 or v > 1 then raise exception 'commission_rate must be 0-1'; end if;
    elsif k = 'payment_processing_fee_rate' then
      if v < 0 or v > 0.25 then raise exception 'payment_processing_fee_rate must be 0-0.25'; end if;
    elsif k = 'payment_processing_fixed_centavos' then
      if v < 0 or v > 100000 or v <> floor(v) then raise exception 'payment_processing_fixed_centavos must be a whole number 0-100000'; end if;
    elsif k = 'downpayment_rate' then
      if v < 0.2 or v > 1 then raise exception 'downpayment_rate must be 0.2-1.0'; end if;
    elsif k = 'refund_full_hours' then
      if v < 0 or v > 720 or v <> floor(v) then raise exception 'refund_full_hours must be a whole number 0-720'; end if;
    elsif k = 'refund_late_renter_percent' then
      if v < 0 or v > 100 then raise exception 'refund_late_renter_percent must be 0-100'; end if;
    elsif k = 'arrival_checkin_lead_hours' then
      if v < 0 or v > 48 or v <> floor(v) then raise exception 'arrival_checkin_lead_hours must be a whole number 0-48'; end if;
    elsif k = 'lister_completion_timeout_hours' then
      if v < 1 or v > 72 or v <> floor(v) then raise exception 'lister_completion_timeout_hours must be a whole number 1-72'; end if;
    else
      raise exception 'Setting % is not configurable', k;
    end if;
  end loop;
end;
$$;

-- End of SafeDrive chaptered database master.
