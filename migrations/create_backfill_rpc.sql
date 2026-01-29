-- Migration: Create Backfill RPC (Fixed Infinite Loop)
-- Purpose: Allow iterative backfill via Supabase API to avoid timeouts
-- Fix: Prevent re-processing rows that correctly evaluated to NULL
BEGIN;
CREATE OR REPLACE FUNCTION backfill_gamx_batch(p_batch_size INTEGER DEFAULT 1000) RETURNS INTEGER AS $$
DECLARE v_updated_count INTEGER := 0;
v_rows_affected INTEGER;
BEGIN -- 1. Backfill USAW (Chunk)
-- Logic: Only pick rows where gamx_total IS NUL 
-- AND NOT RECENTLY UPDATED (to avoid picking same rows if result is genuinely NULL)
WITH batch AS (
    SELECT result_id
    FROM usaw_meet_results
    WHERE gamx_total IS NULL
        AND total IS NOT NULL
        AND body_weight_kg IS NOT NULL -- Skip rows touched in last hour (implies we just tried to calc them)
        AND (
            updated_at IS NULL
            OR updated_at < (NOW() - INTERVAL '1 hour')
        )
    LIMIT p_batch_size
)
UPDATE usaw_meet_results u
SET updated_at = NOW(),
    gamx_u = get_gamx_score(
        'u',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ),
    gamx_a = get_gamx_score(
        'a',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ),
    gamx_masters = get_gamx_score(
        'masters',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ),
    gamx_total = get_gamx_score(
        'total',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ),
    gamx_s = get_gamx_score(
        's',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(best_snatch)
    ),
    gamx_j = get_gamx_score(
        'j',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(best_cj)
    )
WHERE u.result_id IN (
        SELECT result_id
        FROM batch
    );
GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
v_updated_count := v_updated_count + v_rows_affected;
-- If we hit the limit, stop early to keep transaction short.
IF v_updated_count >= p_batch_size THEN RETURN v_updated_count;
END IF;
-- 2. Backfill IWF (Chunk - using remaining allowance)
WITH batch AS (
    SELECT db_result_id
    FROM iwf_meet_results
    WHERE gamx_total IS NULL
        AND total IS NOT NULL
        AND body_weight_kg IS NOT NULL
        AND (
            updated_at IS NULL
            OR updated_at < (NOW() - INTERVAL '1 hour')
        )
    LIMIT (p_batch_size - v_updated_count)
)
UPDATE iwf_meet_results i
SET updated_at = NOW(),
    gamx_u = get_gamx_score(
        'u',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ),
    gamx_a = get_gamx_score(
        'a',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ),
    gamx_masters = get_gamx_score(
        'masters',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ),
    gamx_total = get_gamx_score(
        'total',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(total)
    ),
    gamx_s = get_gamx_score(
        's',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(best_snatch)
    ),
    gamx_j = get_gamx_score(
        'j',
        gender,
        competition_age,
        text_to_numeric_safe(body_weight_kg),
        text_to_numeric_safe(best_cj)
    )
WHERE i.db_result_id IN (
        SELECT db_result_id
        FROM batch
    );
GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
v_updated_count := v_updated_count + v_rows_affected;
RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql;
-- Force PostgREST schema cache reload
NOTIFY pgrst,
'reload schema';
COMMIT;