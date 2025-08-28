-- INVESTIGATE ATHLETE 116344 CONTAMINATION ISSUE
-- This SQL will help us understand the contamination problem

-- 1. Check the lifters table for athlete 116344
SELECT 
    lifter_id,
    athlete_name,
    membership_number,
    internal_id,
    internal_id_2,
    internal_id_3,
    internal_id_4,
    internal_id_5,
    gender,
    birth_year,
    club_name,
    wso
FROM lifters 
WHERE lifter_id = 116344;

-- 2. Check if there are other lifter_ids with the same name
SELECT 
    lifter_id,
    athlete_name,
    membership_number,
    internal_id,
    internal_id_2,
    internal_id_3,
    internal_id_4,
    internal_id_5,
    birth_year,
    club_name
FROM lifters 
WHERE athlete_name = (SELECT athlete_name FROM lifters WHERE lifter_id = 116344)
ORDER BY lifter_id;

-- 3. Check all meet results assigned to lifter_id 116344
SELECT 
    result_id,
    meet_name,
    date,
    lifter_name,
    age_category,
    weight_class,
    body_weight_kg,
    best_snatch,
    best_cj,
    total,
    club_name,
    wso
FROM meet_results 
WHERE lifter_id = 116344
ORDER BY date DESC;

-- 4. Count results by lifter_name within this lifter_id
SELECT 
    lifter_name,
    COUNT(*) as result_count,
    MIN(date) as earliest_meet,
    MAX(date) as latest_meet,
    STRING_AGG(DISTINCT club_name, ', ') as clubs,
    STRING_AGG(DISTINCT wso, ', ') as wsos
FROM meet_results 
WHERE lifter_id = 116344
GROUP BY lifter_name
ORDER BY result_count DESC;

-- 5. Show different athletes mixed under this lifter_id (by membership number in results)
SELECT DISTINCT
    lifter_name,
    club_name,
    wso,
    COUNT(*) as meet_count
FROM meet_results 
WHERE lifter_id = 116344
GROUP BY lifter_name, club_name, wso
ORDER BY meet_count DESC;