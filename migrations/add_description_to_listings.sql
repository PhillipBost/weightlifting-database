-- Migration: Add meet_description column to usaw_meet_listings
-- Captures unstructured text from the "Info" section of the meet details
BEGIN;
ALTER TABLE public.usaw_meet_listings
ADD COLUMN IF NOT EXISTS meet_description TEXT;
COMMIT;