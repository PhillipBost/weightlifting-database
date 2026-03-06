WITH usaw_stats AS (
  SELECT 
    COUNT(*) as total_masters,
    COUNT(gamx_s) as with_gamx_s,
    COUNT(gamx_j) as with_gamx_j,
    MIN(created_at) as earliest_affected,
    MAX(created_at) as latest_affected,
    MIN(updated_at) as earliest_updated,
    MAX(updated_at) as latest_updated
  FROM usaw_meet_results
  WHERE competition_age > 40 AND (gamx_s IS NOT NULL OR gamx_j IS NOT NULL)
),
iwf_stats AS (
  SELECT 
    COUNT(*) as total_masters,
    COUNT(gamx_s) as with_gamx_s,
    COUNT(gamx_j) as with_gamx_j,
    MIN(created_at) as earliest_affected,
    MAX(created_at) as latest_affected,
    MIN(updated_at) as earliest_updated,
    MAX(updated_at) as latest_updated
  FROM iwf_meet_results
  WHERE competition_age > 40 AND (gamx_s IS NOT NULL OR gamx_j IS NOT NULL)
)
SELECT 'USAW' as source, * FROM usaw_stats
UNION ALL
SELECT 'IWF' as source, * FROM iwf_stats;
