-- Migration: Add GAMX Triggers
-- Purpose: Automatically calculate GAMX scores on INSERT or UPDATE
-- Depends on: gamx_calc_functions.sql, add_gamx_columns.sql
BEGIN;
--------------------------------------------------------------------------------
-- Helper: Safe Numeric Cast
-- Removes non-numeric chars (except dot) to handle "109+" or "DNS" etc.
-- Returns NULL if not parseable.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION text_to_numeric_safe(p_input TEXT) RETURNS NUMERIC AS $$
DECLARE v_cleaned TEXT;
BEGIN IF p_input IS NULL THEN RETURN NULL;
END IF;
-- keep digits and decimal point
v_cleaned := REGEXP_REPLACE(p_input, '[^0-9.]', '', 'g');
IF v_cleaned = ''
OR v_cleaned = '.' THEN RETURN NULL;
END IF;
RETURN v_cleaned::NUMERIC;
EXCEPTION
WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--------------------------------------------------------------------------------
-- Trigger Function
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_gamx_scores() RETURNS TRIGGER AS $$
DECLARE v_bw NUMERIC;
v_total NUMERIC;
v_snatch NUMERIC;
v_cj NUMERIC;
v_age INTEGER;
BEGIN -- Parse inputs safely
v_bw := text_to_numeric_safe(NEW.body_weight_kg);
v_total := text_to_numeric_safe(NEW.total);
v_snatch := text_to_numeric_safe(NEW.best_snatch);
v_cj := text_to_numeric_safe(NEW.best_cj);
v_age := NEW.competition_age;
-- Basic validation
IF v_bw IS NULL
OR v_bw <= 0
OR NEW.gender IS NULL THEN -- If data invalid, ensure columns are NULL (or leave existing? usually NULL)
NEW.gamx_u := NULL;
NEW.gamx_a := NULL;
NEW.gamx_masters := NULL;
NEW.gamx_total := NULL;
NEW.gamx_s := NULL;
NEW.gamx_j := NULL;
RETURN NEW;
END IF;
-- 1. GAMX U (Youth 7-20)
-- Only calc if age is valid? Function handles it.
-- Assuming get_gamx_score returns NULL if inputs invalid/out of range.
NEW.gamx_u := get_gamx_score('u', NEW.gender, v_age, v_bw, v_total);
-- 2. GAMX A (Junior/Senior/General 13-30? Actually generic)
NEW.gamx_a := get_gamx_score('a', NEW.gender, v_age, v_bw, v_total);
-- 3. GAMX Masters (30+)
NEW.gamx_masters := get_gamx_score('masters', NEW.gender, v_age, v_bw, v_total);
-- 4. GAMX Point (Total, Senior/Open factors usually?)
-- Pass NULL for age if your logic for 'total' ignores it.
NEW.gamx_total := get_gamx_score('total', NEW.gender, v_age, v_bw, v_total);
-- 5. GAMX Snatch
NEW.gamx_s := get_gamx_score('s', NEW.gender, NULL, v_bw, v_snatch);
-- 6. GAMX Clean & Jerk
NEW.gamx_j := get_gamx_score('j', NEW.gender, NULL, v_bw, v_cj);
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--------------------------------------------------------------------------------
-- Apply Triggers
--------------------------------------------------------------------------------
-- usaw_meet_results
DROP TRIGGER IF EXISTS trigger_update_gamx_usaw ON usaw_meet_results;
CREATE TRIGGER trigger_update_gamx_usaw BEFORE
INSERT
    OR
UPDATE OF total,
    best_snatch,
    best_cj,
    body_weight_kg,
    competition_age,
    gender ON usaw_meet_results FOR EACH ROW EXECUTE FUNCTION update_gamx_scores();
-- iwf_meet_results
DROP TRIGGER IF EXISTS trigger_update_gamx_iwf ON iwf_meet_results;
CREATE TRIGGER trigger_update_gamx_iwf BEFORE
INSERT
    OR
UPDATE OF total,
    best_snatch,
    best_cj,
    body_weight_kg,
    competition_age,
    gender ON iwf_meet_results FOR EACH ROW EXECUTE FUNCTION update_gamx_scores();
COMMIT;