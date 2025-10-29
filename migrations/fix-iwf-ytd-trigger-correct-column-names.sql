-- Migration: Fix IWF YTD Trigger - Correct Column Names
-- Purpose: Update trigger to use actual column names (db_result_id not result_id)
-- Issue: Previous trigger used wrong column name, causing silent failures
-- Date: 2025-10-26

BEGIN;

-- Drop existing trigger and function if they exist
DROP TRIGGER IF EXISTS iwf_meet_results_ytd_calculation_trigger ON iwf_meet_results;
DROP FUNCTION IF EXISTS calculate_iwf_ytd_bests();

-- ============================================================================
-- FUNCTION: calculate_iwf_ytd_bests() - FIXED VERSION
-- Calculates Year-to-Date best performances for a lifter
-- YTD = Best performance in calendar year UP TO AND INCLUDING this meet
--
-- FIXES:
-- 1. Uses db_result_id instead of result_id (correct column name)
-- 2. Simplified exclusion logic - don't exclude current row in query
-- 3. Removed unnecessary EXCEPTION handler that was hiding errors
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
    -- Skip calculation if we don't have required fields
    IF NEW.db_lifter_id IS NULL OR NEW.date IS NULL THEN
        NEW.best_snatch_ytd := NULL;
        NEW.best_cj_ytd := NULL;
        NEW.best_total_ytd := NULL;
        RETURN NEW;
    END IF;

    -- Extract year from meet date
    v_year := EXTRACT(YEAR FROM NEW.date::DATE);

    -- Initialize with current result values
    v_max_snatch := CASE
        WHEN NEW.best_snatch IS NOT NULL AND NEW.best_snatch != '---'
        THEN (NEW.best_snatch::NUMERIC)::INTEGER
        ELSE NULL
    END;

    v_max_cj := CASE
        WHEN NEW.best_cj IS NOT NULL AND NEW.best_cj != '---'
        THEN (NEW.best_cj::NUMERIC)::INTEGER
        ELSE NULL
    END;

    v_max_total := CASE
        WHEN NEW.total IS NOT NULL AND NEW.total != '---'
        THEN (NEW.total::NUMERIC)::INTEGER
        ELSE NULL
    END;

    -- Query ALL results for same lifter in same year UP TO this date
    -- We'll find the max including the current result
    FOR v_snatch_value, v_cj_value, v_total_value IN
        SELECT
            CASE WHEN best_snatch IS NOT NULL AND best_snatch != '---'
                 THEN (best_snatch::NUMERIC)::INTEGER ELSE NULL END,
            CASE WHEN best_cj IS NOT NULL AND best_cj != '---'
                 THEN (best_cj::NUMERIC)::INTEGER ELSE NULL END,
            CASE WHEN total IS NOT NULL AND total != '---'
                 THEN (total::NUMERIC)::INTEGER ELSE NULL END
        FROM iwf_meet_results
        WHERE db_lifter_id = NEW.db_lifter_id
          AND EXTRACT(YEAR FROM date::DATE) = v_year
          AND date <= NEW.date
          AND date IS NOT NULL
          -- Exclude the current row being inserted/updated
          AND (
              -- On UPDATE: exclude by primary key
              (TG_OP = 'UPDATE' AND db_result_id != NEW.db_result_id)
              -- On INSERT: no exclusion needed (NEW row not in table yet)
              OR TG_OP = 'INSERT'
          )
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

    -- Set YTD fields (max of current result + previous results)
    NEW.best_snatch_ytd := v_max_snatch;
    NEW.best_cj_ytd := v_max_cj;
    NEW.best_total_ytd := v_max_total;

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
--   - Fixed column name: result_id → db_result_id
--   - Simplified exclusion logic using TG_OP to handle INSERT vs UPDATE
--   - Removed EXCEPTION handler to surface errors instead of hiding them
--   - Current result is now included in YTD calculation
--
-- Expected Behavior:
--   - First meet of year: YTD = current result
--   - Later meets: YTD = MAX(current result, all previous results this year)
--
-- Next Steps:
--   1. Apply this migration via Supabase SQL Editor
--   2. Run backfill: node scripts/maintenance/backfill-iwf-ytd.js
--   3. Test: node scripts/production/iwf-main.js --event-id 661 --year 2025 --limit 10
--   4. Verify: node scripts/maintenance/verify-iwf-ytd-trigger.js
-- ============================================================================
