-- Debug Script Variant
-- Testing if search_path = 'public' allows the function to work.
BEGIN;
CREATE OR REPLACE FUNCTION public.debug_search_public_path(search_term text) RETURNS TABLE(lifter_id bigint, athlete_name text) LANGUAGE plpgsql
SET search_path = 'public' AS $function$ BEGIN RETURN QUERY
SELECT l.lifter_id,
    l.athlete_name::text
FROM public.lifters l
WHERE l.athlete_name ILIKE '%' || search_term || '%'
LIMIT 1;
END;
$function$;
DO $$
DECLARE rec RECORD;
BEGIN -- This should work if the table is truly in public
SELECT * INTO rec
FROM public.debug_search_public_path('Smith');
RAISE NOTICE 'Search with search_path=public SUCCEEDED.';
EXCEPTION
WHEN OTHERS THEN RAISE EXCEPTION 'Search with search_path=public FAILED: %',
SQLERRM;
END $$;
ROLLBACK;