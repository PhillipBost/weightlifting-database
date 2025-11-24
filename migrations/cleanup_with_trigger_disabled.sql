-- ================================================================
-- Cleanup Q-Points with Trigger Disabled
-- ================================================================
-- The qpoints_auto_update trigger recalculates Q-scores on UPDATE,
-- which prevents our cleanup from working. We need to disable it.
-- ================================================================

-- Disable the trigger temporarily
ALTER TABLE meet_results DISABLE TRIGGER qpoints_auto_update;

-- ================================================================
-- CLEANUP STEP 1: Ages 10-20 (Youth)
-- Should have ONLY q_youth, NULL out qpoints and q_masters
-- ================================================================
UPDATE meet_results
SET qpoints = NULL,
    q_masters = NULL
WHERE competition_age::integer BETWEEN 10 AND 20
  AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- ================================================================
-- CLEANUP STEP 2: Ages 21-30 (Open)
-- Should have ONLY qpoints, NULL out q_youth and q_masters
-- ================================================================
UPDATE meet_results
SET q_youth = NULL,
    q_masters = NULL
WHERE competition_age::integer BETWEEN 21 AND 30
  AND (q_youth IS NOT NULL OR q_masters IS NOT NULL);

-- ================================================================
-- CLEANUP STEP 3: Ages 31+ (Masters)
-- Should have ONLY q_masters, NULL out qpoints and q_youth
-- ================================================================
UPDATE meet_results
SET qpoints = NULL,
    q_youth = NULL
WHERE competition_age::integer >= 31
  AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

-- ================================================================
-- CLEANUP STEP 4: Invalid ages (NULL or < 10)
-- Should have ALL Q-scores as NULL
-- ================================================================
UPDATE meet_results
SET qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL
WHERE (competition_age IS NULL OR competition_age::integer < 10)
  AND (qpoints IS NOT NULL OR q_youth IS NOT NULL OR q_masters IS NOT NULL);

-- Re-enable the trigger
ALTER TABLE meet_results ENABLE TRIGGER qpoints_auto_update;

-- Final verification
SELECT
    'Invalid q_youth (not ages 10-20)' as check_name,
    COUNT(*) as remaining_issues,
    CASE WHEN COUNT(*) = 0 THEN 'PASS ✓' ELSE 'FAIL ✗' END as status
FROM meet_results
WHERE q_youth IS NOT NULL
  AND (competition_age IS NULL OR competition_age::integer < 10 OR competition_age::integer > 20)

UNION ALL

SELECT
    'Invalid qpoints (not ages 21-30)',
    COUNT(*),
    CASE WHEN COUNT(*) = 0 THEN 'PASS ✓' ELSE 'FAIL ✗' END
FROM meet_results
WHERE qpoints IS NOT NULL
  AND (competition_age IS NULL OR competition_age::integer < 21 OR competition_age::integer > 30)

UNION ALL

SELECT
    'Invalid q_masters (not ages 31+)',
    COUNT(*),
    CASE WHEN COUNT(*) = 0 THEN 'PASS ✓' ELSE 'FAIL ✗' END
FROM meet_results
WHERE q_masters IS NOT NULL
  AND (competition_age IS NULL OR competition_age::integer < 31)

ORDER BY check_name;
