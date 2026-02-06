-- Migration: Add meet_match_status column to usaw_meet_listings
-- Tracks if the listing was matched to a record in usaw_meets table
BEGIN;
ALTER TABLE public.usaw_meet_listings
ADD COLUMN IF NOT EXISTS meet_match_status TEXT;
-- Update existing records based on meet_id presence
UPDATE public.usaw_meet_listings
SET meet_match_status = CASE
        WHEN meet_id IS NOT NULL THEN 'matched'
        ELSE 'unmatched'
    END;
COMMIT;