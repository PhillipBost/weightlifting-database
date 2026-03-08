-- Diagnose calculate_ytd_best Failure
-- We need to check if 'meet_results' actually exists and if the search_path is set correctly.
-- 1. Check if 'meet_results' exists and what schema it's in.
SELECT schemaname,
    tablename
FROM pg_tables
WHERE tablename LIKE '%meet_results%';
-- 2. Check the config of calculate_ytd_best
SELECT p.proname,
    p.proconfig as current_config -- Should show if search_path is set
FROM pg_proc p
WHERE p.proname = 'calculate_ytd_best';
-- 3. Check current search_path
SHOW search_path;