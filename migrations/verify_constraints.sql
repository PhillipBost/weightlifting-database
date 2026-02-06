-- Verify that the unique indexes exist
SELECT indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'usaw_meet_entries'
    AND indexname LIKE '%unique%';
-- Check columns
SELECT column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'usaw_meet_entries'
    AND column_name IN (
        'event_date',
        'meet_type',
        'meet_address',
        'meet_organizer',
        'contact_phone',
        'contact_email',
        'entries_on_platform',
        'registration_open',
        'registration_close'
    )
ORDER BY column_name;