-- Direct table access test
-- This will tell us if the issue is permissions or search_path
-- Test 1: Can we access the table directly?
SELECT 'Direct access to public.lifters' as test,
    count(*) as result
FROM public.lifters
UNION ALL
-- Test 2: Can we access with empty search_path from session?
SELECT 'Access with search_path cleared' as test,
    (
        SELECT count(*)
        FROM (
                SELECT set_config('search_path', '', false);
SELECT count(*)
FROM public.lifters
) AS subq
) as result;