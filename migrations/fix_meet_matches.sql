-- Attempt to match listings to meets by Name and Year
-- This handles cases where precise date string matching failed in the scraper
WITH matches AS (
    SELECT l.listing_id,
        m.meet_id
    FROM usaw_meet_listings l
        JOIN usaw_meets m ON l.meet_name = m."Meet"
    WHERE l.meet_id IS NULL -- Extract year from event_date string (e.g. "January 8th 2022" -> "2022")
        AND substring(
            l.event_date
            from '\d{4}'
        ) = CAST(
            EXTRACT(
                YEAR
                FROM m."Date"
            ) AS TEXT
        )
)
UPDATE usaw_meet_listings l
SET meet_id = matches.meet_id
FROM matches
WHERE l.listing_id = matches.listing_id;
-- Report how many were matched
SELECT COUNT(meet_id) as newly_matched_count
FROM usaw_meet_listings
WHERE meet_id IS NOT NULL;