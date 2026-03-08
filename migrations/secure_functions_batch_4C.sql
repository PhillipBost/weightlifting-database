-- Secure Functions Batch 4C: Remaining Calculation Functions
-- Signatures Verified by User:
-- calculate_qpoints_from_row(numeric, numeric, text)
-- get_age_factor(integer, text)
-- get_youth_factor_exact(integer, integer, text)
-- calculate_ytd_best(bigint, text, text, text)
BEGIN;
-- 1. Safe to Alter - Pure Math/Logic or Already Qualified:
ALTER FUNCTION public.calculate_qpoints_from_row(numeric, numeric, text)
SET search_path = '';
ALTER FUNCTION public.get_age_factor(integer, text)
SET search_path = '';
ALTER FUNCTION public.get_youth_factor_exact(integer, integer, text)
SET search_path = '';
-- 2. Needs Modification (Bad Table Reference):
--    - calculate_ytd_best was referencing 'meet_results' (does not exist).
--    - Changing to 'public.usaw_meet_results' (Correct table).
CREATE OR REPLACE FUNCTION public.calculate_ytd_best(
        p_lifter_id bigint,
        p_date text,
        p_current_best text,
        p_lift_type text
    ) RETURNS integer LANGUAGE plpgsql
SET search_path TO '' AS $function$
DECLARE competition_year INTEGER;
ytd_best INTEGER := 0;
current_best_val INTEGER;
result_record RECORD;
parsed_date DATE;
BEGIN -- Extract year from date with robust error handling
BEGIN -- Try to parse as date first
parsed_date := p_date::DATE;
competition_year := EXTRACT(
    YEAR
    FROM parsed_date
);
-- Check if year is valid (reasonable range)
IF competition_year < 1900
OR competition_year > 2100 THEN RAISE EXCEPTION 'Invalid year: %',
competition_year;
END IF;
EXCEPTION
WHEN OTHERS THEN -- If date parsing fails, try to extract year from string
BEGIN competition_year := substring(
    p_date
    FROM 1 FOR 4
)::INTEGER;
-- Validate extracted year
IF competition_year < 1900
OR competition_year > 2100 THEN -- Use current year as fallback for invalid dates
competition_year := EXTRACT(
    YEAR
    FROM CURRENT_DATE
);
END IF;
-- Create a fallback date for comparison
parsed_date := (competition_year || '-01-01')::DATE;
EXCEPTION
WHEN OTHERS THEN -- Ultimate fallback: use current year and date
competition_year := EXTRACT(
    YEAR
    FROM CURRENT_DATE
);
parsed_date := CURRENT_DATE;
END;
END;
-- Convert current best to integer
BEGIN current_best_val := p_current_best::INTEGER;
IF current_best_val IS NULL THEN current_best_val := 0;
END IF;
EXCEPTION
WHEN OTHERS THEN current_best_val := 0;
END;
-- Query all results for this lifter in the same year up to this date
-- FIXED: Changed 'meet_results' to 'public.usaw_meet_results'
FOR result_record IN
SELECT best_snatch,
    best_cj,
    total,
    date
FROM public.usaw_meet_results
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
BEGIN -- Get the appropriate lift value based on lift_type
IF p_lift_type = 'snatch' THEN lift_value := result_record.best_snatch::INTEGER;
ELSIF p_lift_type = 'cj' THEN lift_value := result_record.best_cj::INTEGER;
ELSIF p_lift_type = 'total' THEN lift_value := result_record.total::INTEGER;
END IF;
-- Update YTD best if this lift is better
IF lift_value > ytd_best THEN ytd_best := lift_value;
END IF;
EXCEPTION
WHEN OTHERS THEN -- Skip invalid values
END;
END LOOP;
-- Include current competition result
IF current_best_val > ytd_best THEN ytd_best := current_best_val;
END IF;
RETURN ytd_best;
END;
$function$;
COMMIT;