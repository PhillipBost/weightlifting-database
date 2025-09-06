-- SQL Functions for Meet Results Analytics Calculations
-- These functions calculate success attempts, YTD bests, and bounce-back metrics

-- Function to count successful attempts from lift values
-- Positive values = successful lifts, negative/NULL = missed lifts
CREATE OR REPLACE FUNCTION count_successful_attempts(lift1 TEXT, lift2 TEXT, lift3 TEXT)
RETURNS INTEGER AS $$
DECLARE
    count INTEGER := 0;
    lift1_val INTEGER;
    lift2_val INTEGER;
    lift3_val INTEGER;
BEGIN
    -- Convert text to integer, handle NULL and non-numeric values
    BEGIN
        lift1_val := lift1::INTEGER;
        IF lift1_val > 0 THEN count := count + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Skip invalid values
    END;
    
    BEGIN
        lift2_val := lift2::INTEGER;
        IF lift2_val > 0 THEN count := count + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Skip invalid values
    END;
    
    BEGIN
        lift3_val := lift3::INTEGER;
        IF lift3_val > 0 THEN count := count + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Skip invalid values
    END;
    
    RETURN count;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate year-to-date best for a specific lift type
-- Returns the best result for this lifter from start of year through this competition date
CREATE OR REPLACE FUNCTION calculate_ytd_best(
    p_lifter_id BIGINT,
    p_date TEXT,
    p_current_best TEXT,
    p_lift_type TEXT -- 'snatch', 'cj', or 'total'
)
RETURNS INTEGER AS $$
DECLARE
    competition_year INTEGER;
    ytd_best INTEGER := 0;
    current_best_val INTEGER;
    result_record RECORD;
    parsed_date DATE;
BEGIN
    -- Extract year from date with robust error handling
    BEGIN
        -- Try to parse as date first
        parsed_date := p_date::DATE;
        competition_year := EXTRACT(YEAR FROM parsed_date);
        
        -- Check if year is valid (reasonable range)
        IF competition_year < 1900 OR competition_year > 2100 THEN
            RAISE EXCEPTION 'Invalid year: %', competition_year;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- If date parsing fails, try to extract year from string
        BEGIN
            competition_year := substring(p_date FROM 1 FOR 4)::INTEGER;
            -- Validate extracted year
            IF competition_year < 1900 OR competition_year > 2100 THEN
                -- Use current year as fallback for invalid dates
                competition_year := EXTRACT(YEAR FROM CURRENT_DATE);
            END IF;
            -- Create a fallback date for comparison
            parsed_date := (competition_year || '-01-01')::DATE;
        EXCEPTION WHEN OTHERS THEN
            -- Ultimate fallback: use current year and date
            competition_year := EXTRACT(YEAR FROM CURRENT_DATE);
            parsed_date := CURRENT_DATE;
        END;
    END;
    
    -- Convert current best to integer
    BEGIN
        current_best_val := p_current_best::INTEGER;
        IF current_best_val IS NULL THEN current_best_val := 0; END IF;
    EXCEPTION WHEN OTHERS THEN
        current_best_val := 0;
    END;
    
    -- Query all results for this lifter in the same year up to this date
    -- Use safe date parsing for comparison
    FOR result_record IN
        SELECT 
            best_snatch,
            best_cj,
            total,
            date
        FROM meet_results 
        WHERE lifter_id = p_lifter_id 
            AND CASE 
                WHEN date ~ '^\d{4}-\d{2}-\d{2}$' AND date::DATE >= '1900-01-01' AND date::DATE <= '2100-12-31'
                THEN EXTRACT(YEAR FROM date::DATE) = competition_year 
                     AND date::DATE <= parsed_date
                WHEN date ~ '^\d{4}'
                THEN substring(date FROM 1 FOR 4)::INTEGER = competition_year
                ELSE FALSE
            END
        ORDER BY 
            CASE 
                WHEN date ~ '^\d{4}-\d{2}-\d{2}$' AND date::DATE >= '1900-01-01' AND date::DATE <= '2100-12-31'
                THEN date::DATE
                ELSE '1900-01-01'::DATE
            END ASC
    LOOP
        DECLARE
            lift_value INTEGER;
        BEGIN
            -- Get the appropriate lift value based on lift_type
            IF p_lift_type = 'snatch' THEN
                lift_value := result_record.best_snatch::INTEGER;
            ELSIF p_lift_type = 'cj' THEN
                lift_value := result_record.best_cj::INTEGER;
            ELSIF p_lift_type = 'total' THEN
                lift_value := result_record.total::INTEGER;
            END IF;
            
            -- Update YTD best if this lift is better
            IF lift_value > ytd_best THEN
                ytd_best := lift_value;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            -- Skip invalid values
        END;
    END LOOP;
    
    -- Include current competition result
    IF current_best_val > ytd_best THEN
        ytd_best := current_best_val;
    END IF;
    
    RETURN ytd_best;
END;
$$ LANGUAGE plpgsql;

-- Function to check bounce-back performance after missed attempts
-- Returns TRUE if lifter successfully made a lift after missing the previous attempt
CREATE OR REPLACE FUNCTION calculate_bounce_back(prev_lift TEXT, current_lift TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    prev_val INTEGER;
    current_val INTEGER;
BEGIN
    -- Convert lifts to integers
    BEGIN
        prev_val := prev_lift::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE; -- Can't determine bounce-back without valid previous lift
    END;
    
    BEGIN
        current_val := current_lift::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE; -- Can't determine bounce-back without valid current lift
    END;
    
    -- Bounce-back occurs when previous lift was missed (negative/zero) 
    -- and current lift was successful (positive)
    RETURN (prev_val <= 0 AND current_val > 0);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate all analytics for a single meet result record
CREATE OR REPLACE FUNCTION calculate_meet_result_analytics(
    p_lifter_id BIGINT,
    p_date TEXT,
    p_snatch_1 TEXT,
    p_snatch_2 TEXT,
    p_snatch_3 TEXT,
    p_best_snatch TEXT,
    p_cj_1 TEXT,
    p_cj_2 TEXT,
    p_cj_3 TEXT,
    p_best_cj TEXT,
    p_total TEXT
)
RETURNS TABLE(
    snatch_successful_attempts INTEGER,
    cj_successful_attempts INTEGER,
    total_successful_attempts INTEGER,
    best_snatch_ytd INTEGER,
    best_cj_ytd INTEGER,
    best_total_ytd INTEGER,
    bounce_back_snatch_2 BOOLEAN,
    bounce_back_snatch_3 BOOLEAN,
    bounce_back_cj_2 BOOLEAN,
    bounce_back_cj_3 BOOLEAN
) AS $$
DECLARE
    snatch_success INTEGER;
    cj_success INTEGER;
    total_success INTEGER;
    snatch_ytd INTEGER;
    cj_ytd INTEGER;
    total_ytd INTEGER;
    bb_snatch_2 BOOLEAN;
    bb_snatch_3 BOOLEAN;
    bb_cj_2 BOOLEAN;
    bb_cj_3 BOOLEAN;
BEGIN
    -- Calculate successful attempts
    snatch_success := count_successful_attempts(p_snatch_1, p_snatch_2, p_snatch_3);
    cj_success := count_successful_attempts(p_cj_1, p_cj_2, p_cj_3);
    total_success := snatch_success + cj_success;
    
    -- Calculate YTD bests
    snatch_ytd := calculate_ytd_best(p_lifter_id, p_date, p_best_snatch, 'snatch');
    cj_ytd := calculate_ytd_best(p_lifter_id, p_date, p_best_cj, 'cj');
    total_ytd := calculate_ytd_best(p_lifter_id, p_date, p_total, 'total');
    
    -- Calculate bounce-backs
    bb_snatch_2 := calculate_bounce_back(p_snatch_1, p_snatch_2);
    bb_snatch_3 := calculate_bounce_back(p_snatch_2, p_snatch_3);
    bb_cj_2 := calculate_bounce_back(p_cj_1, p_cj_2);
    bb_cj_3 := calculate_bounce_back(p_cj_2, p_cj_3);
    
    -- Return all calculated values
    RETURN QUERY SELECT 
        snatch_success,
        cj_success,
        total_success,
        snatch_ytd,
        cj_ytd,
        total_ytd,
        bb_snatch_2,
        bb_snatch_3,
        bb_cj_2,
        bb_cj_3;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions (adjust as needed for your database setup)
GRANT EXECUTE ON FUNCTION count_successful_attempts TO PUBLIC;
GRANT EXECUTE ON FUNCTION calculate_ytd_best TO PUBLIC;
GRANT EXECUTE ON FUNCTION calculate_bounce_back TO PUBLIC;
GRANT EXECUTE ON FUNCTION calculate_meet_result_analytics TO PUBLIC;