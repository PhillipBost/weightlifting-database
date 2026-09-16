-- ============================================================================
-- Migration: Add Analytics & Sabermetrics Columns to OWLCMS Results
-- Purpose: Add the complete analytical suite (GAMX, Q-Scores, Attempt Metrics,
--          Bounce-Back, YTD Bests, and Age/Demographics) to owlcms_meet_results.
-- Date: 2026-09-13
-- ============================================================================

BEGIN;

-- 1. Demographics & Competition Age Context
ALTER TABLE public.owlcms_meet_results
    ADD COLUMN IF NOT EXISTS gender TEXT,
    ADD COLUMN IF NOT EXISTS birth_year INTEGER,
    ADD COLUMN IF NOT EXISTS competition_age INTEGER;

-- 2. Full GAMX Breakdown Suite
ALTER TABLE public.owlcms_meet_results
    ADD COLUMN IF NOT EXISTS gamx_u NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_a NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_masters NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_total NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_s NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_j NUMERIC;

-- 3. Q-Scores Suite
ALTER TABLE public.owlcms_meet_results
    ADD COLUMN IF NOT EXISTS qpoints NUMERIC,
    ADD COLUMN IF NOT EXISTS q_masters NUMERIC,
    ADD COLUMN IF NOT EXISTS q_youth NUMERIC;

-- 4. Attempt Performance Metrics
ALTER TABLE public.owlcms_meet_results
    ADD COLUMN IF NOT EXISTS snatch_successful_attempts INTEGER,
    ADD COLUMN IF NOT EXISTS cj_successful_attempts INTEGER,
    ADD COLUMN IF NOT EXISTS total_successful_attempts INTEGER;

-- 5. Clutch / Bounce-Back Recovery Metrics
ALTER TABLE public.owlcms_meet_results
    ADD COLUMN IF NOT EXISTS bounce_back_snatch_2 BOOLEAN,
    ADD COLUMN IF NOT EXISTS bounce_back_snatch_3 BOOLEAN,
    ADD COLUMN IF NOT EXISTS bounce_back_cj_2 BOOLEAN,
    ADD COLUMN IF NOT EXISTS bounce_back_cj_3 BOOLEAN;

-- 6. Year-To-Date Career Tracking
ALTER TABLE public.owlcms_meet_results
    ADD COLUMN IF NOT EXISTS best_snatch_ytd NUMERIC(5,1),
    ADD COLUMN IF NOT EXISTS best_cj_ytd NUMERIC(5,1),
    ADD COLUMN IF NOT EXISTS best_total_ytd NUMERIC(5,1);

-- 7. Analytics Calculation Trigger Function
CREATE OR REPLACE FUNCTION public.calculate_owlcms_analytics()
RETURNS TRIGGER AS $$
DECLARE
    v_meet_year INTEGER;
    v_meet_date DATE;
    v_s1_make BOOLEAN;
    v_s2_make BOOLEAN;
    v_s3_make BOOLEAN;
    v_cj1_make BOOLEAN;
    v_cj2_make BOOLEAN;
    v_cj3_make BOOLEAN;
    v_base_q NUMERIC;
    v_masters_factor NUMERIC;
    v_youth_factor NUMERIC;
    v_prior_snatch NUMERIC;
    v_prior_cj NUMERIC;
    v_prior_total NUMERIC;
BEGIN
    -- 1. Sync demographics from lifter if missing
    IF NEW.gender IS NULL OR NEW.birth_year IS NULL THEN
        SELECT l.gender, l.birth_year
        INTO NEW.gender, NEW.birth_year
        FROM public.owlcms_lifters l
        WHERE l.lifter_id = NEW.lifter_id;
    END IF;

    -- 2. Fetch meet date and calculate competition age
    SELECT m.start_date, EXTRACT(YEAR FROM m.start_date)::INTEGER
    INTO v_meet_date, v_meet_year
    FROM public.owlcms_meets m
    WHERE m.meet_id = NEW.meet_id;

    IF v_meet_year IS NOT NULL AND NEW.birth_year IS NOT NULL THEN
        NEW.competition_age := v_meet_year - NEW.birth_year;
    END IF;

    -- 3. Calculate Attempt Success Counts
    v_s1_make := (NEW.snatch_1 IS NOT NULL AND NEW.snatch_1 > 0);
    v_s2_make := (NEW.snatch_2 IS NOT NULL AND NEW.snatch_2 > 0);
    v_s3_make := (NEW.snatch_3 IS NOT NULL AND NEW.snatch_3 > 0);
    NEW.snatch_successful_attempts := 
        (CASE WHEN v_s1_make THEN 1 ELSE 0 END) +
        (CASE WHEN v_s2_make THEN 1 ELSE 0 END) +
        (CASE WHEN v_s3_make THEN 1 ELSE 0 END);

    v_cj1_make := (NEW.cj_1 IS NOT NULL AND NEW.cj_1 > 0);
    v_cj2_make := (NEW.cj_2 IS NOT NULL AND NEW.cj_2 > 0);
    v_cj3_make := (NEW.cj_3 IS NOT NULL AND NEW.cj_3 > 0);
    NEW.cj_successful_attempts := 
        (CASE WHEN v_cj1_make THEN 1 ELSE 0 END) +
        (CASE WHEN v_cj2_make THEN 1 ELSE 0 END) +
        (CASE WHEN v_cj3_make THEN 1 ELSE 0 END);

    NEW.total_successful_attempts := NEW.snatch_successful_attempts + NEW.cj_successful_attempts;

    -- 4. Bounce-Back Recovery Metrics
    -- Snatch 2 (missed 1st, took 2nd)
    IF NEW.snatch_1 IS NOT NULL AND NEW.snatch_1 < 0 AND NEW.snatch_2 IS NOT NULL AND NEW.snatch_2 != 0 THEN
        NEW.bounce_back_snatch_2 := v_s2_make;
    ELSE
        NEW.bounce_back_snatch_2 := NULL;
    END IF;

    -- Snatch 3 (missed 2nd, took 3rd)
    IF NEW.snatch_2 IS NOT NULL AND NEW.snatch_2 < 0 AND NEW.snatch_3 IS NOT NULL AND NEW.snatch_3 != 0 THEN
        NEW.bounce_back_snatch_3 := v_s3_make;
    ELSE
        NEW.bounce_back_snatch_3 := NULL;
    END IF;

    -- CJ 2 (missed 1st, took 2nd)
    IF NEW.cj_1 IS NOT NULL AND NEW.cj_1 < 0 AND NEW.cj_2 IS NOT NULL AND NEW.cj_2 != 0 THEN
        NEW.bounce_back_cj_2 := v_cj2_make;
    ELSE
        NEW.bounce_back_cj_2 := NULL;
    END IF;

    -- CJ 3 (missed 2nd, took 3rd)
    IF NEW.cj_2 IS NOT NULL AND NEW.cj_2 < 0 AND NEW.cj_3 IS NOT NULL AND NEW.cj_3 != 0 THEN
        NEW.bounce_back_cj_3 := v_cj3_make;
    ELSE
        NEW.bounce_back_cj_3 := NULL;
    END IF;

    -- 5. GAMX Calculations (via existing public.get_gamx_score)
    IF NEW.body_weight_kg IS NOT NULL AND NEW.body_weight_kg > 0 AND NEW.gender IS NOT NULL THEN
        IF NEW.total IS NOT NULL AND NEW.total > 0 THEN
            NEW.gamx_u := get_gamx_score('u', NEW.gender, NEW.competition_age, NEW.body_weight_kg, NEW.total);
            NEW.gamx_a := get_gamx_score('a', NEW.gender, NEW.competition_age, NEW.body_weight_kg, NEW.total);
            NEW.gamx_masters := get_gamx_score('masters', NEW.gender, NEW.competition_age, NEW.body_weight_kg, NEW.total);
            NEW.gamx_total := get_gamx_score('total', NEW.gender, NEW.competition_age, NEW.body_weight_kg, NEW.total);
        ELSE
            NEW.gamx_u := NULL;
            NEW.gamx_a := NULL;
            NEW.gamx_masters := NULL;
            NEW.gamx_total := NULL;
        END IF;

        IF NEW.best_snatch IS NOT NULL AND NEW.best_snatch > 0 THEN
            NEW.gamx_s := get_gamx_score('s', NEW.gender, NEW.competition_age, NEW.body_weight_kg, NEW.best_snatch);
        ELSE
            NEW.gamx_s := NULL;
        END IF;

        IF NEW.best_cj IS NOT NULL AND NEW.best_cj > 0 THEN
            NEW.gamx_j := get_gamx_score('j', NEW.gender, NEW.competition_age, NEW.body_weight_kg, NEW.best_cj);
        ELSE
            NEW.gamx_j := NULL;
        END IF;
    END IF;

    -- 6. Q-Scores Calculations
    IF NEW.total IS NOT NULL AND NEW.total > 0 AND NEW.body_weight_kg IS NOT NULL AND NEW.body_weight_kg > 0 AND NEW.gender IS NOT NULL THEN
        v_base_q := calculate_qpoints_from_row(NEW.total, NEW.body_weight_kg, NEW.gender);

        -- qpoints (Senior ages 21-30)
        IF NEW.competition_age IS NOT NULL AND NEW.competition_age BETWEEN 21 AND 30 THEN
            NEW.qpoints := v_base_q;
        ELSE
            NEW.qpoints := NULL;
        END IF;

        -- q_masters (Masters ages 31+)
        IF v_base_q IS NOT NULL AND v_base_q > 0 AND NEW.competition_age IS NOT NULL AND NEW.competition_age >= 31 THEN
            v_masters_factor := get_age_factor(NEW.competition_age, NEW.gender);
            NEW.q_masters := ROUND(v_base_q * v_masters_factor, 2);
        ELSE
            NEW.q_masters := NULL;
        END IF;

        -- q_youth (Youth ages 10-20)
        IF NEW.competition_age IS NOT NULL AND NEW.competition_age BETWEEN 10 AND 20 THEN
            v_youth_factor := get_youth_age_factor_interpolated(NEW.competition_age, NEW.body_weight_kg, NEW.gender);
            NEW.q_youth := ROUND(NEW.total * v_youth_factor, 2);
        ELSE
            NEW.q_youth := NULL;
        END IF;
    END IF;

    -- 7. Year-to-Date (YTD) Career Progression
    IF v_meet_year IS NOT NULL AND v_meet_date IS NOT NULL THEN
        SELECT 
            COALESCE(MAX(r.best_snatch), 0),
            COALESCE(MAX(r.best_cj), 0),
            COALESCE(MAX(r.total), 0)
        INTO v_prior_snatch, v_prior_cj, v_prior_total
        FROM public.owlcms_meet_results r
        JOIN public.owlcms_meets m ON r.meet_id = m.meet_id
        WHERE r.lifter_id = NEW.lifter_id
          AND EXTRACT(YEAR FROM m.start_date) = v_meet_year
          AND m.start_date <= v_meet_date
          AND r.result_id != COALESCE(NEW.result_id, 0);

        NEW.best_snatch_ytd := GREATEST(COALESCE(NEW.best_snatch, 0), v_prior_snatch);
        IF NEW.best_snatch_ytd = 0 THEN NEW.best_snatch_ytd := NULL; END IF;

        NEW.best_cj_ytd := GREATEST(COALESCE(NEW.best_cj, 0), v_prior_cj);
        IF NEW.best_cj_ytd = 0 THEN NEW.best_cj_ytd := NULL; END IF;

        NEW.best_total_ytd := GREATEST(COALESCE(NEW.total, 0), v_prior_total);
        IF NEW.best_total_ytd = 0 THEN NEW.best_total_ytd := NULL; END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Attach Trigger to owlcms_meet_results
DROP TRIGGER IF EXISTS trg_calculate_owlcms_analytics ON public.owlcms_meet_results;
CREATE TRIGGER trg_calculate_owlcms_analytics
    BEFORE INSERT OR UPDATE ON public.owlcms_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION public.calculate_owlcms_analytics();

-- 9. Backfill all existing records (triggers automatic calculation for already uploaded meets)
UPDATE public.owlcms_meet_results
SET updated_at = NOW();

COMMIT;
