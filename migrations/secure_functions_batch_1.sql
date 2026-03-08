-- Migration: Secure Function Search Paths (Batch 1 - Low Risk Utilities)
-- Purpose: specific batch to test search_path = '' on simple functions
BEGIN;
-- 1. text_to_numeric_safe (Pure utility)
CREATE OR REPLACE FUNCTION public.text_to_numeric_safe(p_input text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE
SET search_path = '' AS $function$ BEGIN BEGIN RETURN p_input::NUMERIC;
EXCEPTION
WHEN OTHERS THEN RETURN NULL;
END;
END;
$function$;
-- 2. count_successful_attempts (Pure logic)
CREATE OR REPLACE FUNCTION public.count_successful_attempts(lift1 text, lift2 text, lift3 text) RETURNS integer LANGUAGE plpgsql
SET search_path = '' AS $function$
DECLARE count INTEGER := 0;
lift1_val INTEGER;
lift2_val INTEGER;
lift3_val INTEGER;
BEGIN -- Convert text to integer, handle NULL and non-numeric values
BEGIN lift1_val := lift1::INTEGER;
IF lift1_val > 0 THEN count := count + 1;
END IF;
EXCEPTION
WHEN OTHERS THEN -- Skip invalid values
END;
BEGIN lift2_val := lift2::INTEGER;
IF lift2_val > 0 THEN count := count + 1;
END IF;
EXCEPTION
WHEN OTHERS THEN -- Skip invalid values
END;
BEGIN lift3_val := lift3::INTEGER;
IF lift3_val > 0 THEN count := count + 1;
END IF;
EXCEPTION
WHEN OTHERS THEN -- Skip invalid values
END;
RETURN count;
END;
$function$;
-- 3. calculate_bounce_back (Pure logic)
CREATE OR REPLACE FUNCTION public.calculate_bounce_back(prev_lift text, current_lift text) RETURNS boolean LANGUAGE plpgsql
SET search_path = '' AS $function$
DECLARE prev_val INTEGER;
current_val INTEGER;
BEGIN -- Convert lifts to integers
BEGIN prev_val := prev_lift::INTEGER;
EXCEPTION
WHEN OTHERS THEN RETURN FALSE;
-- Can't determine bounce-back without valid previous lift
END;
BEGIN current_val := current_lift::INTEGER;
EXCEPTION
WHEN OTHERS THEN RETURN FALSE;
-- Can't determine bounce-back without valid current lift
END;
-- Bounce-back occurs when previous lift was missed (negative/zero) 
-- and current lift was successful (positive)
RETURN (
    prev_val <= 0
    AND current_val > 0
);
END;
$function$;
COMMIT;