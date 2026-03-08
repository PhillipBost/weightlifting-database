-- Fetch Source for Existing Functions (Batch 4C)
-- We need to check these for unqualified table references before securing.
SELECT p.proname as function_name,
    p.prosrc as source_code
FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND p.proname IN (
        'calculate_qpoints_from_row',
        'get_age_factor',
        'get_youth_factor_exact',
        'calculate_ytd_best'
    )
ORDER BY p.proname;