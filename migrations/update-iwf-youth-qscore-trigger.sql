-- Migration: Update IWF Q-Youth Score Trigger to Use youth_factors Multipliers
-- Purpose: Apply age-specific multipliers to youth Q-scores (ages 10-20)
-- This ensures consistency with USAW database youth scoring
-- Date: 2025-01-26
--
-- Changes:
--   - Modifies update_iwf_qpoints_on_change() function to lookup youth_factors
--   - For ages 10-20: applies age-specific multiplier to base Huebner formula
--   - Falls back to base Huebner if no multiplier found

BEGIN;

-- ============================================================================
-- UPDATED FUNCTION: update_iwf_qpoints_on_change()
-- Now uses youth_factors table for ages 10-20
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
    v_youth_multiplier NUMERIC;
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

    -- Ages 10-20: Q-youth with age-specific multiplier from youth_factors
    IF v_age >= 10 AND v_age <= 20 THEN
        -- Calculate base Huebner score
        IF NEW.gender = 'M' THEN
            v_denominator := 416.7 - 47.87 * POWER(v_B, -2) + 18.93 * POWER(v_B, 2);
            v_qscore := v_total * 463.26 / v_denominator;
        ELSIF NEW.gender = 'F' THEN
            v_denominator := 266.5 - 19.44 * POWER(v_B, -2) + 18.61 * POWER(v_B, 2);
            v_qscore := v_total * 306.54 / v_denominator;
        ELSE
            RETURN NEW;
        END IF;

        -- Look up age-specific multiplier from youth_factors table
        BEGIN
            SELECT multiplier INTO v_youth_multiplier
            FROM youth_factors
            WHERE age = v_age AND gender = NEW.gender;
        EXCEPTION WHEN OTHERS THEN
            v_youth_multiplier := NULL;
        END;

        -- Apply multiplier if found, otherwise use base score
        IF v_youth_multiplier IS NOT NULL THEN
            NEW.q_youth := ROUND((v_qscore * v_youth_multiplier)::NUMERIC, 3);
        ELSE
            -- Fallback to base Huebner formula if multiplier not found
            NEW.q_youth := ROUND(v_qscore::NUMERIC, 3);
        END IF;

        RETURN NEW;
    END IF;

    -- Ages 21-30: Q-points only (standard Huebner, no age adjustment)
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

    -- Ages 31+: Q-masters only (standard Huebner, no age adjustment)
    IF v_age >= 31 THEN
        IF NEW.gender = 'M' THEN
            v_denominator := 416.7 - 47.87 * POWER(v_B, -2) + 18.93 * POWER(v_B, 2);
            v_qscore := ROUND((v_total * 463.26 / v_denominator)::NUMERIC, 3);
            NEW.q_masters := v_qscore;
        ELSIF NEW.gender = 'F' THEN
            v_denominator := 266.5 - 19.44 * POWER(v_B, -2) + 18.61 * POWER(v_B, 2);
            v_qscore := ROUND((v_total * 306.54 / v_denominator)::NUMERIC, 3);
            NEW.q_masters := v_qscore;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- Updated Functions: 1
--   - update_iwf_qpoints_on_change() - Now uses youth_factors multipliers
--
-- Next Steps:
--   1. Run this SQL in Supabase SQL Editor
--   2. Verify function updated: SELECT prosrc FROM pg_proc WHERE proname = 'update_iwf_qpoints_on_change';
--   3. Run backfill script for existing records: node scripts/maintenance/backfill-iwf-analytics.js
--   4. Test with event containing youth athletes (ages 10-20)
-- ============================================================================
