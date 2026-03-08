-- Secure ALL update_updated_at_column functions
-- Uses a DO block to iterate over all function OIDs with this name
DO $$
DECLARE func_rec record;
BEGIN FOR func_rec IN
SELECT oid::regprocedure as func_signature
FROM pg_proc
WHERE proname = 'update_updated_at_column'
    AND prokind = 'f' LOOP RAISE NOTICE 'Securing function: %',
    func_rec.func_signature;
EXECUTE 'ALTER FUNCTION ' || func_rec.func_signature || ' SET search_path = public';
END LOOP;
END $$;