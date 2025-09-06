-- Simplified SQL Script to Populate Analytics Fields in Existing meet_results Records
-- This version works with Supabase by avoiding transaction control issues

-- First, add missing bounce_back columns if they don't exist
DO $$
BEGIN
    -- Add bounce_back_snatch_2 if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'meet_results' AND column_name = 'bounce_back_snatch_2') THEN
        ALTER TABLE meet_results ADD COLUMN bounce_back_snatch_2 BOOLEAN DEFAULT FALSE;
    END IF;
    
    -- Add bounce_back_snatch_3 if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'meet_results' AND column_name = 'bounce_back_snatch_3') THEN
        ALTER TABLE meet_results ADD COLUMN bounce_back_snatch_3 BOOLEAN DEFAULT FALSE;
    END IF;
    
    -- Add bounce_back_cj_2 if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'meet_results' AND column_name = 'bounce_back_cj_2') THEN
        ALTER TABLE meet_results ADD COLUMN bounce_back_cj_2 BOOLEAN DEFAULT FALSE;
    END IF;
    
    -- Add bounce_back_cj_3 if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'meet_results' AND column_name = 'bounce_back_cj_3') THEN
        ALTER TABLE meet_results ADD COLUMN bounce_back_cj_3 BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Update all records with calculated analytics
-- This will process all records in a single transaction
UPDATE meet_results
SET 
    snatch_successful_attempts = analytics.snatch_successful_attempts,
    cj_successful_attempts = analytics.cj_successful_attempts,
    total_successful_attempts = analytics.total_successful_attempts,
    best_snatch_ytd = analytics.best_snatch_ytd,
    best_cj_ytd = analytics.best_cj_ytd,
    best_total_ytd = analytics.best_total_ytd,
    bounce_back_snatch_2 = analytics.bounce_back_snatch_2,
    bounce_back_snatch_3 = analytics.bounce_back_snatch_3,
    bounce_back_cj_2 = analytics.bounce_back_cj_2,
    bounce_back_cj_3 = analytics.bounce_back_cj_3,
    updated_at = now()
FROM (
    SELECT 
        result_id,
        (calculate_meet_result_analytics(
            lifter_id,
            date,
            snatch_lift_1,
            snatch_lift_2,
            snatch_lift_3,
            best_snatch,
            cj_lift_1,
            cj_lift_2,
            cj_lift_3,
            best_cj,
            total
        )).*
    FROM meet_results
) AS analytics
WHERE meet_results.result_id = analytics.result_id;

-- Verification queries
SELECT 'Analytics Population Results:' as status;

-- Check total record count
SELECT 
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE snatch_successful_attempts IS NOT NULL) as records_with_analytics,
    COUNT(*) FILTER (WHERE snatch_successful_attempts IS NULL) as records_without_analytics
FROM meet_results;

-- Sample of updated records
SELECT 
    result_id,
    lifter_id,
    date,
    snatch_successful_attempts,
    cj_successful_attempts,
    total_successful_attempts,
    best_snatch_ytd,
    best_cj_ytd,
    best_total_ytd
FROM meet_results 
WHERE snatch_successful_attempts IS NOT NULL
ORDER BY result_id 
LIMIT 10;