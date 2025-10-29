-- Migration: Update IWF YTD Trigger to Include Current Result
-- Purpose: Fix YTD calculation to include current result (not just previous)
-- YTD = Year-to-Date = Best performance SO FAR this year (including today)
-- Date: 2025-10-26

BEGIN;

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS iwf_meet_results_ytd_calculation_trigger ON iwf_meet_results;
DROP FUNCTION IF EXISTS calculate_iwf_ytd_bests();

-- ============================================================================
-- FUNCTION: calculate_iwf_ytd_bests() - CORRECTED VERSION
-- Calculates Year-to-Date best performances for a lifter
-- YTD = Best performance in calendar year UP TO AND INCLUDING this meet
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_iwf_ytd_bests()
RETURNS TRIGGER AS $$
DECLARE
    v_year INTEGER;
    v_max_snatch INTEGER;
    v_max_cj INTEGER;
    v_max_total INTEGER;
    v_snatch_value INTEGER;
    v_cj_value INTEGER;
    v_total_value INTEGER;
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
                         THEN (NEW.best_snatch::NUMERIC)::INTEGER ELSE NULL END;
    v_max_cj := CASE WHEN NEW.best_cj != '---' AND NEW.best_cj IS NOT NULL 
                     THEN (NEW.best_cj::NUMERIC)::INTEGER ELSE NULL END;
    v_max_total := CASE WHEN NEW.total != '---' AND NEW.total IS NOT NULL 
                       THEN (NEW.total::NUMERIC)::INTEGER ELSE NULL END;

    BEGIN
        -- Query all previous results for same lifter in same calendar year
        -- UP TO AND INCLUDING this meet date (YTD = best so far this year)
        FOR v_snatch_value, v_cj_value, v_total_value IN
            SELECT 
                CASE WHEN best_snatch != '---' THEN (best_snatch::NUMERIC)::INTEGER ELSE NULL END,
                CASE WHEN best_cj != '---' THEN (best_cj::NUMERIC)::INTEGER ELSE NULL END,
                CASE WHEN total != '---' THEN (total::NUMERIC)::INTEGER ELSE NULL END
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

        -- Set YTD fields (includes current result + any previous results)
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

-- ============================================================================
-- TRIGGER: Calculate YTD bests on INSERT or UPDATE
-- ============================================================================

CREATE TRIGGER iwf_meet_results_ytd_calculation_trigger
    BEFORE INSERT OR UPDATE ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION calculate_iwf_ytd_bests();

COMMIT;

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- Changes:
--   - Dropped and recreated trigger with corrected logic
--   - YTD now includes current result (not just previous results)
--   - First meet of year will have YTD = current result
--   - Subsequent meets will have YTD = max(current + all previous in year)
--
-- Next Steps:
--   1. Run backfill script: node scripts/maintenance/backfill-iwf-ytd.js
--   2. Verify: SELECT lifter_name, date, best_snatch, best_snatch_ytd FROM iwf_meet_results WHERE date >= '2025-01-01' LIMIT 10;
-- ============================================================================
