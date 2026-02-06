-- Rename athlete_id to lifter_id to match convention
ALTER TABLE public.usaw_meet_entries
    RENAME COLUMN athlete_id TO lifter_id;
-- Add new columns for better context and data granularity
ALTER TABLE public.usaw_meet_entries
ADD COLUMN IF NOT EXISTS meet_name TEXT;
ALTER TABLE public.usaw_meet_entries
ADD COLUMN IF NOT EXISTS pronouns TEXT;
ALTER TABLE public.usaw_meet_entries
ADD COLUMN IF NOT EXISTS entry_status TEXT;
-- Add tracking columns to usaw_meets
ALTER TABLE public.usaw_meets
ADD COLUMN IF NOT EXISTS has_entry_list BOOLEAN DEFAULT FALSE;
ALTER TABLE public.usaw_meets
ADD COLUMN IF NOT EXISTS entry_list_last_scraped_at TIMESTAMP WITH TIME ZONE;