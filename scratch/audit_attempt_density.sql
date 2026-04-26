-- Investigating the "Perfect Cluster" in 2014
-- Goal: See how many attempts are actually recorded per meet for 100% lifters.
-- If avg_attempts_per_meet is ~2, it confirms "Best-Lift-Only" data.
-- If it is 6, they are true 6-for-6 lifters.

WITH perfect_athlete_stats AS (
    SELECT 
        lifter_id,
        COUNT(*) as meet_count,
        SUM(
            (CASE WHEN NULLIF(snatch_lift_1, '0') ~ '^-?[0-9.]+$' THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(snatch_lift_2, '0') ~ '^-?[0-9.]+$' THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(snatch_lift_3, '0') ~ '^-?[0-9.]+$' THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(cj_lift_1, '0') ~ '^-?[0-9.]+$' THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(cj_lift_2, '0') ~ '^-?[0-9.]+$' THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(cj_lift_3, '0') ~ '^-?[0-9.]+$' THEN 1 ELSE 0 END)
        ) as total_recorded_attempts,
        SUM(
            (CASE WHEN NULLIF(snatch_lift_1, '0') ~ '^-?[0-9.]+$' AND (NULLIF(snatch_lift_1, '0')::float > 0) THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(snatch_lift_2, '0') ~ '^-?[0-9.]+$' AND (NULLIF(snatch_lift_2, '0')::float > 0) THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(snatch_lift_3, '0') ~ '^-?[0-9.]+$' AND (NULLIF(snatch_lift_3, '0')::float > 0) THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(cj_lift_1, '0') ~ '^-?[0-9.]+$' AND (NULLIF(cj_lift_1, '0')::float > 0) THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(cj_lift_2, '0') ~ '^-?[0-9.]+$' AND (NULLIF(cj_lift_2, '0')::float > 0) THEN 1 ELSE 0 END) +
            (CASE WHEN NULLIF(cj_lift_3, '0') ~ '^-?[0-9.]+$' AND (NULLIF(cj_lift_3, '0')::float > 0) THEN 1 ELSE 0 END)
        ) as total_successes
    FROM usaw_meet_results
    WHERE date <= '2014-12-31'
      AND gender ILIKE 'M%' AND (age_category ILIKE '%senior%' OR age_category ILIKE '%open%')
    GROUP BY lifter_id
    HAVING COUNT(*) >= 2 
)
SELECT 
    ROUND((total_recorded_attempts::float / meet_count)::numeric, 1) as avg_attempts_per_meet,
    COUNT(*) as athlete_count,
    ROUND(AVG(total_successes)::numeric, 1) as avg_total_successes
FROM perfect_athlete_stats
WHERE (total_successes::float / total_recorded_attempts) >= 1.0 -- Only the 100% group
GROUP BY 1
ORDER BY 1 DESC;
