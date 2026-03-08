-- Secure Functions Batch 4B: Code Modifications
-- These functions require code changes to support search_path = ''.
-- We fully qualify all function calls and table references.
BEGIN;
--------------------------------------------------------------------------------
-- 1. gamx_erf (Calls other GAMX functions)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gamx_erf(x numeric) RETURNS numeric LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path TO '' AS $function$ BEGIN IF abs(x) < 6.0 THEN RETURN public.gamx_erf_series(x);
ELSE IF x >= 0 THEN RETURN 1.0 - public.gamx_erfc_cf(x);
ELSE RETURN -(1.0 - public.gamx_erfc_cf(abs(x)));
END IF;
END IF;
END;
$function$;
--------------------------------------------------------------------------------
-- 2. gamx_norm_cdf (Calls gamx_erf)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gamx_norm_cdf(x numeric) RETURNS numeric LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path TO '' AS $function$
DECLARE sqrt2 NUMERIC := 1.41421356237309504880;
BEGIN RETURN 0.5 * (1.0 + public.gamx_erf(x / sqrt2));
END;
$function$;
--------------------------------------------------------------------------------
-- 3. calculate_iwf_ytd_bests (Accesses iwf_meet_results)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_iwf_ytd_bests() RETURNS trigger LANGUAGE plpgsql
SET search_path TO '' AS $function$
DECLARE v_year INTEGER;
v_max_snatch INTEGER;
v_max_cj INTEGER;
v_max_total INTEGER;
v_snatch_value INTEGER;
v_cj_value INTEGER;
v_total_value INTEGER;
BEGIN -- Skip calculation if we don't have required fields
IF NEW.db_lifter_id IS NULL
OR NEW.date IS NULL THEN NEW.best_snatch_ytd := NULL;
NEW.best_cj_ytd := NULL;
NEW.best_total_ytd := NULL;
RETURN NEW;
END IF;
-- Extract year from meet date
v_year := EXTRACT(
    YEAR
    FROM NEW.date::DATE
);
-- Initialize with current result values
v_max_snatch := CASE
    WHEN NEW.best_snatch IS NOT NULL
    AND NEW.best_snatch != '---' THEN (NEW.best_snatch::NUMERIC)::INTEGER
    ELSE NULL
END;
v_max_cj := CASE
    WHEN NEW.best_cj IS NOT NULL
    AND NEW.best_cj != '---' THEN (NEW.best_cj::NUMERIC)::INTEGER
    ELSE NULL
END;
v_max_total := CASE
    WHEN NEW.total IS NOT NULL
    AND NEW.total != '---' THEN (NEW.total::NUMERIC)::INTEGER
    ELSE NULL
END;
-- Query ALL results for same lifter in same year UP TO this date
-- We'll find the max including the current result
FOR v_snatch_value,
v_cj_value,
v_total_value IN
SELECT CASE
        WHEN best_snatch IS NOT NULL
        AND best_snatch != '---' THEN (best_snatch::NUMERIC)::INTEGER
        ELSE NULL
    END,
    CASE
        WHEN best_cj IS NOT NULL
        AND best_cj != '---' THEN (best_cj::NUMERIC)::INTEGER
        ELSE NULL
    END,
    CASE
        WHEN total IS NOT NULL
        AND total != '---' THEN (total::NUMERIC)::INTEGER
        ELSE NULL
    END
FROM public.iwf_meet_results -- FIXED: Fully qualified table
WHERE db_lifter_id = NEW.db_lifter_id
    AND EXTRACT(
        YEAR
        FROM date::DATE
    ) = v_year
    AND date <= NEW.date
    AND date IS NOT NULL -- Exclude the current row being inserted/updated
    AND (
        -- On UPDATE: exclude by primary key
        (
            TG_OP = 'UPDATE'
            AND db_result_id != NEW.db_result_id
        ) -- On INSERT: no exclusion needed (NEW row not in table yet)
        OR TG_OP = 'INSERT'
    ) LOOP -- Track maximum snatch
    IF v_snatch_value IS NOT NULL THEN IF v_max_snatch IS NULL
    OR v_snatch_value > v_max_snatch THEN v_max_snatch := v_snatch_value;
END IF;
END IF;
-- Track maximum C&J
IF v_cj_value IS NOT NULL THEN IF v_max_cj IS NULL
OR v_cj_value > v_max_cj THEN v_max_cj := v_cj_value;
END IF;
END IF;
-- Track maximum total
IF v_total_value IS NOT NULL THEN IF v_max_total IS NULL
OR v_total_value > v_max_total THEN v_max_total := v_total_value;
END IF;
END IF;
END LOOP;
-- Set YTD fields (max of current result + previous results)
NEW.best_snatch_ytd := v_max_snatch;
NEW.best_cj_ytd := v_max_cj;
NEW.best_total_ytd := v_max_total;
RETURN NEW;
END;
$function$;
COMMIT;