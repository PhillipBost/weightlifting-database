-- 1. IDENTIFY TOP PROBLEMATIC NAMES
-- Find athlete names associated with the most distinct lifter_ids.
-- These are names like "John Smith" where multiple people are likely being confused.
SELECT 
    athlete_name, 
    COUNT(DISTINCT lifter_id) as lifter_count,
    COUNT(DISTINCT membership_number) as distinct_memberships,
    STRING_AGG(DISTINCT membership_number::text, ', ') as membership_numbers
FROM 
    usaw_lifters
GROUP BY 
    athlete_name
HAVING 
    COUNT(DISTINCT lifter_id) > 1
ORDER BY 
    lifter_count DESC
LIMIT 50;

-- 1b. IDENTIFY "TRUE DUPLICATES" (ID Count > Membership Count)
-- This query helps differentiate "Type 1" (Multiple IDs, One Person) from "Type 2" (Different People, Same Name).
-- If (Lifter Count > Distinct Memberships) and Distinct Memberships is relatively low, 
-- it's highly likely that one person has multiple lifter_ids.
SELECT 
    athlete_name, 
    COUNT(DISTINCT lifter_id) as lifter_count,
    COUNT(DISTINCT membership_number) as distinct_memberships,
    STRING_AGG(DISTINCT lifter_id::text, ', ') as lifter_ids,
    STRING_AGG(DISTINCT membership_number::text, ', ') as membership_numbers
FROM 
    usaw_lifters
GROUP BY 
    athlete_name
HAVING 
    COUNT(DISTINCT lifter_id) > COUNT(DISTINCT membership_number) 
    AND COUNT(DISTINCT lifter_id) > 1
ORDER BY 
    lifter_count DESC
LIMIT 50;

LIMIT 50;

-- 2. IDENTIFY LIFTERS WITH IMPOSSIBLE CAREER SPANS
-- Find lifters with results spanning more than 40 years, suggesting two generations merged.
-- Fixed: Cast string dates to DATE type for AGE function
SELECT 
    l.lifter_id,
    l.athlete_name,
    MIN(r.date) as first_meet,
    MAX(r.date) as last_meet,
    EXTRACT(YEAR FROM AGE(MAX(r.date)::DATE, MIN(r.date)::DATE)) as career_years,
    COUNT(r.result_id) as total_results
FROM 
    usaw_lifters l
JOIN 
    usaw_meet_results r ON l.lifter_id = r.lifter_id
GROUP BY 
    l.lifter_id, l.athlete_name
HAVING 
    EXTRACT(YEAR FROM AGE(MAX(r.date)::DATE, MIN(r.date)::DATE)) > 40
ORDER BY 
    career_years DESC;

-- 3. IDENTIFY "SUPER LIFTERS" (Suspicious Volume)
-- Lifters with an extraordinarily high number of meet results, likely due to merging.
SELECT 
    l.lifter_id,
    l.athlete_name,
    COUNT(r.result_id) as meet_count
FROM 
    usaw_lifters l
JOIN 
    usaw_meet_results r ON l.lifter_id = r.lifter_id
GROUP BY 
    l.lifter_id, l.athlete_name
ORDER BY 
    meet_count DESC
LIMIT 50;

LIMIT 50;

-- 4. IDENTIFY PHANTOM DUPLICATES (TIMESTAMP ANALYSIS - ENHANCED)
-- Find results created in the specific batches identified in the root cause analysis (2025-10-29).
-- Enhanced to show which meets are involved in these batches.
SELECT 
    count(*) as phantom_count,
    date_trunc('minute', created_at) as creation_minute,
    -- Add distinct meet names to see WHAT was being duplicated
    STRING_AGG(DISTINCT meet_name, ', ' ORDER BY meet_name) as affected_meets
FROM 
    usaw_meet_results
WHERE 
    created_at::date = '2025-10-29'
GROUP BY 
    creation_minute
ORDER BY 
    phantom_count DESC;

-- 5. IDENTIFY DUPLICATE MEETS (SAME NAME/DATE, DIFFERENT ID)
-- This helps see which meets have the phantom versions.
SELECT 
    m1.meet_name,
    m1.date,
    COUNT(DISTINCT m1.meet_id) as distinct_meet_ids
FROM 
    usaw_meet_results m1
GROUP BY 
    m1.meet_name, m1.date
HAVING 
    COUNT(DISTINCT m1.meet_id) > 1
ORDER BY 
    distinct_meet_ids DESC
LIMIT 20;

-- 6. TEST DECONTAMINATION CANDIDATES
-- Check specific athletes you suspect might be fixed or need fixing
SELECT 
    l.lifter_id,
    l.athlete_name,
    l.membership_number,
    l.internal_id,
    (SELECT count(*) FROM usaw_meet_results r WHERE r.lifter_id = l.lifter_id) as result_count
FROM 
    usaw_lifters l
WHERE 
    l.athlete_name IN ('Paul Smith', 'Jessica Smith', 'Michael Jones') -- Replace with names of interest
ORDER BY 
    l.athlete_name;

LIMIT 20;

LIMIT 20;

LIMIT 20;

LIMIT 20;

-- 7. CHECK FOR SHARED RESULTS (INTEGRITY CHECK - REFINED v2)
-- Checks if EXACTLY the same performance is assigned to multiple athletes.
-- Now includes detailed lift attempts and competition age for maximum precision.
SELECT 
    meet_id, 
    meet_name,
    date,
    age_category,
    weight_class,
    body_weight_kg,
    competition_age,  -- Added age check
    total,
    snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
    cj_lift_1, cj_lift_2, cj_lift_3, best_cj,
    count(DISTINCT lifter_id) as athlete_count,
    string_agg(DISTINCT lifter_id::text, ', ') as lifter_ids
FROM 
    usaw_meet_results
WHERE
    total IS NOT NULL AND total <> '0' AND total <> '---'
GROUP BY 
    meet_id, meet_name, date, age_category, weight_class, body_weight_kg, competition_age,
    total, 
    snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
    cj_lift_1, cj_lift_2, cj_lift_3, best_cj
HAVING 
    count(DISTINCT lifter_id) > 1
ORDER BY 
    athlete_count DESC
LIMIT 20;

-- 8. FIND GHOST LIFTERS (ENHANCED)
-- Athletes in the `usaw_lifters` table who have absolutely zero meet results.
-- Added: Check for blank internal_ids which often indicates failed scrapes.
SELECT 
    l.lifter_id,
    l.athlete_name,
    l.membership_number,
    l.internal_id,
    l.created_at,
    CASE 
        WHEN l.internal_id IS NULL THEN 'Missing Internal ID'
        WHEN l.membership_number IS NULL THEN 'Missing Membership #'
        ELSE 'Has Metadata' 
    END as status_check
FROM 
    usaw_lifters l
LEFT JOIN 
    usaw_meet_results r ON l.lifter_id = r.lifter_id
WHERE 
    r.result_id IS NULL
ORDER BY 
    l.created_at DESC
LIMIT 100;
