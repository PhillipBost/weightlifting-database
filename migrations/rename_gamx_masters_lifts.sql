-- Review before execution. Run the entire transaction as the database owner.
-- Renames existing factor tables and lookup types without changing factor rows.
BEGIN;

LOCK TABLE public.gamx_ms_factors, public.gamx_mj_factors
    IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    definition text;
BEGIN
    IF to_regclass('public.gamx_sm_factors') IS NOT NULL
       OR to_regclass('public.gamx_jm_factors') IS NOT NULL THEN
        RAISE EXCEPTION 'A destination masters-lift factor table already exists';
    END IF;

    SELECT pg_get_functiondef(
        'public.get_gamx_score(text,text,numeric,numeric,numeric)'::regprocedure
    ) INTO definition;
    IF md5(definition) <> '281108a9c0b46b2372f1a89d5c711671' THEN
        RAISE EXCEPTION 'The deployed GAMX lookup function has changed; review before proceeding';
    END IF;
    IF position('ELSIF p_type = ''ms'' THEN' IN definition) = 0
       OR position('ELSIF p_type = ''mj'' THEN' IN definition) = 0
       OR position('public.gamx_ms_factors' IN definition) = 0
       OR position('public.gamx_mj_factors' IN definition) = 0 THEN
        RAISE EXCEPTION 'Expected masters-lift lookup branches were not found';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.oid <> 'public.get_gamx_score(text,text,numeric,numeric,numeric)'::regprocedure
          AND (
              p.prosrc ~* 'gamx_(ms|mj)_factors'
              OR p.prosrc ~* 'get_gamx_score[[:space:]]*\([[:space:]]*''(ms|mj)'''
          )
    ) THEN
        RAISE EXCEPTION 'Another public routine references the old masters-lift names; review it first';
    END IF;

    IF (SELECT count(*) FROM public.gamx_ms_factors) <> 190627
       OR (SELECT count(*) FROM public.gamx_mj_factors) <> 190627 THEN
        RAISE EXCEPTION 'Masters-lift factor counts do not match the verified tables';
    END IF;
END $$;

ALTER TABLE public.gamx_ms_factors RENAME TO gamx_sm_factors;
ALTER TABLE public.gamx_mj_factors RENAME TO gamx_jm_factors;
ALTER TABLE public.gamx_sm_factors
    RENAME CONSTRAINT gamx_ms_factors_pkey TO gamx_sm_factors_pkey;
ALTER TABLE public.gamx_jm_factors
    RENAME CONSTRAINT gamx_mj_factors_pkey TO gamx_jm_factors_pkey;

DO $$
DECLARE
    definition text;
BEGIN
    SELECT pg_get_functiondef(
        'public.get_gamx_score(text,text,numeric,numeric,numeric)'::regprocedure
    ) INTO definition;
    IF md5(definition) <> '281108a9c0b46b2372f1a89d5c711671' THEN
        RAISE EXCEPTION 'The GAMX lookup function changed during the rename';
    END IF;
    definition := replace(definition, 'ELSIF p_type = ''ms'' THEN', 'ELSIF p_type = ''sm'' THEN');
    definition := replace(definition, 'ELSIF p_type = ''mj'' THEN', 'ELSIF p_type = ''jm'' THEN');
    definition := replace(definition, 'public.gamx_ms_factors', 'public.gamx_sm_factors');
    definition := replace(definition, 'public.gamx_mj_factors', 'public.gamx_jm_factors');
    EXECUTE definition;
END $$;

DO $$
BEGIN
    IF (SELECT count(*) FROM public.gamx_sm_factors) <> 190627
       OR (SELECT count(*) FROM public.gamx_jm_factors) <> 190627
       OR round(public.get_gamx_score('sm', 'm', 40, 85.2, 100), 2)
            IS DISTINCT FROM 930.29::numeric
       OR round(public.get_gamx_score('sm', 'f', 40, 53.5, 60), 2)
            IS DISTINCT FROM 1046.99::numeric
       OR round(public.get_gamx_score('jm', 'm', 40, 85.2, 130), 2)
            IS DISTINCT FROM 968.65::numeric
       OR round(public.get_gamx_score('jm', 'f', 40, 53.5, 80), 2)
            IS DISTINCT FROM 1101.47::numeric
       OR public.get_gamx_score('ms', 'm', 40, 85.2, 100) IS NOT NULL
       OR public.get_gamx_score('mj', 'm', 40, 85.2, 130) IS NOT NULL
    THEN
        RAISE EXCEPTION 'Masters-lift rename verification failed';
    END IF;
END $$;
COMMIT;
