-- check_gamx_progress.sql
-- Run this to see the REAL status of the backfill
SELECT 'USAW Results' as table_name,
    count(*) as total_rows,
    count(*) FILTER (
        WHERE gamx_total IS NOT NULL
    ) as completed_success,
    count(*) FILTER (
        WHERE gamx_total IS NULL
            AND updated_at > (NOW() - INTERVAL '12 hours')
    ) as processed_but_null,
    count(*) FILTER (
        WHERE gamx_total IS NULL
            AND (
                updated_at IS NULL
                OR updated_at <= (NOW() - INTERVAL '12 hours')
            )
    ) as remaining_to_process
FROM usaw_meet_results
UNION ALL
SELECT 'IWF Results' as table_name,
    count(*) as total_rows,
    count(*) FILTER (
        WHERE gamx_total IS NOT NULL
    ) as completed_success,
    count(*) FILTER (
        WHERE gamx_total IS NULL
            AND updated_at > (NOW() - INTERVAL '12 hours')
    ) as processed_but_null,
    count(*) FILTER (
        WHERE gamx_total IS NULL
            AND (
                updated_at IS NULL
                OR updated_at <= (NOW() - INTERVAL '12 hours')
            )
    ) as remaining_to_process
FROM iwf_meet_results;