-- Verification Script for update_updated_at_column
BEGIN;
-- 1. Create a temp table to test the trigger
CREATE TEMP TABLE user_audit_test (
    id serial PRIMARY KEY,
    username text,
    updated_at timestamptz DEFAULT now()
);
-- 2. Attach the trigger
CREATE TRIGGER update_audit_timestamp BEFORE
UPDATE ON user_audit_test FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- 3. Insert a record
INSERT INTO user_audit_test (username, updated_at)
VALUES ('test_user', '2000-01-01 00:00:00+00');
-- 4. Update the record (should trigger update_updated_at_column)
UPDATE user_audit_test
SET username = 'updated_user'
WHERE username = 'test_user';
-- 5. Verify updated_at changed to NOW()
DO $$
DECLARE rec record;
BEGIN
SELECT * INTO rec
FROM user_audit_test
WHERE username = 'updated_user';
IF rec.updated_at <= '2000-01-01 00:00:00+00' THEN RAISE EXCEPTION 'Trigger failed: updated_at was not updated (Value: %)',
rec.updated_at;
END IF;
RAISE NOTICE 'SUCCESS: Trigger updated timestamp correctly to %',
rec.updated_at;
END $$;
ROLLBACK;