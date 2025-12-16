-- ============================================================================
-- STEP 2 FINAL: Subtract 0.1 kg back (using verified timestamp range)
-- ============================================================================
-- STEP 1 executed between: 
--   Start:  2025-12-14 18:24:13.319124
--   End:    2025-12-14 18:24:46.817163
-- 
-- This targets ONLY records modified during that window
-- ============================================================================

-- Youth (10-20)
UPDATE usaw_meet_results
SET 
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) - 0.1)::TEXT
WHERE 
    updated_at >= '2025-12-14 18:24:13.319124'
    AND competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---';

-- Seniors (21-30)
UPDATE usaw_meet_results
SET 
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) - 0.1)::TEXT
WHERE 
    updated_at >= '2025-12-14 18:24:13.319124'
    AND competition_age >= 21 
    AND competition_age <= 30
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---';

-- Masters Men (31-75)
UPDATE usaw_meet_results
SET 
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) - 0.1)::TEXT
WHERE 
    updated_at >= '2025-12-14 18:24:13.319124'
    AND gender = 'M'
    AND competition_age >= 31 
    AND competition_age <= 75
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---';

-- Masters Women (31-109)
UPDATE usaw_meet_results
SET 
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) - 0.1)::TEXT
WHERE 
    updated_at >= '2025-12-14 18:24:13.319124'
    AND gender = 'F'
    AND competition_age >= 31 
    AND competition_age <= 109
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT COUNT(*) as remaining_misplaced_usaw
FROM usaw_meet_results
WHERE 
    competition_age IS NOT NULL
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND (qpoints IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (competition_age >= 21 AND competition_age <= 30 AND (q_youth IS NOT NULL OR q_masters IS NOT NULL))
        OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
        OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND (qpoints IS NOT NULL OR q_youth IS NOT NULL))
    );
