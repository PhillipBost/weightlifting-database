-- Diagnostic: Check Factor Table Coverage for Failing Lookups
BEGIN;
-- 1. Check Albert Dunlap (Age 80, BW 93.8, Total 76, Gender M)
-- Expecting match in gamx_masters_factors
SELECT 'Checking Masters (Age 80, BW 93.8)' as test_case,
    *
FROM gamx_masters_factors
WHERE gender = 'm'
    AND age = 80
    AND bodyweight BETWEEN 93.0 AND 94.0;
-- 2. Check Bleu Williams (Age 7, BW 19.81->19.8, Gender M)
-- Expecting match in gamx_u_factors
SELECT 'Checking Youth (Age 7, BW 19.8)' as test_case,
    *
FROM gamx_u_factors
WHERE gender = 'm'
    AND age = 7
    AND bodyweight BETWEEN 19.0 AND 21.0;
-- 3. Check Bodyweight Range for Masters Age 52 (Heather Kesler, 102.8kg)
SELECT 'Checking Masters Ranges (Age 52)' as test_case,
    min(bodyweight) as min_bw,
    max(bodyweight) as max_bw
FROM gamx_masters_factors
WHERE gender = 'f'
    AND age = 52;
ROLLBACK;