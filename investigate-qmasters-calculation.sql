-- ============================================================================
-- SQL to Investigate Q-Masters Calculation
-- ============================================================================
-- Purpose: Understand how q_masters is calculated and if it differs from qpoints
-- Date: 2025-12-14
-- ============================================================================

-- ============================================================================
-- QUERY 1: Get the trigger function definition
-- ============================================================================
-- This shows the actual SQL code used to calculate q-scores

SELECT 
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname LIKE '%qpoints%' OR p.proname LIKE '%q_masters%'
ORDER BY p.proname;

-- ============================================================================
-- QUERY 2: Check for masters_factors table
-- ============================================================================
-- Similar to youth_factors, there might be a masters_factors table

SELECT 
    tablename,
    schemaname
FROM pg_tables
WHERE tablename LIKE '%masters%' OR tablename LIKE '%factor%'
ORDER BY tablename;

-- ============================================================================
-- QUERY 3: Show columns in potential masters factor tables
-- ============================================================================
-- If tables exist, show their structure

SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name IN ('masters_factors', 'age_factors', 'youth_factors')
ORDER BY table_name, ordinal_position;

-- ============================================================================
-- QUERY 4: Sample q_masters values with athlete details
-- ============================================================================
-- Show actual q_masters calculations to see the pattern

SELECT 
    competition_age,
    gender,
    body_weight_kg,
    total,
    qpoints,
    q_youth,
    q_masters,
    CASE 
        WHEN qpoints IS NOT NULL THEN ROUND((q_masters::numeric / qpoints::numeric), 4)
        ELSE NULL
    END as masters_to_qpoints_ratio,
    lifter_name,
    date
FROM usaw_meet_results
WHERE 
    q_masters IS NOT NULL
    AND competition_age >= 31
    AND total IS NOT NULL
    AND body_weight_kg IS NOT NULL
ORDER BY competition_age, gender, body_weight_kg::numeric
LIMIT 50;

-- ============================================================================
-- QUERY 5: Compare same athlete at different ages
-- ============================================================================
-- Find athletes with both qpoints and q_masters to see the relationship

SELECT 
    lifter_id,
    lifter_name,
    COUNT(DISTINCT competition_age) as age_count,
    MIN(competition_age) as min_age,
    MAX(competition_age) as max_age,
    COUNT(CASE WHEN qpoints IS NOT NULL THEN 1 END) as qpoints_count,
    COUNT(CASE WHEN q_masters IS NOT NULL THEN 1 END) as q_masters_count
FROM usaw_meet_results
WHERE 
    total IS NOT NULL
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL)
GROUP BY lifter_id, lifter_name
HAVING 
    COUNT(CASE WHEN qpoints IS NOT NULL THEN 1 END) > 0
    AND COUNT(CASE WHEN q_masters IS NOT NULL THEN 1 END) > 0
ORDER BY age_count DESC
LIMIT 20;

-- ============================================================================
-- QUERY 6: Detailed view of an athlete with both qpoints and q_masters
-- ============================================================================
-- Pick one athlete from QUERY 5 and examine their progression
-- Replace the lifter_id below with an actual ID from QUERY 5 results

-- SELECT 
--     result_id,
--     date,
--     competition_age,
--     gender,
--     body_weight_kg,
--     total,
--     qpoints,
--     q_masters,
--     meet_name
-- FROM usaw_meet_results
-- WHERE lifter_id = <REPLACE_WITH_LIFTER_ID>
-- ORDER BY date;

-- ============================================================================
-- QUERY 7: Check if q_masters uses age-based multipliers
-- ============================================================================
-- Group by age to see if there's a pattern in the ratio

SELECT 
    competition_age,
    gender,
    COUNT(*) as sample_size,
    AVG(CASE 
        WHEN qpoints IS NOT NULL AND qpoints > 0 
        THEN q_masters::numeric / qpoints::numeric 
        ELSE NULL 
    END) as avg_ratio_to_qpoints,
    MIN(q_masters) as min_q_masters,
    MAX(q_masters) as max_q_masters
FROM usaw_meet_results
WHERE 
    q_masters IS NOT NULL
    AND competition_age >= 31
    AND total IS NOT NULL
GROUP BY competition_age, gender
ORDER BY competition_age, gender;

-- ============================================================================
-- QUERY 8: Get the get_age_factor function definition
-- ============================================================================
-- This shows how masters age factors are calculated

SELECT 
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname LIKE '%age_factor%'
ORDER BY p.proname;

-- ============================================================================
-- QUERY 9: Check for age factor tables
-- ============================================================================

SELECT 
    tablename,
    schemaname
FROM pg_tables
WHERE tablename LIKE '%age%' AND tablename LIKE '%factor%'
ORDER BY tablename;

-- ============================================================================
-- QUERY 10: Show all available tables (to find factor tables)
-- ============================================================================

SELECT 
    schemaname,
    tablename
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY tablename;

-- ============================================================================
-- USAGE INSTRUCTIONS
-- ============================================================================
-- 1. Run QUERY 1 to see the trigger function code
-- 2. Run QUERY 2 and 3 to check for masters factor tables
-- 3. Run QUERY 4 to see sample q_masters values
-- 4. Run QUERY 7 to check if there's an age-based multiplier pattern
-- 5. Run QUERY 8 to see all available tables
--
-- This will reveal whether q_masters uses:
--   - Same formula as qpoints (Huebner)
--   - Age-based multipliers (like youth_factors)
--   - A completely different calculation method
-- ============================================================================
