SELECT l.meet_name,
    l.event_date,
    COUNT(e.id) as entry_count,
    l.last_scraped_at
FROM usaw_meet_listings l
    LEFT JOIN usaw_meet_entries e ON l.listing_id = e.listing_id
GROUP BY l.listing_id,
    l.meet_name,
    l.event_date,
    l.last_scraped_at
HAVING COUNT(e.id) > 0
ORDER BY entry_count DESC;