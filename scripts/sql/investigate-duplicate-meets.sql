-- ============================================================================
-- PHASE 1: DATABASE STATE ANALYSIS FOR PHANTOM DUPLICATES
-- ============================================================================
-- Investigation Date: 2025-11-01
-- Purpose: Find root cause of 19,052 phantom duplicate records created 2025-10-29

-- ----------------------------------------------------------------------------
-- Query 1: Check for duplicate iwf_meet_id entries in iwf_meets table
-- ----------------------------------------------------------------------------
-- If the same iwf_meet_id appears multiple times with different db_meet_ids,
-- this would explain why identical results get assigned to different meets
-- ----------------------------------------------------------------------------

SELECT
    iwf_meet_id,
    COUNT(*) as duplicate_count,
    STRING_AGG(db_meet_id::text, ', ' ORDER BY db_meet_id) as db_meet_ids,
    STRING_AGG(meet, ' | ' ORDER BY db_meet_id) as meet_names,
    STRING_AGG(date, ' | ' ORDER BY db_meet_id) as dates,
    MIN(created_at) as first_created,
    MAX(created_at) as last_created
FROM iwf_meets
GROUP BY iwf_meet_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, iwf_meet_id;

-- Expected result:
-- - If EMPTY: No duplicate iwf_meet_ids exist (bug is elsewhere)
-- - If ROWS: Shows which IWF events were inserted multiple times

-- ----------------------------------------------------------------------------
-- Query 2: Inspect problematic meet pairs from phantom analysis
-- ----------------------------------------------------------------------------
-- These are the top 6 meet pairs with most phantom duplicates
-- We need to see if they share the same iwf_meet_id
-- ----------------------------------------------------------------------------

SELECT
    db_meet_id,
    iwf_meet_id,
    meet,
    date,
    created_at,
    batch_id,
    url
FROM iwf_meets
WHERE db_meet_id IN (
    671, 672,   -- 240 phantom groups
    785, 788,   -- 202 phantom groups
    1089, 1090, -- 190 phantom groups
    1019, 1020, -- 170 phantom groups
    864, 865,   -- 160 phantom groups
    652, 653    -- 155 phantom groups
)
ORDER BY
    CASE
        WHEN db_meet_id IN (671, 672) THEN 1
        WHEN db_meet_id IN (785, 788) THEN 2
        WHEN db_meet_id IN (1089, 1090) THEN 3
        WHEN db_meet_id IN (1019, 1020) THEN 4
        WHEN db_meet_id IN (864, 865) THEN 5
        WHEN db_meet_id IN (652, 653) THEN 6
    END,
    db_meet_id;

-- Expected result:
-- Scenario A: Pairs share SAME iwf_meet_id → Meet upsert created duplicates
-- Scenario B: Pairs have DIFFERENT iwf_meet_ids → Scraper returned wrong results

-- ----------------------------------------------------------------------------
-- Query 3: Check creation timeline for problematic meets
-- ----------------------------------------------------------------------------
-- All phantom records were created 2025-10-29
-- Check if problematic meets were also created on that date
-- ----------------------------------------------------------------------------

SELECT
    DATE(created_at) as creation_date,
    COUNT(*) as meets_created,
    COUNT(DISTINCT iwf_meet_id) as unique_events,
    STRING_AGG(DISTINCT db_meet_id::text, ', ' ORDER BY db_meet_id::text) as db_meet_ids_sample
FROM iwf_meets
WHERE db_meet_id IN (
    671, 672, 785, 788, 1089, 1090, 1019, 1020, 864, 865, 652, 653
)
GROUP BY DATE(created_at)
ORDER BY creation_date DESC;

-- Expected result:
-- - Should show creation date around 2025-10-29
-- - If unique_events < meets_created, confirms duplicate iwf_meet_ids

-- ----------------------------------------------------------------------------
-- Query 4: Sample phantom results for verification
-- ----------------------------------------------------------------------------
-- Get a few phantom duplicate records to verify they're truly identical
-- ----------------------------------------------------------------------------

WITH phantom_sample AS (
    SELECT db_result_id, db_meet_id, db_lifter_id, lifter_name,
           weight_class, total, snatch_lift_1, cj_lift_1, created_at
    FROM iwf_meet_results
    WHERE db_meet_id IN (671, 672)
    AND lifter_name = 'Mohammed Abdulmunem Ali AL-SHARUEE'
)
SELECT * FROM phantom_sample
ORDER BY db_meet_id, db_result_id;

-- Expected result:
-- - Should show 2 records with identical performance data
-- - Different db_result_id and db_meet_id
-- - Same lifter_name, weight_class, totals, attempts

-- ----------------------------------------------------------------------------
-- Query 5: Count total affected records per meet pair
-- ----------------------------------------------------------------------------

SELECT
    m.db_meet_id,
    m.iwf_meet_id,
    m.meet,
    m.date,
    COUNT(r.db_result_id) as result_count,
    m.created_at as meet_created_at
FROM iwf_meets m
LEFT JOIN iwf_meet_results r ON m.db_meet_id = r.db_meet_id
WHERE m.db_meet_id IN (
    671, 672, 785, 788, 1089, 1090, 1019, 1020, 864, 865, 652, 653
)
GROUP BY m.db_meet_id, m.iwf_meet_id, m.meet, m.date, m.created_at
ORDER BY m.db_meet_id;

-- Expected result:
-- - Each meet in a pair should have similar result counts
-- - Confirms both meets have full result sets (not partial)
