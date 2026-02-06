-- Migration: Add event_date to usaw_meet_entries
-- Logic: Differentiating unmatched meets requires Name + Date.
ALTER TABLE public.usaw_meet_entries
ADD COLUMN IF NOT EXISTS event_date TEXT;