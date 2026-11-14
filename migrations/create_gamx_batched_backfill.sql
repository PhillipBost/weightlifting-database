-- Owner-run setup. Installing this function does not backfill results.
BEGIN;

CREATE FUNCTION public.backfill_gamx_scores_batched(
    p_table text,
    p_after_id bigint,
    p_upper_id bigint,
    p_batch_size integer,
    p_apply boolean
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id_column text;
    v_upper bigint;
    v_last bigint := p_after_id;
    v_row record;
    v_old jsonb;
    v_after jsonb;
    v_old_scores jsonb;
    v_new_scores jsonb;
    v_after_scores jsonb;
    v_gender text;
    v_age integer;
    v_bodyweight numeric;
    v_total numeric;
    v_snatch numeric;
    v_jerk numeric;
    v_reason text;
    v_key text;
    v_field record;
    v_other_changes jsonb;
    v_changed_fields jsonb := '{}'::jsonb;
    v_skipped jsonb := '[]'::jsonb;
    v_examples jsonb := '[]'::jsonb;
    v_examined integer := 0;
    v_candidates integer := 0;
    v_updated integer := 0;
    v_unchanged integer := 0;
    v_skipped_count integer := 0;
    v_score_keys constant text[] := ARRAY[
        'gamx_u', 'gamx_a', 'gamx_masters', 'gamx_total',
        'gamx_s', 'gamx_j', 'gamx_sm', 'gamx_jm'
    ];
    v_allowed_changes constant text[] := ARRAY[
        'gamx_u', 'gamx_a', 'gamx_masters', 'gamx_total',
        'gamx_s', 'gamx_j', 'gamx_sm', 'gamx_jm',
        'qpoints', 'q_masters', 'q_youth', 'updated_at',
        'best_snatch_ytd', 'best_cj_ytd', 'best_total_ytd',
        'snatch_successful_attempts', 'cj_successful_attempts',
        'total_successful_attempts', 'bounce_back_snatch_2',
        'bounce_back_snatch_3', 'bounce_back_cj_2', 'bounce_back_cj_3'
    ];
BEGIN
    IF p_table = 'usaw_meet_results' OR p_table = 'owlcms_meet_results' THEN
        v_id_column := 'result_id';
    ELSIF p_table = 'iwf_meet_results' THEN
        v_id_column := 'db_result_id';
    ELSE
        RAISE EXCEPTION 'Unsupported result table: %', p_table;
    END IF;
    IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 1000 OR p_apply IS NULL THEN
        RAISE EXCEPTION 'Batch size must be between 1 and 1000 and apply must be specified';
    END IF;
    IF p_after_id IS NOT NULL AND p_upper_id IS NOT NULL AND p_after_id > p_upper_id THEN
        RAISE EXCEPTION 'The restart point cannot exceed the upper boundary';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_class temp_table
        JOIN pg_class public_table ON public_table.relname = temp_table.relname
        JOIN pg_namespace public_schema ON public_schema.oid = public_table.relnamespace
        WHERE temp_table.relnamespace = pg_my_temp_schema()
          AND public_schema.nspname = 'public'
          AND temp_table.relkind IN ('r', 'p', 'v', 'm', 'f')
    ) THEN
        RAISE EXCEPTION 'A temporary relation shadows a public relation; use a clean session';
    END IF;

    v_upper := p_upper_id;
    IF v_upper IS NULL THEN
        EXECUTE format('SELECT max(%I) FROM public.%I', v_id_column, p_table) INTO v_upper;
    END IF;

    FOR v_row IN EXECUTE format(
        'SELECT r.%1$I AS id, to_jsonb(r) AS data
         FROM public.%2$I r
         WHERE ($1::bigint IS NULL OR r.%1$I > $1)
           AND r.%1$I <= $2
         ORDER BY r.%1$I LIMIT $3 %3$s',
        v_id_column, p_table, CASE WHEN p_apply THEN 'FOR UPDATE' ELSE '' END
    ) USING p_after_id, v_upper, p_batch_size
    LOOP
        v_examined := v_examined + 1;
        v_last := v_row.id;
        v_old := v_row.data;
        v_gender := v_old->>'gender';
        v_age := (v_old->>'competition_age')::integer;
        v_bodyweight := public.text_to_numeric_safe(v_old->>'body_weight_kg');
        v_total := public.text_to_numeric_safe(v_old->>'total');
        v_snatch := public.text_to_numeric_safe(v_old->>'best_snatch');
        v_jerk := public.text_to_numeric_safe(v_old->>'best_cj');

        IF v_total::text IN ('NaN', 'Infinity', '-Infinity') THEN v_total := NULL; END IF;
        IF v_snatch::text IN ('NaN', 'Infinity', '-Infinity') THEN v_snatch := NULL; END IF;
        IF v_jerk::text IN ('NaN', 'Infinity', '-Infinity') THEN v_jerk := NULL; END IF;

        v_reason := NULL;
        IF NULLIF(btrim(v_gender), '') IS NULL OR v_age IS NULL
           OR v_bodyweight IS NULL OR v_bodyweight <= 0
           OR v_bodyweight::text IN ('NaN', 'Infinity', '-Infinity') THEN
            v_reason := 'missing or invalid gender, competition age, or body weight';
        END IF;

        v_old_scores := jsonb_build_object(
            'gamx_u', v_old->'gamx_u', 'gamx_a', v_old->'gamx_a',
            'gamx_masters', v_old->'gamx_masters', 'gamx_total', v_old->'gamx_total',
            'gamx_s', v_old->'gamx_s', 'gamx_j', v_old->'gamx_j',
            'gamx_sm', v_old->'gamx_sm', 'gamx_jm', v_old->'gamx_jm'
        );

        IF v_reason IS NULL THEN
            v_new_scores := jsonb_build_object(
                'gamx_u', public.get_gamx_score('u', v_gender, v_age, v_bodyweight, v_total),
                'gamx_a', public.get_gamx_score('a', v_gender, v_age, v_bodyweight, v_total),
                'gamx_masters', public.get_gamx_score('masters', v_gender, v_age, v_bodyweight, v_total),
                'gamx_total', public.get_gamx_score('total', v_gender, v_age, v_bodyweight, v_total),
                'gamx_s', public.get_gamx_score('s', v_gender, v_age, v_bodyweight, v_snatch),
                'gamx_j', public.get_gamx_score('j', v_gender, v_age, v_bodyweight, v_jerk),
                'gamx_sm', public.get_gamx_score('sm', v_gender, v_age, v_bodyweight, v_snatch),
                'gamx_jm', public.get_gamx_score('jm', v_gender, v_age, v_bodyweight, v_jerk)
            );
            FOREACH v_key IN ARRAY v_score_keys LOOP
                IF v_old_scores->>v_key IS NOT NULL AND v_new_scores->>v_key IS NULL THEN
                    v_reason := 'an existing score cannot be recalculated: ' || v_key;
                    EXIT;
                END IF;
            END LOOP;
            IF v_reason IS NULL AND NOT EXISTS (
                SELECT 1 FROM jsonb_each(v_new_scores) score WHERE score.value <> 'null'::jsonb
            ) THEN
                v_reason := 'no scores can be calculated from the available results';
            END IF;
        END IF;

        IF v_reason IS NOT NULL THEN
            v_skipped_count := v_skipped_count + 1;
            v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
                'id', v_row.id::text, 'reason', v_reason
            ));
        ELSIF v_old_scores = v_new_scores THEN
            v_unchanged := v_unchanged + 1;
        ELSE
            v_candidates := v_candidates + 1;
            IF jsonb_array_length(v_examples) < 5 THEN
                v_examples := v_examples || jsonb_build_array(jsonb_build_object(
                    'id', v_row.id::text, 'before', v_old_scores, 'expected', v_new_scores
                ));
            END IF;

            IF p_apply THEN
                EXECUTE format(
                    'UPDATE public.%1$I AS r
                     SET gamx_u = $1, gamx_a = $2, gamx_masters = $3, gamx_total = $4,
                         gamx_s = $5, gamx_j = $6, gamx_sm = $7, gamx_jm = $8
                     WHERE r.%2$I = $9 RETURNING to_jsonb(r)',
                    p_table, v_id_column
                ) INTO v_after USING
                    (v_new_scores->>'gamx_u')::numeric, (v_new_scores->>'gamx_a')::numeric,
                    (v_new_scores->>'gamx_masters')::numeric, (v_new_scores->>'gamx_total')::numeric,
                    (v_new_scores->>'gamx_s')::numeric, (v_new_scores->>'gamx_j')::numeric,
                    (v_new_scores->>'gamx_sm')::numeric, (v_new_scores->>'gamx_jm')::numeric,
                    v_row.id;
                IF v_after IS NULL THEN
                    RAISE EXCEPTION 'Result % in % was not updated; batch rolled back', v_row.id, p_table;
                END IF;
                IF (v_old - v_allowed_changes) IS DISTINCT FROM (v_after - v_allowed_changes) THEN
                    RAISE EXCEPTION 'A trigger changed an unapproved field on result % in %; batch rolled back',
                        v_row.id, p_table;
                END IF;
                v_after_scores := jsonb_build_object(
                    'gamx_u', v_after->'gamx_u', 'gamx_a', v_after->'gamx_a',
                    'gamx_masters', v_after->'gamx_masters', 'gamx_total', v_after->'gamx_total',
                    'gamx_s', v_after->'gamx_s', 'gamx_j', v_after->'gamx_j',
                    'gamx_sm', v_after->'gamx_sm', 'gamx_jm', v_after->'gamx_jm'
                );
                IF v_after_scores IS DISTINCT FROM v_new_scores THEN
                    RAISE EXCEPTION 'A trigger changed the calculated scores on result % in %; batch rolled back',
                        v_row.id, p_table;
                END IF;
                IF v_candidates <= 5 THEN
                    SELECT COALESCE(jsonb_object_agg(
                        field.key, jsonb_build_object('before', field.value, 'after', v_after->field.key)
                    ), '{}'::jsonb)
                    INTO v_other_changes
                    FROM jsonb_each(v_old) field
                    WHERE NOT (field.key = ANY(v_score_keys))
                      AND field.value IS DISTINCT FROM v_after->field.key;
                    v_examples := jsonb_set(
                        v_examples, ARRAY[(jsonb_array_length(v_examples) - 1)::text, 'other_changes'],
                        v_other_changes, true
                    );
                END IF;
                FOR v_field IN SELECT key, value FROM jsonb_each(v_old) LOOP
                    IF v_field.value IS DISTINCT FROM v_after->v_field.key THEN
                        v_changed_fields := jsonb_set(
                            v_changed_fields, ARRAY[v_field.key],
                            to_jsonb(COALESCE((v_changed_fields->>v_field.key)::integer, 0) + 1), true
                        );
                    END IF;
                END LOOP;
                v_updated := v_updated + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'table', p_table, 'mode', CASE WHEN p_apply THEN 'apply' ELSE 'preview' END,
        'upper_id', v_upper::text, 'last_id', v_last::text,
        'examined', v_examined, 'candidates', v_candidates, 'updated', v_updated,
        'unchanged', v_unchanged, 'skipped_count', v_skipped_count, 'skipped', v_skipped,
        'examples', v_examples, 'changed_fields', v_changed_fields,
        'complete', v_upper IS NULL OR v_examined < p_batch_size OR v_last >= v_upper
    );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_gamx_scores_batched(text, bigint, bigint, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_gamx_scores_batched(text, bigint, bigint, integer, boolean) TO service_role;

COMMIT;
