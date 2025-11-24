-- ================================================================
-- Comprehensive Q-Points Backfill Script
-- ================================================================
-- Purpose: Calculate and populate ALL missing Q-scores by triggering
--          the update_qpoints_on_change() trigger
--
-- This script handles:
--   - Youth (10-20) missing q_youth
--   - Open (21-30) missing qpoints
--   - Masters (31+) missing q_masters
--
-- Processes in batches of 1000 records to avoid timeout
-- Run this AFTER cleanup_invalid_qpoints_comprehensive.sql
-- ================================================================

DO $$
DECLARE
    batch_size INTEGER := 1000;
    total_updated INTEGER := 0;
    rows_affected INTEGER;
    youth_missing INTEGER;
    open_missing INTEGER;
    masters_missing INTEGER;
BEGIN
    -- Count missing records before backfill
    SELECT COUNT(*) INTO youth_missing
    FROM meet_results
    WHERE competition_age BETWEEN 10 AND 20
      AND q_youth IS NULL
      AND total IS NOT NULL
      AND total::numeric > 0  -- Exclude bombed out (total = 0)
      AND body_weight_kg IS NOT NULL;

    SELECT COUNT(*) INTO open_missing
    FROM meet_results
    WHERE competition_age BETWEEN 21 AND 30
      AND qpoints IS NULL
      AND total IS NOT NULL
      AND total::numeric > 0  -- Exclude bombed out (total = 0)
      AND body_weight_kg IS NOT NULL;

    SELECT COUNT(*) INTO masters_missing
    FROM meet_results
    WHERE competition_age >= 31
      AND q_masters IS NULL
      AND total IS NOT NULL
      AND total::numeric > 0  -- Exclude bombed out (total = 0)
      AND body_weight_kg IS NOT NULL;

    RAISE NOTICE '================================================';
    RAISE NOTICE 'Q-Points Comprehensive Backfill - Starting';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Records missing q_youth (ages 10-20): %', youth_missing;
    RAISE NOTICE 'Records missing qpoints (ages 21-30): %', open_missing;
    RAISE NOTICE 'Records missing q_masters (ages 31+): %', masters_missing;
    RAISE NOTICE 'Total records to backfill: %', youth_missing + open_missing + masters_missing;
    RAISE NOTICE 'Batch size: %', batch_size;
    RAISE NOTICE '================================================';

    -- Process in batches to avoid timeout
    LOOP
        -- Update records where ANY Q-score is missing for their age bracket
        -- Setting updated_at triggers the update_qpoints_on_change() function
        WITH batch AS (
            SELECT result_id
            FROM meet_results
            WHERE
                -- Youth missing q_youth
                (competition_age BETWEEN 10 AND 20
                 AND q_youth IS NULL
                 AND total IS NOT NULL
                 AND total::numeric > 0  -- Exclude bombed out
                 AND body_weight_kg IS NOT NULL
                 AND gender IS NOT NULL)
                OR
                -- Open missing qpoints
                (competition_age BETWEEN 21 AND 30
                 AND qpoints IS NULL
                 AND total IS NOT NULL
                 AND total::numeric > 0  -- Exclude bombed out
                 AND body_weight_kg IS NOT NULL
                 AND gender IS NOT NULL)
                OR
                -- Masters missing q_masters
                (competition_age >= 31
                 AND q_masters IS NULL
                 AND total IS NOT NULL
                 AND total::numeric > 0  -- Exclude bombed out
                 AND body_weight_kg IS NOT NULL
                 AND gender IS NOT NULL)
            LIMIT batch_size
        )
        UPDATE meet_results
        SET updated_at = NOW()
        WHERE result_id IN (SELECT result_id FROM batch);

        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        total_updated := total_updated + rows_affected;

        -- Log progress every batch
        IF rows_affected > 0 THEN
            RAISE NOTICE 'Processed batch: % rows (Total processed: %)', rows_affected, total_updated;
        END IF;

        -- Exit when no more rows to update
        IF rows_affected = 0 THEN
            EXIT;
        END IF;

        -- Small delay to prevent overwhelming the database
        PERFORM pg_sleep(0.1);
    END LOOP;

    -- Count remaining missing records after backfill
    SELECT COUNT(*) INTO youth_missing
    FROM meet_results
    WHERE competition_age BETWEEN 10 AND 20
      AND q_youth IS NULL
      AND total IS NOT NULL
      AND total::numeric > 0  -- Exclude bombed out
      AND body_weight_kg IS NOT NULL
      AND gender IS NOT NULL;

    SELECT COUNT(*) INTO open_missing
    FROM meet_results
    WHERE competition_age BETWEEN 21 AND 30
      AND qpoints IS NULL
      AND total IS NOT NULL
      AND total::numeric > 0  -- Exclude bombed out
      AND body_weight_kg IS NOT NULL
      AND gender IS NOT NULL;

    SELECT COUNT(*) INTO masters_missing
    FROM meet_results
    WHERE competition_age >= 31
      AND q_masters IS NULL
      AND total IS NOT NULL
      AND total::numeric > 0  -- Exclude bombed out
      AND body_weight_kg IS NOT NULL
      AND gender IS NOT NULL;

    RAISE NOTICE '================================================';
    RAISE NOTICE 'Q-Points Comprehensive Backfill - Complete';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Total records updated: %', total_updated;
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Remaining missing q_youth (ages 10-20): %', youth_missing;
    RAISE NOTICE 'Remaining missing qpoints (ages 21-30): %', open_missing;
    RAISE NOTICE 'Remaining missing q_masters (ages 31+): %', masters_missing;
    RAISE NOTICE 'Total still missing: %', youth_missing + open_missing + masters_missing;

    IF youth_missing + open_missing + masters_missing = 0 THEN
        RAISE NOTICE 'SUCCESS: All Q-scores have been calculated!';
    ELSE
        RAISE WARNING 'Some Q-scores could not be calculated - check for missing total, bodyweight, or gender data';
    END IF;

    RAISE NOTICE '================================================';
    RAISE NOTICE 'Next step: Run validate_qpoints_cleanup.sql to verify';
    RAISE NOTICE '================================================';
END $$;
