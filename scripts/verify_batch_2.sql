-- Verification Script: Batch 2 Functions (Read-Only)
-- Expected: 4 rows with status 'PASS' (some may be SKIP if data missing)
-- 1. get_age_factor (Logic check, no table dependency)
SELECT 'get_age_factor' as function_name,
    CASE
        WHEN public.get_age_factor(35, 'M') > 1.0 THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    'Age 35 Male > 1.0' as test_case
UNION ALL
-- 2. get_youth_factor_exact (Table lookup: public.youth_factors)
SELECT 'get_youth_factor_exact',
    CASE
        -- We just check if it runs without error. Result might be 1.000 if data missing, which is fine for structure check.
        WHEN public.get_youth_factor_exact(15, 60, 'M') IS NOT NULL THEN 'PASS'
        ELSE 'FAIL'
    END,
    'Returns non-null value (15yo, 60kg, M)'
UNION ALL
-- 3. is_admin (Table lookup: public.profiles)
SELECT 'is_admin',
    CASE
        -- Pass a random UUID. Should return FALSE (or TRUE if lucky), but NOT error.
        WHEN public.is_admin('00000000-0000-0000-0000-000000000000'::uuid) IS NOT NULL THEN 'PASS'
        ELSE 'FAIL'
    END,
    'Returns boolean for dummy UUID'
UNION ALL
-- 4. search_athletes (Complex query: public.lifters, public.meet_results, extensions.similarity)
SELECT 'search_athletes',
    CASE
        -- Search for 'Smith' (common). Even if 0 rows, it should not error.
        -- We interpret "execution without error" as success here.
        WHEN (
            SELECT count(*)
            FROM public.search_athletes('Smith')
        ) >= 0 THEN 'PASS'
        ELSE 'FAIL'
    END,
    'Executes search without error';