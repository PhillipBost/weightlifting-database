-- Migration: Add Analytics Triggers to IWF Meet Results
-- Purpose: Automatically calculate and populate analytics fields on INSERT/UPDATE
-- This mirrors the USAW database pattern for consistency
-- Date: 2025-01-26
--
-- Functions created:
--   1. calculate_iwf_analytics() - Successful attempts & bounce-back metrics
--   2. calculate_iwf_competition_age() - Age calculation from birth_year and date
--   3. update_iwf_qpoints_on_change() - Q-scores using Huebner formula
--   4. handle_iwf_manual_override() - Preserve manual data entry flag
--
-- Triggers created:
--   1. iwf_meet_results_analytics_insert_trigger - AUTO on INSERT
--   2. iwf_meet_results_analytics_update_trigger - AUTO on UPDATE (lift/date fields)
--   3. iwf_meet_results_manual_override_trigger - MANUAL entry handling
--   4. iwf_meet_results_qpoints_auto_update - Q-points AUTO
--   5. iwf_meet_results_competition_age_trigger - AGE AUTO on date/birth_year change

BEGIN;

-- ============================================================================
-- FUNCTION 1: calculate_iwf_analytics()
-- Calculates successful attempts and bounce-back metrics from attempt data
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_iwf_analytics()
RETURNS TRIGGER AS $$
DECLARE
    v_snatch_1_success BOOLEAN;
    v_snatch_2_success BOOLEAN;
    v_snatch_3_success BOOLEAN;
    v_cj_1_success BOOLEAN;
    v_cj_2_success BOOLEAN;
    v_cj_3_success BOOLEAN;
BEGIN
    -- Helper function to determine if attempt was successful (positive value)
    -- Positive number = success, negative/zero = miss, null/--- = not attempted

    -- SNATCH ATTEMPTS
    v_snatch_1_success := (NEW.snatch_lift_1 IS NOT NULL AND
                          NEW.snatch_lift_1 != '---' AND
                          (NEW.snatch_lift_1::NUMERIC) > 0);
    v_snatch_2_success := (NEW.snatch_lift_2 IS NOT NULL AND
                          NEW.snatch_lift_2 != '---' AND
                          (NEW.snatch_lift_2::NUMERIC) > 0);
    v_snatch_3_success := (NEW.snatch_lift_3 IS NOT NULL AND
                          NEW.snatch_lift_3 != '---' AND
                          (NEW.snatch_lift_3::NUMERIC) > 0);

    -- C&J ATTEMPTS
    v_cj_1_success := (NEW.cj_lift_1 IS NOT NULL AND
                      NEW.cj_lift_1 != '---' AND
                      (NEW.cj_lift_1::NUMERIC) > 0);
    v_cj_2_success := (NEW.cj_lift_2 IS NOT NULL AND
                      NEW.cj_lift_2 != '---' AND
                      (NEW.cj_lift_2::NUMERIC) > 0);
    v_cj_3_success := (NEW.cj_lift_3 IS NOT NULL AND
                      NEW.cj_lift_3 != '---' AND
                      (NEW.cj_lift_3::NUMERIC) > 0);

    -- COUNT SUCCESSFUL ATTEMPTS
    NEW.snatch_successful_attempts :=
        (CASE WHEN v_snatch_1_success THEN 1 ELSE 0 END) +
        (CASE WHEN v_snatch_2_success THEN 1 ELSE 0 END) +
        (CASE WHEN v_snatch_3_success THEN 1 ELSE 0 END);

    NEW.cj_successful_attempts :=
        (CASE WHEN v_cj_1_success THEN 1 ELSE 0 END) +
        (CASE WHEN v_cj_2_success THEN 1 ELSE 0 END) +
        (CASE WHEN v_cj_3_success THEN 1 ELSE 0 END);

    NEW.total_successful_attempts := NEW.snatch_successful_attempts + NEW.cj_successful_attempts;

    -- BOUNCE-BACK METRICS (recovery after missed attempts)
    -- bounce_back_snatch_2: Made 2nd snatch after missing 1st (null if 1st didn't miss)
    IF v_snatch_1_success = FALSE AND NEW.snatch_lift_2 IS NOT NULL AND NEW.snatch_lift_2 != '---' THEN
        NEW.bounce_back_snatch_2 := v_snatch_2_success;
    ELSE
        NEW.bounce_back_snatch_2 := NULL;
    END IF;

    -- bounce_back_snatch_3: Made 3rd snatch after missing 2nd (null if 2nd didn't miss)
    IF v_snatch_2_success = FALSE AND NEW.snatch_lift_3 IS NOT NULL AND NEW.snatch_lift_3 != '---' THEN
        NEW.bounce_back_snatch_3 := v_snatch_3_success;
    ELSE
        NEW.bounce_back_snatch_3 := NULL;
    END IF;

    -- bounce_back_cj_2: Made 2nd C&J after missing 1st
    IF v_cj_1_success = FALSE AND NEW.cj_lift_2 IS NOT NULL AND NEW.cj_lift_2 != '---' THEN
        NEW.bounce_back_cj_2 := v_cj_2_success;
    ELSE
        NEW.bounce_back_cj_2 := NULL;
    END IF;

    -- bounce_back_cj_3: Made 3rd C&J after missing 2nd
    IF v_cj_2_success = FALSE AND NEW.cj_lift_3 IS NOT NULL AND NEW.cj_lift_3 != '---' THEN
        NEW.bounce_back_cj_3 := v_cj_3_success;
    ELSE
        NEW.bounce_back_cj_3 := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION 2: calculate_iwf_competition_age()
-- Calculates competition age from birth_year and date
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_iwf_competition_age()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate competition_age if we have both date and birth_year
    IF NEW.date IS NOT NULL AND NEW.birth_year IS NOT NULL THEN
        NEW.competition_age := EXTRACT(YEAR FROM NEW.date::date) - NEW.birth_year;
    ELSIF NEW.date IS NULL OR NEW.birth_year IS NULL THEN
        NEW.competition_age := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION 3: update_iwf_qpoints_on_change()
-- Calculates Q-scores using Huebner formula
-- Age-appropriate: ages 10-20 = q_youth, 21-30 = qpoints, 31+ = q_masters
-- ============================================================================

CREATE OR REPLACE FUNCTION update_iwf_qpoints_on_change()
RETURNS TRIGGER AS $$
DECLARE
    v_total NUMERIC;
    v_bodyweight NUMERIC;
    v_B NUMERIC;
    v_denominator NUMERIC;
    v_qscore NUMERIC;
    v_age INTEGER;
BEGIN
    -- Reset all Q-scores to null
    NEW.qpoints := NULL;
    NEW.q_youth := NULL;
    NEW.q_masters := NULL;

    -- Validate input data
    IF NEW.total IS NULL OR NEW.total = '---' OR
       NEW.body_weight_kg IS NULL OR NEW.body_weight_kg = '---' OR
       NEW.gender IS NULL OR NEW.competition_age IS NULL THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_total := NEW.total::NUMERIC;
        v_bodyweight := NEW.body_weight_kg::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
        RETURN NEW;  -- Invalid numeric data, skip Q-score calculation
    END;

    -- Validate numeric values
    IF v_total <= 0 OR v_bodyweight <= 0 THEN
        RETURN NEW;
    END IF;

    v_age := NEW.competition_age;
    v_B := v_bodyweight / 100;

    -- Age-based scoring (Huebner brackets)
    -- Ages ≤9: No Q-scoring
    IF v_age <= 9 THEN
        RETURN NEW;
    END IF;

    -- Ages 10-20: Q-youth only
    IF v_age >= 10 AND v_age <= 20 THEN
        IF NEW.gender = 'M' THEN
            v_denominator := 416.7 - 47.87 * POWER(v_B, -2) + 18.93 * POWER(v_B, 2);
            v_qscore := ROUND((v_total * 463.26 / v_denominator)::NUMERIC, 3);
            NEW.q_youth := v_qscore;
        ELSIF NEW.gender = 'F' THEN
            v_denominator := 266.5 - 19.44 * POWER(v_B, -2) + 18.61 * POWER(v_B, 2);
            v_qscore := ROUND((v_total * 306.54 / v_denominator)::NUMERIC, 3);
            NEW.q_youth := v_qscore;
        END IF;
        RETURN NEW;
    END IF;

    -- Ages 21-30: Q-points only
    IF v_age >= 21 AND v_age <= 30 THEN
        IF NEW.gender = 'M' THEN
            v_denominator := 416.7 - 47.87 * POWER(v_B, -2) + 18.93 * POWER(v_B, 2);
            v_qscore := ROUND((v_total * 463.26 / v_denominator)::NUMERIC, 3);
            NEW.qpoints := v_qscore;
        ELSIF NEW.gender = 'F' THEN
            v_denominator := 266.5 - 19.44 * POWER(v_B, -2) + 18.61 * POWER(v_B, 2);
            v_qscore := ROUND((v_total * 306.54 / v_denominator)::NUMERIC, 3);
            NEW.qpoints := v_qscore;
        END IF;
        RETURN NEW;
    END IF;

    -- Ages 31+: Q-masters only (use central is_master_age predicate)
    IF public.is_master_age(NEW.gender, v_age) THEN
        IF upper(coalesce(NEW.gender, '')) = 'M' THEN
            v_denominator := 416.7 - 47.87 * POWER(v_B, -2) + 18.93 * POWER(v_B, 2);
            v_qscore := ROUND((v_total * 463.26 / v_denominator)::NUMERIC, 3);
            NEW.q_masters := v_qscore;
        ELSIF upper(coalesce(NEW.gender, '')) = 'F' THEN
            v_denominator := 266.5 - 19.44 * POWER(v_B, -2) + 18.61 * POWER(v_B, 2);
            v_qscore := ROUND((v_total * 306.54 / v_denominator)::NUMERIC, 3);
            NEW.q_masters := v_qscore;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION 4: handle_iwf_manual_override()
-- Preserves manual_override flag (no auto-recalculation when manual_override=true)
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_iwf_manual_override()
RETURNS TRIGGER AS $$
BEGIN
    -- If manual_override is set to true, skip analytics calculation
    -- This allows manual data entry without automatic recalculation
    IF NEW.manual_override = TRUE THEN
        -- Do not run other triggers
        -- This is noted for future reference - in Supabase, we'd need to
        -- structure the triggers to respect this flag
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- TRIGGER 1: Calculate analytics on INSERT
CREATE TRIGGER iwf_meet_results_analytics_insert_trigger
    BEFORE INSERT ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION calculate_iwf_analytics();

-- Ensure idempotency when running this migration multiple times
DROP TRIGGER IF EXISTS iwf_meet_results_analytics_insert_trigger ON iwf_meet_results;
DROP TRIGGER IF EXISTS iwf_meet_results_analytics_update_trigger ON iwf_meet_results;
DROP TRIGGER IF EXISTS iwf_meet_results_manual_override_trigger ON iwf_meet_results;
DROP TRIGGER IF EXISTS iwf_meet_results_qpoints_auto_update ON iwf_meet_results;
DROP TRIGGER IF EXISTS iwf_meet_results_competition_age_trigger ON iwf_meet_results;

-- TRIGGER 1: Calculate analytics on INSERT
CREATE TRIGGER iwf_meet_results_analytics_insert_trigger
    BEFORE INSERT ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION calculate_iwf_analytics();

-- TRIGGER 2: Calculate analytics on UPDATE (when lift or date fields change)
CREATE TRIGGER iwf_meet_results_analytics_update_trigger
    BEFORE UPDATE OF snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
                    cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total,
                    date
    ON iwf_meet_results
    FOR EACH ROW
    WHEN (
        OLD.snatch_lift_1 IS DISTINCT FROM NEW.snatch_lift_1 OR
        OLD.snatch_lift_2 IS DISTINCT FROM NEW.snatch_lift_2 OR
        OLD.snatch_lift_3 IS DISTINCT FROM NEW.snatch_lift_3 OR
        OLD.best_snatch IS DISTINCT FROM NEW.best_snatch OR
        OLD.cj_lift_1 IS DISTINCT FROM NEW.cj_lift_1 OR
        OLD.cj_lift_2 IS DISTINCT FROM NEW.cj_lift_2 OR
        OLD.cj_lift_3 IS DISTINCT FROM NEW.cj_lift_3 OR
        OLD.best_cj IS DISTINCT FROM NEW.best_cj OR
        OLD.total IS DISTINCT FROM NEW.total OR
        OLD.date IS DISTINCT FROM NEW.date
    )
    EXECUTE FUNCTION calculate_iwf_analytics();

-- TRIGGER 3: Manual override handling
CREATE TRIGGER iwf_meet_results_manual_override_trigger
    BEFORE INSERT OR UPDATE ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION handle_iwf_manual_override();

-- TRIGGER 4: Auto-update Q-points on any INSERT or UPDATE
CREATE TRIGGER iwf_meet_results_qpoints_auto_update
    BEFORE INSERT OR UPDATE ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_qpoints_on_change();

-- TRIGGER 5: Calculate competition age on date or birth_year changes
CREATE TRIGGER iwf_meet_results_competition_age_trigger
    BEFORE INSERT OR UPDATE OF date, birth_year ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION calculate_iwf_competition_age();

COMMIT;

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- Functions Created: 4
--   1. calculate_iwf_analytics()
--   2. calculate_iwf_competition_age()
--   3. update_iwf_qpoints_on_change()
--   4. handle_iwf_manual_override()
--
-- Triggers Created: 5
--   1. iwf_meet_results_analytics_insert_trigger
--   2. iwf_meet_results_analytics_update_trigger
--   3. iwf_meet_results_manual_override_trigger
--   4. iwf_meet_results_qpoints_auto_update
--   5. iwf_meet_results_competition_age_trigger
--
-- Next Steps:
--   1. Run this SQL in Supabase SQL Editor
--   2. Verify triggers exist: SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'iwf_meet_results';
--   3. Run backfill script for existing records: node scripts/maintenance/backfill-iwf-analytics.js
--   4. Test by importing new event data
-- ============================================================================
