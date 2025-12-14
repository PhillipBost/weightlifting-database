-- Recalculate q-masters for all 2025 records where competition_age >= 31
-- This will fire the trigger and recalculate qpoints, qmasters, qyouth based on correct competition_age

UPDATE usaw_meet_results
SET updated_at = NOW()
WHERE competition_age >= 31
  AND total IS NOT NULL
  AND body_weight_kg IS NOT NULL
  AND EXTRACT(YEAR FROM date::date) = 2025;

-- Check how many records will be affected:
-- SELECT COUNT(*) 
-- FROM usaw_meet_results
-- WHERE competition_age >= 31
--   AND total IS NOT NULL
--   AND body_weight_kg IS NOT NULL
--   AND EXTRACT(YEAR FROM date::date) = 2025;
