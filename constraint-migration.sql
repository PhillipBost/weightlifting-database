-- Database Constraint Migration: Fix meet results constraint
-- Purpose: Allow same athlete to compete in different weight classes in same meet
-- Issue: Current constraint (meet_id, lifter_id) prevents Molly Raines case
-- Solution: Change constraint to (meet_id, lifter_id, weight_class)

BEGIN;

-- Step 1: Drop the existing constraint
ALTER TABLE usaw_meet_results 
DROP CONSTRAINT IF EXISTS meet_results_meet_id_lifter_id_key;

-- Step 2: Handle null weight_class values (ensure all records have valid weight_class)
UPDATE usaw_meet_results 
SET weight_class = 'Unknown' 
WHERE weight_class IS NULL OR weight_class = '';

-- Step 3: Add NOT NULL constraint to weight_class
ALTER TABLE usaw_meet_results 
ALTER COLUMN weight_class SET NOT NULL;

-- Step 4: Create new unique constraint including weight_class
ALTER TABLE usaw_meet_results 
ADD CONSTRAINT meet_results_meet_id_lifter_id_weight_class_key 
UNIQUE (meet_id, lifter_id, weight_class);

COMMIT;

-- Step 5: Verify the constraint was created successfully
SELECT 
    constraint_name,
    constraint_type,
    table_name
FROM information_schema.table_constraints 
WHERE table_name = 'usaw_meet_results' 
AND constraint_type = 'UNIQUE'
ORDER BY constraint_name;