-- Migration: Backfill GAMX Scores
-- Purpose: Calculate GAMX scores for all existing records
-- Method: Direct UPDATE using calculation function (Triggers not involved)
BEGIN;
-- Ensure helper function exists (in case Trigger migration wasn't run, though it should have been)
CREATE OR REPLACE FUNCTION text_to_numeric_safe_backfill(p_input TEXT) RETURNS NUMERIC AS $$ BEGIN IF p_input IS NULL THEN RETURN NULL;
END IF;
RETURN REGEXP_REPLACE(p_input, '[^0-9.]', '', 'g')::NUMERIC;
EXCEPTION
WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--------------------------------------------------------------------------------
-- 1. Backfill USAW Results
--------------------------------------------------------------------------------
UPDATE usaw_meet_results
SET gamx_u = get_gamx_score(
        'u',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(total)
    ),
    gamx_a = get_gamx_score(
        'a',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(total)
    ),
    gamx_masters = get_gamx_score(
        'masters',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(total)
    ),
    gamx_total = get_gamx_score(
        'total',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(total)
    ),
    gamx_s = get_gamx_score(
        's',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(best_snatch)
    ),
    gamx_j = get_gamx_score(
        'j',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(best_cj)
    )
WHERE -- Only update rows where calculation is possible and hasn't been done
    -- (checking gamx_total IS NULL is a good proxy for "fresh" backup)
    gamx_total IS NULL
    AND body_weight_kg IS NOT NULL
    AND total IS NOT NULL;
--------------------------------------------------------------------------------
-- 2. Backfill IWF Results
--------------------------------------------------------------------------------
UPDATE iwf_meet_results
SET gamx_u = get_gamx_score(
        'u',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(total)
    ),
    gamx_a = get_gamx_score(
        'a',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(total)
    ),
    gamx_masters = get_gamx_score(
        'masters',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(total)
    ),
    gamx_total = get_gamx_score(
        'total',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(total)
    ),
    gamx_s = get_gamx_score(
        's',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(best_snatch)
    ),
    gamx_j = get_gamx_score(
        'j',
        gender,
        competition_age,
        text_to_numeric_safe_backfill(body_weight_kg),
        text_to_numeric_safe_backfill(best_cj)
    )
WHERE gamx_total IS NULL
    AND body_weight_kg IS NOT NULL
    AND total IS NOT NULL;
-- Cleanup helper
DROP FUNCTION text_to_numeric_safe_backfill(TEXT);
COMMIT;