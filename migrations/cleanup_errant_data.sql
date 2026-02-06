-- Cleanup Migration: Remove errant lifters and reset entries table.
-- WARNING: This will delete ALL data from `usaw_meet_entries`.
-- It also deletes lifters created in the last 2 hours.
BEGIN;
-- 1. Truncate the entries table (it's new data, safe to reset).
TRUNCATE TABLE public.usaw_meet_entries RESTART IDENTITY CASCADE;
-- 2. Delete lifters logic REMOVED. 
-- Due to overlap with "USAW Daily Discovery Pipeline", we cannot safely delete based on time.
-- We will only clear the entries table to allow a fresh start for the scraper.
COMMIT;