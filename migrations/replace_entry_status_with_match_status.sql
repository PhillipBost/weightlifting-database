-- Migration: Replace entry_status with match_status
-- User finds entry_status not useful; match_status adds value tracking resolution type.
ALTER TABLE public.usaw_meet_entries DROP COLUMN IF EXISTS entry_status;
ALTER TABLE public.usaw_meet_entries
ADD COLUMN IF NOT EXISTS match_status TEXT;
-- Possible values handled in code: 'matched', 'created', 'unmatched'