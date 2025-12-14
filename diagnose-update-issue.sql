-- ============================================================================
-- Diagnostic Queries for UPDATE Issue
-- ============================================================================
-- Purpose: Understand why the UPDATE statements aren't working
-- Date: 2025-12-14
-- ============================================================================

-- ============================================================================
-- DIAGNOSTIC 1: Check if triggers are enabled
-- ============================================================================

SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement,
    action_timing,
    action_orientation
FROM information_schema.triggers
WHERE event_object_table IN ('usaw_meet_results', 'iwf_meet_results')
ORDER BY event_object_table, trigger_name;

-- ============================================================================
-- DIAGNOSTIC 2: Test if a simple UPDATE works (on 1 row)
-- ============================================================================
-- This just tests if we can update at all

SELECT 
    result_id,
    lifter_name,
    competition_age,
    qpoints,
    q_youth,
    q_masters,
    updated_at
FROM usaw_meet_results
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL)
LIMIT 1;

-- After reviewing the above row, try updating just that one:
-- UPDATE usaw_meet_results
-- SET updated_at = NOW()
-- WHERE result_id = [INSERT_RESULT_ID_FROM_ABOVE];

-- ============================================================================
-- DIAGNOSTIC 3: Count how many rows SHOULD match Step 1 WHERE clause
-- ============================================================================

SELECT COUNT(*) as should_match_step1
FROM usaw_meet_results
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- ============================================================================
-- DIAGNOSTIC 4: Check current trigger behavior
-- ============================================================================
-- Get the trigger function to see what it expects

SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'update_qpoints_on_change';

-- ============================================================================
-- NEW APPROACH: Force trigger with actual value change
-- ============================================================================
-- Instead of total = total, we'll use a two-step approach:
-- 1. Add a tiny amount to total (0.0001)
-- 2. Subtract it back
-- This forces a real change that triggers can't ignore
--
-- OR we can use the updated_at field which we're already changing
-- ============================================================================

-- ============================================================================
-- REVISED FIX - Step 1: Youth (10-20)
-- ============================================================================
-- First, NULL the incorrect columns WITHOUT triggering recalculation

UPDATE usaw_meet_results
SET 
    qpoints = NULL,
    q_masters = NULL
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---'
    AND (qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- Then, force recalculation by updating a non-q-score field
UPDATE usaw_meet_results
SET 
    q_youth = NULL,  -- NULL this too
    updated_at = NOW()
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND gender IS NOT NULL
    AND total IS NOT NULL
    AND total != '---'
    AND body_weight_kg IS NOT NULL
    AND body_weight_kg != '---';

-- ============================================================================
-- ALTERNATIVE: Check if we need to disable/re-enable triggers
-- ============================================================================

-- Check trigger timing
SELECT tgname, tgtype, tgenabled 
FROM pg_trigger 
WHERE tgrelid = 'usaw_meet_results'::regclass;

-- tgenabled values:
-- 'O' = enabled
-- 'D' = disabled
-- 'R' = replica
-- 'A' = always

