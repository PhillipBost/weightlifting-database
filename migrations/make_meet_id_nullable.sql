-- Migration: Make meet_id nullable in usaw_meet_entries
-- This allows storing entries for scraping targets that don't match an existing usaw_meets record.
ALTER TABLE public.usaw_meet_entries
ALTER COLUMN meet_id DROP NOT NULL;