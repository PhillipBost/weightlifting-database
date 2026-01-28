/*
 DUPLICATE LIFTER ANALYSIS AND CLEANUP SCRIPT
 
 Purpose:
 1. Identify "True Duplicate" lifters (same name, multiple IDs) and characterize them.
 2. Determine if results are "Split" (distinct results on each ID) or "Duplicated" (same result on both IDs).
 3. Provide a SAFE mechanism to merge/delete duplicates.
 
 WARNING: 
 - The CLEANUP sections utilize transactions (BEGIN/ROLLBACK). 
 - Only change ROLLBACK to COMMIT when you are absolutely sure.
 - Always backup your database before running DELETE/UPDATE operations.
 */
-- 1.1b List "Safely Deletable Simple Ghosts"
-- This filters for cases where:
-- 1. There is EXACTLY ONE "Active" lifter (>0 results).
-- 2. The "Ghost" lifter (0 results) has NO unique metadata (Safe to delete).
--    (i.e., Ghost has no membership # OR it matches the Active lifter's #).
WITH AthleteStats AS (
    SELECT l.athlete_name,
        -- Identify the "Active" lifter's membership number AND internal_id for comparison
        MAX(
            CASE
                WHEN r.result_id IS NOT NULL THEN l.membership_number
            END
        ) as active_membership_num,
        MAX(
            CASE
                WHEN r.result_id IS NOT NULL THEN l.internal_id
            END
        ) as active_internal_id,
        COUNT(
            DISTINCT CASE
                WHEN r.result_id IS NOT NULL THEN l.lifter_id
            END
        ) as active_lifters_count,
        COUNT(
            DISTINCT CASE
                WHEN r.result_id IS NULL THEN l.lifter_id
            END
        ) as ghost_lifters_count
    FROM usaw_lifters l
        LEFT JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id
    GROUP BY l.athlete_name
),
PotentialSafeList AS (
    SELECT l.athlete_name,
        l.lifter_id,
        l.membership_number,
        l.internal_id,
        STRING_AGG(DISTINCT r.meet_id::text, ', ') as lifter_meet_ids,
        -- Calculated per lifter
        -- Added to SELECT list
        COUNT(r.result_id) as result_count,
        CASE
            WHEN COUNT(r.result_id) > 0 THEN 'Active'
            ELSE 'Ghost'
        END as type
    FROM usaw_lifters l
        JOIN AthleteStats s ON l.athlete_name = s.athlete_name
        LEFT JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id
    WHERE s.ghost_lifters_count > 0
    GROUP BY l.athlete_name,
        l.lifter_id,
        l.membership_number,
        l.internal_id,
        s.active_membership_num,
        s.active_internal_id,
        s.active_lifters_count,
        s.ghost_lifters_count
    HAVING COUNT(r.result_id) > 0 -- Include Active for context
        OR (
            -- Safe Ghost Logic: 
            -- CASE A: Single Active Lifter (Standard)
            (s.active_lifters_count = 1)
            OR -- CASE B: Multiple Active Lifters, but Ghost matches ONE of them specifically via Metadata
            (
                l.membership_number IS NOT NULL
                AND l.membership_number = s.active_membership_num
            )
            OR (
                l.internal_id IS NOT NULL
                AND l.internal_id = s.active_internal_id
            )
        )
)
SELECT *,
    lifter_meet_ids
FROM PotentialSafeList
WHERE athlete_name IN (
        SELECT athlete_name
        FROM PotentialSafeList
        GROUP BY athlete_name
        HAVING COUNT(*) > 1 -- Must have at least 1 Active + 1 Safe Ghost
    )
ORDER BY athlete_name,
    result_count DESC;
-- 1.2 Check for "Collision" (Duplicate Data)
-- Do these duplicates share the EXACT same meet result?
-- If this returns rows, you have "Double Content" (Type A).
-- If this returns empty, but 1.1 shows multiple IDs with results, they have "Split Content" (Type B).
WITH TrueDuplicateNames AS (
    SELECT athlete_name
    FROM usaw_lifters
    GROUP BY athlete_name
    HAVING COUNT(DISTINCT lifter_id) > COUNT(DISTINCT membership_number)
        AND COUNT(DISTINCT lifter_id) > 1
)
SELECT l.athlete_name,
    r.meet_id,
    -- Added meet_id
    r.meet_name,
    r.date,
    r.total,
    COUNT(DISTINCT r.lifter_id) as ids_with_this_result,
    STRING_AGG(DISTINCT r.lifter_id::text, ', ') as lifter_ids_involved
FROM usaw_meet_results r
    JOIN usaw_lifters l ON r.lifter_id = l.lifter_id
WHERE l.athlete_name IN (
        SELECT athlete_name
        FROM TrueDuplicateNames
    )
GROUP BY l.athlete_name,
    r.meet_id,
    r.meet_name,
    r.date,
    r.total
HAVING COUNT(DISTINCT r.lifter_id) > 1
ORDER BY l.athlete_name;
-- =====================================================================================
-- SECTION 2: CHECK CONSTRAINTS
-- =====================================================================================
-- 2.1 Check if we can casually delete
-- If this returns NO ACTION or RESTRICT, a simple DELETE FROM usaw_lifters WILL FAIL
-- if they have associated results.
SELECT tc.table_name,
    kcu.column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints AS rc ON rc.constraint_name = tc.constraint_name
WHERE tc.table_name = 'usaw_meet_results'
    AND kcu.column_name = 'lifter_id';
-- =====================================================================================
-- SECTION 3: SAFE CLEANUP - "MERGE & PURGE"
-- =====================================================================================
/*
 STRATEGY:
 1. Pick a "Master" ID (e.g., the one with the most results, or existing membership #).
 2. Pick a "Target" ID to remove.
 3. DELETE EXACT DUPLICATE results from Target (where Meet+Date matches Master).
 4. MOVE UNIQUE results from Target to Master.
 5. DELETE Target Lifter.
 */
-- EXAMPLE: Automating the Cleanup for one athlete
-- Replace 'Andrew Smith' and IDs with actual values found in Analysis 1.1
-- Master ID: 198720 (Example: Has membership #)
-- Target ID: 198721 (Example: No membership #, duplicate results)
BEGIN;
-- Start Transaction (Safety Net)
DO $$
DECLARE v_master_id bigint := 198720;
-- REPLACE THIS
v_target_id bigint := 198721;
-- REPLACE THIS
v_rows_moved int;
v_rows_deleted int;
BEGIN RAISE NOTICE 'Merging Lifter % into %',
v_target_id,
v_master_id;
-- STEP A: Delete Duplicate Results (Collision)
-- If Target has a result for a meet that Master ALSO has, delete the Target's copy.
DELETE FROM usaw_meet_results target_r
WHERE target_r.lifter_id = v_target_id
    AND EXISTS (
        SELECT 1
        FROM usaw_meet_results master_r
        WHERE master_r.lifter_id = v_master_id
            AND master_r.meet_name = target_r.meet_name
            AND master_r.date = target_r.date
    );
GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
RAISE NOTICE 'Deleted % duplicate results from Target.',
v_rows_deleted;
-- STEP B: Move Unique Results
-- Any results remaining on Target are unique to them (e.g. from a different scrape batch).
-- Reassign them to Master.
UPDATE usaw_meet_results
SET lifter_id = v_master_id
WHERE lifter_id = v_target_id;
GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
RAISE NOTICE 'Moved % unique results from Target to Master.',
v_rows_moved;
-- STEP C: Delete the Target Lifter
DELETE FROM usaw_lifters
WHERE lifter_id = v_target_id;
RAISE NOTICE 'Deleted Target Lifter %.',
v_target_id;
END $$;
-- CHECK YOUR WORK
SELECT *
FROM usaw_lifters
WHERE lifter_id IN (198720, 198721);
-- Should show only Master
SELECT count(*)
FROM usaw_meet_results
WHERE lifter_id = 198720;
-- Should be Master + Moved
ROLLBACK;
-- Change to COMMIT when ready to apply
-- =====================================================================================
-- SECTION 4: SAFE CLEANUP - "GHOST DUPLICATES" (Zero Results)
-- =====================================================================================
/*
 This section safely deletes "Ghost" lifters:
 - Lifter has 0 associated results.
 - Lifter shares a name with another "Active" lifter (who HAS results).
 
 This handles the "Alexandra Harp" case: 1 active profile, 4 empty "ghost" profiles.
 */
-- 4.1 EXECUTE DELETION (Highlight and Run this Part)
-- STEP A: DEBUG PREVIEW - Check how many rows will be deleted
-- Highlight lines just below here to TEST first
/*
 /*
 SELECT 
 l.athlete_name,
 'TO_DELETE' as action,
 l.lifter_id as ghost_id,
 l.membership_number as ghost_mem_num,
 l.internal_id as ghost_internal_id,
 '>> MATCHES >>' as correlation,
 active.lifter_id as keep_active_id,
 active.membership_number as keep_active_mem_num,
 active.internal_id as keep_active_internal_id,
 active.result_count as active_result_count
 FROM usaw_lifters l
 LEFT JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id,
 LATERAL (
 SELECT 
 active_l.lifter_id, 
 active_l.membership_number, 
 active_l.internal_id,
 COUNT(active_r.result_id) as result_count
 FROM usaw_lifters active_l
 JOIN usaw_meet_results active_r ON active_l.lifter_id = active_r.lifter_id
 WHERE active_l.athlete_name = l.athlete_name 
 AND active_l.lifter_id != l.lifter_id
 AND (
 l.membership_number IS NULL 
 OR (active_l.membership_number IS NOT NULL AND active_l.membership_number = l.membership_number)
 )
 AND (
 l.internal_id IS NULL 
 OR (active_l.internal_id IS NOT NULL AND active_l.internal_id = l.internal_id)
 )
 GROUP BY active_l.lifter_id, active_l.membership_number, active_l.internal_id
 LIMIT 1 -- Pick the best matching active lifter to show as the 'reason'
 ) active
 WHERE r.result_id IS NULL
 ORDER BY l.athlete_name ASC; 
 */
* / -- STEP B: EXECUTE DELETE
DELETE FROM usaw_lifters
WHERE lifter_id IN (
        SELECT l.lifter_id
        FROM usaw_lifters l
            LEFT JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id
        WHERE r.result_id IS NULL
            AND EXISTS (
                SELECT 1
                FROM usaw_lifters active_l
                    JOIN usaw_meet_results active_r ON active_l.lifter_id = active_r.lifter_id
                WHERE active_l.athlete_name = l.athlete_name
                    AND active_l.lifter_id != l.lifter_id -- SAFETY CHECKS
                    AND (
                        l.membership_number IS NULL
                        OR (
                            active_l.membership_number IS NOT NULL
                            AND active_l.membership_number = l.membership_number
                        )
                    )
                    AND (
                        l.internal_id IS NULL
                        OR (
                            active_l.internal_id IS NOT NULL
                            AND active_l.internal_id = l.internal_id
                        )
                    )
            )
    );
-- Force commit (if your client requires it)
COMMIT;
-- VERIFICATION:
-- Run Section 1.1 again to ensure only valid lifters remain.
COMMIT;
-- Change to ROLLBACK for a dry-run