-- List triggers on iwf_meet_results
SELECT trigger_name,
    event_manipulation,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'iwf_meet_results';