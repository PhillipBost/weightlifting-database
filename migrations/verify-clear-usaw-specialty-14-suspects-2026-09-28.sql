-- Verification: 14 erroneous specialty designations cleared
-- Date: 2026-09-28
-- READ-ONLY. Run manually on the self-hosted instance after applying
-- migrations/clear-usaw-specialty-14-suspects-2026-09-28.sql.
-- Each block states EXPECTED. Investigate any row returned by a "must be empty" block.

-- Block 1: All 14 cleared (EXPECTED: 14 rows, all NULL/false).
SELECT club_name, community_designation, is_bipoc_owned, is_lgbtqia_owned
FROM public.usaw_clubs
WHERE club_name IN (
  'B3 Better Sport Performance', 'Bearproof Weightlifting Club',
  'Desert Dome Weightlifting', 'Diamond Fit Weightlifting Club',
  'Golden State Barbell', 'ISA Barbell Club', 'Liberation Barbell Club',
  'Liberty Barbell', 'Olde City Barbell', 'Olympus Weightlifting and Fitness Center',
  'Set Fire Barbell', 'Team Kansas City Barbell', 'Tri Peak Athlete', 'Urban Power House'
)
ORDER BY club_name;
-- EXPECTED: 14 rows, every community_designation NULL, both flags false.

-- Block 2: No designation survives on the 14 (EXPECTED: empty).
SELECT club_name, community_designation
FROM public.usaw_clubs
WHERE club_name IN (
  'B3 Better Sport Performance', 'Bearproof Weightlifting Club',
  'Desert Dome Weightlifting', 'Diamond Fit Weightlifting Club',
  'Golden State Barbell', 'ISA Barbell Club', 'Liberation Barbell Club',
  'Liberty Barbell', 'Olde City Barbell', 'Olympus Weightlifting and Fitness Center',
  'Set Fire Barbell', 'Team Kansas City Barbell', 'Tri Peak Athlete', 'Urban Power House'
)
AND community_designation IS NOT NULL;
-- EXPECTED: 0 rows.

-- Block 3: Base data preserved on the 14 (EXPECTED: 14 rows, contacts intact).
SELECT club_name, contact_name, email, address, state, instagram
FROM public.usaw_clubs
WHERE club_name IN (
  'B3 Better Sport Performance', 'Bearproof Weightlifting Club',
  'Desert Dome Weightlifting', 'Diamond Fit Weightlifting Club',
  'Golden State Barbell', 'ISA Barbell Club', 'Liberation Barbell Club',
  'Liberty Barbell', 'Olde City Barbell', 'Olympus Weightlifting and Fitness Center',
  'Set Fire Barbell', 'Team Kansas City Barbell', 'Tri Peak Athlete', 'Urban Power House'
)
ORDER BY club_name;
-- EXPECTED: 14 rows; contact/email/address/state/instagram unchanged
-- (e.g. Desert Dome still 'United Arab Emirates'/null for pipeline review,
-- ISA still Hillary Herring, Liberation/Liberty distinct contacts).

-- Block 4: Live-matched rows untouched (EXPECTED: 22 rows incl. Blaze/Brightside,
-- Monument still absent until pipeline test inserts it).
SELECT count(*) AS designated_count
FROM public.usaw_clubs
WHERE community_designation IS NOT NULL;
-- EXPECTED: 22 (23 live minus Monument not yet inserted).
