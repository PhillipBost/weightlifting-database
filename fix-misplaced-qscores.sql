-- ============================================================================
-- SQL to Fix Misplaced Q-Scores
-- ============================================================================
-- Purpose: Re-trigger q-score calculation for records with scores in wrong columns
-- Date: 2025-12-14
--
-- Problem: Some records have q-scores in inappropriate columns:
--   - Youth (10-20) with qpoints or q_masters instead of q_youth
--   - Seniors (21-30) with q_youth or q_masters instead of qpoints
--   - Masters (31+) with qpoints or q_youth instead of q_masters
--
-- Solution: Update these records to trigger recalculation with correct logic
-- ============================================================================

-- ============================================================================
-- QUERY 1: Find USAW records with misplaced q-scores
-- ============================================================================

SELECT 
    result_id,
    lifter_name,
    date,
    age_category,
    competition_age,
    gender,
    body_weight_kg,
    total,
    qpoints,
    q_youth,
    q_masters,
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL) 
            THEN 'Youth has qpoints/q_masters - should only have q_youth'
        WHEN competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL) 
            THEN 'Senior has q_youth/q_masters - should only have qpoints'
        WHEN gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL) 
            THEN 'Master (M) has qpoints/q_youth - should only have q_masters'
        WHEN gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL) 
            THEN 'Master (F) has qpoints/q_youth - should only have q_masters'
        ELSE 'Other issue'
    END as issue_description,
    meet_id,
    meet_name
FROM usaw_meet_results
WHERE 
    competition_age IS NOT NULL
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (
        -- Youth (10-20) should only have q_youth
        (competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL))
        OR
        -- Senior (21-30) should only have qpoints
        (competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL))
        OR
        -- Master men (31-75) should only have q_masters
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
        OR
        -- Master women (31-109) should only have q_masters
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
    )
ORDER BY date DESC, competition_age, lifter_name
LIMIT 200;

-- ============================================================================
-- QUERY 2: Count misplaced q-scores by age group (USAW)
-- ============================================================================

SELECT 
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 THEN 'Youth (10-20)'
        WHEN competition_age >= 21 AND competition_age <= 30 THEN 'Senior (21-30)'
        WHEN competition_age >= 31 AND competition_age <= 40 THEN 'Masters 31-40'
        WHEN competition_age >= 41 AND competition_age <= 50 THEN 'Masters 41-50'
        WHEN competition_age >= 51 THEN 'Masters 51+'
        ELSE 'Other'
    END as age_group,
    COUNT(*) as misplaced_count,
    COUNT(DISTINCT meet_id) as affected_meets,
    MIN(date) as earliest_date,
    MAX(date) as latest_date
FROM usaw_meet_results
WHERE 
    competition_age IS NOT NULL
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
        OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
    )
GROUP BY age_group
ORDER BY age_group;

-- ============================================================================
-- QUERY 3: Total count of misplaced q-scores (USAW)
-- ============================================================================

SELECT 
    COUNT(*) as total_misplaced_qscores,
    COUNT(DISTINCT lifter_id) as affected_athletes,
    COUNT(DISTINCT meet_id) as affected_meets
FROM usaw_meet_results
WHERE 
    competition_age IS NOT NULL
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
        OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
    );

-- ============================================================================
-- UPDATE 1: Fix misplaced q-scores (USAW)
-- ============================================================================
-- This NULLs incorrect q-score columns and forces recalculation by updating total
-- The trigger should recalculate and place the score in the correct column
-- IMPORTANT: Review the count from QUERY 3 before running this update!
-- ============================================================================

-- Step 1: Fix Youth (10-20) - NULL qpoints and q_masters, force recalc
UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_masters = NULL,
    q_youth = NULL,  -- Also NULL q_youth to force fresh calculation
    total = total,   -- Force trigger to recalculate
    updated_at = NOW()
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- Step 2: Fix Seniors (21-30) - NULL q_youth and q_masters, force recalc
UPDATE usaw_meet_results
SET 
    q_youth = NULL,
    q_masters = NULL,
    qpoints = NULL,  -- Also NULL qpoints to force fresh calculation
    total = total,   -- Force trigger to recalculate
    updated_at = NOW()
WHERE 
    competition_age >= 21 
    AND competition_age <= 30
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (q_youth IS NOT NULL OR q_masters IS NOT NULL);

-- Step 3: Fix Masters Men (31-75) - NULL qpoints and q_youth, force recalc
UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,  -- Also NULL q_masters to force fresh calculation
    total = total,     -- Force trigger to recalculate
    updated_at = NOW()
WHERE 
    gender = 'M'
    AND competition_age >= 31 
    AND competition_age <= 75
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

-- Step 4: Fix Masters Women (31-109) - NULL qpoints and q_youth, force recalc
UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,  -- Also NULL q_masters to force fresh calculation
    total = total,     -- Force trigger to recalculate
    updated_at = NOW()
WHERE 
    gender = 'F'
    AND competition_age >= 31 
    AND competition_age <= 109
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

-- ============================================================================
-- IWF DATABASE QUERIES
-- ============================================================================

-- ============================================================================
-- QUERY 4: Find IWF records with misplaced q-scores
-- ============================================================================

SELECT 
    db_result_id,
    lifter_name,
    date,
    age_category,
    competition_age,
    gender,
    body_weight_kg,
    total,
    qpoints,
    q_youth,
    q_masters,
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL) 
            THEN 'Youth has qpoints/q_masters - should only have q_youth'
        WHEN competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL) 
            THEN 'Senior has q_youth/q_masters - should only have qpoints'
        WHEN gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL) 
            THEN 'Master (M) has qpoints/q_youth - should only have q_masters'
        WHEN gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL) 
            THEN 'Master (F) has qpoints/q_youth - should only have q_masters'
        ELSE 'Other issue'
    END as issue_description,
    db_meet_id,
    meet_name
FROM iwf_meet_results
WHERE 
    competition_age IS NOT NULL
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
        OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
    )
ORDER BY date DESC, competition_age, lifter_name
LIMIT 200;

-- ============================================================================
-- QUERY 5: Count misplaced q-scores by age group (IWF)
-- ============================================================================

SELECT 
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 THEN 'Youth (10-20)'
        WHEN competition_age >= 21 AND competition_age <= 30 THEN 'Senior (21-30)'
        WHEN competition_age >= 31 AND competition_age <= 40 THEN 'Masters 31-40'
        WHEN competition_age >= 41 AND competition_age <= 50 THEN 'Masters 41-50'
        WHEN competition_age >= 51 THEN 'Masters 51+'
        ELSE 'Other'
    END as age_group,
    COUNT(*) as misplaced_count,
    COUNT(DISTINCT db_meet_id) as affected_meets,
    MIN(date) as earliest_date,
    MAX(date) as latest_date
FROM iwf_meet_results
WHERE 
    competition_age IS NOT NULL
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
        OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
    )
GROUP BY age_group
ORDER BY age_group;

-- ============================================================================
-- QUERY 6: Total count of misplaced q-scores (IWF)
-- ============================================================================

SELECT 
    COUNT(*) as total_misplaced_qscores,
    COUNT(DISTINCT db_lifter_id) as affected_athletes,
    COUNT(DISTINCT db_meet_id) as affected_meets
FROM iwf_meet_results
WHERE 
    competition_age IS NOT NULL
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
        OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
    );

-- ============================================================================
-- UPDATE 2: Fix misplaced q-scores (IWF)
-- ============================================================================
-- This NULLs incorrect q-score columns and forces recalculation by updating total
-- The trigger should recalculate and place the score in the correct column
-- IMPORTANT: Review the count from QUERY 6 before running this update!
-- ============================================================================

-- Step 1: Fix Youth (10-20) - NULL qpoints and q_masters, force recalc
UPDATE iwf_meet_results
SET 
    qpoints = NULL,
    q_masters = NULL,
    q_youth = NULL,  -- Also NULL q_youth to force fresh calculation
    total = total,   -- Force trigger to recalculate
    updated_at = NOW()
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- Step 2: Fix Seniors (21-30) - NULL q_youth and q_masters, force recalc
UPDATE iwf_meet_results
SET 
    q_youth = NULL,
    q_masters = NULL,
    qpoints = NULL,  -- Also NULL qpoints to force fresh calculation
    total = total,   -- Force trigger to recalculate
    updated_at = NOW()
WHERE 
    competition_age >= 21 
    AND competition_age <= 30
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (q_youth IS NOT NULL OR q_masters IS NOT NULL);

-- Step 3: Fix Masters Men (31-75) - NULL qpoints and q_youth, force recalc
UPDATE iwf_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,  -- Also NULL q_masters to force fresh calculation
    total = total,     -- Force trigger to recalculate
    updated_at = NOW()
WHERE 
    gender = 'M'
    AND competition_age >= 31 
    AND competition_age <= 75
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

-- Step 4: Fix Masters Women (31-109) - NULL qpoints and q_youth, force recalc
UPDATE iwf_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,  -- Also NULL q_masters to force fresh calculation
    total = total,     -- Force trigger to recalculate
    updated_at = NOW()
WHERE 
    gender = 'F'
    AND competition_age >= 31 
    AND competition_age <= 109
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these after the UPDATE to verify the fix worked
-- ============================================================================

-- Verify USAW - should return 0 rows
SELECT COUNT(*) as remaining_misplaced_usaw
FROM usaw_meet_results
WHERE 
    competition_age IS NOT NULL
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
        OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
    );

-- Verify IWF - should return 0 rows
SELECT COUNT(*) as remaining_misplaced_iwf
FROM iwf_meet_results
WHERE 
    competition_age IS NOT NULL
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
        OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
    );

-- ============================================================================
-- USAGE INSTRUCTIONS
-- ============================================================================
-- 1. Run QUERY 3 (USAW) and QUERY 6 (IWF) to see total counts
-- 2. Run QUERY 2 (USAW) and QUERY 5 (IWF) to see breakdown by age group
-- 3. Run QUERY 1 (USAW) and QUERY 4 (IWF) to examine specific records
-- 4. Review the counts and sample records to understand the scope
-- 5. Run UPDATE 1 (USAW) and/or UPDATE 2 (IWF) to fix the issues
-- 6. Run verification queries to confirm all issues are resolved
--
-- The UPDATE statements trigger the database to recalculate q-scores using
-- the current trigger logic, which will place them in the correct columns.
-- ============================================================================
