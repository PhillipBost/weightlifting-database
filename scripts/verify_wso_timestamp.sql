-- Verification Script for update_wso_analytics_updated_at
DO $$
DECLARE rec record;
initial_ts timestamptz := '2000-01-01 00:00:00+00';
new_ts timestamptz;
BEGIN -- 1. Create a temp table to test the trigger
CREATE TEMP TABLE IF NOT EXISTS wso_info_test (
    name text PRIMARY KEY,
    barbell_clubs_count integer DEFAULT 0,
    recent_meets_count integer DEFAULT 0,
    active_lifters_count integer DEFAULT 0,
    estimated_population bigint DEFAULT 0,
    total_participations integer DEFAULT 0,
    analytics_updated_at timestamptz DEFAULT '2000-01-01 00:00:00+00'
);
-- 2. Attach the trigger (drop if exists to be clean)
DROP TRIGGER IF EXISTS update_wso_ts ON wso_info_test;
CREATE TRIGGER update_wso_ts BEFORE
UPDATE ON wso_info_test FOR EACH ROW EXECUTE FUNCTION public.update_wso_analytics_updated_at();
-- 3. Insert a record
DELETE FROM wso_info_test;
INSERT INTO wso_info_test (name, active_lifters_count, analytics_updated_at)
VALUES ('Test WSO', 100, initial_ts);
-- 4. CASE A: Update unrelated column (should NOT update timestamp)
-- Just "touch" the row without changing analytics columns
UPDATE wso_info_test
SET name = 'Test WSO'
WHERE name = 'Test WSO';
SELECT analytics_updated_at INTO new_ts
FROM wso_info_test
WHERE active_lifters_count = 100;
IF new_ts != initial_ts THEN RAISE EXCEPTION 'Trigger failed: Updated timestamp unexpectedly on unrelated change. TS: %',
new_ts;
END IF;
-- 5. CASE B: Update analytics column (active_lifters_count)
UPDATE wso_info_test
SET active_lifters_count = 101
WHERE active_lifters_count = 100;
SELECT analytics_updated_at INTO new_ts
FROM wso_info_test
WHERE active_lifters_count = 101;
IF new_ts <= initial_ts THEN RAISE EXCEPTION 'Trigger failed: Did NOT update timestamp on analytics change.';
END IF;
RAISE NOTICE 'SUCCESS: WSO timestamp updated correctly (Original: %, New: %)',
initial_ts,
new_ts;
END $$;