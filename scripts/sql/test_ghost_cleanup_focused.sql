/*
    TEST SCRIPT: Safely Delete "Ghost" Duplicates for a Specific Athlete
    Target: Alexandra Harp
*/

-- 1. SHOW CURRENT STATE (Highlight and Run this Part)
-- --- BEFORE CLEANUP ---
SELECT 
    l.lifter_id, 
    l.athlete_name, 
    l.membership_number, 
    l.internal_id,
    COUNT(r.result_id) as result_count
FROM usaw_lifters l
LEFT JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id
WHERE l.athlete_name = 'Alexandra Harp'
GROUP BY l.lifter_id, l.athlete_name, l.membership_number, l.internal_id;

-- 1b. DEBUG: VERIFY GHOST LOGIC (Highlight and Run this Part)
-- Does the logic actually find the duplicates?
SELECT l.lifter_id, l.athlete_name, 'Would be deleted' as status
FROM usaw_lifters l
LEFT JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id
WHERE l.athlete_name = 'Alexandra Harp'
AND r.result_id IS NULL
AND EXISTS (
    SELECT 1 
    FROM usaw_lifters active_l
    JOIN usaw_meet_results active_r ON active_l.lifter_id = active_r.lifter_id
    WHERE active_l.athlete_name = l.athlete_name 
    AND active_l.lifter_id != l.lifter_id
    -- SAFETY: Only delete if the Ghost has NO unique metadata 
    -- (Membership # AND Internal ID must be NULL or match Active)
    AND (
        l.membership_number IS NULL 
        OR (active_l.membership_number IS NOT NULL AND active_l.membership_number = l.membership_number)
    )
    AND (
        l.internal_id IS NULL 
        OR (active_l.internal_id IS NOT NULL AND active_l.internal_id = l.internal_id)
    )
);

-- 2. DELETE GHOSTS (Highlight and Run this Part)
-- Note: This is a standard DELETE statement. It will return the number of rows deleted.

DELETE FROM usaw_lifters
WHERE lifter_id IN (
    SELECT l.lifter_id
    FROM usaw_lifters l
    LEFT JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id
    WHERE l.athlete_name = 'Alexandra Harp' -- Safety: Only target this athlete
    AND r.result_id IS NULL                 -- Safety: MUST have 0 results
    AND EXISTS (
        -- Context: Ensure there is ANOTHER "Active" lifter with the same name who HAS results
        -- AND is not "less complete" than the ghost
        SELECT 1 
        FROM usaw_lifters active_l
        JOIN usaw_meet_results active_r ON active_l.lifter_id = active_r.lifter_id
        WHERE active_l.athlete_name = l.athlete_name 
        AND active_l.lifter_id != l.lifter_id
        -- SAFETY: Only delete if the Ghost has NO unique metadata 
        -- (Membership # AND Internal ID must be NULL or match Active)
        AND (
            l.membership_number IS NULL 
            OR (active_l.membership_number IS NOT NULL AND active_l.membership_number = l.membership_number)
        )
        AND (
            l.internal_id IS NULL 
            OR (active_l.internal_id IS NOT NULL AND active_l.internal_id = l.internal_id)
        )
    )
);

-- (If your client requires explicit commit: run 'COMMIT;' afterwards, but usually this auto-commits in simple windows)

-- 3. SHOW FINAL STATE (Highlight and Run this Part)
-- --- AFTER CLEANUP ---
/*
SELECT 
    l.lifter_id, 
    l.athlete_name, 
    l.membership_number, 
    COUNT(r.result_id) as result_count
FROM usaw_lifters l
LEFT JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id
WHERE l.athlete_name = 'Alexandra Harp'
GROUP BY l.lifter_id, l.athlete_name, l.membership_number;
*/

-- 4. DECISION
-- ROLLBACK; -- Revert changes
COMMIT; -- Apply changes

