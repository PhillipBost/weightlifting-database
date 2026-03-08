-- Verification Script: Batch 3 Functions (Trigger Functions)
-- These functions are triggers and cannot be called directly
-- Instead, we verify they exist and have the correct search_path setting
SELECT p.proname as function_name,
    CASE
        WHEN p.proconfig IS NOT NULL
        AND array_to_string(p.proconfig, ',') LIKE '%search_path%' THEN 'PASS - search_path is FIXED'
        ELSE 'FAIL - search_path is MUTABLE'
    END as status,
    COALESCE(array_to_string(p.proconfig, ', '), 'No config') as config
FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND p.proname IN (
        'update_updated_at_column',
        'update_clubs_analytics_timestamp',
        'update_wso_analytics_updated_at',
        'handle_manual_override',
        'calculate_competition_age'
    )
ORDER BY p.proname;