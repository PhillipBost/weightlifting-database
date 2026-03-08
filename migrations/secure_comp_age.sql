-- Secure calculate_competition_age
-- Setting search_path = public
DO $$
DECLARE func_rec record;
BEGIN FOR func_rec IN
SELECT pg_proc.oid::regprocedure as func_signature
FROM pg_proc
    JOIN pg_namespace n ON pg_proc.pronamespace = n.oid
WHERE proname = 'calculate_competition_age'
    AND n.nspname = 'public' -- Explicitly target public schema only
    AND prokind = 'f' LOOP EXECUTE 'ALTER FUNCTION ' || func_rec.func_signature || ' SET search_path = public';
END LOOP;
END $$;