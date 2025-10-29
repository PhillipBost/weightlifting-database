-- Verification queries for IWF YTD trigger

-- 1. Check if trigger exists
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers 
WHERE event_object_table = 'iwf_meet_results'
AND trigger_name = 'iwf_meet_results_ytd_calculation_trigger';

-- 2. Check if function exists
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'calculate_iwf_ytd_bests';

-- 3. Sample data check - look for lifters with multiple results in 2025
SELECT 
    db_lifter_id,
    lifter_name,
    date,
    best_snatch,
    best_cj,
    total,
    best_snatch_ytd,
    best_cj_ytd,
    best_total_ytd
FROM iwf_meet_results
WHERE EXTRACT(YEAR FROM date::DATE) = 2025
  AND db_lifter_id IN (
      SELECT db_lifter_id 
      FROM iwf_meet_results 
      WHERE EXTRACT(YEAR FROM date::DATE) = 2025
      GROUP BY db_lifter_id 
      HAVING COUNT(*) > 1
  )
ORDER BY db_lifter_id, date
LIMIT 50;

-- 4. Test trigger manually on a single record
-- Find a record to update
SELECT result_id, db_lifter_id, date, best_snatch_ytd, best_cj_ytd, best_total_ytd
FROM iwf_meet_results
WHERE date >= '2025-01-01'
LIMIT 1;

-- After getting result_id from above, run this to force trigger:
-- UPDATE iwf_meet_results 
-- SET updated_at = NOW() 
-- WHERE result_id = <REPLACE_WITH_RESULT_ID>;

-- Then check if YTD was calculated:
-- SELECT result_id, best_snatch_ytd, best_cj_ytd, best_total_ytd
-- FROM iwf_meet_results
-- WHERE result_id = <REPLACE_WITH_RESULT_ID>;
