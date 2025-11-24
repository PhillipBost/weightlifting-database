-- Analyze the remaining records that won't calculate

-- Sample of remaining youth records
SELECT
    result_id,
    lifter_name,
    competition_age,
    gender,
    total,
    body_weight_kg,
    'Remaining youth record' as note
FROM meet_results
WHERE competition_age::integer BETWEEN 10 AND 20
  AND q_youth IS NULL
  AND total IS NOT NULL
  AND total::numeric > 0
  AND body_weight_kg IS NOT NULL
  AND body_weight_kg::numeric > 0
  AND gender IS NOT NULL
LIMIT 10;

-- Try to manually calculate for one record to see if it errors
SELECT
    result_id,
    lifter_name,
    competition_age,
    total,
    body_weight_kg,
    gender,
    -- Try the calculation
    calculate_qpoints_from_row(total::numeric, body_weight_kg::numeric, gender) as base_qpoints,
    get_youth_age_factor_interpolated(competition_age::integer, body_weight_kg::numeric, gender) as youth_factor,
    calculate_qpoints_from_row(total::numeric, body_weight_kg::numeric, gender)
        * get_youth_age_factor_interpolated(competition_age::integer, body_weight_kg::numeric, gender) as calculated_q_youth
FROM meet_results
WHERE competition_age::integer BETWEEN 10 AND 20
  AND q_youth IS NULL
  AND total IS NOT NULL
  AND total::numeric > 0
  AND body_weight_kg IS NOT NULL
  AND body_weight_kg::numeric > 0
  AND gender IS NOT NULL
LIMIT 5;

-- Check for patterns in remaining records
SELECT
    gender,
    COUNT(*) as count,
    MIN(competition_age::integer) as min_age,
    MAX(competition_age::integer) as max_age,
    MIN(total::numeric) as min_total,
    MAX(total::numeric) as max_total,
    MIN(body_weight_kg::numeric) as min_bw,
    MAX(body_weight_kg::numeric) as max_bw
FROM meet_results
WHERE competition_age::integer BETWEEN 10 AND 20
  AND q_youth IS NULL
  AND total IS NOT NULL
  AND total::numeric > 0
  AND body_weight_kg IS NOT NULL
  AND body_weight_kg::numeric > 0
  AND gender IS NOT NULL
GROUP BY gender;
