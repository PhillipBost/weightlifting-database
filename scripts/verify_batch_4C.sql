-- Verify Batch 4C
-- Test pure math functions to ensure no regression after setting search_path = ''.
-- 1. calculate_qpoints_from_row(total, bodyweight, gender)
-- Male, 100kg bw, 300kg total -> approx 328.something
SELECT 'calculate_qpoints_from_row' as test,
    public.calculate_qpoints_from_row(300, 100, 'M') as result;
-- 2. get_age_factor(age, gender)
-- Age 30 M -> 1.000
-- Age 40 M -> 1.112
SELECT 'get_age_factor(30, M)' as test,
    public.get_age_factor(30, 'M') as result
UNION ALL
SELECT 'get_age_factor(40, M)',
    public.get_age_factor(40, 'M');
-- 3. calculate_ytd_best
-- Complex to test without known data, but we can check if it throws a "relation not found" error
-- by passing a non-existent ID. It should return 0 or passed current_best, not error.
SELECT 'calculate_ytd_best (No Error Check)' as test,
    public.calculate_ytd_best(-1, '2023-01-01', 'total', 100) as result;