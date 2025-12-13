-- ================================================================
-- Chunked Q-Points Backfill Script
-- ================================================================
-- Processes missing Q-scores in small batches to avoid timeout
-- Run this script MULTIPLE TIMES until all Q-scores are filled
-- ================================================================

-- Process 50 records at a time (adjust if still timing out)
DO $$
DECLARE
    records_processed INTEGER := 0;
    batch_limit INTEGER := 50;
BEGIN
    -- Update records with missing Q-scores
    -- The trigger will calculate the correct Q-score values
    WITH missing_qscores AS (
        SELECT result_id
        FROM meet_results
        WHERE
            -- Youth missing q_youth
            (competition_age::integer BETWEEN 10 AND 20
             AND q_youth IS NULL
             AND total IS NOT NULL
             AND total::numeric > 0
             AND body_weight_kg IS NOT NULL
             AND body_weight_kg::numeric > 0
             AND gender IS NOT NULL)
            OR
            -- Open missing qpoints
            (competition_age::integer BETWEEN 21 AND 30
             AND qpoints IS NULL
             AND total IS NOT NULL
             AND total::numeric > 0
             AND body_weight_kg IS NOT NULL
             AND body_weight_kg::numeric > 0
             AND gender IS NOT NULL)
            OR
            -- Masters missing q_masters (predicate)
            (public.is_master_age(gender, competition_age)
             AND q_masters IS NULL
             AND total IS NOT NULL
             AND total::numeric > 0
             AND body_weight_kg IS NOT NULL
             AND body_weight_kg::numeric > 0
             AND gender IS NOT NULL)
        LIMIT batch_limit
    )
    UPDATE meet_results
    SET updated_at = NOW()
    WHERE result_id IN (SELECT result_id FROM missing_qscores);

    GET DIAGNOSTICS records_processed = ROW_COUNT;

    RAISE NOTICE 'Processed % records in this batch', records_processed;
END $$;

-- Show remaining work
SELECT
    'Missing q_youth for youth (10-20)' as category,
    COUNT(*) as remaining
FROM meet_results
WHERE competition_age::integer BETWEEN 10 AND 20
  AND q_youth IS NULL
  AND total IS NOT NULL
  AND total::numeric > 0
  AND body_weight_kg IS NOT NULL
  AND body_weight_kg::numeric > 0
  AND gender IS NOT NULL

UNION ALL

SELECT
    'Missing qpoints for open (21-30)',
    COUNT(*)
FROM meet_results
WHERE competition_age::integer BETWEEN 21 AND 30
  AND qpoints IS NULL
  AND total IS NOT NULL
  AND total::numeric > 0
  AND body_weight_kg IS NOT NULL
  AND body_weight_kg::numeric > 0
  AND gender IS NOT NULL

UNION ALL

SELECT
    'Missing q_masters for masters (predicate)',
    COUNT(*)
FROM meet_results
WHERE public.is_master_age(gender, competition_age)
  AND q_masters IS NULL
  AND total IS NOT NULL
  AND total::numeric > 0
  AND body_weight_kg IS NOT NULL
  AND body_weight_kg::numeric > 0
  AND gender IS NOT NULL

UNION ALL

SELECT
    'TOTAL REMAINING',
    (
        SELECT COUNT(*) FROM meet_results
        WHERE competition_age::integer BETWEEN 10 AND 20
          AND q_youth IS NULL AND total IS NOT NULL AND total::numeric > 0
          AND body_weight_kg IS NOT NULL AND body_weight_kg::numeric > 0 AND gender IS NOT NULL
    ) + (
        SELECT COUNT(*) FROM meet_results
        WHERE competition_age::integer BETWEEN 21 AND 30
          AND qpoints IS NULL AND total IS NOT NULL AND total::numeric > 0
          AND body_weight_kg IS NOT NULL AND body_weight_kg::numeric > 0 AND gender IS NOT NULL
    ) + (
        SELECT COUNT(*) FROM meet_results
        WHERE public.is_master_age(gender, competition_age)
          AND q_masters IS NULL AND total IS NOT NULL AND total::numeric > 0
          AND body_weight_kg IS NOT NULL AND body_weight_kg::numeric > 0 AND gender IS NOT NULL
    );
