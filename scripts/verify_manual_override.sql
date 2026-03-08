-- Verification Script for handle_manual_override
DO $$
DECLARE rec record;
initial_ts timestamptz := '2000-01-01 00:00:00+00';
new_ts timestamptz;
BEGIN -- 1. Create a temp table to test the trigger
CREATE TEMP TABLE IF NOT EXISTS meet_results_test (
    id serial PRIMARY KEY,
    manual_override boolean DEFAULT false,
    some_data text,
    updated_at timestamptz DEFAULT '2000-01-01 00:00:00+00'
);
-- 2. Attach the trigger (drop if exists to be clean)
DROP TRIGGER IF EXISTS check_manual_override ON meet_results_test;
CREATE TRIGGER check_manual_override BEFORE
UPDATE ON meet_results_test FOR EACH ROW EXECUTE FUNCTION public.handle_manual_override();
-- 3. Insert a record
DELETE FROM meet_results_test;
INSERT INTO meet_results_test (manual_override, some_data, updated_at)
VALUES (true, 'initial', initial_ts);
-- 4. CASE: Update with manual_override = TRUE
-- The trigger logic says: IF manual_override=TRUE THEN NEW.updated_at = NOW(); RETURN NEW; END IF;
-- So updated_at SHOULD change.
UPDATE meet_results_test
SET some_data = 'changed'
WHERE manual_override = true;
SELECT updated_at INTO new_ts
FROM meet_results_test
WHERE some_data = 'changed';
IF new_ts <= initial_ts THEN RAISE EXCEPTION 'Trigger failed: updated_at was not updated when manual_override=TRUE. TS: %',
new_ts;
END IF;
RAISE NOTICE 'SUCCESS: Manual override trigger logic is preserved (updated_at changed to %)',
new_ts;
END $$;