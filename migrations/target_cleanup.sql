-- Targeted Cleanup Migration
-- 1. Identify lifters that are LINKED to the current 'usaw_meet_entries' rows (which were just created by the bad script).
-- 2. Delete those lifters ONLY IF they were created in the last 1 hour.
-- 3. Truncate the entries table.
BEGIN;
CREATE TEMP TABLE lifters_to_delete AS
SELECT DISTINCT e.lifter_id
FROM public.usaw_meet_entries e
    JOIN public.usaw_lifters l ON e.lifter_id = l.lifter_id
WHERE l.created_at > NOW() - INTERVAL '1 hour';
-- Delete the specific lifters identified above
DELETE FROM public.usaw_lifters
WHERE lifter_id IN (
        SELECT lifter_id
        FROM lifters_to_delete
    );
-- Truncate the entries table to reset for the corrected scraper
TRUNCATE TABLE public.usaw_meet_entries RESTART IDENTITY CASCADE;
COMMIT;