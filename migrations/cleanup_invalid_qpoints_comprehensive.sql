-- ================================================================
-- Comprehensive Q-Points Cleanup Script
-- ================================================================
-- Purpose: NULL out ALL misassigned Q-scores across all age brackets
--
-- Age Bracket Rules:
--   Ages 10-20 (Youth):  q_youth ONLY  (qpoints=NULL, q_masters=NULL)
--   Ages 21-30 (Open):   qpoints ONLY  (q_youth=NULL, q_masters=NULL)
--   Ages 31+ (Masters):  q_masters ONLY (qpoints=NULL, q_youth=NULL)
--   No valid age:        ALL NULL
--
-- Run this BEFORE the backfill script to ensure clean data
-- ================================================================

-- Count records before cleanup
DO $$
DECLARE
    total_records INTEGER;
    invalid_youth INTEGER;
    invalid_open INTEGER;
    invalid_masters INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_records FROM meet_results;

    SELECT COUNT(*) INTO invalid_youth
    FROM meet_results
    WHERE q_youth IS NOT NULL
      AND (competition_age IS NULL OR competition_age::integer < 10 OR competition_age::integer > 20);

    SELECT COUNT(*) INTO invalid_open
    FROM meet_results
    WHERE qpoints IS NOT NULL
      AND (competition_age IS NULL OR competition_age::integer < 21 OR competition_age::integer > 30);

    SELECT COUNT(*) INTO invalid_masters
    FROM meet_results
    WHERE q_masters IS NOT NULL
      AND (competition_age IS NULL OR competition_age::integer < 31);

    RAISE NOTICE '================================================';
    RAISE NOTICE 'Q-Points Comprehensive Cleanup - Starting';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Total records in meet_results: %', total_records;
    RAISE NOTICE 'Invalid q_youth assignments: %', invalid_youth;
    RAISE NOTICE 'Invalid qpoints assignments: %', invalid_open;
    RAISE NOTICE 'Invalid q_masters assignments: %', invalid_masters;
    RAISE NOTICE '================================================';
END $$;

-- ================================================================
-- CLEANUP STEP 1: Ages 10-20 (Youth)
-- Should have ONLY q_youth, NULL out qpoints and q_masters
-- ================================================================
DO $$
DECLARE
    rows_updated INTEGER;
BEGIN
    UPDATE meet_results
    SET qpoints = NULL,
        q_masters = NULL
    WHERE competition_age::integer BETWEEN 10 AND 20
      AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RAISE NOTICE 'Step 1 complete: Cleaned up youth age bracket (10-20) - % rows updated', rows_updated;
END $$;

-- ================================================================
-- CLEANUP STEP 2: Ages 21-30 (Open)
-- Should have ONLY qpoints, NULL out q_youth and q_masters
-- ================================================================
DO $$
DECLARE
    rows_updated INTEGER;
BEGIN
    UPDATE meet_results
    SET q_youth = NULL,
        q_masters = NULL
    WHERE competition_age::integer BETWEEN 21 AND 30
      AND (q_youth IS NOT NULL OR q_masters IS NOT NULL);

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RAISE NOTICE 'Step 2 complete: Cleaned up open age bracket (21-30) - % rows updated', rows_updated;
END $$;

-- ================================================================
-- CLEANUP STEP 3: Ages 31+ (Masters)
-- Should have ONLY q_masters, NULL out qpoints and q_youth
-- ================================================================
DO $$
DECLARE
    rows_updated INTEGER;
BEGIN
    UPDATE meet_results
    SET qpoints = NULL,
        q_youth = NULL
    WHERE competition_age::integer >= 31
      AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RAISE NOTICE 'Step 3 complete: Cleaned up masters age bracket (31+) - % rows updated', rows_updated;
END $$;

-- ================================================================
-- CLEANUP STEP 4: Invalid ages (NULL or < 10)
-- Should have ALL Q-scores as NULL (safety measure)
-- ================================================================
DO $$
DECLARE
    rows_updated INTEGER;
BEGIN
    UPDATE meet_results
    SET qpoints = NULL,
        q_youth = NULL,
        q_masters = NULL
    WHERE (competition_age IS NULL OR competition_age::integer < 10)
      AND (qpoints IS NOT NULL OR q_youth IS NOT NULL OR q_masters IS NOT NULL);

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RAISE NOTICE 'Step 4 complete: Cleaned up records with invalid ages - % rows updated', rows_updated;
END $$;

-- Count records after cleanup
DO $$
DECLARE
    invalid_youth INTEGER;
    invalid_open INTEGER;
    invalid_masters INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_youth
    FROM meet_results
    WHERE q_youth IS NOT NULL
      AND (competition_age IS NULL OR competition_age::integer < 10 OR competition_age::integer > 20);

    SELECT COUNT(*) INTO invalid_open
    FROM meet_results
    WHERE qpoints IS NOT NULL
      AND (competition_age IS NULL OR competition_age::integer < 21 OR competition_age::integer > 30);

    SELECT COUNT(*) INTO invalid_masters
    FROM meet_results
    WHERE q_masters IS NOT NULL
      AND (competition_age IS NULL OR competition_age::integer < 31);

    RAISE NOTICE '================================================';
    RAISE NOTICE 'Q-Points Comprehensive Cleanup - Complete';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Remaining invalid q_youth assignments: %', invalid_youth;
    RAISE NOTICE 'Remaining invalid qpoints assignments: %', invalid_open;
    RAISE NOTICE 'Remaining invalid q_masters assignments: %', invalid_masters;

    IF invalid_youth = 0 AND invalid_open = 0 AND invalid_masters = 0 THEN
        RAISE NOTICE 'SUCCESS: All misassigned Q-scores have been cleaned up!';
    ELSE
        RAISE WARNING 'Some invalid assignments remain - manual investigation required';
    END IF;

    RAISE NOTICE '================================================';
    RAISE NOTICE 'Next step: Run backfill_missing_qpoints_comprehensive.sql';
    RAISE NOTICE '================================================';
END $$;

-- Final verification query - THIS IS WHAT YOU'LL SEE IN SUPABASE
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
