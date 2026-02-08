-- Migration: Add start_date and end_date columns to usaw_meet_listings
-- Purpose: Enable sorting and filtering by date
-- Run this migration directly in Supabase SQL editor or via migration script
BEGIN;
-- Add new columns
ALTER TABLE public.usaw_meet_listings
ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS end_date DATE;
-- Create index for sorting
CREATE INDEX IF NOT EXISTS idx_meet_listings_start_date ON public.usaw_meet_listings(start_date);
CREATE INDEX IF NOT EXISTS idx_meet_listings_end_date ON public.usaw_meet_listings(end_date);
COMMIT;