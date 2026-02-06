-- VERIFICATION SCRIPT
-- Run this to see EXACTLY who will be deleted.
-- NO deletions are performed by this script.
SELECT l.lifter_id,
    l.athlete_name,
    l.created_at,
    e.meet_name as source_entry_meet
FROM public.usaw_meet_entries e
    JOIN public.usaw_lifters l ON e.lifter_id = l.lifter_id
WHERE l.created_at > NOW() - INTERVAL '1 hour'
ORDER BY l.created_at DESC;