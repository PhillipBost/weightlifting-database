CREATE OR REPLACE FUNCTION public.update_iwf_meet_results_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_result_count INTEGER;
    v_meet_id BIGINT;
BEGIN
    -- Use db_meet_id (the actual foreign key) instead of iwf_meet_id
    v_meet_id := COALESCE(NEW.db_meet_id, OLD.db_meet_id);
    
    -- If we don't have a meet ID, return early
    IF v_meet_id IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Count distinct lifters with results for this meet
    SELECT COUNT(DISTINCT db_lifter_id) INTO v_result_count
    FROM iwf_meet_results
    WHERE db_meet_id = v_meet_id;
    
    -- Update the meet's results column with the count
    UPDATE iwf_meets
    SET results = v_result_count,
        updated_at = NOW()
    WHERE db_meet_id = v_meet_id;
    
    RETURN NULL;
END;
$function$
