-- Query to get ALL fields for all 14 duplicate pairs
-- Export as JSON for manual correction
-- In Supabase: Click "No limit" to remove the 100-row limit

WITH duplicate_pairs AS (
  SELECT db_meet_id, db_lifter_id
  FROM iwf_meet_results
  GROUP BY db_meet_id, db_lifter_id
  HAVING COUNT(*) > 1
)
SELECT
  r.db_result_id,
  r.db_lifter_id,
  r.db_meet_id,
  r.meet_name,
  r.date,
  r.age_category,
  r.weight_class,
  r.lifter_name,
  r.body_weight_kg,
  r.snatch_lift_1,
  r.snatch_lift_2,
  r.snatch_lift_3,
  r.best_snatch,
  r.cj_lift_1,
  r.cj_lift_2,
  r.cj_lift_3,
  r.best_cj,
  r.total,
  r.snatch_successful_attempts,
  r.cj_successful_attempts,
  r.total_successful_attempts,
  r.best_snatch_ytd,
  r.best_cj_ytd,
  r.best_total_ytd,
  r.bounce_back_snatch_2,
  r.bounce_back_snatch_3,
  r.bounce_back_cj_2,
  r.bounce_back_cj_3,
  r.gender,
  r.birth_year,
  r.competition_age,
  r.competition_group,
  r.rank,
  r.qpoints,
  r.q_masters,
  r.q_youth,
  r.country_code,
  r.country_name,
  r.manual_override,
  r.created_at,
  r.updated_at,
  l.athlete_name,
  l.iwf_lifter_id,
  l.iwf_athlete_url,
  m.iwf_meet_id,
  m.meet,
  m.level,
  m.results,
  m.url,
  m.batch_id,
  m.scraped_date
FROM iwf_meet_results r
JOIN iwf_lifters l ON r.db_lifter_id = l.db_lifter_id
JOIN iwf_meets m ON r.db_meet_id = m.db_meet_id
JOIN duplicate_pairs dp ON r.db_meet_id = dp.db_meet_id AND r.db_lifter_id = dp.db_lifter_id
ORDER BY r.db_meet_id, r.db_lifter_id, r.total DESC NULLS LAST;
