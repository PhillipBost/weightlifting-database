-- Diagnostic: Why is gamx_total missing for 15-40s?
BEGIN;
-- 1. Check if gamx_points_factors (Senior Total) has data
SELECT 'gamx_points_factors count' as check,
    count(*)
FROM gamx_points_factors;
-- 2. Find a specific failing example
-- Valid Input, Age 15-40, But gamx_total IS NULL
SELECT result_id,
    lifter_name,
    competition_age,
    body_weight_kg,
    total,
    gender,
    get_gamx_score(
        'total',
        gender,
        competition_age,
        body_weight_kg::numeric,
        total::numeric
    ) as recalc_score
FROM usaw_meet_results
WHERE competition_age BETWEEN 15 AND 40
    AND total IS NOT NULL
    AND total::NUMERIC > 0
    AND body_weight_kg IS NOT NULL
    AND gamx_total IS NULL
LIMIT 5;
-- 3. Check for specific factor existence for one of the above examples (if any found)
-- We'll just check a generic logical case (Male, 80kg) to see if factors exist
SELECT *
FROM gamx_points_factors
WHERE gender = 'm'
    AND bodyweight = 81.0
LIMIT 1;
ROLLBACK;