-- Check counts of matched vs unmatched
SELECT COUNT(*) as total_listings,
    COUNT(meet_id) as matched_listings,
    COUNT(*) FILTER (
        WHERE meet_id IS NULL
    ) as unmatched_listings
FROM usaw_meet_listings;
-- Check for past meets that are unmatched (potential missing data)
SELECT meet_name,
    event_date,
    entry_count
FROM usaw_meet_listings
WHERE meet_id IS NULL -- Rough check for past dates (assuming standard format or just checking non-2026 dates?)
    -- Actually, let's just look at the first few.
LIMIT 20;