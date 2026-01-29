-- Migration: Fix Factor Table Precision
-- Purpose: Round bodyweight values to 1 decimal place to fix floating point artifacts (e.g. 188.70000002 -> 188.7)
-- ensuring they match the rounded inputs from get_gamx_score.
BEGIN;
-- 1. U Factors
UPDATE gamx_u_factors
SET bodyweight = ROUND(bodyweight, 1);
-- 2. A Factors
UPDATE gamx_a_factors
SET bodyweight = ROUND(bodyweight, 1);
-- 3. Masters Factors
UPDATE gamx_masters_factors
SET bodyweight = ROUND(bodyweight, 1);
-- 4. Total Factors
UPDATE gamx_points_factors
SET bodyweight = ROUND(bodyweight, 1);
-- 5. Snatch Factors
UPDATE gamx_s_factors
SET bodyweight = ROUND(bodyweight, 1);
-- 6. CJ Factors
UPDATE gamx_j_factors
SET bodyweight = ROUND(bodyweight, 1);
COMMIT;