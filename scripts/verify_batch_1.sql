-- Verification Script: Batch 1 Functions
-- Run this script to confirm that the recently migrated functions work correctly.
BEGIN;
-- Verification Script: Batch 1 Functions (Single Result Set)
-- Expected: 3 rows with status 'PASS'
SELECT 'text_to_numeric_safe' as function_name,
    CASE
        WHEN public.text_to_numeric_safe('123.45') = 123.45
        AND public.text_to_numeric_safe('invalid') IS NULL THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    'Valid: 123.45 -> 123.45, Invalid -> NULL' as test_case
UNION ALL
SELECT 'count_successful_attempts',
    CASE
        WHEN public.count_successful_attempts('100', '-105', '110') = 2 THEN 'PASS'
        ELSE 'FAIL'
    END,
    'Inputs: 100, -105, 110. Expected: 2'
UNION ALL
SELECT 'calculate_bounce_back',
    CASE
        WHEN public.calculate_bounce_back('-100', '100') = TRUE
        AND public.calculate_bounce_back('100', '-105') = FALSE THEN 'PASS'
        ELSE 'FAIL'
    END,
    'Bounce Back: -100 -> 100 (True), 100 -> -105 (False)';