-- Cleanup invalid Q-points (outside age 21-30)
-- This fixes the data corruption from the previous backfill

UPDATE meet_results
SET qpoints = NULL
WHERE qpoints IS NOT NULL 
  AND (competition_age < 21 OR competition_age > 30 OR competition_age IS NULL);

-- Note: We do NOT need to backfill q_youth or q_masters separately because
-- the trigger fix + a new backfill pass will handle them.
-- The previous backfill might have missed them if qpoints was NULL (due to optimization),
-- but the new trigger logic handles all cases.
