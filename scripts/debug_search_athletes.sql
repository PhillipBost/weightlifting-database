-- Debug Script for search_athletes
-- Checks where the failure occurs: Simple table access, or Extension access.
BEGIN;
-- 1. Create a simplified search function (NO extension, just pure SQL + public table)
CREATE OR REPLACE FUNCTION public.debug_search_simple(search_term text) RETURNS TABLE(lifter_id bigint, athlete_name text) LANGUAGE plpgsql
SET search_path = '' AS $function$ BEGIN RETURN QUERY
SELECT l.lifter_id,
    l.athlete_name::text
FROM public.lifters l
WHERE l.athlete_name ILIKE '%' || search_term || '%'
LIMIT 1;
END;
$function$;
-- 2. Test the simple function
DO $$
DECLARE rec RECORD;
BEGIN
SELECT * INTO rec
FROM public.debug_search_simple('Smith');
RAISE NOTICE 'Simple search (public.lifters) executed successfully. Result: %',
rec;
EXCEPTION
WHEN OTHERS THEN RAISE EXCEPTION 'Simple search FAILED: %',
SQLERRM;
END $$;
-- 3. Create a function that uses the extension (to test extension visibility)
-- ensuring we use the correct schema for similarity
CREATE OR REPLACE FUNCTION public.debug_search_extension(search_term text) RETURNS boolean LANGUAGE plpgsql
SET search_path = '' AS $function$
DECLARE v_sim float;
BEGIN -- Try to call similarity from EXTENSIONS schema
SELECT extensions.similarity('hello', 'hallo') INTO v_sim;
RETURN TRUE;
EXCEPTION
WHEN OTHERS THEN RAISE NOTICE 'Extension search (extensions.similarity) failed: %',
SQLERRM;
RETURN FALSE;
END;
$function$;
-- 4. Test the extension function
DO $$
DECLARE v_success boolean;
BEGIN v_success := public.debug_search_extension('test');
IF v_success THEN RAISE NOTICE 'Extension search (extensions.similarity) executed successfully.';
ELSE RAISE NOTICE 'Extension search FAILED.';
END IF;
END $$;
ROLLBACK;