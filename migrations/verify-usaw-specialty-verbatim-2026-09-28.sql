-- Verification: Verbatim-only fix for USA Weightlifting (USAW) specialty clubs
-- Date: 2026-09-28
-- READ-ONLY. Run manually on the self-hosted instance after applying
-- migrations/fix-usaw-specialty-verbatim-2026-09-28.sql.
-- Each block states EXPECTED. Investigate any row returned by a "must be empty" block.

-- Block 1: Gap rows must be exactly as-written (EXPECTED: 3 rows).
SELECT club_name, community_designation, is_bipoc_owned, is_lgbtqia_owned,
       contact_name, state
FROM public.usaw_clubs
WHERE club_name IN ('Brightside Barbell', 'Blaze Barbell', 'Ablaze Barbell')
ORDER BY club_name;
-- EXPECTED:
--   Ablaze Barbell     | NULL      | false | false | <preserved> | <preserved>
--   Blaze Barbell      | LGBTQIA+  | false | false | Jason Anderson | FL
--   Brightside Barbell | LGBTQIA+  | false | false | C. E. Brooks (or prior) | <existing>

-- Block 2: Blaze/Ablaze conflation must be gone (EXPECTED: empty).
SELECT club_name, community_designation
FROM public.usaw_clubs
WHERE club_name ILIKE '%blaze%'
  AND club_name <> 'Blaze Barbell'
  AND club_name <> 'Ablaze Barbell'
  AND community_designation IS NOT NULL;
-- EXPECTED: 0 rows.

-- Block 3: No flags newly set true by this migration (EXPECTED: empty).
-- Only rows whose designation was already non-null before 2026-09-28 may carry true.
SELECT club_name, community_designation, is_bipoc_owned, is_lgbtqia_owned, updated_at
FROM public.usaw_clubs
WHERE (is_bipoc_owned = true OR is_lgbtqia_owned = true)
  AND updated_at >= timestamptz '2026-09-28 00:00:00+00'
  AND club_name IN ('Brightside Barbell', 'Blaze Barbell', 'Ablaze Barbell');
-- EXPECTED: 0 rows (flags frozen; verbatim designation only).

-- Block 4: Provenance snapshot — all rows carrying a designation (EXPECTED: review list).
-- Compare against the 22-23 live page rows. The 14 remaining extras are
-- intentionally still present; this block is the forensic input for phase 2.
SELECT club_name, community_designation, is_bipoc_owned, is_lgbtqia_owned
FROM public.usaw_clubs
WHERE community_designation IS NOT NULL
ORDER BY club_name;
-- EXPECTED: Brightside + Blaze present verbatim; Ablaze absent;
-- remaining 14 extras still listed (untouched, pending forensic SELECT review).

-- Block 5: Blaze stub completeness for overnight pipeline (EXPECTED: 1 row, geocode pending).
SELECT club_name, address, state, latitude, longitude, wso_geography
FROM public.usaw_clubs
WHERE club_name = 'Blaze Barbell';
-- EXPECTED: address/state set, latitude/longitude/wso_geography NULL (daily
-- geocoder + WSO assigner picks it up overnight; do not hand-geocode).
