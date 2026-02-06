-- Migration: Migrate usaw_meet_entries to use listing_id
-- Step 1: Create listings from existing entries, add listing_id column
BEGIN;
-- Step 1: Create listing for each unique (meet_name, event_date) in usaw_meet_entries
INSERT INTO public.usaw_meet_listings (
        meet_name,
        event_date,
        date_range,
        meet_type,
        address,
        organizer,
        contact_phone,
        contact_email,
        registration_open,
        registration_close,
        entries_on_platform,
        has_entry_list,
        meet_id,
        first_discovered_at,
        last_seen_at
    )
SELECT DISTINCT ON (meet_name, event_date) meet_name,
    event_date,
    -- Keep as TEXT
    NULL as date_range,
    -- Not available in existing data
    meet_type,
    meet_address as address,
    meet_organizer as organizer,
    contact_phone,
    contact_email,
    CASE
        WHEN registration_open ~ '^\d{4}-\d{2}-\d{2}$' THEN registration_open::DATE
        ELSE NULL
    END as registration_open,
    CASE
        WHEN registration_close ~ '^\d{4}-\d{2}-\d{2}$' THEN registration_close::DATE
        ELSE NULL
    END as registration_close,
    entries_on_platform,
    true as has_entry_list,
    -- If entries exist, list was available
    meet_id,
    -- Existing match (could be NULL)
    created_at as first_discovered_at,
    updated_at as last_seen_at
FROM public.usaw_meet_entries
WHERE meet_name IS NOT NULL
    AND event_date IS NOT NULL ON CONFLICT (meet_name, event_date) DO NOTHING;
-- Step 2: Add listing_id column to usaw_meet_entries
ALTER TABLE public.usaw_meet_entries
ADD COLUMN IF NOT EXISTS listing_id INTEGER REFERENCES public.usaw_meet_listings(listing_id) ON DELETE CASCADE;
-- Step 3: Backfill listing_id by matching on (meet_name, event_date)
UPDATE public.usaw_meet_entries e
SET listing_id = l.listing_id
FROM public.usaw_meet_listings l
WHERE e.meet_name = l.meet_name
    AND e.event_date = l.event_date
    AND e.listing_id IS NULL;
-- Step 4: Make listing_id NOT NULL (all entries should now have a listing)
ALTER TABLE public.usaw_meet_entries
ALTER COLUMN listing_id
SET NOT NULL;
-- Step 5: Add index on listing_id for FK performance
CREATE INDEX IF NOT EXISTS idx_meet_entries_listing_id ON public.usaw_meet_entries(listing_id);
-- Step 6: Drop old columns (COMMENTED OUT - uncomment after verification)
-- ALTER TABLE public.usaw_meet_entries DROP COLUMN IF EXISTS meet_id;
-- ALTER TABLE public.usaw_meet_entries DROP COLUMN IF EXISTS meet_match_status;
COMMIT;
-- VERIFICATION QUERIES:
-- Check that all entries have listings:
-- SELECT COUNT(*) as entries_without_listing FROM usaw_meet_entries WHERE listing_id IS NULL;
-- 
-- Check listing distribution:
-- SELECT l.meet_name, l.event_date, l.meet_id, COUNT(e.id) as entry_count
-- FROM usaw_meet_listings l
-- LEFT JOIN usaw_meet_entries e ON l.listing_id = e.listing_id
-- GROUP BY l.listing_id, l.meet_name, l.event_date, l.meet_id
-- ORDER BY entry_count DESC;