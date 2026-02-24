-- =============================================
-- SAFEDRIVE: Complete Supabase Database Schema
-- Web-Based Car Rental Community Platform
-- =============================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. PROFILES TABLE (extends auth.users)
-- =============================================
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  date_of_birth DATE,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'rentee' CHECK (role IN ('admin', 'renter', 'rentee')),
  
  -- Verification status
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'submitted', 'verified', 'rejected')),
  
  -- Government ID info
  national_id_number TEXT,
  national_id_front_url TEXT,
  national_id_back_url TEXT,
  drivers_license_number TEXT,
  drivers_license_front_url TEXT,
  drivers_license_back_url TEXT,
  drivers_license_expiry DATE,
  
  -- Selfie verification
  selfie_url TEXT,
  selfie_verified BOOLEAN DEFAULT FALSE,
  
  -- Admin notes
  admin_notes TEXT,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  
  -- Reputation
  average_rating DECIMAL(3,2) DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 2. VEHICLES TABLE
-- =============================================
CREATE TABLE public.vehicles (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  
  -- Vehicle details
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year >= EXTRACT(YEAR FROM NOW()) - 5),
  color TEXT NOT NULL,
  plate_number TEXT UNIQUE NOT NULL,
  body_type TEXT NOT NULL CHECK (body_type IN ('Sedan', 'SUV', 'MPV', 'Van')),
  transmission TEXT NOT NULL CHECK (transmission IN ('Automatic', 'Manual')),
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('Gasoline', 'Diesel', 'Hybrid', 'Electric')),
  seating_capacity INTEGER NOT NULL CHECK (seating_capacity >= 2 AND seating_capacity <= 15),
  
  -- Rental info
  daily_rate DECIMAL(10,2) NOT NULL CHECK (daily_rate > 0),
  weekly_rate DECIMAL(10,2),
  monthly_rate DECIMAL(10,2),
  security_deposit DECIMAL(10,2) DEFAULT 0,
  
  -- Location
  pickup_location TEXT NOT NULL,
  pickup_city TEXT NOT NULL,
  pickup_province TEXT NOT NULL,
  
  -- Vehicle condition
  mileage INTEGER,
  description TEXT,
  features TEXT[], -- e.g., ['ABS', 'Airbags', 'GPS', 'Dashcam']
  
  -- Images
  images TEXT[] NOT NULL DEFAULT '{}',
  thumbnail_url TEXT,
  
  -- OR/CR info
  or_number TEXT,
  cr_number TEXT,
  registration_expiry DATE,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'listed', 'unlisted', 'rented', 'maintenance')),
  is_available BOOLEAN DEFAULT TRUE,
  
  -- Admin review
  admin_notes TEXT,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 3. BOOKINGS TABLE
-- =============================================
CREATE TABLE public.bookings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
  renter_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  
  -- Booking dates
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  pickup_time TIME,
  return_time TIME,
  
  -- Pricing
  daily_rate DECIMAL(10,2) NOT NULL,
  total_days INTEGER NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  service_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  security_deposit DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'active', 'completed', 'cancelled', 'disputed')),
  
  -- Selfie verification at pickup
  renter_selfie_at_pickup TEXT,
  selfie_verified_by_owner BOOLEAN DEFAULT FALSE,
  
  -- Vehicle condition
  pre_rental_notes TEXT,
  post_rental_notes TEXT,
  pre_rental_photos TEXT[],
  post_rental_photos TEXT[],
  
  -- Pickup/Return info
  pickup_location TEXT,
  return_location TEXT,
  
  -- Cancellation
  cancelled_by UUID REFERENCES auth.users(id),
  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_dates CHECK (end_date >= start_date)
);

-- =============================================
-- 4. RENTAL AGREEMENTS (Digital Contracts)
-- =============================================
CREATE TABLE public.rental_agreements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE UNIQUE NOT NULL,
  
  -- Parties
  owner_id UUID REFERENCES public.profiles(id) NOT NULL,
  renter_id UUID REFERENCES public.profiles(id) NOT NULL,
  
  -- Vehicle info snapshot
  vehicle_info JSONB NOT NULL,
  
  -- Agreement content
  terms_and_conditions TEXT NOT NULL,
  special_conditions TEXT,
  
  -- Rental details
  rental_period_start DATE NOT NULL,
  rental_period_end DATE NOT NULL,
  daily_rate DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  security_deposit DECIMAL(10,2),
  
  -- Signatures  
  owner_signed BOOLEAN DEFAULT FALSE,
  owner_signed_at TIMESTAMPTZ,
  owner_signature_ip TEXT,
  renter_signed BOOLEAN DEFAULT FALSE,
  renter_signed_at TIMESTAMPTZ,
  renter_signature_ip TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_signatures', 'active', 'completed', 'cancelled', 'violated')),
  
  -- Agreement PDF
  agreement_pdf_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 5. REVIEWS TABLE
-- =============================================
CREATE TABLE public.reviews (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE NOT NULL,
  reviewer_id UUID REFERENCES public.profiles(id) NOT NULL,
  reviewee_id UUID REFERENCES public.profiles(id) NOT NULL,
  vehicle_id UUID REFERENCES public.vehicles(id),
  
  -- Review content
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT,
  comment TEXT,
  
  -- Review type
  review_type TEXT NOT NULL CHECK (review_type IN ('renter_to_owner', 'owner_to_renter', 'renter_to_vehicle')),
  
  -- Response
  response TEXT,
  response_at TIMESTAMPTZ,
  
  -- Moderation
  is_flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_review UNIQUE (booking_id, reviewer_id, review_type)
);

-- =============================================
-- 6. NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE public.notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('booking', 'verification', 'review', 'system', 'agreement', 'payment')),
  
  -- Reference
  reference_id UUID,
  reference_type TEXT,
  
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 7. ADMIN VERIFICATION LOG
-- =============================================
CREATE TABLE public.verification_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  admin_id UUID REFERENCES public.profiles(id) NOT NULL,
  
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'request_resubmit')),
  notes TEXT,
  
  -- What was verified
  verification_type TEXT NOT NULL CHECK (verification_type IN ('identity', 'vehicle', 'document')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 8. FAVORITES / WISHLISTS
-- =============================================
CREATE TABLE public.favorites (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_favorite UNIQUE (user_id, vehicle_id)
);

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Vehicles policies
CREATE POLICY "Approved vehicles are viewable by everyone" ON public.vehicles
  FOR SELECT USING (status IN ('approved', 'listed', 'rented') OR owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Owners can insert vehicles" ON public.vehicles
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can update own vehicles" ON public.vehicles
  FOR UPDATE USING (owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Bookings policies
CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT USING (renter_id = auth.uid() OR owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Renters can create bookings" ON public.bookings
  FOR INSERT WITH CHECK (renter_id = auth.uid());

CREATE POLICY "Parties can update bookings" ON public.bookings
  FOR UPDATE USING (renter_id = auth.uid() OR owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Rental agreements policies
CREATE POLICY "Parties can view agreements" ON public.rental_agreements
  FOR SELECT USING (owner_id = auth.uid() OR renter_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "System can create agreements" ON public.rental_agreements
  FOR INSERT WITH CHECK (owner_id = auth.uid() OR renter_id = auth.uid());

CREATE POLICY "Parties can update agreements" ON public.rental_agreements
  FOR UPDATE USING (owner_id = auth.uid() OR renter_id = auth.uid());

-- Reviews policies
CREATE POLICY "Reviews are viewable by everyone" ON public.reviews
  FOR SELECT USING (true);

CREATE POLICY "Users can create reviews" ON public.reviews
  FOR INSERT WITH CHECK (reviewer_id = auth.uid());

CREATE POLICY "Users can update own reviews" ON public.reviews
  FOR UPDATE USING (reviewer_id = auth.uid());

-- Notifications policies
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

-- Verification logs policies
CREATE POLICY "Admins can manage verification logs" ON public.verification_logs
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can view own verification logs" ON public.verification_logs
  FOR SELECT USING (user_id = auth.uid());

-- Favorites policies
CREATE POLICY "Users can manage own favorites" ON public.favorites
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Favorites viewable by user" ON public.favorites
  FOR SELECT USING (user_id = auth.uid());

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_vehicles_updated_at BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_bookings_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_agreements_updated_at BEFORE UPDATE ON public.rental_agreements
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_reviews_updated_at BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'renter')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update average rating after review
CREATE OR REPLACE FUNCTION public.update_user_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET 
    average_rating = (
      SELECT COALESCE(AVG(rating), 0)
      FROM public.reviews
      WHERE reviewee_id = NEW.reviewee_id
    ),
    total_reviews = (
      SELECT COUNT(*)
      FROM public.reviews
      WHERE reviewee_id = NEW.reviewee_id
    )
  WHERE id = NEW.reviewee_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_rating_after_review
  AFTER INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_user_rating();

-- =============================================
-- STORAGE BUCKETS (create via Supabase Dashboard)
-- =============================================
-- Create these buckets in your Supabase dashboard:
-- 1. avatars - User profile photos
-- 2. vehicle-images - Vehicle listing photos
-- 3. documents - Government IDs, licenses, etc.
-- 4. selfies - Selfie verification photos
-- 5. agreements - Generated rental agreement PDFs
