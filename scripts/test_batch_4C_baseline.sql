-- Baseline Test: Batch 4C
-- Signatures Verified:
-- calculate_qpoints_from_row(numeric, numeric, text)
-- get_age_factor(integer, text)
-- get_youth_factor_exact(integer, integer, text)
-- calculate_ytd_best(bigint, text, text, text)
-- Explicitly set search_path to public for this session to prove 'meet_results' is missing/broken.
SET search_path = public;
-- 1. calculate_qpoints_from_row
SELECT 'calculate_qpoints_from_row' as test_case,
    public.calculate_qpoints_from_row(300::numeric, 100::numeric, 'M'::text) as result;
-- 2. get_age_factor
SELECT 'get_age_factor(30, M)' as test_case,
    public.get_age_factor(30::integer, 'M'::text) as result
UNION ALL
SELECT 'get_age_factor(40, M)',
    public.get_age_factor(40::integer, 'M'::text);
-- 3. calculate_ytd_best (Expected to FAIL in baseline due to missing table)
SELECT 'calculate_ytd_best' as test_case,
    public.calculate_ytd_best(
        -1::bigint,
        -- p_lifter_id
        '2023-01-01'::text,
        -- p_date
        '100'::text,
        -- p_current_best
        'total'::text -- p_lift_type
    ) as result;
-- 4. get_youth_factor_exact
SELECT 'get_youth_factor_exact (Default Check)' as test_case,
    public.get_youth_factor_exact(15::integer, 60::integer, 'M'::text) as result;