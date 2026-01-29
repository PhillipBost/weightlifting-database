-- Diagnostic: Check Bodyweight Granularity
BEGIN;
SELECT bodyweight
FROM gamx_u_factors
WHERE gender = 'm'
    AND age = 20
ORDER BY bodyweight
LIMIT 20;
ROLLBACK;