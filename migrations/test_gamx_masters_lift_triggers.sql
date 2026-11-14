-- Owner-run rollback test. To test before installation, paste the migration
-- between this file's BEGIN and the first CREATE TEMP TABLE, excluding the
-- migration's BEGIN and COMMIT. Never include COMMIT in a rollback test.
-- The athlete checks temporarily update one existing athlete and result per
-- federation. Other triggers on those rows also run until ROLLBACK.
BEGIN;

CREATE TEMP TABLE usaw_meet_results (
    date text, birth_year integer, competition_age integer, gender text,
    body_weight_kg text, best_snatch text, best_cj text,
    gamx_sm numeric, gamx_jm numeric
);
CREATE TRIGGER update_competition_age_trigger
    BEFORE INSERT OR UPDATE OF date, birth_year, competition_age
    ON pg_temp.usaw_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.calculate_competition_age();
CREATE TRIGGER zz_gamx_masters_lifts
    BEFORE INSERT OR UPDATE ON pg_temp.usaw_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.calculate_gamx_masters_lifts();

CREATE TEMP TABLE iwf_meet_results (
    date text, birth_year integer, competition_age integer, gender text,
    body_weight_kg text, best_snatch text, best_cj text,
    gamx_sm numeric, gamx_jm numeric
);
CREATE TRIGGER iwf_meet_results_competition_age_trigger
    BEFORE INSERT OR UPDATE OF date, birth_year
    ON pg_temp.iwf_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.calculate_iwf_competition_age();
CREATE TRIGGER zz_gamx_masters_lifts
    BEFORE INSERT OR UPDATE ON pg_temp.iwf_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.calculate_gamx_masters_lifts();

CREATE TEMP TABLE owlcms_meet_results (
    birth_year integer, competition_age integer, gender text, body_weight_kg numeric,
    best_snatch numeric, best_cj numeric, gamx_sm numeric, gamx_jm numeric
);
CREATE TRIGGER zz_gamx_masters_lifts
    BEFORE INSERT OR UPDATE ON pg_temp.owlcms_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.calculate_gamx_masters_lifts();

DO $$
DECLARE
    row_data record;
    athlete_id bigint;
    new_gender text;
    new_birth_year integer;
BEGIN
    INSERT INTO pg_temp.usaw_meet_results (date, birth_year, gender, body_weight_kg, best_snatch, best_cj)
    VALUES ('2020-01-01', 1980, 'm', '85.2', '100', '130');
    INSERT INTO pg_temp.iwf_meet_results (date, birth_year, gender, body_weight_kg, best_snatch, best_cj)
    VALUES ('2020-01-01', 1980, 'm', '85.2', '100', '130');
    INSERT INTO pg_temp.owlcms_meet_results (competition_age, gender, body_weight_kg, best_snatch, best_cj)
    VALUES (40, 'm', 85.2, 100, 130);

    FOR row_data IN
        SELECT competition_age, gamx_sm, gamx_jm FROM pg_temp.usaw_meet_results
        UNION ALL SELECT competition_age, gamx_sm, gamx_jm FROM pg_temp.iwf_meet_results
        UNION ALL SELECT competition_age, gamx_sm, gamx_jm FROM pg_temp.owlcms_meet_results
    LOOP
        IF row_data.competition_age IS DISTINCT FROM 40
           OR round(row_data.gamx_sm, 2) IS DISTINCT FROM 930.29::numeric
           OR round(row_data.gamx_jm, 2) IS DISTINCT FROM 968.65::numeric THEN
            RAISE EXCEPTION 'Masters-lift insert or age ordering test failed';
        END IF;
    END LOOP;

    UPDATE pg_temp.usaw_meet_results SET birth_year = 1981;
    UPDATE pg_temp.iwf_meet_results SET birth_year = 1981;
    UPDATE pg_temp.owlcms_meet_results SET competition_age = 39;
    FOR row_data IN
        SELECT competition_age, gamx_sm, gamx_jm FROM pg_temp.usaw_meet_results
        UNION ALL SELECT competition_age, gamx_sm, gamx_jm FROM pg_temp.iwf_meet_results
        UNION ALL SELECT competition_age, gamx_sm, gamx_jm FROM pg_temp.owlcms_meet_results
    LOOP
        IF row_data.competition_age IS DISTINCT FROM 39
           OR row_data.gamx_sm IS DISTINCT FROM public.get_gamx_score('sm', 'm', 39, 85.2, 100)
           OR row_data.gamx_jm IS DISTINCT FROM public.get_gamx_score('jm', 'm', 39, 85.2, 130) THEN
            RAISE EXCEPTION 'Masters-lift age update test failed';
        END IF;
    END LOOP;

    UPDATE pg_temp.usaw_meet_results SET best_cj = '120';
    UPDATE pg_temp.iwf_meet_results SET best_cj = '120';
    UPDATE pg_temp.owlcms_meet_results SET best_cj = 120;
    FOR row_data IN
        SELECT gamx_sm, gamx_jm FROM pg_temp.usaw_meet_results
        UNION ALL SELECT gamx_sm, gamx_jm FROM pg_temp.iwf_meet_results
        UNION ALL SELECT gamx_sm, gamx_jm FROM pg_temp.owlcms_meet_results
    LOOP
        IF row_data.gamx_sm IS DISTINCT FROM public.get_gamx_score('sm', 'm', 39, 85.2, 100)
           OR row_data.gamx_jm IS DISTINCT FROM public.get_gamx_score('jm', 'm', 39, 85.2, 120) THEN
            RAISE EXCEPTION 'Masters-lift result update test failed';
        END IF;
    END LOOP;

    UPDATE pg_temp.usaw_meet_results SET best_snatch = '-100';
    UPDATE pg_temp.iwf_meet_results SET best_snatch = '---';
    UPDATE pg_temp.owlcms_meet_results SET best_snatch = -100;
    IF EXISTS (
        SELECT gamx_sm FROM pg_temp.usaw_meet_results WHERE gamx_sm IS NOT NULL
        UNION ALL SELECT gamx_sm FROM pg_temp.iwf_meet_results WHERE gamx_sm IS NOT NULL
        UNION ALL SELECT gamx_sm FROM pg_temp.owlcms_meet_results WHERE gamx_sm IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Invalid snatch test failed';
    END IF;
    UPDATE pg_temp.usaw_meet_results SET gender = NULL;
    UPDATE pg_temp.iwf_meet_results SET body_weight_kg = NULL;
    UPDATE pg_temp.owlcms_meet_results SET competition_age = NULL;
    IF EXISTS (
        SELECT gamx_sm, gamx_jm FROM pg_temp.usaw_meet_results WHERE gamx_sm IS NOT NULL OR gamx_jm IS NOT NULL
        UNION ALL SELECT gamx_sm, gamx_jm FROM pg_temp.iwf_meet_results WHERE gamx_sm IS NOT NULL OR gamx_jm IS NOT NULL
        UNION ALL SELECT gamx_sm, gamx_jm FROM pg_temp.owlcms_meet_results WHERE gamx_sm IS NOT NULL OR gamx_jm IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Missing-input test failed';
    END IF;

    ALTER TABLE pg_temp.usaw_meet_results RENAME TO masters_lift_test_usaw_results;
    ALTER TABLE pg_temp.iwf_meet_results RENAME TO masters_lift_test_iwf_results;
    ALTER TABLE pg_temp.owlcms_meet_results RENAME TO masters_lift_test_owlcms_results;

    SELECT l.db_lifter_id,
           CASE WHEN lower(l.gender) LIKE 'm%' THEN 'F' ELSE 'M' END,
           CASE WHEN l.birth_year = 1980 THEN 1981 ELSE 1980 END
    INTO athlete_id, new_gender, new_birth_year
    FROM public.iwf_lifters l
    WHERE lower(l.gender) IN ('m', 'male', 'f', 'female')
      AND (SELECT count(*) FROM public.iwf_meet_results r WHERE r.db_lifter_id = l.db_lifter_id) = 1
      AND EXISTS (
          SELECT 1 FROM public.iwf_meet_results r
          WHERE r.db_lifter_id = l.db_lifter_id
            AND r.body_weight_kg ~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$'
            AND r.best_snatch ~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$'
            AND r.best_cj ~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$'
            AND (r.gender IS DISTINCT FROM CASE WHEN lower(l.gender) LIKE 'm%' THEN 'F' ELSE 'M' END
              OR r.birth_year IS DISTINCT FROM CASE WHEN l.birth_year = 1980 THEN 1981 ELSE 1980 END)
      )
    ORDER BY l.db_lifter_id
    LIMIT 1
    FOR UPDATE OF l;
    IF athlete_id IS NULL THEN
        RAISE EXCEPTION 'No suitable international athlete with exactly one result was found';
    END IF;
    UPDATE public.iwf_lifters SET gender = new_gender, birth_year = new_birth_year
    WHERE db_lifter_id = athlete_id;
    IF NOT EXISTS (
        SELECT 1 FROM public.iwf_meet_results r WHERE r.db_lifter_id = athlete_id
    ) OR EXISTS (
        SELECT 1 FROM public.iwf_meet_results r
        WHERE r.db_lifter_id = athlete_id
          AND (r.gender IS DISTINCT FROM new_gender OR r.birth_year IS DISTINCT FROM new_birth_year
            OR r.gamx_sm IS DISTINCT FROM public.get_gamx_score(
                'sm', r.gender, r.competition_age, public.text_to_numeric_safe(r.body_weight_kg),
                public.text_to_numeric_safe(r.best_snatch))
            OR r.gamx_jm IS DISTINCT FROM public.get_gamx_score(
                'jm', r.gender, r.competition_age, public.text_to_numeric_safe(r.body_weight_kg),
                public.text_to_numeric_safe(r.best_cj)))
    ) THEN
        RAISE EXCEPTION 'International athlete propagation test failed';
    END IF;
    UPDATE public.iwf_lifters SET gender = NULL, birth_year = NULL WHERE db_lifter_id = athlete_id;
    IF EXISTS (
        SELECT 1 FROM public.iwf_meet_results r WHERE r.db_lifter_id = athlete_id
          AND (r.gender IS DISTINCT FROM new_gender OR r.birth_year IS DISTINCT FROM new_birth_year)
    ) THEN
        RAISE EXCEPTION 'Cleared international profile values changed result demographics';
    END IF;

    athlete_id := NULL;
    SELECT l.lifter_id,
           CASE WHEN lower(l.gender) LIKE 'm%' THEN 'F' ELSE 'M' END,
           CASE WHEN l.birth_year = 1980 THEN 1981 ELSE 1980 END
    INTO athlete_id, new_gender, new_birth_year
    FROM public.owlcms_lifters l
    WHERE lower(l.gender) IN ('m', 'male', 'f', 'female')
      AND (SELECT count(*) FROM public.owlcms_meet_results r WHERE r.lifter_id = l.lifter_id) = 1
      AND EXISTS (
          SELECT 1 FROM public.owlcms_meet_results r
          WHERE r.lifter_id = l.lifter_id
            AND (r.gender IS DISTINCT FROM CASE WHEN lower(l.gender) LIKE 'm%' THEN 'F' ELSE 'M' END
              OR r.birth_year IS DISTINCT FROM CASE WHEN l.birth_year = 1980 THEN 1981 ELSE 1980 END)
      )
    ORDER BY l.lifter_id
    LIMIT 1
    FOR UPDATE OF l;
    IF athlete_id IS NULL THEN
        RAISE EXCEPTION 'No suitable Open Weightlifting Competition Management System athlete with exactly one result was found';
    END IF;
    UPDATE public.owlcms_lifters SET gender = new_gender, birth_year = new_birth_year
    WHERE lifter_id = athlete_id;
    IF NOT EXISTS (
        SELECT 1 FROM public.owlcms_meet_results r WHERE r.lifter_id = athlete_id
    ) OR EXISTS (
        SELECT 1 FROM public.owlcms_meet_results r
        WHERE r.lifter_id = athlete_id
          AND (r.gender IS DISTINCT FROM new_gender OR r.birth_year IS DISTINCT FROM new_birth_year
            OR r.gamx_sm IS DISTINCT FROM public.get_gamx_score(
                'sm', r.gender, r.competition_age, r.body_weight_kg, r.best_snatch)
            OR r.gamx_jm IS DISTINCT FROM public.get_gamx_score(
                'jm', r.gender, r.competition_age, r.body_weight_kg, r.best_cj))
    ) THEN
        RAISE EXCEPTION 'Open Weightlifting Competition Management System athlete propagation test failed';
    END IF;
    UPDATE public.owlcms_lifters SET gender = NULL, birth_year = NULL WHERE lifter_id = athlete_id;
    IF EXISTS (
        SELECT 1 FROM public.owlcms_meet_results r WHERE r.lifter_id = athlete_id
          AND (r.gender IS DISTINCT FROM new_gender OR r.birth_year IS DISTINCT FROM new_birth_year)
    ) THEN
        RAISE EXCEPTION 'Cleared Open Weightlifting Competition Management System profile values changed result demographics';
    END IF;
END $$;

ROLLBACK;
