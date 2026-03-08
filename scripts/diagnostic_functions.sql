SELECT n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    CASE
        WHEN p.proconfig IS NULL THEN 'Global Default'
        ELSE array_to_string(p.proconfig, ', ')
    END as search_path_config
FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND (
        p.proname LIKE 'gamx_%'
        OR p.proname LIKE 'calculate_iwf_%'
        OR p.proname IN (
            'update_updated_at_column',
            'calculate_competition_age'
        )
    )
ORDER BY schema_name,
    function_name;