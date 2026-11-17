-- ============================================================================
-- Migration: Backfill Canonical 4-Tier URLs on public.iwf_meets
-- Purpose: Updates stale public.iwf_meets.url values to match getIwfMeetUrl()
--          in scripts/production/iwf-config.js. Updating modified rows triggers
--          trigger_enqueue_meet_shard_iwf_meets to enqueue their .json.gz shards
--          in public.meet_shard_queue for regeneration.
-- ============================================================================

WITH canonical AS (
    SELECT
        db_meet_id,
        CASE
            WHEN date_iso >= DATE '2026-08-01' THEN
                'https://iwf.sport/results/results-by-events/?event_id=' || btrim(iwf_meet_id)
            WHEN date_iso >= DATE '2025-07-01' AND date_iso < DATE '2026-08-01' THEN
                'https://iwf.sport/results/results-by-events/results-by-events-2025-2026/?event_id=' || btrim(iwf_meet_id)
            WHEN date_iso >= DATE '2018-11-01' AND date_iso < DATE '2025-07-01' THEN
                'https://iwf.sport/results/results-by-events/results-by-events-2018-2025/?event_id=' || btrim(iwf_meet_id)
            ELSE
                'https://iwf.sport/results/results-by-events/results-by-events-upto2018/?event_id=' || btrim(iwf_meet_id)
        END AS expected_url
    FROM public.iwf_meets
    WHERE iwf_meet_id IS NOT NULL
      AND btrim(iwf_meet_id) <> ''
      AND date_iso IS NOT NULL
)
UPDATE public.iwf_meets m
SET url = c.expected_url
FROM canonical c
WHERE m.db_meet_id = c.db_meet_id
  AND m.url IS DISTINCT FROM c.expected_url;
