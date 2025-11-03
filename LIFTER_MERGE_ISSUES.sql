-- Find lifters with MULTIPLE DIFFERENT BIRTH YEARS (data corruption)
-- This indicates two different athletes were merged into one db_lifter_id

SELECT
    l.db_lifter_id,
    l.athlete_name,
    l.country_code,
    COUNT(DISTINCT l.birth_year) as distinct_birth_years,
    STRING_AGG(DISTINCT l.birth_year::text, ', ' ORDER BY l.birth_year::text) as birth_years,
    COUNT(DISTINCT r.date) as competition_count,
    COUNT(DISTINCT r.weight_class) as weight_classes_competed_in,
    l.iwf_lifter_id,
    l.iwf_athlete_url
FROM iwf_lifters l
LEFT JOIN iwf_meet_results r ON l.db_lifter_id = r.db_lifter_id
WHERE l.birth_year IS NOT NULL
GROUP BY l.db_lifter_id, l.athlete_name, l.country_code, l.iwf_lifter_id, l.iwf_athlete_url
HAVING COUNT(DISTINCT l.birth_year) > 1
ORDER BY COUNT(DISTINCT l.birth_year) DESC, l.athlete_name;

-- Detailed view: Show all results for merged lifters
-- This shows what got mixed together
SELECT
    l.db_lifter_id,
    l.athlete_name,
    l.birth_year as lifter_birth_year,
    m.meet,
    m.date as meet_date,
    r.db_result_id,
    r.weight_class,
    r.total,
    r.date as result_date,
    r.created_at
FROM iwf_lifters l
JOIN iwf_meet_results r ON l.db_lifter_id = r.db_lifter_id
JOIN iwf_meets m ON r.db_meet_id = m.db_meet_id
WHERE l.db_lifter_id IN (
    SELECT l2.db_lifter_id
    FROM iwf_lifters l2
    WHERE l2.birth_year IS NOT NULL
    GROUP BY l2.db_lifter_id
    HAVING COUNT(DISTINCT l2.birth_year) > 1
)
ORDER BY l.db_lifter_id, l.birth_year, m.date;

-- Show which lifters have missing iwf_lifter_id (vulnerable to name collision)
SELECT
    COUNT(*) as lifters_without_iwf_id,
    COUNT(CASE WHEN birth_year IS NULL THEN 1 END) as also_missing_birth_year
FROM iwf_lifters
WHERE iwf_lifter_id IS NULL;

-- Show lifters from duplicate pairs that would be affected
SELECT DISTINCT
    l.db_lifter_id,
    l.athlete_name,
    l.birth_year,
    l.iwf_lifter_id,
    l.country_code,
    COUNT(DISTINCT r.db_result_id) as result_count
FROM iwf_lifters l
JOIN iwf_meet_results r ON l.db_lifter_id = r.db_lifter_id
WHERE r.db_meet_id IN (1013) AND r.db_lifter_id IN (37814)
GROUP BY l.db_lifter_id, l.athlete_name, l.birth_year, l.iwf_lifter_id, l.country_code;

-- Summary of the issue
SELECT
    'Lifters with multiple birth years' as issue_type,
    COUNT(DISTINCT l.db_lifter_id) as count
FROM iwf_lifters l
WHERE l.birth_year IS NOT NULL
GROUP BY l.birth_year
HAVING COUNT(DISTINCT l.birth_year) > 1
UNION ALL
SELECT
    'Lifters missing iwf_lifter_id (vulnerable)',
    COUNT(*)
FROM iwf_lifters
WHERE iwf_lifter_id IS NULL;
