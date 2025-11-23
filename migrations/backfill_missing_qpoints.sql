-- Backfill missing Q-points by triggering the update_qpoints_on_change trigger
-- The trigger has been modified to force recalculation when qpoints is NULL

DO $$
DECLARE
    batch_size INTEGER := 1000;
    total_updated INTEGER := 0;
    rows_affected INTEGER;
BEGIN
    RAISE NOTICE 'Starting backfill of missing Q-points...';

    LOOP
        -- Update a batch of records where qpoints is NULL
        -- We update 'updated_at' to current time to fire the trigger
        -- The trigger logic (OLD.qpoints IS NULL) will ensure calculation happens
        WITH batch AS (
            SELECT result_id
            FROM meet_results
            WHERE qpoints IS NULL
            LIMIT batch_size
        )
        UPDATE meet_results
        SET updated_at = NOW()
        WHERE result_id IN (SELECT result_id FROM batch);

        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        total_updated := total_updated + rows_affected;

        RAISE NOTICE 'Updated % rows (Total: %)', rows_affected, total_updated;

        -- Exit when no more rows to update
        IF rows_affected = 0 THEN
            EXIT;
        END IF;
        
        -- Optional: Sleep to prevent locking issues (not strictly necessary for this size but good practice)
        -- PERFORM pg_sleep(0.1); 
    END LOOP;

    RAISE NOTICE 'Backfill complete. Total records updated: %', total_updated;
END $$;
