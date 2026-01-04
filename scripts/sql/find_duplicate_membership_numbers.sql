-- Find duplicates based on membership_number WHERE NAMES DIFFER
-- This helps identify potential name changes (e.g., Marriage)
-- Filters out cases where the same name appears multiple times (duplicates)

SELECT 
    m.membership_number,
    COUNT(*) as count,
    STRING_AGG(l.athlete_name, ' | ') as names,
    STRING_AGG(l.lifter_id::text, ' | ') as lifter_ids,
    STRING_AGG(l.internal_id::text, ' | ') as internal_ids
FROM 
    usaw_lifters l
    JOIN (
        SELECT membership_number
        FROM usaw_lifters
        WHERE membership_number IS NOT NULL
        GROUP BY membership_number
        HAVING COUNT(DISTINCT athlete_name) > 1
    ) m ON l.membership_number = m.membership_number
GROUP BY 
    m.membership_number
ORDER BY 
    count DESC;
