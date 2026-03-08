-- Rollback Batch 4C
-- Reverts calculate_ytd_best and resets search_path.
-- Uses verified signatures.
BEGIN;
-- 1. Revert calculate_ytd_best (Remove 'public.' and search_path)
CREATE OR REPLACE FUNCTION public.calculate_ytd_best(
        p_lifter_id bigint,
        p_date text,
        p_current_best text,
        p_lift_type text
    ) RETURNS integer LANGUAGE plpgsql AS $function$
DECLARE competition_year INTEGER;
ytd_best INTEGER := 0;
current_best_val INTEGER;
result_record RECORD;
parsed_date DATE;
BEGIN -- Extract year from date with robust error handling
BEGIN parsed_date := p_date::DATE;
competition_year := EXTRACT(
    YEAR
    FROM parsed_date
);
IF competition_year < 1900
OR competition_year > 2100 THEN RAISE EXCEPTION 'Invalid year: %',
competition_year;
END IF;
EXCEPTION
WHEN OTHERS THEN BEGIN competition_year := substring(
    p_date
    FROM 1 FOR 4
)::INTEGER;
IF competition_year < 1900
OR competition_year > 2100 THEN competition_year := EXTRACT(
    YEAR
    FROM CURRENT_DATE
);
END IF;
parsed_date := (competition_year || '-01-01')::DATE;
EXCEPTION
WHEN OTHERS THEN competition_year := EXTRACT(
    YEAR
    FROM CURRENT_DATE
);
parsed_date := CURRENT_DATE;
END;
END;
BEGIN current_best_val := p_current_best::INTEGER;
IF current_best_val IS NULL THEN current_best_val := 0;
END IF;
EXCEPTION
WHEN OTHERS THEN current_best_val := 0;
END;
-- REVERTED QUERY: FROM meet_results (No public.)
FOR result_record IN
SELECT best_snatch,
    best_cj,
    total,
    date
FROM meet_results
WHERE lifter_id = p_lifter_id
    AND CASE
        WHEN date ~ '^\d{4}-\d{2}-\d{2}$'
        AND date::DATE >= '1900-01-01'
        AND date::DATE <= '2100-12-31' THEN EXTRACT(
            YEAR
            FROM date::DATE
        ) = competition_year
        AND date::DATE <= parsed_date
        WHEN date ~ '^\d{4}' THEN substring(
            date
            FROM 1 FOR 4
        )::INTEGER = competition_year
        ELSE FALSE
    END
ORDER BY CASE
        WHEN date ~ '^\d{4}-\d{2}-\d{2}$'
        AND date::DATE >= '1900-01-01'
        AND date::DATE <= '2100-12-31' THEN date::DATE
        ELSE '1900-01-01'::DATE
    END ASC LOOP
DECLARE lift_value INTEGER;
BEGIN IF p_lift_type = 'snatch' THEN lift_value := result_record.best_snatch::INTEGER;
ELSIF p_lift_type = 'cj' THEN lift_value := result_record.best_cj::INTEGER;
ELSIF p_lift_type = 'total' THEN lift_value := result_record.total::INTEGER;
END IF;
IF lift_value > ytd_best THEN ytd_best := lift_value;
END IF;
END;
END LOOP;
IF current_best_val > ytd_best THEN ytd_best := current_best_val;
END IF;
RETURN ytd_best;
END;
$function$;
-- 2. Reset search_path for safe functions (Default back to user creation default or public)
ALTER FUNCTION public.calculate_qpoints_from_row(numeric, numeric, text) RESET search_path;
ALTER FUNCTION public.get_age_factor(integer, text) RESET search_path;
ALTER FUNCTION public.get_youth_factor_exact(integer, integer, text) RESET search_path;
COMMIT;