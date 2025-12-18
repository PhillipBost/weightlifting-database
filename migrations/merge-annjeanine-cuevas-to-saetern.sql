-- Migration: Merge Annjeanine Cuevas records into Annjeanine Saetern
-- Date: 2025-12-17
-- Reason: Athlete name change (marriage) - merge duplicate athlete records
-- 
-- Background:
-- - lifter_id 11822: "Annjeanine Cuevas" (18 meet results, 2015-2023, no internal_id)
-- - lifter_id 64401: "Annjeanine Saetern" (1 meet result, 2025, internal_id: 31215)
-- - Sport80 URL confirms internal_id 31215 belongs to Annjeanine Saetern
-- - All Cuevas results should be reassigned to Saetern and name updated retroactively
--
-- This migration will:
-- 1. Update all meet_results from lifter_id 11822 to lifter_id 64401
-- 2. Update lifter_name from "Annjeanine Cuevas" to "Annjeanine Saetern" in all results
-- 3. Delete the orphaned lifter record (lifter_id 11822)

BEGIN;

-- Step 1: Update all meet_results to point to the correct athlete (Saetern)
UPDATE usaw_meet_results
SET 
    lifter_id = 64401,
    lifter_name = 'Annjeanine Saetern',
    updated_at = NOW()
WHERE lifter_id = 11822;

-- Step 2: Delete the orphaned Cuevas lifter record
DELETE FROM usaw_lifters
WHERE lifter_id = 11822;

-- Verification queries (run these after migration to confirm success)
-- 
-- Check that no Cuevas records remain in lifters:
-- SELECT * FROM usaw_lifters WHERE athlete_name ILIKE '%Annjeanine%Cuevas%';
--
-- Check that all results now belong to Saetern (should show 19 results):
-- SELECT COUNT(*) as total_results, MIN(date) as earliest, MAX(date) as latest
-- FROM usaw_meet_results 
-- WHERE lifter_id = 64401;
--
-- Check that all results have the updated name:
-- SELECT DISTINCT lifter_name 
-- FROM usaw_meet_results 
-- WHERE lifter_id = 64401;
--
-- Check the athlete record:
-- SELECT lifter_id, athlete_name, internal_id, birth_year 
-- FROM usaw_lifters 
-- WHERE lifter_id = 64401;

COMMIT;
