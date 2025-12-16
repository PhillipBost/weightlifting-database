-- ============================================================================
-- SQL Queries to Find Missing Q-Scores Where Total is Present
-- ============================================================================
-- Purpose: Identify records that should have q-scores but don't
-- Likely cause: Missing competition_age at time of import
-- Date: 2025-12-14
--
-- Q-Score Assignment Rules:
--   Ages 0-9:   No q-score (expected)
--   Ages 10-20: q_youth should be populated
--   Ages 21-30: qpoints should be populated
--   Ages 31+:   q_masters should be populated
-- ============================================================================

-- ============================================================================
-- QUERY 1: Find ALL missing q-scores with valid data (USAW)
-- ============================================================================
-- This query finds all USAW records that have the necessary data for q-score
-- calculation but are missing the appropriate q-score field
-- ============================================================================

SELECT 
    'USAW' as source,
    result_id,
    lifter_name,
    date,
    age_category,
    competition_age,
    gender,
    body_weight_kg,
    total,
    qpoints,
    q_youth,
    q_masters,
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 THEN 'q_youth missing'
        WHEN competition_age >= 21 AND competition_age <= 30 THEN 'qpoints missing'
        WHEN gender = 'M' AND competition_age >= 31 AND competition_age <= 75 THEN 'q_masters missing'
        WHEN gender = 'F' AND competition_age >= 31 AND competition_age <= 109 THEN 'q_masters missing'
        ELSE 'unexpected_age'
    END as missing_score_type,
    meet_id,
    meet_name
FROM usaw_meet_results
WHERE 
    -- Has valid total and bodyweight
    total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND CAST(body_weight_kg AS NUMERIC) > 0
    -- Has gender and competition_age
    AND gender IS NOT NULL
    AND competition_age IS NOT NULL
    AND competition_age >= 10  -- Only check ages that should have q-scores
    -- Missing the appropriate q-score
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND q_youth IS NULL) OR
        (competition_age >= 21 AND competition_age <= 30 AND qpoints IS NULL) OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND q_masters IS NULL) OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND q_masters IS NULL)
    )
ORDER BY date DESC, competition_age, lifter_name
LIMIT 100;

-- ============================================================================
-- QUERY 2: Find missing q-scores grouped by age range (USAW)
-- ============================================================================
-- Summary statistics to understand the scope of the problem
-- ============================================================================

SELECT 
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 THEN 'Youth (10-20)'
        WHEN competition_age >= 21 AND competition_age <= 30 THEN 'Senior (21-30)'
        WHEN competition_age >= 31 AND competition_age <= 40 THEN 'Masters 31-40'
        WHEN competition_age >= 41 AND competition_age <= 50 THEN 'Masters 41-50'
        WHEN competition_age >= 51 THEN 'Masters 51+'
        ELSE 'Other'
    END as age_group,
    COUNT(*) as missing_count,
    MIN(date) as earliest_date,
    MAX(date) as latest_date,
    COUNT(DISTINCT meet_id) as affected_meets
FROM usaw_meet_results
WHERE 
    total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND CAST(body_weight_kg AS NUMERIC) > 0
    AND gender IS NOT NULL
    AND competition_age IS NOT NULL
    AND competition_age >= 10
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND q_youth IS NULL) OR
        (competition_age >= 21 AND competition_age <= 30 AND qpoints IS NULL) OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND q_masters IS NULL) OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND q_masters IS NULL)
    )
GROUP BY age_group
ORDER BY age_group;

-- ============================================================================
-- QUERY 3: Find missing q-scores by year (USAW)
-- ============================================================================
-- Shows which years are most affected
-- ============================================================================

SELECT 
    EXTRACT(YEAR FROM date::date) as year,
    COUNT(*) as missing_count,
    COUNT(DISTINCT lifter_id) as affected_athletes,
    COUNT(DISTINCT meet_id) as affected_meets
FROM usaw_meet_results
WHERE 
    total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND CAST(body_weight_kg AS NUMERIC) > 0
    AND gender IS NOT NULL
    AND competition_age IS NOT NULL
    AND competition_age >= 10
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND q_youth IS NULL) OR
        (competition_age >= 21 AND competition_age <= 30 AND qpoints IS NULL) OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND q_masters IS NULL) OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND q_masters IS NULL)
    )
    AND date IS NOT NULL
GROUP BY year
ORDER BY year DESC;

-- ============================================================================
-- QUERY 4: Find missing q_youth specifically (USAW)
-- ============================================================================
-- Youth athletes (10-20) with totals but no q_youth score
-- ============================================================================

SELECT 
    result_id,
    lifter_id,
    lifter_name,
    date,
    competition_age,
    gender,
    body_weight_kg,
    total,
    meet_name,
    meet_id
FROM usaw_meet_results
WHERE 
    competition_age >= 10 
    AND competition_age <= 20
    AND total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND CAST(body_weight_kg AS NUMERIC) > 0
    AND gender IS NOT NULL
    AND q_youth IS NULL
ORDER BY date DESC, lifter_name
LIMIT 100;

-- ============================================================================
-- IWF DATABASE QUERIES
-- ============================================================================
-- Same queries for the IWF international database
-- ============================================================================

-- ============================================================================
-- QUERY 5: Find ALL missing q-scores with valid data (IWF)
-- ============================================================================

SELECT 
    'IWF' as source,
    db_result_id,
    lifter_name,
    date,
    age_category,
    competition_age,
    gender,
    body_weight_kg,
    total,
    qpoints,
    q_youth,
    q_masters,
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 THEN 'q_youth missing'
        WHEN competition_age >= 21 AND competition_age <= 30 THEN 'qpoints missing'
        WHEN gender = 'M' AND competition_age >= 31 AND competition_age <= 75 THEN 'q_masters missing'
        WHEN gender = 'F' AND competition_age >= 31 AND competition_age <= 109 THEN 'q_masters missing'
        ELSE 'unexpected_age'
    END as missing_score_type,
    db_meet_id,
    meet_name
FROM iwf_meet_results
WHERE 
    -- Has valid total and bodyweight
    total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND CAST(body_weight_kg AS NUMERIC) > 0
    -- Has gender and competition_age
    AND gender IS NOT NULL
    AND competition_age IS NOT NULL
    AND competition_age >= 10  -- Only check ages that should have q-scores
    -- Missing the appropriate q-score
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND q_youth IS NULL) OR
        (competition_age >= 21 AND competition_age <= 30 AND qpoints IS NULL) OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND q_masters IS NULL) OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND q_masters IS NULL)
    )
ORDER BY date DESC, competition_age, lifter_name
LIMIT 100;

-- ============================================================================
-- QUERY 6: Find missing q-scores grouped by age range (IWF)
-- ============================================================================

SELECT 
    CASE 
        WHEN competition_age >= 10 AND competition_age <= 20 THEN 'Youth (10-20)'
        WHEN competition_age >= 21 AND competition_age <= 30 THEN 'Senior (21-30)'
        WHEN competition_age >= 31 AND competition_age <= 40 THEN 'Masters 31-40'
        WHEN competition_age >= 41 AND competition_age <= 50 THEN 'Masters 41-50'
        WHEN competition_age >= 51 THEN 'Masters 51+'
        ELSE 'Other'
    END as age_group,
    COUNT(*) as missing_count,
    MIN(date) as earliest_date,
    MAX(date) as latest_date,
    COUNT(DISTINCT db_meet_id) as affected_meets
FROM iwf_meet_results
WHERE 
    total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND CAST(body_weight_kg AS NUMERIC) > 0
    AND gender IS NOT NULL
    AND competition_age IS NOT NULL
    AND competition_age >= 10
    AND (
        (competition_age >= 10 AND competition_age <= 20 AND q_youth IS NULL) OR
        (competition_age >= 21 AND competition_age <= 30 AND qpoints IS NULL) OR
        (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND q_masters IS NULL) OR
        (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND q_masters IS NULL)
    )
GROUP BY age_group
ORDER BY age_group;

-- ============================================================================
-- QUERY 7: Find records missing competition_age but have total (USAW)
-- ============================================================================
-- These are the root cause - they need competition_age to calculate q-scores
-- ============================================================================

SELECT 
    result_id,
    lifter_id,
    lifter_name,
    date,
    age_category,
    competition_age,
    birth_year,
    gender,
    body_weight_kg,
    total,
    meet_name,
    meet_id,
    CASE 
        WHEN birth_year IS NOT NULL AND date IS NOT NULL 
        THEN EXTRACT(YEAR FROM date::date)::INTEGER - birth_year
        ELSE NULL
    END as calculated_age
FROM usaw_meet_results
WHERE 
    total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND gender IS NOT NULL
    AND competition_age IS NULL  -- Missing competition age!
ORDER BY date DESC
LIMIT 100;

-- ============================================================================
-- QUERY 8: Find records missing competition_age but have total (IWF)
-- ============================================================================

SELECT 
    db_result_id,
    db_lifter_id,
    lifter_name,
    date,
    age_category,
    competition_age,
    birth_year,
    gender,
    body_weight_kg,
    total,
    meet_name,
    db_meet_id,
    CASE 
        WHEN birth_year IS NOT NULL AND date IS NOT NULL 
        THEN EXTRACT(YEAR FROM date::date)::INTEGER - birth_year
        ELSE NULL
    END as calculated_age
FROM iwf_meet_results
WHERE 
    total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND gender IS NOT NULL
    AND competition_age IS NULL  -- Missing competition age!
ORDER BY date DESC
LIMIT 100;

-- ============================================================================
-- QUERY 9: Get total count of missing q-scores (USAW)
-- ============================================================================

SELECT 
    COUNT(*) as total_missing_qscores,
    COUNT(CASE WHEN competition_age IS NULL THEN 1 END) as missing_due_to_no_age,
    COUNT(CASE WHEN competition_age IS NOT NULL THEN 1 END) as missing_with_age_present
FROM usaw_meet_results
WHERE 
    total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND gender IS NOT NULL
    AND (
        competition_age IS NULL OR  -- Missing age entirely
        (
            competition_age >= 10 AND  -- Or has age but missing appropriate q-score
            (
                (competition_age >= 10 AND competition_age <= 20 AND q_youth IS NULL) OR
                (competition_age >= 21 AND competition_age <= 30 AND qpoints IS NULL) OR
                (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND q_masters IS NULL) OR
                (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND q_masters IS NULL)
            )
        )
    );

-- ============================================================================
-- QUERY 10: Get total count of missing q-scores (IWF)
-- ============================================================================

SELECT 
    COUNT(*) as total_missing_qscores,
    COUNT(CASE WHEN competition_age IS NULL THEN 1 END) as missing_due_to_no_age,
    COUNT(CASE WHEN competition_age IS NOT NULL THEN 1 END) as missing_with_age_present
FROM iwf_meet_results
WHERE 
    total IS NOT NULL 
    AND total != '---'
    AND CAST(total AS NUMERIC) > 0
    AND body_weight_kg IS NOT NULL 
    AND body_weight_kg != '---'
    AND gender IS NOT NULL
    AND (
        competition_age IS NULL OR  -- Missing age entirely
        (
            competition_age >= 10 AND  -- Or has age but missing appropriate q-score
            (
                (competition_age >= 10 AND competition_age <= 20 AND q_youth IS NULL) OR
                (competition_age >= 21 AND competition_age <= 30 AND qpoints IS NULL) OR
                (gender = 'M' AND competition_age >= 31 AND competition_age <= 75 AND q_masters IS NULL) OR
                (gender = 'F' AND competition_age >= 31 AND competition_age <= 109 AND q_masters IS NULL)
            )
        )
    );

-- ============================================================================
-- USAGE INSTRUCTIONS
-- ============================================================================
-- 1. Run QUERY 9 or 10 first to get total counts
-- 2. Run QUERY 2 or 6 to see breakdown by age group
-- 3. Run QUERY 3 to see breakdown by year
-- 4. Run QUERY 1 or 5 to see specific records (limited to 100)
-- 5. Run QUERY 7 or 8 to find records missing competition_age
--
-- Once you understand the scope, you can design targeted scraper runs
-- to fill in the missing data by targeting specific meets/dates.
-- ============================================================================
