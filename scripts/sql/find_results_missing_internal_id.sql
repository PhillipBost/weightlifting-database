-- Find active meet results (Total > 0) where the associated lifter has no internal_id (Sport80 ID)
SELECT
    r.result_id,
    r.lifter_name,
    r.total,
    r.meet_id,
    r.date,
    l.lifter_id,
    l.membership_number
FROM
    usaw_meet_results r
JOIN
    usaw_lifters l ON r.lifter_id = l.lifter_id
WHERE
    (r.total ~ '^[0-9.]+$') -- Ensure it looks like a number
    AND CAST(r.total AS NUMERIC) > 0
    AND l.internal_id IS NULL
ORDER BY
    r.meet_id ASC;
