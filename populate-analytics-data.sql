-- SQL Script to Populate Analytics Fields in Existing meet_results Records
-- This script calculates and populates the analytics fields for all existing records
-- Run this after creating the analytics functions

-- First, let's check if the bounce_back columns exist and add them if missing
-- Note: Run these ALTER TABLE statements only if columns don't exist

-- Check if bounce_back columns exist, add them if missing
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

-- Create a temporary function to batch update records
CREATE OR REPLACE FUNCTION batch_update_analytics()
RETURNS VOID AS $$
DECLARE
    batch_size INTEGER := 1000;
    total_records INTEGER;
    batches_processed INTEGER := 0;
    start_time TIMESTAMP;
    current_batch_start BIGINT := 0;
    analytics_result RECORD;
    result_record RECORD;
BEGIN
    start_time := now();
    
    -- Get total record count
    SELECT COUNT(*) INTO total_records FROM meet_results;
    RAISE NOTICE 'Starting analytics population for % records', total_records;
    
    -- Process records in batches
    LOOP
        -- Get batch of records
        FOR result_record IN
            SELECT 
                result_id,
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
            FROM meet_results 
            WHERE result_id > current_batch_start
            ORDER BY result_id
            LIMIT batch_size
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
            
            -- Update the record with calculated analytics
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
            
            current_batch_start := result_record.result_id;
        END LOOP;
        
        batches_processed := batches_processed + 1;
        
        -- Check if we processed any records in this batch
        IF NOT FOUND THEN
            EXIT; -- No more records to process
        END IF;
        
        -- Progress report every 10 batches
        IF batches_processed % 10 = 0 THEN
            RAISE NOTICE 'Processed % batches (approximately % records) in %', 
                batches_processed, 
                batches_processed * batch_size,
                now() - start_time;
        END IF;
        
        -- Commit transaction periodically to avoid long locks
        COMMIT;
    END LOOP;
    
    RAISE NOTICE 'Completed analytics population. Processed % batches in %', 
        batches_processed, 
        now() - start_time;
END;
$$ LANGUAGE plpgsql;

-- Execute the batch update
SELECT batch_update_analytics();

-- Clean up the temporary function
DROP FUNCTION batch_update_analytics();

-- Verify the update by checking sample records
SELECT 
    result_id,
    lifter_id,
    date,
    snatch_successful_attempts,
    cj_successful_attempts,
    total_successful_attempts,
    best_snatch_ytd,
    best_cj_ytd,
    best_total_ytd,
    bounce_back_snatch_2,
    bounce_back_snatch_3,
    bounce_back_cj_2,
    bounce_back_cj_3
FROM meet_results 
WHERE snatch_successful_attempts IS NOT NULL
ORDER BY result_id 
LIMIT 10;

-- Check for any records that weren't updated (analytics fields still NULL)
SELECT COUNT(*) as records_without_analytics
FROM meet_results 
WHERE snatch_successful_attempts IS NULL 
   OR cj_successful_attempts IS NULL 
   OR total_successful_attempts IS NULL;

-- Final completion message
DO $$
BEGIN
    RAISE NOTICE 'Analytics population script completed. Check the verification queries above.';
END $$;