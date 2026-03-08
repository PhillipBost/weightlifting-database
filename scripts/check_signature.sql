-- Check Function Arguments (Batch 4C)
-- Getting exact signatures for all batch 4C functions to avoid guessing.
SELECT p.proname,
    pg_get_function_identity_arguments(p.oid) as arguments
FROM pg_proc p
WHERE p.proname IN (
        'calculate_ytd_best',
        'get_youth_factor_exact',
        'get_age_factor',
        'calculate_qpoints_from_row'
    )
ORDER BY p.proname;