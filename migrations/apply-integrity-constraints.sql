-- Migration: USAW Athlete Integrity & De-duplication
-- Purpose: Merges duplicate athletes sharing the same internal_id and applies a UNIQUE constraint.
BEGIN;

--------------------------------------------------------------------------------
-- 1. Identify and Merge Duplicates
--------------------------------------------------------------------------------
-- This CTE finds all lifters who share an internal_id.
-- We will keep the LOWEST lifter_id as the "Master Record".
WITH DuplicateGroups AS (
    SELECT 
        internal_id, 
        min(lifter_id) as master_id,
        array_agg(lifter_id) as all_ids
    FROM usaw_lifters
    WHERE internal_id IS NOT NULL
    GROUP BY internal_id
    HAVING count(*) > 1
),
DuplicatesToDelete AS (
    SELECT unnest(all_ids) as target_id, master_id
    FROM DuplicateGroups
)
-- Step A: Update meet results to point to the master record
UPDATE usaw_meet_results mr
SET lifter_id = dt.master_id
FROM DuplicatesToDelete dt
WHERE mr.lifter_id = dt.target_id
  AND dt.target_id != dt.master_id;

-- Step B: Delete the redundant lifter records
DELETE FROM usaw_lifters
WHERE lifter_id IN (
    SELECT target_id 
    FROM DuplicatesToDelete 
    WHERE target_id != master_id
);

--------------------------------------------------------------------------------
-- 2. Apply Unique Constraint
--------------------------------------------------------------------------------
-- Now that duplicates are purged, we can safely lock down the column.
ALTER TABLE usaw_lifters 
ADD CONSTRAINT unique_lifter_internal_id UNIQUE (internal_id);

COMMIT;
