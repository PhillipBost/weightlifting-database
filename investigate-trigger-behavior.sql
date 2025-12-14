-- ============================================================================
-- Investigate Trigger Function Behavior
-- ============================================================================
-- The UPDATE is happening but trigger isn't recalculating - let's see why
-- ============================================================================

-- ============================================================================
-- Get the full trigger function definition
-- ============================================================================

SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'update_qpoints_on_change';

-- ============================================================================
-- Check if there's a manual_override or calculation_override column
-- ============================================================================

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'usaw_meet_results'
AND column_name LIKE '%override%'
OR column_name LIKE '%manual%'
OR column_name LIKE '%lock%'
OR column_name LIKE '%recalc%';

-- ============================================================================
-- Check all columns in usaw_meet_results
-- ============================================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'usaw_meet_results'
ORDER BY ordinal_position;

-- ============================================================================
-- Check a sample of rows that "should" have been updated
-- ============================================================================
-- Look at records that are still misplaced after the UPDATE

SELECT 
    result_id,
    lifter_name,
    competition_age,
    gender,
    total,
    qpoints,
    q_youth,
    q_masters,
    updated_at,
    created_at
FROM usaw_meet_results
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL)
    AND total IS NOT NULL
    AND total != '---'
ORDER BY updated_at DESC
LIMIT 10;

-- ============================================================================
-- Get the handle_manual_override trigger function
-- ============================================================================

SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'handle_manual_override';

-- ============================================================================
-- Check for any flags/columns that might prevent recalculation
-- ============================================================================

SELECT 
    'usaw_meet_results' as table_name,
    COUNT(*) as total_rows
FROM usaw_meet_results
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- ============================================================================
-- Try checking if there's a disable trigger flag or similar
-- ============================================================================

SELECT setting, short_desc
FROM pg_settings
WHERE name LIKE '%trigger%'
OR name LIKE '%constraint%';
