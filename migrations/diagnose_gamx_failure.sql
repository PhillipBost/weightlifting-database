-- Diagnostic: Check why GAMX calculations are NULL
BEGIN;
-- 1. Check if Factor Tables have data
SELECT (
        SELECT count(*)
        FROM gamx_u_factors
    ) as count_u,
    (
        SELECT count(*)
        FROM gamx_a_factors
    ) as count_a,
    (
        SELECT count(*)
        FROM gamx_points_factors
    ) as count_total,
    (
        SELECT count(*)
        FROM gamx_s_factors
    ) as count_s,
    (
        SELECT count(*)
        FROM gamx_j_factors
    ) as count_j;
-- 2. Pick a candidate row that SHOULD calculate
-- (Non-zero total, valid BW, known gender)
WITH sample_row AS (
    SELECT *
    FROM usaw_meet_results
    WHERE total::numeric > 50
        AND body_weight_kg::numeric > 0
        AND gender IS NOT NULL
    LIMIT 1
)
SELECT result_id,
    lifter_name,
    competition_age,
    body_weight_kg,
    total,
    gender,
    -- Test Parsing
    text_to_numeric_safe(body_weight_kg) as parsed_bw,
    text_to_numeric_safe(total) as parsed_total,
    -- Test Calculation
    get_gamx_score(
        'total',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ) as test_gamx_total,
    get_gamx_score(
        'u',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ) as test_gamx_u
FROM sample_row;
ROLLBACK;