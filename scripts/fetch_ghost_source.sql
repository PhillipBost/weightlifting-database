-- Fetch Source for Complex IWF and GAMX Functions
-- We need to check if these functions use schema-unqualified references (e.g., calling other functions or tables without public.)
SELECT p.proname as function_name,
    p.prosrc as source_code
FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND (
        p.proname IN (
            'calculate_iwf_analytics',
            'calculate_iwf_competition_age',
            'calculate_iwf_duration',
            'calculate_iwf_ytd_bests'
        )
        OR p.proname LIKE 'gamx_%'
    )
ORDER BY p.proname;