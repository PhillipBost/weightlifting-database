-- Verify backfill results
SELECT event_date,
    start_date,
    end_date
FROM public.usaw_meet_listings
WHERE start_date IS NOT NULL
LIMIT 20;
-- Check for NULLs remaining (should be low/zero)
SELECT count(*) as null_start_dates
FROM public.usaw_meet_listings
WHERE start_date IS NULL
    AND event_date IS NOT NULL;
-- Check sorting capability
SELECT event_date,
    start_date
FROM public.usaw_meet_listings
WHERE start_date > '2024-01-01'
ORDER BY start_date DESC
LIMIT 10;