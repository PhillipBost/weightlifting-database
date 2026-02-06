-- Clear both usaw_meet_listings and usaw_meet_entries for fresh scrape
-- CAUTION: This deletes all data from both tables
BEGIN;
-- Clear entries first (has FK to listings)
TRUNCATE TABLE public.usaw_meet_entries CASCADE;
-- Clear listings
TRUNCATE TABLE public.usaw_meet_listings CASCADE;
COMMIT;
-- Verify tables are empty
SELECT COUNT(*) as entries_count
FROM public.usaw_meet_entries;
SELECT COUNT(*) as listings_count
FROM public.usaw_meet_listings;