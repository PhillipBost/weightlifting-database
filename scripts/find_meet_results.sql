-- Find 'meet_results' or similar tables/views
-- We suspect 'meet_results' might be 'usaw_meet_results', 'iwf_meet_results', or a View.
SELECT table_schema,
    table_name,
    table_type
FROM information_schema.tables
WHERE table_name LIKE '%meet%';