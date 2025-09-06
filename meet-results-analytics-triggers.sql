-- Database Triggers for Automatic Analytics Calculation
-- These triggers ensure analytics fields are calculated whenever lift data is inserted or updated

-- Trigger function to calculate and set analytics fields
CREATE OR REPLACE FUNCTION calculate_and_set_analytics()
RETURNS TRIGGER AS $$
DECLARE
    analytics_result RECORD;
BEGIN
    -- Calculate analytics for the new/updated record
    SELECT * INTO analytics_result
    FROM calculate_meet_result_analytics(
        NEW.lifter_id,
        NEW.date,
        NEW.snatch_lift_1,
        NEW.snatch_lift_2,
        NEW.snatch_lift_3,
        NEW.best_snatch,
        NEW.cj_lift_1,
        NEW.cj_lift_2,
        NEW.cj_lift_3,
        NEW.best_cj,
        NEW.total
    );
    
    -- Set the calculated analytics fields
    NEW.snatch_successful_attempts := analytics_result.snatch_successful_attempts;
    NEW.cj_successful_attempts := analytics_result.cj_successful_attempts;
    NEW.total_successful_attempts := analytics_result.total_successful_attempts;
    NEW.best_snatch_ytd := analytics_result.best_snatch_ytd;
    NEW.best_cj_ytd := analytics_result.best_cj_ytd;
    NEW.best_total_ytd := analytics_result.best_total_ytd;
    NEW.bounce_back_snatch_2 := analytics_result.bounce_back_snatch_2;
    NEW.bounce_back_snatch_3 := analytics_result.bounce_back_snatch_3;
    NEW.bounce_back_cj_2 := analytics_result.bounce_back_cj_2;
    NEW.bounce_back_cj_3 := analytics_result.bounce_back_cj_3;
    
    -- Set updated_at timestamp for updates
    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := now();
    END IF;
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail the insert/update
    RAISE WARNING 'Analytics calculation failed for result_id %: %', 
        COALESCE(NEW.result_id, 0), SQLERRM;
    
    -- Return NEW to allow the operation to continue
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for INSERT operations
DROP TRIGGER IF EXISTS meet_results_analytics_insert_trigger ON meet_results;
CREATE TRIGGER meet_results_analytics_insert_trigger
    BEFORE INSERT ON meet_results
    FOR EACH ROW
    EXECUTE FUNCTION calculate_and_set_analytics();

-- Create trigger for UPDATE operations
-- Only trigger when lift-related columns are actually changed
DROP TRIGGER IF EXISTS meet_results_analytics_update_trigger ON meet_results;
CREATE TRIGGER meet_results_analytics_update_trigger
    BEFORE UPDATE OF 
        snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
        cj_lift_1, cj_lift_2, cj_lift_3, best_cj,
        total, lifter_id, date
    ON meet_results
    FOR EACH ROW
    WHEN (
        -- Only trigger if relevant fields actually changed
        OLD.snatch_lift_1 IS DISTINCT FROM NEW.snatch_lift_1 OR
        OLD.snatch_lift_2 IS DISTINCT FROM NEW.snatch_lift_2 OR
        OLD.snatch_lift_3 IS DISTINCT FROM NEW.snatch_lift_3 OR
        OLD.best_snatch IS DISTINCT FROM NEW.best_snatch OR
        OLD.cj_lift_1 IS DISTINCT FROM NEW.cj_lift_1 OR
        OLD.cj_lift_2 IS DISTINCT FROM NEW.cj_lift_2 OR
        OLD.cj_lift_3 IS DISTINCT FROM NEW.cj_lift_3 OR
        OLD.best_cj IS DISTINCT FROM NEW.best_cj OR
        OLD.total IS DISTINCT FROM NEW.total OR
        OLD.lifter_id IS DISTINCT FROM NEW.lifter_id OR
        OLD.date IS DISTINCT FROM NEW.date
    )
    EXECUTE FUNCTION calculate_and_set_analytics();

-- Optional: Create a trigger to handle manual override cases
-- This allows manual setting of analytics fields when manual_override is TRUE
CREATE OR REPLACE FUNCTION handle_manual_override()
RETURNS TRIGGER AS $$
BEGIN
    -- If manual_override is TRUE, skip automatic calculation
    IF NEW.manual_override = TRUE THEN
        -- Still update the updated_at timestamp
        NEW.updated_at := now();
        RETURN NEW;
    END IF;
    
    -- Otherwise, proceed with normal analytics calculation
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create manual override trigger (runs before the analytics trigger)
DROP TRIGGER IF EXISTS meet_results_manual_override_trigger ON meet_results;
CREATE TRIGGER meet_results_manual_override_trigger
    BEFORE INSERT OR UPDATE ON meet_results
    FOR EACH ROW
    WHEN (NEW.manual_override = TRUE)
    EXECUTE FUNCTION handle_manual_override();

-- Function to recalculate analytics for a specific lifter/year combination
-- Useful for manual corrections or data fixes
CREATE OR REPLACE FUNCTION recalculate_lifter_analytics(
    p_lifter_id BIGINT,
    p_year INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    records_updated INTEGER := 0;
    analytics_result RECORD;
    result_record RECORD;
BEGIN
    -- If no year specified, recalculate for all years
    FOR result_record IN
        SELECT 
            result_id,
            lifter_id,
            date,
            snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
            cj_lift_1, cj_lift_2, cj_lift_3, best_cj,
            total
        FROM meet_results 
        WHERE lifter_id = p_lifter_id 
            AND (p_year IS NULL OR EXTRACT(YEAR FROM date::DATE) = p_year)
        ORDER BY date::DATE
    LOOP
        -- Calculate analytics for this record
        SELECT * INTO analytics_result
        FROM calculate_meet_result_analytics(
            result_record.lifter_id,
            result_record.date,
            result_record.snatch_lift_1,
            result_record.snatch_lift_2,
            result_record.snatch_lift_3,
            result_record.best_snatch,
            result_record.cj_lift_1,
            result_record.cj_lift_2,
            result_record.cj_lift_3,
            result_record.best_cj,
            result_record.total
        );
        
        -- Update the record
        UPDATE meet_results
        SET 
            snatch_successful_attempts = analytics_result.snatch_successful_attempts,
            cj_successful_attempts = analytics_result.cj_successful_attempts,
            total_successful_attempts = analytics_result.total_successful_attempts,
            best_snatch_ytd = analytics_result.best_snatch_ytd,
            best_cj_ytd = analytics_result.best_cj_ytd,
            best_total_ytd = analytics_result.best_total_ytd,
            bounce_back_snatch_2 = analytics_result.bounce_back_snatch_2,
            bounce_back_snatch_3 = analytics_result.bounce_back_snatch_3,
            bounce_back_cj_2 = analytics_result.bounce_back_cj_2,
            bounce_back_cj_3 = analytics_result.bounce_back_cj_3,
            updated_at = now()
        WHERE result_id = result_record.result_id;
        
        records_updated := records_updated + 1;
    END LOOP;
    
    RETURN records_updated;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_and_set_analytics TO PUBLIC;
GRANT EXECUTE ON FUNCTION handle_manual_override TO PUBLIC;
GRANT EXECUTE ON FUNCTION recalculate_lifter_analytics TO PUBLIC;

-- Display trigger information
SELECT 
    trigger_name,
    event_manipulation as event,
    action_timing as timing,
    action_statement as action
FROM information_schema.triggers 
WHERE event_object_table = 'meet_results'
    AND trigger_name LIKE '%analytics%'
ORDER BY trigger_name;