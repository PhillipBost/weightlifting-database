-- Show the actual code of the trigger function
SELECT pg_get_functiondef('update_qpoints_on_change'::regproc);

-- Also show any errors from the PostgreSQL log (if accessible)
-- Check if the function even exists
SELECT
    routine_name,
    routine_type,
    data_type
FROM information_schema.routines
WHERE routine_name = 'update_qpoints_on_change';

-- Check for the helper functions it might need
SELECT
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_name IN (
    'calculate_qpoints_from_row',
    'get_age_factor',
    'get_youth_age_factor_interpolated'
)
ORDER BY routine_name;
