-- Rollback Migration: Restore original meet results constraint
-- Date: 2025-12-24
-- Purpose: Rollback the constraint change if needed
-- 
-- WARNING: This rollback will fail if there are multiple results for the same
-- (meet_id, lifter_id) combination. You must resolve duplicates first.

-- ============================================================================
-- ROLLBACK MIGRATION
-- ============================================================================

BEGIN;

-- Step 1: Check for potential conflicts before rollback
DO $$
DECLARE
    conflict_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conflict_count
    FROM (
        SELECT meet_id, lifter_id, COUNT(*) as result_count
        FROM usaw_meet_results
        GROUP BY meet_id, lifter_id
        HAVING COUNT(*) > 1
    ) conflicts;
    
    IF conflict_count > 0 THEN
        RAISE EXCEPTION 'ROLLBACK BLOCKED: Found % athlete(s) with multiple results in same meet. Cannot restore original constraint without data loss.', conflict_count;
    ELSE
        RAISE NOTICE 'No conflicts found. Safe to proceed with rollback.';
    END IF;
END $$;

-- Step 2: Drop the new constraint
ALTER TABLE usaw_meet_results 
DROP CONSTRAINT IF EXISTS meet_results_meet_id_lifter_id_weight_class_key;

-- Step 3: Restore the original constraint
ALTER TABLE usaw_meet_results 
ADD CONSTRAINT meet_results_meet_id_lifter_id_key 
UNIQUE (meet_id, lifter_id);

-- Step 4: Remove NOT NULL constraint from weight_class (optional)
-- ALTER TABLE usaw_meet_results 
-- ALTER COLUMN weight_class DROP NOT NULL;

-- Step 5: Verify rollback was successful
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'meet_results_meet_id_lifter_id_key'
        AND table_name = 'usaw_meet_results'
    ) THEN
        RAISE NOTICE 'SUCCESS: Original constraint restored successfully';
    ELSE
        RAISE EXCEPTION 'FAILED: Original constraint was not restored';
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check constraint exists
SELECT 
    constraint_name,
    constraint_type,
    table_name
FROM information_schema.table_constraints 
WHERE table_name = 'usaw_meet_results' 
AND constraint_type = 'UNIQUE';

-- Show any athletes that would have conflicts
SELECT 
    meet_id,
    lifter_id,
    lifter_name,
    COUNT(*) as result_count,
    STRING_AGG(weight_class, ', ') as weight_classes
FROM usaw_meet_results
GROUP BY meet_id, lifter_id, lifter_name
HAVING COUNT(*) > 1
ORDER BY meet_id, lifter_id;