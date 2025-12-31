-- 1. OVERVIEW: How many "Zero Total" results have enriched data?
-- We define "Zero Total" as total = 0, NULL, or '---'.
-- We define "Enriched" as having non-null WSO, Club Name, or Competition Age.
SELECT 
    COUNT(*) as total_enriched_zero_results,
    COUNT(CASE WHEN wso IS NOT NULL THEN 1 END) as has_wso,
    COUNT(CASE WHEN club_name IS NOT NULL THEN 1 END) as has_club,
    COUNT(CASE WHEN competition_age IS NOT NULL THEN 1 END) as has_comp_age
FROM 
    usaw_meet_results
WHERE 
    (total IS NULL OR total = '0' OR total = '---')
    AND (wso IS NOT NULL OR club_name IS NOT NULL OR competition_age IS NOT NULL);

-- 2. INVESTIGATE SPECIFIC MEMBER (155187)
-- Checking why they have WSO info despite bombing out (Total = 0)
SELECT 
    r.result_id,
    r.lifter_name,
    l.membership_number,
    r.meet_id,
    r.meet_name,
    r.date,
    r.total,
    r.wso,
    r.club_name,
    r.competition_age,
    r.snatch_lift_1, r.best_snatch,
    r.cj_lift_1, r.best_cj
FROM 
    usaw_meet_results r
JOIN
    usaw_lifters l ON r.lifter_id = l.lifter_id
WHERE 
    l.membership_number = '155187'
ORDER BY 
    r.date DESC;

-- 3. RANK MEETS BY COUNT OF "ENRICHED BOMBOUTS"
-- Which meets have the most of these cases? This helps identify if it's a specific scraper issue or a general data feature.
SELECT 
    meet_id,
    meet_name,
    date,
    COUNT(*) as enriched_zero_count
FROM 
    usaw_meet_results
WHERE 
    (total IS NULL OR total = '0' OR total = '---')
    AND (wso IS NOT NULL OR club_name IS NOT NULL OR competition_age IS NOT NULL)
GROUP BY 
    meet_id, meet_name, date
ORDER BY 
    enriched_zero_count DESC
LIMIT 50;

-- 4. DETAILS OF ENRICHED BOMBOUTS
-- A sample to verify if these are legitimately registered athletes who just bombed out.
-- If they bombed out (e.g., Best SN = 0 or Best CJ = 0), they are still valid participants.
-- The scraper likely found them in the "All" view or they were processed because they had a Membership Number in the source,
-- allowing the backend enrichment to work even if they didn't post a total.
SELECT 
    r.result_id,
    r.lifter_name,
    r.meet_name,
    r.total,
    r.best_snatch,
    r.best_cj,
    r.wso,
    CASE 
        WHEN best_snatch = '0' OR best_snatch = '---' THEN 'Bombout SN'
        WHEN best_cj = '0' OR best_cj = '---' THEN 'Bombout CJ'
        ELSE 'Did Not Compete (DNC)?'
    END as status_check
FROM 
    usaw_meet_results r
WHERE 
    (total IS NULL OR total = '0' OR total = '---')
    AND wso IS NOT NULL
LIMIT 50;

-- 5. REMEDIATION: SCRUB WSO/CLUB FOR ZERO TOTALS
-- WARNING: This operation will remove WSO and Club information for ANY result with a 0/Null total.
-- This includes legitimate athletes who "Bombed Out" (failed all attempts in one or both lifts).
-- Run this only if you are certain you want to de-enrich these records.

UPDATE usaw_meet_results
SET 
    wso = NULL,
    club_name = NULL
WHERE 
    (total IS NULL OR total = '0' OR total = '---')
    AND (wso IS NOT NULL OR club_name IS NOT NULL);

-- Verification after update:
-- SELECT count(*) FROM usaw_meet_results WHERE (total IS NULL OR total = '0' OR total = '---') AND wso IS NOT NULL;
