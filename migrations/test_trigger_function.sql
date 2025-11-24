-- Test if the trigger actually calculates Q-scores

-- 1. Find a specific record that's missing Q-scores
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
    'BEFORE UPDATE' as status
FROM meet_results
WHERE competition_age::integer BETWEEN 10 AND 20
  AND q_youth IS NULL
  AND total IS NOT NULL
  AND total::numeric > 0
  AND body_weight_kg IS NOT NULL
  AND gender IS NOT NULL
LIMIT 1;

-- 2. Manually update that specific record to trigger the function
-- Replace XXXXX with the result_id from query above
UPDATE meet_results
SET updated_at = NOW()
WHERE result_id = (
    SELECT result_id
    FROM meet_results
    WHERE competition_age::integer BETWEEN 10 AND 20
      AND q_youth IS NULL
      AND total IS NOT NULL
      AND total::numeric > 0
      AND body_weight_kg IS NOT NULL
      AND gender IS NOT NULL
    LIMIT 1
)
RETURNING result_id, lifter_name, competition_age, total, body_weight_kg, q_youth, qpoints, q_masters;

-- 3. Check if q_youth was calculated
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
    'AFTER UPDATE' as status,
    CASE
        WHEN q_youth IS NOT NULL THEN 'Trigger worked! ✓'
        WHEN q_youth IS NULL THEN 'Trigger did NOT calculate q_youth ✗'
    END as trigger_status
FROM meet_results
WHERE result_id = (
    SELECT result_id
    FROM meet_results
    WHERE competition_age::integer BETWEEN 10 AND 20
      AND total IS NOT NULL
      AND total::numeric > 0
      AND body_weight_kg IS NOT NULL
      AND gender IS NOT NULL
    ORDER BY result_id
    LIMIT 1
);
