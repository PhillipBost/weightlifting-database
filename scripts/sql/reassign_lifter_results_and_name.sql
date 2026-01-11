--1. Compare the colliding results (Optional)
SELECT result_id,
    lifter_id,
    meet_id,
    total,
    best_snatch,
    best_cj
FROM usaw_meet_results
WHERE lifter_id IN (14437, 64360)
    AND meet_id IN (451, 3793)
ORDER BY meet_id,
    lifter_id;
--2. Resolve Conflicts
--Option A (Recommended): Keep the Target (64360), Delete the Source (14437) Run this if you trust the data in 64360 or if the data is identical.
DELETE FROM usaw_meet_results
WHERE lifter_id = 14437
    AND meet_id IN (451, 3793);
--Option B: Keep the Source (14437), Delete the Target (64360) Run this ONLY if 14437 has better data for these meets.
DELETE FROM usaw_meet_results
WHERE lifter_id = 64360
    AND meet_id IN (451, 3793);
--3. Reassign and Update Details
--Once the collisions are gone (step 2), run this to finish the job.
BEGIN;
-- 1. Reassign remaining results from 14437 to 64360
UPDATE usaw_meet_results
SET lifter_id = 64360
WHERE lifter_id = 14437;
-- 2. Update the name on ALL results for 64360
UPDATE usaw_meet_results
SET lifter_name = 'Johanna Griffith'
WHERE lifter_id = 64360;
-- 3. Update the lifter profile
UPDATE usaw_lifters
SET athlete_name = 'Johanna Griffith'
WHERE lifter_id = 64360;
COMMIT;
--4. Delete the "Ghost" Lifter
DELETE FROM usaw_lifters
WHERE lifter_id = 14437;