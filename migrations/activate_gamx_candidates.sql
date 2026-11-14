-- Review before execution. Run the entire transaction as the database owner.
-- Existing result rows and triggers are not changed.
-- This transaction updates live factors and the live lookup function.
BEGIN;

LOCK TABLE public.gamx_u_factors, public.gamx_points_factors
    IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.gamx_u_factors_candidate, public.gamx_points_factors_candidate,
    public.gamx_ms_factors_candidate, public.gamx_mj_factors_candidate
    IN SHARE MODE;

DO $$
DECLARE
    current_function text;
BEGIN
    SELECT pg_get_functiondef(
        'public.get_gamx_score(text,text,numeric,numeric,numeric)'::regprocedure
    ) INTO current_function;
    IF md5(current_function) <> '1a2903ab5fe0fc4e25db830b215388ef' THEN
        RAISE EXCEPTION 'The deployed GAMX lookup function has changed; review before proceeding';
    END IF;

    IF (SELECT count(*) FROM public.gamx_u_factors) <> 43428
       OR (SELECT count(*) FROM public.gamx_u_factors_candidate) <> 43428
       OR EXISTS (
           SELECT gender, age, bodyweight FROM public.gamx_u_factors
           EXCEPT SELECT gender, age, bodyweight FROM public.gamx_u_factors_candidate
       )
       OR EXISTS (
           SELECT gender, age, bodyweight FROM public.gamx_u_factors_candidate
           EXCEPT SELECT gender, age, bodyweight FROM public.gamx_u_factors
       )
       OR (SELECT count(*) FROM public.gamx_points_factors) <> 3002
       OR (SELECT count(*) FROM public.gamx_points_factors_candidate) <> 3002
       OR EXISTS (
           SELECT gender, bodyweight FROM public.gamx_points_factors
           EXCEPT SELECT gender, bodyweight FROM public.gamx_points_factors_candidate
       )
       OR EXISTS (
           SELECT gender, bodyweight FROM public.gamx_points_factors_candidate
           EXCEPT SELECT gender, bodyweight FROM public.gamx_points_factors
       )
    THEN
        RAISE EXCEPTION 'Live and candidate youth or senior-total factor keys differ';
    END IF;

    IF (SELECT count(*) FROM public.gamx_ms_factors_candidate WHERE gender = 'm') <> 99066
       OR (SELECT count(*) FROM public.gamx_ms_factors_candidate WHERE gender = 'f') <> 91561
       OR (SELECT count(*) FROM public.gamx_mj_factors_candidate WHERE gender = 'm') <> 99066
       OR (SELECT count(*) FROM public.gamx_mj_factors_candidate WHERE gender = 'f') <> 91561
       OR EXISTS (
           SELECT 1 FROM public.gamx_ms_factors_candidate
           WHERE bodyweight < 40 OR bodyweight > 190 OR mod(bodyweight * 10, 1) <> 0
              OR (gender = 'm' AND age NOT BETWEEN 30 AND 95)
              OR (gender = 'f' AND age NOT BETWEEN 30 AND 90)
       )
       OR EXISTS (
           SELECT 1 FROM public.gamx_mj_factors_candidate
           WHERE bodyweight < 40 OR bodyweight > 190 OR mod(bodyweight * 10, 1) <> 0
              OR (gender = 'm' AND age NOT BETWEEN 30 AND 95)
              OR (gender = 'f' AND age NOT BETWEEN 30 AND 90)
       )
    THEN
        RAISE EXCEPTION 'Masters-lift candidate factor grids are incomplete or invalid';
    END IF;
END $$;

-- These copies preserve the prior values and function definition for manual recovery.
CREATE TABLE public.gamx_u_factors_backup_20261113 AS TABLE public.gamx_u_factors;
CREATE TABLE public.gamx_points_factors_backup_20261113 AS TABLE public.gamx_points_factors;
CREATE TABLE public.gamx_lookup_backup_20261113 AS
SELECT pg_get_functiondef(
    'public.get_gamx_score(text,text,numeric,numeric,numeric)'::regprocedure
) AS function_definition;

ALTER TABLE public.gamx_u_factors_backup_20261113 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gamx_points_factors_backup_20261113 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gamx_lookup_backup_20261113 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gamx_u_factors_backup_20261113,
    public.gamx_points_factors_backup_20261113, public.gamx_lookup_backup_20261113
    FROM PUBLIC, anon, authenticated, service_role;

UPDATE public.gamx_u_factors AS live
SET mu = candidate.mu, sigma = candidate.sigma, nu = candidate.nu
FROM public.gamx_u_factors_candidate AS candidate
WHERE live.gender = candidate.gender AND live.age = candidate.age
  AND live.bodyweight = candidate.bodyweight;

UPDATE public.gamx_points_factors AS live
SET mu = candidate.mu, sigma = candidate.sigma, nu = candidate.nu
FROM public.gamx_points_factors_candidate AS candidate
WHERE live.gender = candidate.gender AND live.bodyweight = candidate.bodyweight;

CREATE TABLE public.gamx_ms_factors (
    gender text NOT NULL CHECK (gender IN ('m', 'f')),
    age integer NOT NULL,
    bodyweight numeric NOT NULL,
    mu numeric NOT NULL CHECK (mu > 0),
    sigma numeric NOT NULL CHECK (sigma > 0),
    nu numeric NOT NULL,
    PRIMARY KEY (gender, age, bodyweight)
);
CREATE TABLE public.gamx_mj_factors (
    gender text NOT NULL CHECK (gender IN ('m', 'f')),
    age integer NOT NULL,
    bodyweight numeric NOT NULL,
    mu numeric NOT NULL CHECK (mu > 0),
    sigma numeric NOT NULL CHECK (sigma > 0),
    nu numeric NOT NULL,
    PRIMARY KEY (gender, age, bodyweight)
);
ALTER TABLE public.gamx_ms_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gamx_mj_factors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gamx_ms_factors, public.gamx_mj_factors
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.gamx_ms_factors, public.gamx_mj_factors TO service_role;

INSERT INTO public.gamx_ms_factors (gender, age, bodyweight, mu, sigma, nu)
SELECT gender, age, bodyweight, mu, sigma, nu FROM public.gamx_ms_factors_candidate;
INSERT INTO public.gamx_mj_factors (gender, age, bodyweight, mu, sigma, nu)
SELECT gender, age, bodyweight, mu, sigma, nu FROM public.gamx_mj_factors_candidate;

CREATE OR REPLACE FUNCTION public.get_gamx_score(
    p_type text, p_gender text, p_age numeric, p_bw numeric, p_result numeric
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
    rec record;
    low_bw numeric;
    high_bw numeric;
    fraction numeric;
BEGIN
    IF p_gender IS NULL OR p_bw IS NULL OR p_result IS NULL THEN
        RETURN NULL;
    END IF;
    p_gender := lower(p_gender);
    IF p_gender LIKE 'm%' THEN
        p_gender := 'm';
    ELSIF p_gender LIKE 'f%' OR p_gender LIKE 'w%' THEN
        p_gender := 'f';
    END IF;

    IF p_type IN ('total', 's', 'j') THEN
        IF p_age < 15 OR p_age > 40 THEN
            RETURN NULL;
        END IF;
        low_bw := floor(p_bw * 10) / 10;
        high_bw := ceil(p_bw * 10) / 10;
        fraction := CASE WHEN low_bw = high_bw THEN 0
                         ELSE (p_bw - low_bw) / (high_bw - low_bw) END;
        WITH factors AS (
            SELECT 'total'::text AS kind, gender, bodyweight, mu, sigma, nu
            FROM public.gamx_points_factors
            WHERE p_type = 'total' AND gender = p_gender AND bodyweight IN (low_bw, high_bw)
            UNION ALL
            SELECT 's', gender, bodyweight, mu, sigma, nu
            FROM public.gamx_s_factors
            WHERE p_type = 's' AND gender = p_gender AND bodyweight IN (low_bw, high_bw)
            UNION ALL
            SELECT 'j', gender, bodyweight, mu, sigma, nu
            FROM public.gamx_j_factors
            WHERE p_type = 'j' AND gender = p_gender AND bodyweight IN (low_bw, high_bw)
        )
        SELECT lo.mu + (hi.mu - lo.mu) * fraction AS mu,
               lo.sigma + (hi.sigma - lo.sigma) * fraction AS sigma,
               lo.nu + (hi.nu - lo.nu) * fraction AS nu
        INTO rec
        FROM factors lo
        JOIN factors hi ON hi.kind = lo.kind AND hi.gender = lo.gender
        WHERE lo.bodyweight = low_bw AND hi.bodyweight = high_bw;
    ELSE
        p_bw := round(p_bw, 1);
        IF p_type = 'u' THEN
            IF p_age IS NULL THEN RETURN NULL; END IF;
            SELECT mu, sigma, nu INTO rec FROM public.gamx_u_factors
            WHERE gender = p_gender AND age = p_age::integer AND bodyweight = p_bw;
        ELSIF p_type = 'a' THEN
            SELECT mu, sigma, nu INTO rec FROM public.gamx_a_factors
            WHERE gender = p_gender AND age = p_age::integer AND bodyweight = p_bw;
        ELSIF p_type = 'masters' THEN
            SELECT mu, sigma, nu INTO rec FROM public.gamx_masters_factors
            WHERE gender = p_gender AND age = p_age::integer AND bodyweight = p_bw;
        ELSIF p_type = 'ms' THEN
            SELECT mu, sigma, nu INTO rec FROM public.gamx_ms_factors
            WHERE gender = p_gender AND age = p_age::integer AND bodyweight = p_bw;
        ELSIF p_type = 'mj' THEN
            SELECT mu, sigma, nu INTO rec FROM public.gamx_mj_factors
            WHERE gender = p_gender AND age = p_age::integer AND bodyweight = p_bw;
        ELSE
            RETURN NULL;
        END IF;
    END IF;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN public.calculate_gamx_raw(p_result, rec.mu, rec.sigma, rec.nu);
END;
$function$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.gamx_u_factors live
        JOIN public.gamx_u_factors_candidate candidate USING (gender, age, bodyweight)
        WHERE (live.mu, live.sigma, live.nu) IS DISTINCT FROM
              (candidate.mu, candidate.sigma, candidate.nu)
    ) OR EXISTS (
        SELECT 1 FROM public.gamx_points_factors live
        JOIN public.gamx_points_factors_candidate candidate USING (gender, bodyweight)
        WHERE (live.mu, live.sigma, live.nu) IS DISTINCT FROM
              (candidate.mu, candidate.sigma, candidate.nu)
    ) OR (SELECT count(*) FROM public.gamx_ms_factors) <> 190627
      OR (SELECT count(*) FROM public.gamx_mj_factors) <> 190627
    THEN
        RAISE EXCEPTION 'Activated factor verification failed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('total', 'm', 25::numeric, 94.50::numeric, 415::numeric, 1298.05::numeric),
            ('total', 'f', 25, 68.85, 275, 1319.64),
            ('total', 'f', 25, 127.80, 317, 1260.07),
            ('total', 'm', 25, 69.85, 355, 1277.11),
            ('s', 'm', 25, 85.23, 150, 970.13),
            ('s', 'f', 25, 53.52, 90, 1084.28),
            ('j', 'm', 25, 85.23, 200, 1091.63),
            ('j', 'f', 25, 53.52, 110, 1055.64),
            ('ms', 'm', 40, 85.2, 100, 930.29),
            ('ms', 'f', 40, 53.5, 60, 1046.99),
            ('mj', 'm', 40, 85.2, 130, 968.65),
            ('mj', 'f', 40, 53.5, 80, 1101.47),
            ('u', 'm', 10, 40, 35, 754.51),
            ('u', 'f', 10, 40, 35, 767.82)
        ) AS sample(kind, gender, age, bodyweight, lift, expected)
        WHERE round(public.get_gamx_score(kind, gender, age, bodyweight, lift), 2)
              IS DISTINCT FROM expected
    ) THEN
        RAISE EXCEPTION 'GAMX lookup examples do not match the published scores';
    END IF;

    IF public.get_gamx_score('ms', 'm', 40, 85.25, 100) IS NULL
       OR public.get_gamx_score('ms', 'm', 40, 85.25, 100) IS DISTINCT FROM
          public.get_gamx_score('ms', 'm', 40, 85.3, 100)
       OR public.get_gamx_score('mj', 'f', 40, 53.55, 80) IS NULL
       OR public.get_gamx_score('mj', 'f', 40, 53.55, 80) IS DISTINCT FROM
          public.get_gamx_score('mj', 'f', 40, 53.6, 80)
       OR public.get_gamx_score('u', 'm', 10, 40.04, 35) IS DISTINCT FROM
          public.get_gamx_score('u', 'm', 10, 40, 35)
       OR public.get_gamx_score('total', 'm', 14, 94.5, 415) IS NOT NULL
       OR public.get_gamx_score('total', 'm', 41, 94.5, 415) IS NOT NULL
       OR public.get_gamx_score('total', 'm', 25, 190.01, 415) IS NOT NULL
       OR public.get_gamx_score('ms', 'm', 29, 85.2, 100) IS NOT NULL
    THEN
        RAISE EXCEPTION 'GAMX rounding or supported-range verification failed';
    END IF;
END $$;
COMMIT;
