-- Diagnostic: Inspect Stuck Rows
BEGIN;
-- 1. Look at 5 candidate rows that the RPC *should* be picking up
SELECT result_id,
    lifter_name,
    total,
    body_weight_kg,
    updated_at,
    gamx_total
FROM usaw_meet_results
WHERE gamx_total IS NULL
    AND total IS NOT NULL
    AND body_weight_kg IS NOT NULL
    AND (
        updated_at IS NULL
        OR updated_at < (NOW() - INTERVAL '1 hour')
    )
LIMIT 5;
-- 2. Test updating one of them (Force timestamp update)
-- Replace [RESULT_ID] with one found above if you run interactively, 
-- but here we'll just pick one dynamically.
WITH victim AS (
    SELECT result_id
    FROM usaw_meet_results
    WHERE gamx_total IS NULL
        AND total IS NOT NULL
        AND body_weight_kg IS NOT NULL
    LIMIT 1
)
UPDATE usaw_meet_results
SET updated_at = NOW()
WHERE result_id = (
        SELECT result_id
        FROM victim
    )
RETURNING result_id,
    updated_at;
ROLLBACK;
-- Rollback so we don't mess up state, just checking if it works.