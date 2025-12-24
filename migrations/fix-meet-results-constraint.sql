-- Migration: Fix meet results constraint to allow multiple results per athlete per meet
-- Date: 2025-12-24
-- Purpose: Allow same athlete to compete in different weight classes in same meet
-- 
-- Problem: Current constraint (meet_id, lifter_id) prevents Molly Raines from having
-- two results in meet 3019 (48kg and +58kg weight classes)
--
-- Solution: Change constraint to (meet_id, lifter_id, weight_class)

-- ============================================================================
-- FORWARD MIGRATION
-- ============================================================================

BEGIN;

-- Step 1: Drop the existing constraint
ALTER TABLE usaw_meet_results 
DROP CONSTRAINT IF EXISTS meet_results_meet_id_lifter_id_key;

-- Step 2: Ensure weight_class is never null (required for new constraint)
-- First, check if there are any null weight_class values
DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count 
    FROM usaw_meet_results 
    WHERE weight_class IS NULL OR weight_class = '';
    
    IF null_count > 0 THEN
        RAISE NOTICE 'Found % records with null/empty weight_class', null_count;
        -- Update null/empty weight_class to 'Unknown' to maintain constraint integrity
        UPDATE usaw_meet_results 
        SET weight_class = 'Unknown' 
        WHERE weight_class IS NULL OR weight_class = '';
        RAISE NOTICE 'Updated % records to have weight_class = ''Unknown''', null_count;
    ELSE
        RAISE NOTICE 'All records have valid weight_class values';
    END IF;
END $$;

-- Step 3: Add NOT NULL constraint to weight_class if it doesn't exist
ALTER TABLE usaw_meet_results 
ALTER COLUMN weight_class SET NOT NULL;

-- Step 4: Create new unique constraint including weight_class
ALTER TABLE usaw_meet_results 
ADD CONSTRAINT meet_results_meet_id_lifter_id_weight_class_key 
UNIQUE (meet_id, lifter_id, weight_class);

-- Step 5: Verify the constraint was created successfully
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'meet_results_meet_id_lifter_id_weight_class_key'
        AND table_name = 'usaw_meet_results'
    ) THEN
        RAISE NOTICE 'SUCCESS: New constraint created successfully';
    ELSE
        RAISE EXCEPTION 'FAILED: New constraint was not created';
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

-- Check for any null weight_class values
SELECT COUNT(*) as null_weight_class_count
FROM usaw_meet_results 
WHERE weight_class IS NULL OR weight_class = '';

-- Test the new constraint allows multiple results for same athlete
-- (This should work after migration)
SELECT 
    meet_id,
    lifter_id,
    lifter_name,
    weight_class,
    body_weight_kg,
    total
FROM usaw_meet_results 
WHERE lifter_name = 'Molly Raines' 
AND meet_id = 3019
ORDER BY weight_class;