-- Diagnostic Query: List all triggers on usaw_meet_results
-- Run this in the Supabase SQL Editor and share the results.
-- We are looking for any trigger that executes 'calculate_iwf_ytd_bests'

SELECT trigger_name, action_statement 
FROM information_schema.triggers 
WHERE event_object_table = 'usaw_meet_results'
ORDER BY trigger_name;
