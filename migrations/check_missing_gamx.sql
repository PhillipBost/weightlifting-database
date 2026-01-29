-- Diagnostic: Check for "Missing" GAMX Scores
-- Finds athletes with valid inputs who have NULL scores across the board.
SELECT result_id,
    lifter_name,
    gender,
    competition_age,
    body_weight_kg,
    total,
    -- Show which scores are missing
    gamx_u,
    gamx_a,
    gamx_masters,
    gamx_total
FROM usaw_meet_results
WHERE -- 1. Input Data is Valid
    total ~ '^[0-9]+(\.[0-9]+)?$'
    AND total::NUMERIC > 0
    AND body_weight_kg ~ '^[0-9]+(\.[0-9]+)?$'
    AND body_weight_kg::NUMERIC > 0
    AND competition_age IS NOT NULL
    AND gender IS NOT NULL -- 2. "Missing" Logic:
    -- Currently looking for records where ALL relevant age-based scores are null?
    -- OR simply where gamx_total is null (as a proxy for "something is missing")
    AND (
        gamx_total IS NULL
        AND gamx_u IS NULL
        AND gamx_a IS NULL
        AND gamx_masters IS NULL
    )
ORDER BY result_id DESC
LIMIT 50;