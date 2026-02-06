SELECT meet_name,
    event_date,
    entry_count,
    meet_id as matched_meet_id,
    CASE
        WHEN meet_id IS NULL THEN 'Unmatched'
        ELSE 'Matched'
    END as status
FROM usaw_meet_listings
WHERE entry_count > 0
ORDER BY event_date DESC;