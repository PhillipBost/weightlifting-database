-- Find all duplicate (db_meet_id, db_lifter_id) pairs
-- Run this first to see the summary
SELECT
    db_meet_id,
    db_lifter_id,
    COUNT(*) as cnt,
    COUNT(*) - 1 as duplicates_to_delete
FROM iwf_meet_results
GROUP BY db_meet_id, db_lifter_id
HAVING COUNT(*) > 1
ORDER BY cnt DESC;

-- Get details of all duplicates with meet and lifter names
-- Shows which records would be kept/deleted
SELECT
    m.meet as meet_name,
    l.athlete_name as lifter_name,
    r.db_result_id,
    r.db_meet_id,
    r.db_lifter_id,
    r.date,
    r.weight_class,
    r.total,
    r.created_at,
    ROW_NUMBER() OVER (PARTITION BY r.db_meet_id, r.db_lifter_id ORDER BY r.total DESC NULLS LAST, r.created_at ASC) as keep_order
FROM iwf_meet_results r
JOIN iwf_meets m ON r.db_meet_id = m.db_meet_id
JOIN iwf_lifters l ON r.db_lifter_id = l.db_lifter_id
WHERE (r.db_meet_id, r.db_lifter_id) IN (
    SELECT db_meet_id, db_lifter_id
    FROM iwf_meet_results
    GROUP BY db_meet_id, db_lifter_id
    HAVING COUNT(*) > 1
)
ORDER BY r.db_meet_id, r.db_lifter_id, keep_order;

-- Specific example: db_meet_id=1013, db_lifter_id=37814 (the one from the error)
SELECT
    r.db_result_id,
    r.db_meet_id,
    r.db_lifter_id,
    m.meet,
    l.athlete_name,
    r.date,
    r.weight_class,
    r.total,
    r.best_snatch,
    r.best_cj,
    r.created_at
FROM iwf_meet_results r
JOIN iwf_meets m ON r.db_meet_id = m.db_meet_id
JOIN iwf_lifters l ON r.db_lifter_id = l.db_lifter_id
WHERE r.db_meet_id = 1013 AND r.db_lifter_id = 37814
ORDER BY r.created_at;

-- Show all 14 duplicate pairs with context
SELECT
    m.meet as meet_name,
    l.athlete_name,
    m.date as meet_date,
    r.db_meet_id,
    r.db_lifter_id,
    r.weight_class,
    r.total,
    r.db_result_id,
    r.created_at
FROM iwf_meet_results r
JOIN iwf_meets m ON r.db_meet_id = m.db_meet_id
JOIN iwf_lifters l ON r.db_lifter_id = l.db_lifter_id
WHERE (r.db_meet_id, r.db_lifter_id) IN (
    SELECT db_meet_id, db_lifter_id
    FROM iwf_meet_results
    GROUP BY db_meet_id, db_lifter_id
    HAVING COUNT(*) > 1
)
ORDER BY r.db_meet_id, r.db_lifter_id, r.total DESC NULLS LAST;

-- Query to identify which record to DELETE from each duplicate pair
-- Shows the record with HIGHEST TOTAL per (db_meet_id, db_lifter_id)
-- All others should be deleted
SELECT
    r.db_result_id,
    r.db_meet_id,
    r.db_lifter_id,
    l.athlete_name,
    m.meet,
    r.weight_class,
    r.total,
    r.created_at,
    CASE
        WHEN ROW_NUMBER() OVER (PARTITION BY r.db_meet_id, r.db_lifter_id ORDER BY r.total DESC NULLS LAST, r.created_at ASC) = 1
        THEN 'KEEP'
        ELSE 'DELETE'
    END as action
FROM iwf_meet_results r
JOIN iwf_meets m ON r.db_meet_id = m.db_meet_id
JOIN iwf_lifters l ON r.db_lifter_id = l.db_lifter_id
WHERE (r.db_meet_id, r.db_lifter_id) IN (
    SELECT db_meet_id, db_lifter_id
    FROM iwf_meet_results
    GROUP BY db_meet_id, db_lifter_id
    HAVING COUNT(*) > 1
)
ORDER BY r.db_meet_id, r.db_lifter_id, r.total DESC NULLS LAST;

-- SQL to delete duplicates (only the ones marked DELETE above)
-- DO NOT RUN THIS UNTIL YOU'VE VERIFIED THE ABOVE QUERIES
-- DELETE FROM iwf_meet_results
-- WHERE db_result_id IN (
--   SELECT db_result_id FROM (
--     SELECT
--       r.db_result_id,
--       ROW_NUMBER() OVER (PARTITION BY r.db_meet_id, r.db_lifter_id ORDER BY r.total DESC NULLS LAST, r.created_at ASC) as rn
--     FROM iwf_meet_results r
--     WHERE (r.db_meet_id, r.db_lifter_id) IN (
--       SELECT db_meet_id, db_lifter_id
--       FROM iwf_meet_results
--       GROUP BY db_meet_id, db_lifter_id
--       HAVING COUNT(*) > 1
--     )
--   ) subq
--   WHERE rn > 1
-- );
