-- COMPREHENSIVE VERIFICATION SCRIPT
-- Run this to check the current state of usaw_meet_entries
-- 1. Check if table exists
SELECT EXISTS (
        SELECT
        FROM information_schema.tables
        WHERE table_schema = 'public'
            AND table_name = 'usaw_meet_entries'
    ) as table_exists;
-- 2. List ALL columns in the table
SELECT column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'usaw_meet_entries'
    AND table_schema = 'public'
ORDER BY ordinal_position;
-- 3. Count rows
SELECT COUNT(*) as total_rows
FROM public.usaw_meet_entries;
-- 4. Show first 3 rows (if any)
SELECT id,
    meet_name,
    event_date,
    membership_number,
    first_name,
    last_name,
    meet_type,
    meet_address
FROM public.usaw_meet_entries
LIMIT 3;
-- 5. Check indexes
SELECT indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'usaw_meet_entries'
    AND schemaname = 'public'
ORDER BY indexname;