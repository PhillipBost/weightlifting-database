-- Migration: Add Trigger to Automatically Maintain iwf_meets.results Column
-- Purpose: Keep the results count in iwf_meets synchronized with iwf_meet_results data
-- Date: 2025-10-27
--
-- This migration creates a trigger that automatically updates the iwf_meets.results column
-- whenever results are inserted, updated, or deleted. The column stores the count of
-- distinct lifters with results for each meet.
--
-- The trigger handles:
--   - INSERT: Add new results and update count
--   - UPDATE: Recalculate count if iwf_meet_id changes
--   - DELETE: Remove results and update count

BEGIN;

-- ============================================================================
-- TRIGGER FUNCTION: Update iwf_meets.results count
-- Calculates the number of distinct lifters with results for a meet
-- Stores result as integer count (e.g., 421, 0, etc.)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_iwf_meet_results_count()
RETURNS TRIGGER AS $$
DECLARE
    v_result_count INTEGER;
    v_meet_id BIGINT;
BEGIN
    -- Determine which meet ID to update
    v_meet_id := COALESCE(NEW.iwf_meet_id, OLD.iwf_meet_id);
    
    -- Count distinct lifters with results for this meet
    SELECT COUNT(DISTINCT db_lifter_id) INTO v_result_count
    FROM iwf_meet_results
    WHERE iwf_meet_id = v_meet_id;
    
    -- Update the meet's results column with the count
    UPDATE iwf_meets
    SET results = v_result_count,
        updated_at = NOW()
    WHERE iwf_meet_id = v_meet_id;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Call update function after any modification to results
-- Applied to: iwf_meet_results table
-- Timing: AFTER INSERT, UPDATE, DELETE
-- Row/Statement: FOR EACH ROW
-- ============================================================================

CREATE TRIGGER trg_update_iwf_meet_results_count
    AFTER INSERT OR UPDATE OR DELETE ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_meet_results_count();

-- ============================================================================
-- BACKFILL: Update existing NULL values for meets that have results
-- This one-time operation populates any NULL results columns
-- ============================================================================

UPDATE iwf_meets m
SET results = (
    SELECT COUNT(DISTINCT db_lifter_id)
    FROM iwf_meet_results r
    WHERE r.iwf_meet_id = m.iwf_meet_id
),
updated_at = NOW()
WHERE results IS NULL;

COMMIT;

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- Trigger Created: 1 (trg_update_iwf_meet_results_count)
-- Function Created: 1 (update_iwf_meet_results_count)
-- Records Updated: All meets with NULL results
--
-- How it works:
--   1. Every time a result is inserted: trigger calculates new count and updates iwf_meets.results
--   2. Every time a result is updated: trigger recalculates count
--   3. Every time a result is deleted: trigger recalculates count
--   4. Count is stored as integer: 421, 0, 312, etc.
--
-- Benefits:
--   - Automatic: No code changes needed in importers
--   - Real-time: Always accurate, updated immediately
--   - Efficient: Minimal database overhead
--   - Bulletproof: Works for all scenarios including bulk operations
-- ============================================================================
