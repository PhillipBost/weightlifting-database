-- Migration: Final Fix for USAW Trigger Crash
-- Purpose: Corrects the refresh_athlete_json_trigger to be table-aware and ensures USAW YTD logic is clean.
BEGIN;

--------------------------------------------------------------------------------
-- 1. Fix the "Ambidextrous" Refresh Trigger
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_athlete_json_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_lifter_id BIGINT;
BEGIN
  -- TABLE AWARENESS: Distinguish between USAW (lifter_id) and IWF (db_lifter_id)
  -- This prevents "record 'new' has no field 'db_lifter_id'" crashes on USAW inserts.
  IF TG_TABLE_NAME = 'usaw_meet_results' THEN
    v_lifter_id := NEW.lifter_id;
  ELSIF TG_TABLE_NAME = 'iwf_meet_results' THEN
    v_lifter_id := NEW.db_lifter_id;
  ELSE
    -- Default to lifter_id for standard lifters tables
    BEGIN
        v_lifter_id := NEW.lifter_id;
    EXCEPTION WHEN OTHERS THEN
        v_lifter_id := NULL;
    END;
  END IF;

  -- Only attempt refresh if we have a valid ID
  IF v_lifter_id IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'http://46.62.223.85:8889/refresh-athlete',
        body := jsonb_build_object(
          'lifter_id', v_lifter_id,
          'secret', 'YPanfk8C8bZqzCr38vjoHMxlsVE3s4Ht'
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
  END IF;

  RETURN NEW;
END;
$function$;

--------------------------------------------------------------------------------
-- 2. Verify and Re-apply USAW YTD Function (Clean Version)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_usaw_ytd_bests()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_year INTEGER;
    v_max_snatch INTEGER;
    v_max_cj INTEGER;
    v_max_total INTEGER;
    v_snatch_val INTEGER;
    v_cj_val INTEGER;
    v_total_val INTEGER;
BEGIN
    -- Skip if required fields are missing
    IF NEW.lifter_id IS NULL OR NEW.date IS NULL THEN
        RETURN NEW;
    END IF;

    v_year := EXTRACT(YEAR FROM NEW.date::DATE);

    -- Initialize with the current result values
    v_max_snatch := (NULLIF(NEW.best_snatch, '---')::NUMERIC)::INTEGER;
    v_max_cj := (NULLIF(NEW.best_cj, '---')::NUMERIC)::INTEGER;
    v_max_total := (NULLIF(NEW.total, '---')::NUMERIC)::INTEGER;

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
$function$;

COMMIT;
