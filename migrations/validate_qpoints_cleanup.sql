-- ================================================================
-- Q-Points Validation Script
-- ================================================================
-- Purpose: Verify that Q-score cleanup and backfill were successful
--
-- Expected Results (after cleanup + backfill):
--   - All invalid assignments should be 0
--   - All missing Q-scores should be 0 (or only for records with missing data)
--
-- Run this AFTER:
--   1. cleanup_invalid_qpoints_comprehensive.sql
--   2. backfill_missing_qpoints_comprehensive.sql
-- ================================================================

DO $$
BEGIN
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Q-Points Validation Report';
    RAISE NOTICE '================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'PART 1: Invalid Q-Score Assignments';
    RAISE NOTICE '------------------------------------';
END $$;

-- ================================================================
-- PART 1: Invalid Assignments (Should all be 0)
-- ================================================================

-- Invalid q_youth (assigned to non-youth ages)
SELECT
    'Invalid q_youth (not ages 10-20)' as issue,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS ✓'
        ELSE 'FAIL ✗'
    END as status
FROM meet_results
WHERE q_youth IS NOT NULL
  AND (competition_age < 10 OR competition_age > 20 OR competition_age IS NULL);

-- Invalid qpoints (assigned to non-open ages)
SELECT
    'Invalid qpoints (not ages 21-30)' as issue,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS ✓'
        ELSE 'FAIL ✗'
    END as status
FROM meet_results
WHERE qpoints IS NOT NULL
  AND (competition_age < 21 OR competition_age > 30 OR competition_age IS NULL);

-- Invalid q_masters (assigned to non-masters ages)
SELECT
    'Invalid q_masters (not ages 31+)' as issue,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS ✓'
        ELSE 'FAIL ✗'
    END as status
FROM meet_results
WHERE q_masters IS NOT NULL
  AND (competition_age < 31 OR competition_age IS NULL);

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE 'PART 2: Cross-Contamination Between Q-Score Types';
    RAISE NOTICE '---------------------------------------------------';
END $$;

-- ================================================================
-- PART 2: Cross-Contamination (Should all be 0)
-- ================================================================

-- Youth with other Q-scores
SELECT
    'Youth (10-20) with qpoints or q_masters' as issue,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS ✓'
        ELSE 'FAIL ✗'
    END as status
FROM meet_results
WHERE competition_age BETWEEN 10 AND 20
  AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- Open with other Q-scores
SELECT
    'Open (21-30) with q_youth or q_masters' as issue,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS ✓'
        ELSE 'FAIL ✗'
    END as status
FROM meet_results
WHERE competition_age BETWEEN 21 AND 30
  AND (q_youth IS NOT NULL OR q_masters IS NOT NULL);

-- Masters with other Q-scores
SELECT
    'Masters (31+) with qpoints or q_youth' as issue,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS ✓'
        ELSE 'FAIL ✗'
    END as status
FROM meet_results
WHERE competition_age >= 31
  AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE 'PART 3: Missing Q-Scores (with valid data)';
    RAISE NOTICE '--------------------------------------------';
END $$;

-- ================================================================
-- PART 3: Missing Q-Scores (Should be 0 or minimal)
-- ================================================================

-- Missing q_youth for youth with totals
SELECT
    'Missing q_youth for youth (10-20)' as issue,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS ✓'
        WHEN COUNT(*) <= 10 THEN 'WARNING ⚠'
        ELSE 'FAIL ✗'
    END as status
FROM meet_results
WHERE competition_age BETWEEN 10 AND 20
  AND total IS NOT NULL
  AND total::numeric > 0  -- Exclude bombed out (total = 0)
  AND body_weight_kg IS NOT NULL
  AND gender IS NOT NULL
  AND q_youth IS NULL;

-- Missing qpoints for open with totals
SELECT
    'Missing qpoints for open (21-30)' as issue,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS ✓'
        WHEN COUNT(*) <= 10 THEN 'WARNING ⚠'
        ELSE 'FAIL ✗'
    END as status
FROM meet_results
WHERE competition_age BETWEEN 21 AND 30
  AND total IS NOT NULL
  AND total::numeric > 0  -- Exclude bombed out (total = 0)
  AND body_weight_kg IS NOT NULL
  AND gender IS NOT NULL
  AND qpoints IS NULL;

-- Missing q_masters for masters with totals
SELECT
    'Missing q_masters for masters (31+)' as issue,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS ✓'
        WHEN COUNT(*) <= 10 THEN 'WARNING ⚠'
        ELSE 'FAIL ✗'
    END as status
FROM meet_results
WHERE competition_age >= 31
  AND total IS NOT NULL
  AND total::numeric > 0  -- Exclude bombed out (total = 0)
  AND body_weight_kg IS NOT NULL
  AND gender IS NOT NULL
  AND q_masters IS NULL;

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE 'PART 4: Q-Score Distribution Summary';
    RAISE NOTICE '--------------------------------------';
END $$;

-- ================================================================
-- PART 4: Summary Statistics
-- ================================================================

-- Count of each Q-score type
SELECT
    'Youth Q-scores (q_youth)' as category,
    COUNT(*) as total_count,
    COUNT(CASE WHEN competition_age BETWEEN 10 AND 20 THEN 1 END) as correct_age_bracket
FROM meet_results
WHERE q_youth IS NOT NULL;

SELECT
    'Open Q-scores (qpoints)' as category,
    COUNT(*) as total_count,
    COUNT(CASE WHEN competition_age BETWEEN 21 AND 30 THEN 1 END) as correct_age_bracket
FROM meet_results
WHERE qpoints IS NOT NULL;

SELECT
    'Masters Q-scores (q_masters)' as category,
    COUNT(*) as total_count,
    COUNT(CASE WHEN competition_age >= 31 THEN 1 END) as correct_age_bracket
FROM meet_results
WHERE q_masters IS NOT NULL;

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE 'PART 5: Sample Problem Records (first 10, if any)';
    RAISE NOTICE '---------------------------------------------------';
END $$;

-- ================================================================
-- PART 5: Sample Problem Records (if any)
-- ================================================================

-- Show sample records with issues (limit 10)
SELECT
    result_id,
    lifter_name,
    competition_age,
    gender,
    total,
    body_weight_kg,
    q_youth,
    qpoints,
    q_masters,
    CASE
        WHEN q_youth IS NOT NULL AND (competition_age < 10 OR competition_age > 20) THEN 'Invalid q_youth'
        WHEN qpoints IS NOT NULL AND (competition_age < 21 OR competition_age > 30) THEN 'Invalid qpoints'
        WHEN q_masters IS NOT NULL AND competition_age < 31 THEN 'Invalid q_masters'
        WHEN competition_age BETWEEN 10 AND 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL) THEN 'Youth contamination'
        WHEN competition_age BETWEEN 21 AND 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL) THEN 'Open contamination'
        WHEN competition_age >= 31 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL) THEN 'Masters contamination'
        WHEN competition_age BETWEEN 10 AND 20 AND total IS NOT NULL AND total::numeric > 0 AND q_youth IS NULL THEN 'Missing q_youth'
        WHEN competition_age BETWEEN 21 AND 30 AND total IS NOT NULL AND total::numeric > 0 AND qpoints IS NULL THEN 'Missing qpoints'
        WHEN competition_age >= 31 AND total IS NOT NULL AND total::numeric > 0 AND q_masters IS NULL THEN 'Missing q_masters'
    END as issue_type
FROM meet_results
WHERE
    -- Invalid assignments
    (q_youth IS NOT NULL AND (competition_age < 10 OR competition_age > 20 OR competition_age IS NULL)) OR
    (qpoints IS NOT NULL AND (competition_age < 21 OR competition_age > 30 OR competition_age IS NULL)) OR
    (q_masters IS NOT NULL AND (competition_age < 31 OR competition_age IS NULL)) OR
    -- Cross-contamination
    (competition_age BETWEEN 10 AND 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL)) OR
    (competition_age BETWEEN 21 AND 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL)) OR
    (competition_age >= 31 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL)) OR
    -- Missing with valid data (exclude total = 0, bombed out)
    (competition_age BETWEEN 10 AND 20 AND total IS NOT NULL AND total::numeric > 0 AND body_weight_kg IS NOT NULL AND q_youth IS NULL) OR
    (competition_age BETWEEN 21 AND 30 AND total IS NOT NULL AND total::numeric > 0 AND body_weight_kg IS NOT NULL AND qpoints IS NULL) OR
    (competition_age >= 31 AND total IS NOT NULL AND total::numeric > 0 AND body_weight_kg IS NOT NULL AND q_masters IS NULL)
LIMIT 10;

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Validation Complete';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'If all checks show PASS ✓, your Q-score data is clean!';
    RAISE NOTICE 'If any checks show FAIL ✗, re-run cleanup and backfill scripts.';
    RAISE NOTICE 'Warnings ⚠ indicate minor issues (< 10 records) - investigate sample records.';
    RAISE NOTICE '================================================';
END $$;
