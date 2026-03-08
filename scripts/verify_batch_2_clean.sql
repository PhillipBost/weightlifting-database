-- Clean Verification for Batch 2 Functions
-- No transactions, no DO blocks, just direct function calls
-- Expected: 4 rows with status 'PASS'
SELECT 'get_age_factor' as function_name,
    CASE
        WHEN public.get_age_factor(35, 'M') = 1.052 THEN 'PASS'
        ELSE 'FAIL: Expected 1.052, got ' || public.get_age_factor(35, 'M')::text
    END as status,
    'Age 35 Male should return 1.052' as test_case
UNION ALL
SELECT 'get_youth_factor_exact',
    CASE
        WHEN public.get_youth_factor_exact(15, 60, 'M') IS NOT NULL THEN 'PASS'
        ELSE 'FAIL: Returned NULL'
    END,
    'Should access public.youth_factors table'
UNION ALL
SELECT 'is_admin',
    CASE
        WHEN public.is_admin('00000000-0000-0000-0000-000000000000'::uuid) IS NOT NULL THEN 'PASS'
        ELSE 'FAIL: Returned NULL'
    END,
    'Should access public.profiles table'
UNION ALL
SELECT 'search_athletes',
    CASE
        WHEN (
            SELECT count(*)
            FROM public.search_athletes('Smith')
        ) > 0 THEN 'PASS'
        ELSE 'FAIL: Returned 0 results'
    END,
    'Should access public.lifters and public.meet_results';