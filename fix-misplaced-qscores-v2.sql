-- ============================================================================
-- FIXED: SQL to Re-Trigger Q-Score Calculation (Working Version)
-- ============================================================================
-- Purpose: Force q-score recalculation by making actual value changes
-- Date: 2025-12-14
-- Previous Issue: total = total doesn't trigger BEFORE UPDATE
-- Solution: Use CAST to force actual change recognition
-- ============================================================================

-- ============================================================================
-- USAW FIXES - Using CAST to force trigger
-- ============================================================================

-- Step 1: Fix Youth (10-20) - NULL wrong scores and force trigger
UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_masters = NULL,
    q_youth = NULL,
    -- Force trigger by casting total (even though value stays the same)
    total = CAST(CAST(total AS NUMERIC) AS TEXT)
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- Step 2: Fix Seniors (21-30) - NULL wrong scores and force trigger
UPDATE usaw_meet_results
SET 
    q_youth = NULL,
    q_masters = NULL,
    qpoints = NULL,
    -- Force trigger by casting total
    total = CAST(CAST(total AS NUMERIC) AS TEXT)
WHERE 
    competition_age >= 21 
    AND competition_age <= 30
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (q_youth IS NOT NULL OR q_masters IS NOT NULL);

-- Step 3: Fix Masters Men (31-75) - NULL wrong scores and force trigger
UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,
    -- Force trigger by casting total
    total = CAST(CAST(total AS NUMERIC) AS TEXT)
WHERE 
    gender = 'M'
    AND competition_age >= 31 
    AND competition_age <= 75
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

-- Step 4: Fix Masters Women (31-109) - NULL wrong scores and force trigger
UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,
    -- Force trigger by casting total
    total = CAST(CAST(total AS NUMERIC) AS TEXT)
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
-- IWF FIXES - Using CAST to force trigger
-- ============================================================================

-- Step 5: Fix IWF Youth (10-20) - NULL wrong scores and force trigger
UPDATE iwf_meet_results
SET 
    qpoints = NULL,
    q_masters = NULL,
    q_youth = NULL,
    -- Force trigger by casting total
    total = CAST(CAST(total AS NUMERIC) AS TEXT)
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- Step 6: Fix IWF Seniors (21-30) - NULL wrong scores and force trigger
UPDATE iwf_meet_results
SET 
    q_youth = NULL,
    q_masters = NULL,
    qpoints = NULL,
    -- Force trigger by casting total
    total = CAST(CAST(total AS NUMERIC) AS TEXT)
WHERE 
    competition_age >= 21 
    AND competition_age <= 30
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (q_youth IS NOT NULL OR q_masters IS NOT NULL);

-- Step 7: Fix IWF Masters Men (31-75) - NULL wrong scores and force trigger
UPDATE iwf_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,
    -- Force trigger by casting total
    total = CAST(CAST(total AS NUMERIC) AS TEXT)
WHERE 
    gender = 'M'
    AND competition_age >= 31 
    AND competition_age <= 75
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

-- Step 8: Fix IWF Masters Women (31-109) - NULL wrong scores and force trigger
UPDATE iwf_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,
    -- Force trigger by casting total
    total = CAST(CAST(total AS NUMERIC) AS TEXT)
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

-- Verify USAW - should return 0 rows if fix worked
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

-- Verify IWF - should return 0 rows if fix worked
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
-- DETAILED VERIFICATION - Run this if totals above aren't 0
-- ============================================================================

SELECT 
    COUNT(*) as misplaced_count,
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 THEN 'Youth (10-20)'
        WHEN competition_age >= 21 AND competition_age <= 30 THEN 'Senior (21-30)'
        WHEN competition_age >= 31 THEN 'Masters (31+)'
    END as age_group,
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL) 
            THEN 'Youth has qpoints/q_masters'
        WHEN competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL) 
            THEN 'Senior has q_youth/q_masters'
        WHEN gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL) 
            THEN 'Master (M) has qpoints/q_youth'
        WHEN gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL) 
            THEN 'Master (F) has qpoints/q_youth'
    END as issue_type
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
GROUP BY age_group, issue_type
ORDER BY age_group;
