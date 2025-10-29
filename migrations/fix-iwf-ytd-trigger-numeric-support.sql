-- Migration: Fix IWF YTD Trigger to Support NUMERIC Decimals
-- Purpose: Update trigger to handle NUMERIC column types for YTD fields
-- This fixes the loss of decimal values (.5 kg increments) from historical data
-- Date: 2025-10-28
--
-- Changes:
--   1. Variable types changed from INTEGER to NUMERIC
--   2. Removed ::INTEGER casts to preserve decimal precision
--   3. Maintains TEXT→NUMERIC conversion for lift fields

BEGIN;

-- ============================================================================
-- FUNCTION: calculate_iwf_ytd_bests() - UPDATED VERSION
-- Calculates Year-to-Date best performances for a lifter
-- This is RETROSPECTIVE: finds best performance in same calendar year BEFORE this meet
-- Now supports NUMERIC fields to preserve decimal values
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_iwf_ytd_bests()
RETURNS TRIGGER AS $$
DECLARE
    v_year INTEGER;
    v_max_snatch NUMERIC;
    v_max_cj NUMERIC;
    v_max_total NUMERIC;
    v_snatch_value NUMERIC;
    v_cj_value NUMERIC;
    v_total_value NUMERIC;
BEGIN
    -- Initialize YTD fields to NULL
    NEW.best_snatch_ytd := NULL;
    NEW.best_cj_ytd := NULL;
    NEW.best_total_ytd := NULL;

    -- Skip calculation if we don't have required fields
    IF NEW.db_lifter_id IS NULL OR NEW.date IS NULL THEN
        RETURN NEW;
    END IF;

    -- Extract year from meet date
    v_year := EXTRACT(YEAR FROM NEW.date::DATE);

    -- First, consider the current result
    v_max_snatch := CASE WHEN NEW.best_snatch != '---' AND NEW.best_snatch IS NOT NULL
                         THEN NEW.best_snatch::NUMERIC ELSE NULL END;
    v_max_cj := CASE WHEN NEW.best_cj != '---' AND NEW.best_cj IS NOT NULL
                     THEN NEW.best_cj::NUMERIC ELSE NULL END;
    v_max_total := CASE WHEN NEW.total != '---' AND NEW.total IS NOT NULL
                       THEN NEW.total::NUMERIC ELSE NULL END;

    BEGIN
        -- Query all previous results for same lifter in same calendar year
        -- UP TO AND INCLUDING this meet date (YTD = best so far this year)
        FOR v_snatch_value, v_cj_value, v_total_value IN
            SELECT
                CASE WHEN best_snatch != '---' THEN best_snatch::NUMERIC ELSE NULL END,
                CASE WHEN best_cj != '---' THEN best_cj::NUMERIC ELSE NULL END,
                CASE WHEN total != '---' THEN total::NUMERIC ELSE NULL END
            FROM iwf_meet_results
            WHERE db_lifter_id = NEW.db_lifter_id
              AND EXTRACT(YEAR FROM date::DATE) = v_year
              AND date <= NEW.date
              AND date IS NOT NULL
              AND result_id != COALESCE(NEW.result_id, -1)
        LOOP
            -- Track maximum snatch
            IF v_snatch_value IS NOT NULL THEN
                IF v_max_snatch IS NULL OR v_snatch_value > v_max_snatch THEN
                    v_max_snatch := v_snatch_value;
                END IF;
            END IF;

            -- Track maximum C&J
            IF v_cj_value IS NOT NULL THEN
                IF v_max_cj IS NULL OR v_cj_value > v_max_cj THEN
                    v_max_cj := v_cj_value;
                END IF;
            END IF;

            -- Track maximum total
            IF v_total_value IS NOT NULL THEN
                IF v_max_total IS NULL OR v_total_value > v_max_total THEN
                    v_max_total := v_total_value;
                END IF;
            END IF;
        END LOOP;

        -- Set YTD fields if we found previous results
        NEW.best_snatch_ytd := v_max_snatch;
        NEW.best_cj_ytd := v_max_cj;
        NEW.best_total_ytd := v_max_total;

    EXCEPTION WHEN OTHERS THEN
        -- If query fails, leave YTD fields as NULL
        NULL;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- Function Updated: 1
--   - calculate_iwf_ytd_bests() now uses NUMERIC types
--
-- Key changes:
--   1. v_max_snatch, v_max_cj, v_max_total: INTEGER → NUMERIC
--   2. v_snatch_value, v_cj_value, v_total_value: INTEGER → NUMERIC
--   3. Removed ::INTEGER casts, kept ::NUMERIC only
--   4. Preserves decimal values from TEXT fields (e.g., "100.5")
--
-- Next Steps:
--   1. Run this SQL in Supabase SQL Editor
--   2. Verify function updated: SELECT routine_name FROM information_schema.routines
--      WHERE routine_name = 'calculate_iwf_ytd_bests';
--   3. Test with a re-import of decimal data
-- ============================================================================
