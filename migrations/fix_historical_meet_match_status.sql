-- Fix historical meet_match_status on usaw_meet_listings
-- Matches USAW meet listings to the national database usaw_meets by exact Name and Start Date
UPDATE public.usaw_meet_listings l
SET meet_match_status = 'matched',
    meet_id = m.meet_id
FROM public.usaw_meets m
WHERE l.meet_name = m."Meet"
    AND l.start_date = m."Date"
    AND l.meet_match_status = 'unmatched';