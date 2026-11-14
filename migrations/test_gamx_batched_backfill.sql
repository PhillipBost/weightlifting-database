-- Owner-run rollback test. This temporarily updates existing results.
-- Before installation, paste the setup migration after this BEGIN, excluding
-- the migration's own BEGIN and COMMIT. Never include COMMIT in this test.
BEGIN;

CREATE TEMP TABLE gamx_backfill_test_report (
    result_table text,
    result_id text,
    batch_report jsonb,
    queue_before jsonb,
    queue_after jsonb,
    meet_before jsonb,
    meet_after jsonb
);

DO $$
DECLARE
    result_table text;
    v_federation text;
    preview jsonb;
    applied jsonb;
    after_id bigint;
    upper_id bigint;
    v_candidate_id bigint;
    v_athlete_id bigint;
    v_meet_id bigint;
    queue_before jsonb;
    queue_after jsonb;
    meet_before jsonb;
    meet_after jsonb;
    attempt integer;
BEGIN
    FOREACH result_table IN ARRAY ARRAY[
        'usaw_meet_results', 'iwf_meet_results', 'owlcms_meet_results'
    ] LOOP
        after_id := NULL;
        upper_id := NULL;
        v_candidate_id := NULL;
        FOR attempt IN 1..10 LOOP
            preview := public.backfill_gamx_scores_batched(result_table, after_id, upper_id, 100, false);
            upper_id := (preview->>'upper_id')::bigint;
            IF (preview->>'candidates')::integer > 0 THEN
                v_candidate_id := (preview->'examples'->0->>'id')::bigint;
                EXIT;
            END IF;
            EXIT WHEN (preview->>'complete')::boolean;
            after_id := (preview->>'last_id')::bigint;
        END LOOP;
        IF v_candidate_id IS NULL OR v_candidate_id = '-9223372036854775808'::bigint THEN
            RAISE EXCEPTION 'No suitable candidate in the first 1000 results of %', result_table;
        END IF;

        v_meet_id := NULL;
        meet_before := NULL;
        meet_after := NULL;
        IF result_table = 'usaw_meet_results' THEN
            v_federation := 'usaw';
            SELECT lifter_id INTO v_athlete_id FROM public.usaw_meet_results WHERE result_id = v_candidate_id;
        ELSIF result_table = 'iwf_meet_results' THEN
            v_federation := 'iwf';
            SELECT db_lifter_id, db_meet_id INTO v_athlete_id, v_meet_id
            FROM public.iwf_meet_results WHERE db_result_id = v_candidate_id;
            SELECT jsonb_build_object('results', m.results, 'updated_at', m.updated_at)
            INTO meet_before FROM public.iwf_meets m WHERE m.db_meet_id = v_meet_id;
        ELSE
            v_federation := 'owlcms';
            SELECT lifter_id INTO v_athlete_id FROM public.owlcms_meet_results WHERE result_id = v_candidate_id;
        END IF;
        SELECT to_jsonb(q) INTO queue_before
        FROM public.athlete_shard_queue q WHERE q.federation = v_federation AND q.entity_id = v_athlete_id;

        applied := public.backfill_gamx_scores_batched(
            result_table, v_candidate_id - 1, v_candidate_id, 1, true
        );
        IF (applied->>'examined')::integer <> 1 OR (applied->>'updated')::integer <> 1 THEN
            RAISE EXCEPTION 'Backfill rollback test did not update candidate % in %', v_candidate_id, result_table;
        END IF;
        SELECT to_jsonb(q) INTO queue_after
        FROM public.athlete_shard_queue q WHERE q.federation = v_federation AND q.entity_id = v_athlete_id;
        IF result_table = 'iwf_meet_results' THEN
            SELECT jsonb_build_object('results', m.results, 'updated_at', m.updated_at)
            INTO meet_after FROM public.iwf_meets m WHERE m.db_meet_id = v_meet_id;
        END IF;
        INSERT INTO pg_temp.gamx_backfill_test_report
        VALUES (result_table, v_candidate_id::text, applied, queue_before, queue_after, meet_before, meet_after);
    END LOOP;

    FOREACH v_candidate_id IN ARRAY ARRAY[143543::bigint, 143745::bigint] LOOP
        SELECT db_lifter_id, db_meet_id INTO v_athlete_id, v_meet_id
        FROM public.iwf_meet_results
        WHERE db_result_id = v_candidate_id AND competition_age >= 30;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Masters test result % is missing or is no longer age 30 or older', v_candidate_id;
        END IF;
        SELECT to_jsonb(q) INTO queue_before
        FROM public.athlete_shard_queue q WHERE q.federation = 'iwf' AND q.entity_id = v_athlete_id;
        SELECT jsonb_build_object('results', m.results, 'updated_at', m.updated_at)
        INTO meet_before FROM public.iwf_meets m WHERE m.db_meet_id = v_meet_id;

        preview := public.backfill_gamx_scores_batched(
            'iwf_meet_results', v_candidate_id - 1, v_candidate_id, 1, false
        );
        IF (preview->>'candidates')::integer <> 1 THEN
            RAISE EXCEPTION 'Masters test result % is not an update candidate: %', v_candidate_id, preview;
        END IF;
        applied := public.backfill_gamx_scores_batched(
            'iwf_meet_results', v_candidate_id - 1, v_candidate_id, 1, true
        );
        IF (applied->>'updated')::integer <> 1 THEN
            RAISE EXCEPTION 'Masters test result % was not updated', v_candidate_id;
        END IF;
        IF v_candidate_id = 143543 THEN
            IF round((applied->'examples'->0->'expected'->>'gamx_sm')::numeric, 2)
                    IS DISTINCT FROM 1614.47::numeric
               OR round((applied->'examples'->0->'expected'->>'gamx_jm')::numeric, 2)
                    IS DISTINCT FROM 1640.55::numeric THEN
                RAISE EXCEPTION 'Masters scores do not match for result %', v_candidate_id;
            END IF;
        ELSIF applied->'examples'->0->'expected'->>'gamx_sm' IS NOT NULL
           OR round((applied->'examples'->0->'expected'->>'gamx_jm')::numeric, 2)
                IS DISTINCT FROM 990.37::numeric THEN
            RAISE EXCEPTION 'Available-lift handling failed for result %', v_candidate_id;
        END IF;

        SELECT to_jsonb(q) INTO queue_after
        FROM public.athlete_shard_queue q WHERE q.federation = 'iwf' AND q.entity_id = v_athlete_id;
        SELECT jsonb_build_object('results', m.results, 'updated_at', m.updated_at)
        INTO meet_after FROM public.iwf_meets m WHERE m.db_meet_id = v_meet_id;
        INSERT INTO pg_temp.gamx_backfill_test_report
        VALUES ('iwf_meet_results', v_candidate_id::text, applied, queue_before, queue_after, meet_before, meet_after);
    END LOOP;
END $$;

SELECT * FROM pg_temp.gamx_backfill_test_report ORDER BY result_table;
ROLLBACK;
