-- Check current user and permissions
SELECT current_user, session_user;

-- Check table owner
SELECT tableowner
FROM pg_tables
WHERE tablename = 'meet_results';

-- Check what privileges current user has on meet_results
SELECT
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'meet_results'
  AND grantee = current_user;

-- Check if there are any triggers that might be blocking updates
SELECT
    trigger_name,
    event_manipulation,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'meet_results';

-- Try a very simple update on a test column (if you have one)
-- Or just try to update a timestamp
UPDATE meet_results
SET updated_at = updated_at
WHERE result_id = 248876
RETURNING result_id, lifter_name, 'UPDATE SUCCESSFUL' as status;
