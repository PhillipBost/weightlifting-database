-- Try explicitly touching the Q-score fields to trigger calculation
-- Process 50 at a time

-- For youth missing q_youth
WITH missing_youth AS (
    SELECT result_id
    FROM meet_results
    WHERE competition_age::integer BETWEEN 10 AND 20
      AND q_youth IS NULL
      AND total IS NOT NULL
      AND total::numeric > 0
      AND body_weight_kg IS NOT NULL
      AND body_weight_kg::numeric > 0
      AND gender IS NOT NULL
    LIMIT 50
)
UPDATE meet_results
SET q_youth = NULL,  -- Explicitly set to NULL to trigger calculation
    updated_at = NOW()
WHERE result_id IN (SELECT result_id FROM missing_youth);

-- For masters missing q_masters (uses central is_master_age predicate)
WITH missing_masters AS (
    SELECT result_id
    FROM meet_results
    WHERE public.is_master_age(gender, competition_age)
      AND q_masters IS NULL
      AND total IS NOT NULL
      AND total::numeric > 0
      AND body_weight_kg IS NOT NULL
      AND body_weight_kg::numeric > 0
      AND gender IS NOT NULL
    LIMIT 50
)
UPDATE meet_results
SET q_masters = NULL,  -- Explicitly set to NULL to trigger calculation
    updated_at = NOW()
WHERE result_id IN (SELECT result_id FROM missing_masters);

-- Check results
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
    'Missing q_masters for masters (predicate)',
    COUNT(*)
FROM meet_results
WHERE public.is_master_age(gender, competition_age)
  AND q_masters IS NULL
  AND total IS NOT NULL
  AND total::numeric > 0
  AND body_weight_kg IS NOT NULL
  AND body_weight_kg::numeric > 0
  AND gender IS NOT NULL;
