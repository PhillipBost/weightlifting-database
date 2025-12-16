-- Calculate Q-scores directly by calling the helper functions
-- Bypass the trigger entirely

-- For youth (10-20) - calculate q_youth
WITH youth_to_update AS (
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
UPDATE meet_results m
SET q_youth = ROUND(
    (calculate_qpoints_from_row(m.total::numeric, m.body_weight_kg::numeric, m.gender)
     * get_youth_age_factor_interpolated(m.competition_age::integer, m.body_weight_kg::numeric, m.gender))::numeric,
    2
)
WHERE m.result_id IN (SELECT result_id FROM youth_to_update);

-- For masters - calculate q_masters using central predicate
WITH masters_to_update AS (
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
UPDATE meet_results m
SET q_masters = ROUND(
    (calculate_qpoints_from_row(m.total::numeric, m.body_weight_kg::numeric, m.gender)
     * get_age_factor(m.competition_age::integer, m.gender))::numeric,
    2
)
WHERE m.result_id IN (SELECT result_id FROM masters_to_update);

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
