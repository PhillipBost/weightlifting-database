-- Find exact duplicate performance records under different meets (with full details)
WITH performance_fingerprint AS (
  SELECT 
    db_result_id,
    db_meet_id,
    meet_name,
    date,
    created_at,
    lifter_name,
    birth_year,
    gender,
    weight_class,
    body_weight_kg,
    snatch_lift_1,
    snatch_lift_2,
    snatch_lift_3,
    best_snatch,
    cj_lift_1,
    cj_lift_2,
    cj_lift_3,
    best_cj,
    total,
    rank,
    competition_group,
    snatch_successful_attempts,
    cj_successful_attempts,
    total_successful_attempts,
    qpoints,
    MD5(
      CONCAT_WS('|',
        lifter_name,
        COALESCE(birth_year::text, 'NULL'),
        gender,
        weight_class,
        COALESCE(body_weight_kg::text, 'NULL'),
        COALESCE(snatch_lift_1::text, 'NULL'),
        COALESCE(snatch_lift_2::text, 'NULL'),
        COALESCE(snatch_lift_3::text, 'NULL'),
        COALESCE(best_snatch::text, 'NULL'),
        COALESCE(cj_lift_1::text, 'NULL'),
        COALESCE(cj_lift_2::text, 'NULL'),
        COALESCE(cj_lift_3::text, 'NULL'),
        COALESCE(best_cj::text, 'NULL'),
        COALESCE(total::text, 'NULL'),
        COALESCE(rank::text, 'NULL'),
        COALESCE(competition_group, 'NULL'),
        COALESCE(snatch_successful_attempts::text, 'NULL'),
        COALESCE(cj_successful_attempts::text, 'NULL'),
        COALESCE(total_successful_attempts::text, 'NULL'),
        COALESCE(qpoints::text, 'NULL')
      )
    ) as fingerprint
  FROM iwf_meet_results
),
duplicate_groups AS (
  SELECT 
    fingerprint,
    COUNT(*) as duplicate_count,
    COUNT(DISTINCT db_meet_id) as different_meet_count,
    MIN(db_result_id) as group_id
  FROM performance_fingerprint
  GROUP BY fingerprint
  HAVING COUNT(*) > 1 
    AND COUNT(DISTINCT db_meet_id) > 1
)
SELECT 
  dg.group_id,
  dg.duplicate_count,
  dg.different_meet_count,
  pf.db_result_id,
  pf.db_meet_id,
  pf.meet_name,
  pf.date,
  pf.created_at,
  pf.lifter_name,
  pf.birth_year,
  pf.gender,
  pf.weight_class,
  pf.body_weight_kg,
  pf.snatch_lift_1,
  pf.snatch_lift_2,
  pf.snatch_lift_3,
  pf.best_snatch,
  pf.cj_lift_1,
  pf.cj_lift_2,
  pf.cj_lift_3,
  pf.best_cj,
  pf.total,
  pf.rank,
  pf.competition_group,
  pf.snatch_successful_attempts,
  pf.cj_successful_attempts,
  pf.total_successful_attempts,
  pf.qpoints
FROM performance_fingerprint pf
JOIN duplicate_groups dg ON pf.fingerprint = dg.fingerprint
ORDER BY dg.group_id, pf.db_result_id;
