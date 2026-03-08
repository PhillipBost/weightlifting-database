-- Verification Script for update_clubs_analytics_timestamp
DO $$
DECLARE rec record;
initial_ts timestamptz := '2000-01-01 00:00:00+00';
new_ts timestamptz;
BEGIN -- 1. Create a temp table to test the trigger
CREATE TEMP TABLE IF NOT EXISTS clubs_test (
    club_name text PRIMARY KEY,
    recent_meets_count integer DEFAULT 0,
    active_lifters_count integer DEFAULT 0,
    total_participations integer DEFAULT 0,
    analytics_updated_at timestamptz DEFAULT '2000-01-01 00:00:00+00'
);
-- 2. Attach the trigger (drop if exists to be clean)
DROP TRIGGER IF EXISTS update_club_ts ON clubs_test;
CREATE TRIGGER update_club_ts BEFORE
UPDATE ON clubs_test FOR EACH ROW EXECUTE FUNCTION public.update_clubs_analytics_timestamp();
-- 3. Insert a record
DELETE FROM clubs_test;
INSERT INTO clubs_test (
        club_name,
        recent_meets_count,
        analytics_updated_at
    )
VALUES ('Test Club', 10, initial_ts);
-- 4. CASE A: Update unrelated column (should NOT update timestamp)
UPDATE clubs_test
SET club_name = 'Test Club Renamed'
WHERE club_name = 'Test Club';
SELECT analytics_updated_at INTO new_ts
FROM clubs_test
WHERE recent_meets_count = 10;
IF new_ts != initial_ts THEN RAISE EXCEPTION 'Trigger failed: Updated timestamp unexpectedly on unrelated change. TS: %',
new_ts;
END IF;
-- 5. CASE B: Update analytics column (recent_meets_count)
UPDATE clubs_test
SET recent_meets_count = 11
WHERE recent_meets_count = 10;
SELECT analytics_updated_at INTO new_ts
FROM clubs_test
WHERE recent_meets_count = 11;
IF new_ts <= initial_ts THEN RAISE EXCEPTION 'Trigger failed: Did NOT update timestamp on analytics change.';
END IF;
RAISE NOTICE 'SUCCESS: Clubs timestamp updated correctly (Original: %, New: %)',
initial_ts,
new_ts;
END $$;