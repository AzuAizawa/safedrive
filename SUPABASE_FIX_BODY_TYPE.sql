-- FIX: Expand allowed body_type values in the vehicles table

-- 1. Drop the existing restrictive constraint
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_body_type_check;

-- 2. Add the correct constraint that matches the UI options and the car_models table
ALTER TABLE public.vehicles 
  ADD CONSTRAINT vehicles_body_type_check 
  CHECK (body_type IN ('Sedan', 'SUV', 'MPV', 'Van', 'Hatchback', 'Pickup', 'Crossover', 'Coupe'));
