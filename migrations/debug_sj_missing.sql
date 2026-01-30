-- Diagnostic: Check S/J factors and calculation
BEGIN;
-- 1. Check if tables are populated
SELECT 'gamx_s_factors' as table,
    count(*)
FROM gamx_s_factors
UNION ALL
SELECT 'gamx_j_factors',
    count(*)
FROM gamx_j_factors;
-- 2. Test Calculation for a known valid candidate (Male, 24yo, ~89kg)
-- Should act like a Unit Test
WITH test_lifter AS (
    SELECT 'm' as gender,
        24 as age,
        89.0 as bw,
        140 as snatch,
        180 as cj
)
SELECT 'Test Case' as desc,
    get_gamx_score('s', gender, age, bw, snatch) as score_s,
    get_gamx_score('j', gender, age, bw, cj) as score_j
FROM test_lifter;
-- 3. Check real data sample
SELECT result_id,
    competition_age,
    body_weight_kg,
    best_snatch,
    gender,
    get_gamx_score(
        's',
        gender,
        competition_age,
        body_weight_kg::numeric,
        best_snatch::numeric
    ) as debug_s_score
FROM usaw_meet_results
WHERE competition_age BETWEEN 20 AND 30
    AND best_snatch IS NOT NULL
    AND body_weight_kg IS NOT NULL
LIMIT 5;
ROLLBACK;
-- Don't change anything