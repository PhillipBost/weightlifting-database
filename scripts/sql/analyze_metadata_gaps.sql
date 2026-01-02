-- =====================================================================================
-- METADATA GAP ANALYSIS - USAW MEET RESULTS
-- =====================================================================================
-- This script analyzes the completeness of key metadata fields in meet results.

-- 1. GLOBAL SUMMARY (ALL RESULTS)
SELECT 
    COUNT(*) as total_results,
    
    -- Membership Number (from linked lifter profile)
    ROUND(100.0 * (COUNT(*) - COUNT(l.membership_number)) / COUNT(*), 1) as pct_missing_mem_num,

    -- WSO (snapshot)
    ROUND(100.0 * (COUNT(*) - COUNT(r.wso)) / COUNT(*), 1) as pct_missing_wso,

    -- Club Name (snapshot)
    ROUND(100.0 * (COUNT(*) - COUNT(r.club_name)) / COUNT(*), 1) as pct_missing_club,

    -- Competition Age
    ROUND(100.0 * (COUNT(*) - COUNT(r.competition_age)) / COUNT(*), 1) as pct_missing_age,

    -- Gender
    ROUND(100.0 * (COUNT(*) - COUNT(r.gender)) / COUNT(*), 1) as pct_missing_gender,

    -- National Rank
    ROUND(100.0 * (COUNT(*) - COUNT(r.national_rank)) / COUNT(*), 1) as pct_missing_rank

FROM usaw_meet_results r
LEFT JOIN usaw_lifters l ON r.lifter_id = l.lifter_id;


-- 1.1 GLOBAL SUMMARY (VALID LIFTS ONLY - Total > 0)
-- "Is our data quality better for successful lifts?"
SELECT 
    COUNT(*) as valid_results_count,
    
    ROUND(100.0 * (COUNT(*) - COUNT(l.membership_number)) / COUNT(*), 1) as pct_missing_mem_num,
    ROUND(100.0 * (COUNT(*) - COUNT(r.wso)) / COUNT(*), 1) as pct_missing_wso,
    ROUND(100.0 * (COUNT(*) - COUNT(r.club_name)) / COUNT(*), 1) as pct_missing_club,
    ROUND(100.0 * (COUNT(*) - COUNT(r.competition_age)) / COUNT(*), 1) as pct_missing_age,
    ROUND(100.0 * (COUNT(*) - COUNT(r.gender)) / COUNT(*), 1) as pct_missing_gender,
    ROUND(100.0 * (COUNT(*) - COUNT(r.national_rank)) / COUNT(*), 1) as pct_missing_rank

FROM usaw_meet_results r
LEFT JOIN usaw_lifters l ON r.lifter_id = l.lifter_id
WHERE r.total ~ '^[0-9]+$' AND r.total::numeric > 0;


-- 2. BREAKDOWN BY YEAR (ALL RESULTS)
SELECT 
    EXTRACT(YEAR FROM r.date::date) as year,
    COUNT(*) as total_results,
    ROUND(100.0 * (COUNT(*) - COUNT(l.membership_number)) / NULLIF(COUNT(*),0), 1) as pct_missing_mem_num,
    ROUND(100.0 * (COUNT(*) - COUNT(r.wso)) / NULLIF(COUNT(*),0), 1) as pct_missing_wso,
    ROUND(100.0 * (COUNT(*) - COUNT(r.club_name)) / NULLIF(COUNT(*),0), 1) as pct_missing_club,
    ROUND(100.0 * (COUNT(*) - COUNT(r.competition_age)) / NULLIF(COUNT(*),0), 1) as pct_missing_age,
    ROUND(100.0 * (COUNT(*) - COUNT(r.gender)) / NULLIF(COUNT(*),0), 1) as pct_missing_gender,
    ROUND(100.0 * (COUNT(*) - COUNT(r.national_rank)) / NULLIF(COUNT(*),0), 1) as pct_missing_rank
FROM usaw_meet_results r
LEFT JOIN usaw_lifters l ON r.lifter_id = l.lifter_id
WHERE r.date IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;


-- 3. PROBLEMATIC RECENT MEETS (Top 20 meets in last 2 years with highest generic missing data)
SELECT 
    r.meet_name,
    r.date,
    COUNT(*) as results_count,
    COUNT(*) - COUNT(r.wso) as missing_wso_count,
    COUNT(*) - COUNT(l.membership_number) as missing_mem_num_count
FROM usaw_meet_results r
LEFT JOIN usaw_lifters l ON r.lifter_id = l.lifter_id
WHERE r.date::date > '2023-01-01'
GROUP BY r.meet_name, r.date
HAVING (COUNT(*) - COUNT(r.wso)) > 10 OR (COUNT(*) - COUNT(l.membership_number)) > 10
ORDER BY missing_wso_count DESC
LIMIT 20;
