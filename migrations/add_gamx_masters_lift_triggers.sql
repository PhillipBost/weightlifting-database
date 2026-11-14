-- Owner-run migration. Existing scores are not backfilled.
BEGIN;

DO $$
DECLARE
    result_table regclass;
BEGIN
    IF round(public.get_gamx_score('sm', 'm', 40, 85.2, 100), 2)
           IS DISTINCT FROM 930.29::numeric
       OR round(public.get_gamx_score('jm', 'm', 40, 85.2, 130), 2)
           IS DISTINCT FROM 968.65::numeric THEN
        RAISE EXCEPTION 'Masters-lift lookup verification failed';
    END IF;

    FOREACH result_table IN ARRAY ARRAY[
        'public.usaw_meet_results'::regclass,
        'public.iwf_meet_results'::regclass,
        'public.owlcms_meet_results'::regclass
    ] LOOP
        IF EXISTS (
            SELECT 1
            FROM pg_trigger t
            WHERE t.tgrelid = result_table
              AND NOT t.tgisinternal
              AND (t.tgtype::integer & 1) = 1
              AND (t.tgtype::integer & 2) = 2
              AND t.tgname::text COLLATE "C" >= 'zz_gamx_masters_lifts'
        ) THEN
            RAISE EXCEPTION 'A BEFORE ROW trigger on % may run after the new score trigger', result_table;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.usaw_meet_results'::regclass
          AND tgname = 'update_competition_age_trigger'
          AND tgenabled IN ('O', 'A')
          AND tgfoid = 'public.calculate_competition_age()'::regprocedure
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.iwf_meet_results'::regclass
          AND tgname = 'iwf_meet_results_competition_age_trigger'
          AND tgenabled IN ('O', 'A')
          AND tgfoid = 'public.calculate_iwf_competition_age()'::regprocedure
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.owlcms_meet_results'::regclass
          AND tgname = 'trg_calculate_owlcms_analytics'
          AND tgenabled IN ('O', 'A')
          AND tgfoid = 'public.calculate_owlcms_analytics()'::regprocedure
    ) THEN
        RAISE EXCEPTION 'Expected competition-age triggers were not found or are disabled';
    END IF;
END $$;

ALTER TABLE public.usaw_meet_results
    ADD COLUMN gamx_sm numeric,
    ADD COLUMN gamx_jm numeric;
ALTER TABLE public.iwf_meet_results
    ADD COLUMN gamx_sm numeric,
    ADD COLUMN gamx_jm numeric;
ALTER TABLE public.owlcms_meet_results
    ADD COLUMN gamx_sm numeric,
    ADD COLUMN gamx_jm numeric;

CREATE FUNCTION public.calculate_gamx_masters_lifts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    bodyweight numeric;
    snatch numeric;
    clean_and_jerk numeric;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.gender IS NOT DISTINCT FROM OLD.gender
           AND NEW.birth_year IS NOT DISTINCT FROM OLD.birth_year
           AND NEW.competition_age IS NOT DISTINCT FROM OLD.competition_age
           AND NEW.body_weight_kg IS NOT DISTINCT FROM OLD.body_weight_kg
           AND NEW.best_snatch IS NOT DISTINCT FROM OLD.best_snatch
           AND NEW.best_cj IS NOT DISTINCT FROM OLD.best_cj THEN
            IF TG_TABLE_NAME = 'owlcms_meet_results' THEN
                RETURN NEW;
            ELSIF NEW.date IS NOT DISTINCT FROM OLD.date THEN
                RETURN NEW;
            END IF;
        END IF;
    END IF;

    IF TG_TABLE_NAME = 'owlcms_meet_results' THEN
        bodyweight := NEW.body_weight_kg;
        snatch := NEW.best_snatch;
        clean_and_jerk := NEW.best_cj;
    ELSE
        bodyweight := public.text_to_numeric_safe(NEW.body_weight_kg);
        snatch := public.text_to_numeric_safe(NEW.best_snatch);
        clean_and_jerk := public.text_to_numeric_safe(NEW.best_cj);
        IF btrim(NEW.body_weight_kg) LIKE '-%' THEN bodyweight := NULL; END IF;
        IF btrim(NEW.best_snatch) LIKE '-%' THEN snatch := NULL; END IF;
        IF btrim(NEW.best_cj) LIKE '-%' THEN clean_and_jerk := NULL; END IF;
    END IF;

    IF bodyweight IS NULL OR bodyweight <= 0
       OR NEW.gender IS NULL OR NEW.competition_age IS NULL THEN
        NEW.gamx_sm := NULL;
        NEW.gamx_jm := NULL;
    ELSE
        NEW.gamx_sm := public.get_gamx_score(
            'sm', NEW.gender, NEW.competition_age, bodyweight, snatch
        );
        NEW.gamx_jm := public.get_gamx_score(
            'jm', NEW.gender, NEW.competition_age, bodyweight, clean_and_jerk
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER zz_gamx_masters_lifts
    BEFORE INSERT OR UPDATE ON public.usaw_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.calculate_gamx_masters_lifts();
CREATE TRIGGER zz_gamx_masters_lifts
    BEFORE INSERT OR UPDATE ON public.iwf_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.calculate_gamx_masters_lifts();
CREATE TRIGGER zz_gamx_masters_lifts
    BEFORE INSERT OR UPDATE ON public.owlcms_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.calculate_gamx_masters_lifts();

CREATE FUNCTION public.propagate_masters_lift_demographics()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    copy_gender boolean := NEW.gender IS DISTINCT FROM OLD.gender
                           AND NULLIF(btrim(NEW.gender), '') IS NOT NULL;
    copy_birth_year boolean := NEW.birth_year IS DISTINCT FROM OLD.birth_year
                               AND NEW.birth_year IS NOT NULL;
BEGIN
    IF NOT copy_gender AND NOT copy_birth_year THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'iwf_lifters' THEN
        IF copy_birth_year THEN
            UPDATE public.iwf_meet_results r
            SET gender = CASE WHEN copy_gender THEN NEW.gender ELSE r.gender END,
                birth_year = NEW.birth_year
            WHERE r.db_lifter_id = NEW.db_lifter_id
              AND ((copy_gender AND r.gender IS DISTINCT FROM NEW.gender)
                OR r.birth_year IS DISTINCT FROM NEW.birth_year);
        ELSE
            UPDATE public.iwf_meet_results r
            SET gender = NEW.gender
            WHERE r.db_lifter_id = NEW.db_lifter_id
              AND r.gender IS DISTINCT FROM NEW.gender;
        END IF;
    ELSIF TG_TABLE_NAME = 'owlcms_lifters' THEN
        IF copy_birth_year THEN
            UPDATE public.owlcms_meet_results r
            SET gender = CASE WHEN copy_gender THEN NEW.gender ELSE r.gender END,
                birth_year = NEW.birth_year
            WHERE r.lifter_id = NEW.lifter_id
              AND ((copy_gender AND r.gender IS DISTINCT FROM NEW.gender)
                OR r.birth_year IS DISTINCT FROM NEW.birth_year);
        ELSE
            UPDATE public.owlcms_meet_results r
            SET gender = NEW.gender
            WHERE r.lifter_id = NEW.lifter_id
              AND r.gender IS DISTINCT FROM NEW.gender;
        END IF;
    ELSE
        RAISE EXCEPTION 'Unexpected athlete table: %', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER propagate_gamx_masters_lift_demographics
    AFTER UPDATE OF gender, birth_year ON public.iwf_lifters
    FOR EACH ROW EXECUTE FUNCTION public.propagate_masters_lift_demographics();
CREATE TRIGGER propagate_gamx_masters_lift_demographics
    AFTER UPDATE OF gender, birth_year ON public.owlcms_lifters
    FOR EACH ROW EXECUTE FUNCTION public.propagate_masters_lift_demographics();

COMMIT;
