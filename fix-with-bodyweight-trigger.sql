-- ============================================================================
-- WORKING FIX: Change body_weight_kg to trigger recalculation
-- ============================================================================
-- The trigger checks if input columns changed. We'll add 0.1 kg temporarily,
-- which forces the trigger to recalculate. Then subtract it back.
-- ============================================================================

-- ============================================================================
-- STEP 1: NULL q-scores and add 0.1 kg to trigger calculation
-- ============================================================================

-- Youth (10-20)
UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_masters = NULL,
    q_youth = NULL,
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) + 0.1)::TEXT
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- Seniors (21-30)
UPDATE usaw_meet_results
SET 
    q_youth = NULL,
    q_masters = NULL,
    qpoints = NULL,
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) + 0.1)::TEXT
WHERE 
    competition_age >= 21 
    AND competition_age <= 30
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (q_youth IS NOT NULL OR q_masters IS NOT NULL);

-- Masters Men (31-75)
UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) + 0.1)::TEXT
WHERE 
    gender = 'M'
    AND competition_age >= 31 
    AND competition_age <= 75
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

-- Masters Women (31-109)
UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_youth = NULL,
    q_masters = NULL,
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) + 0.1)::TEXT
WHERE 
    gender = 'F'
    AND competition_age >= 31 
    AND competition_age <= 109
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_youth IS NOT NULL);

-- ============================================================================
-- STEP 2: Subtract 0.1 kg back (ONLY from records updated by STEP 1)
-- ============================================================================
-- Uses timestamp to identify EXACTLY which records STEP 1 modified
-- STEP 1 ran at: 2025-12-14 18:24:46.817163
-- This ensures we only affect records that were actually touched by STEP 1
-- ============================================================================

-- Youth (10-20) - only those modified by STEP 1 (timestamp check)
UPDATE usaw_meet_results
SET 
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) - 0.1)::TEXT
WHERE 
    updated_at >= '2025-12-14 18:24:46.817163'
    AND competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---';

-- Seniors (21-30) - only those modified by STEP 1 (timestamp check)
UPDATE usaw_meet_results
SET 
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) - 0.1)::TEXT
WHERE 
    updated_at >= '2025-12-14 18:24:46.817163'
    AND competition_age >= 21 
    AND competition_age <= 30
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---';

-- Masters Men (31-75) - only those modified by STEP 1 (timestamp check)
UPDATE usaw_meet_results
SET 
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) - 0.1)::TEXT
WHERE 
    updated_at >= '2025-12-14 18:24:46.817163'
    AND gender = 'M'
    AND competition_age >= 31 
    AND competition_age <= 75
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---';

-- Masters Women (31-109) - only those modified by STEP 1 (timestamp check)
UPDATE usaw_meet_results
SET 
    body_weight_kg = (CAST(body_weight_kg AS NUMERIC) - 0.1)::TEXT
WHERE 
    updated_at >= '2025-12-14 18:24:46.817163'
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

-- Check sample of fixed records
SELECT 
    result_id,
    lifter_name,
    competition_age,
    gender,
    total,
    body_weight_kg,
    qpoints,
    q_youth,
    q_masters
FROM usaw_meet_results
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND total IS NOT NULL
    AND total != '---'
ORDER BY result_id DESC
LIMIT 10;
