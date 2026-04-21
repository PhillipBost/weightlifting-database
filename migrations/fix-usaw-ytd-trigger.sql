-- Migration: Fix USAW YTD Trigger Mismatch
-- Purpose: Remove incorrectly assigned IWF trigger and restore USAW YTD logic
BEGIN;

-- 1. Identify and drop any trigger on usaw_meet_results that might be calling the IWF function
-- The common name for this would be usaw_meet_results_ytd_calculation_trigger or similar
DROP TRIGGER IF EXISTS usaw_meet_results_ytd_calculation_trigger ON public.usaw_meet_results;
DROP TRIGGER IF EXISTS iwf_meet_results_ytd_calculation_trigger ON public.usaw_meet_results; -- Just in case it was a direct copy-paste

-- 2. Create the correct USAW-specific YTD calculation function
CREATE OR REPLACE FUNCTION public.calculate_usaw_ytd_bests()
RETURNS TRIGGER AS $$
DECLARE
    v_year INTEGER;
    v_max_snatch INTEGER;
    v_max_cj INTEGER;
    v_max_total INTEGER;
    v_snatch_val INTEGER;
    v_cj_val INTEGER;
    v_total_val INTEGER;
BEGIN
    -- Initialize YTD fields
    NEW.best_snatch_ytd := NULL;
    NEW.best_cj_ytd := NULL;
    NEW.best_total_ytd := NULL;

    -- Skip if required fields are missing (lifter_id and date)
    -- NOTE: Uses 'lifter_id', which is the correct column for USAW
    IF NEW.lifter_id IS NULL OR NEW.date IS NULL THEN
        RETURN NEW;
    END IF;

    -- Extract year
    v_year := EXTRACT(YEAR FROM NEW.date::DATE);

    -- Initialize with the current result's values
    v_max_snatch := (NULLIF(NEW.best_snatch, '---')::NUMERIC)::INTEGER;
    v_max_cj := (NULLIF(NEW.best_cj, '---')::NUMERIC)::INTEGER;
    v_max_total := (NULLIF(NEW.total, '---')::NUMERIC)::INTEGER;

    -- Query all previous results for the SAME lifter in the SAME calendar year
    FOR v_snatch_val, v_cj_val, v_total_val IN
        SELECT 
            (NULLIF(best_snatch, '---')::NUMERIC)::INTEGER,
            (NULLIF(best_cj, '---')::NUMERIC)::INTEGER,
            (NULLIF(total, '---')::NUMERIC)::INTEGER
        FROM public.usaw_meet_results
        WHERE lifter_id = NEW.lifter_id
          AND EXTRACT(YEAR FROM date::DATE) = v_year
          AND date <= NEW.date
          AND date IS NOT NULL
          -- Exclude current record
          -- Note: result_id is the identity/PK for usaw_meet_results
          AND result_id != COALESCE(NEW.result_id, -1)
    LOOP
        IF v_snatch_val > v_max_snatch OR (v_max_snatch IS NULL AND v_snatch_val IS NOT NULL) THEN v_max_snatch := v_snatch_val; END IF;
        IF v_cj_val > v_max_cj OR (v_max_cj IS NULL AND v_cj_val IS NOT NULL) THEN v_max_cj := v_cj_val; END IF;
        IF v_total_val > v_max_total OR (v_max_total IS NULL AND v_total_val IS NOT NULL) THEN v_max_total := v_total_val; END IF;
    END LOOP;

    NEW.best_snatch_ytd := v_max_snatch;
    NEW.best_cj_ytd := v_max_cj;
    NEW.best_total_ytd := v_max_total;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create the trigger on usaw_meet_results
CREATE TRIGGER usaw_meet_results_ytd_calculation_trigger
    BEFORE INSERT OR UPDATE ON public.usaw_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION public.calculate_usaw_ytd_bests();

COMMIT;
