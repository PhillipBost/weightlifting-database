-- 1. Detailed Athlete Comparison
SELECT m."Meet" as meet_name,
    e.first_name || ' ' || e.last_name as athlete,
    e.entry_total,
    CAST(r.total AS NUMERIC) as actual_total,
    (CAST(r.total AS NUMERIC) - e.entry_total) as diff_kg,
    CASE
        WHEN CAST(r.total AS NUMERIC) > e.entry_total THEN 'Exceeded'
        WHEN CAST(r.total AS NUMERIC) = e.entry_total THEN 'Met'
        ELSE 'Below'
    END as status,
    m."Date" as meet_date
FROM usaw_meet_entries e
    JOIN usaw_meet_listings lst ON e.listing_id = lst.listing_id
    JOIN usaw_meets m ON lst.meet_id = m.meet_id
    JOIN usaw_lifters l ON CAST(e.membership_number AS TEXT) = CAST(l.membership_number AS TEXT)
    JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id
    AND m.meet_id = r.meet_id
WHERE e.entry_total > 0
    AND r.total ~ '^[0-9.]+$' -- Ensure valid numeric total string
ORDER BY m."Date" DESC,
    diff_kg DESC;
-- 2. Aggregate Stats per Meet
SELECT m."Meet",
    m."Date",
    COUNT(*) as lifters_compared,
    ROUND(AVG(CAST(r.total AS NUMERIC) - e.entry_total), 2) as avg_diff_kg,
    ROUND(
        (
            SUM(
                CASE
                    WHEN CAST(r.total AS NUMERIC) >= e.entry_total THEN 1
                    ELSE 0
                END
            )::NUMERIC / COUNT(*)
        ) * 100,
        1
    ) as pct_met_entry
FROM usaw_meet_entries e
    JOIN usaw_meet_listings lst ON e.listing_id = lst.listing_id
    JOIN usaw_meets m ON lst.meet_id = m.meet_id
    JOIN usaw_lifters l ON CAST(e.membership_number AS TEXT) = CAST(l.membership_number AS TEXT)
    JOIN usaw_meet_results r ON l.lifter_id = r.lifter_id
    AND m.meet_id = r.meet_id
WHERE e.entry_total > 0
    AND r.total ~ '^[0-9.]+$'
GROUP BY m."Meet",
    m."Date"
HAVING COUNT(*) >= 5
ORDER BY m."Date" DESC;