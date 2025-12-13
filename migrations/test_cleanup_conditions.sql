-- Test query to verify cleanup conditions are matching records
-- Run this to see if we can find the problematic records

-- Test 1: Find youth ages (< 10) with any Q-scores
SELECT
    'Ages < 10 with Q-scores' as test,
    COUNT(*) as count,
    MIN(competition_age) as min_age,
    MAX(competition_age) as max_age
FROM meet_results
WHERE (competition_age IS NULL OR competition_age::integer < 10)
  AND (qpoints IS NOT NULL OR q_youth IS NOT NULL OR q_masters IS NOT NULL);

-- Test 2: Sample records that should be cleaned up
SELECT
    result_id,
    lifter_name,
    competition_age,
    competition_age::integer as age_as_int,
    q_youth,
    qpoints,
    q_masters,
    CASE
        WHEN competition_age IS NULL THEN 'NULL age'
        WHEN competition_age::integer < 10 THEN 'Too young (< 10)'
        WHEN competition_age::integer BETWEEN 10 AND 20 THEN 'Youth'
        WHEN competition_age::integer BETWEEN 21 AND 30 THEN 'Open'
        WHEN public.is_master_age(gender, competition_age) THEN 'Masters'
    END as age_bracket
FROM meet_results
WHERE (competition_age IS NULL OR competition_age::integer < 10)
  AND (qpoints IS NOT NULL OR q_youth IS NOT NULL OR q_masters IS NOT NULL)
LIMIT 20;

-- Test 3: Try direct cast to see if there are casting errors
SELECT
    competition_age,
    COUNT(*) as count
FROM meet_results
WHERE q_youth IS NOT NULL OR qpoints IS NOT NULL OR q_masters IS NOT NULL
GROUP BY competition_age
ORDER BY competition_age
LIMIT 30;
