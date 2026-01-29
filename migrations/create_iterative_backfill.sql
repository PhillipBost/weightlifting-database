-- Migration: Create Range-Based Backfill RPC
-- Purpose: Deterministic backfill by ID range (avoids infinite loops on stuck rows)
BEGIN;
CREATE OR REPLACE FUNCTION backfill_gamx_by_range(
        p_min_id BIGINT,
        p_max_id BIGINT,
        p_table_name TEXT
    ) RETURNS INTEGER AS $$
DECLARE v_rows_affected INTEGER;
BEGIN IF p_table_name = 'usaw_meet_results' THEN
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
WHERE result_id >= p_min_id
    AND result_id < p_max_id
    AND total IS NOT NULL;
-- Optimization: skip completely empty rows
GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
RETURN v_rows_affected;
ELSIF p_table_name = 'iwf_meet_results' THEN
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
WHERE db_result_id >= p_min_id
    AND db_result_id < p_max_id
    AND total IS NOT NULL;
GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
RETURN v_rows_affected;
END IF;
RETURN 0;
END;
$$ LANGUAGE plpgsql;
-- Force reload
NOTIFY pgrst,
'reload schema';
COMMIT;