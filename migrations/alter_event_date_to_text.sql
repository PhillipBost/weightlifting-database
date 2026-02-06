-- Migration: Change event_date from DATE to TEXT to support date ranges
-- Run this before migrate_to_listings.sql
BEGIN;
-- Drop the unique constraint that includes event_date
ALTER TABLE public.usaw_meet_listings DROP CONSTRAINT IF EXISTS usaw_meet_listings_unique_name_date;
-- Change column type from DATE to TEXT
ALTER TABLE public.usaw_meet_listings
ALTER COLUMN event_date TYPE TEXT;
-- Recreate the unique constraint
ALTER TABLE public.usaw_meet_listings
ADD CONSTRAINT usaw_meet_listings_unique_name_date UNIQUE(meet_name, event_date);
COMMIT;