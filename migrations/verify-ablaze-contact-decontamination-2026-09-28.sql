-- Verification: Ablaze Barbell contact/instagram decontamination
-- Date: 2026-09-28
-- READ-ONLY. Run manually on the self-hosted instance after applying
-- migrations/fix-ablaze-contact-decontamination-2026-09-28.sql.
-- Each block states EXPECTED. Investigate any row returned by a "must be empty" block.

-- Block 1: Ablaze clean, Blaze unchanged (EXPECTED: 2 rows).
SELECT club_name, contact_name, email, instagram, address, state, community_designation
FROM public.usaw_clubs
WHERE club_name IN ('Ablaze Barbell', 'Blaze Barbell')
ORDER BY club_name;
-- EXPECTED:
--   Ablaze Barbell | NULL           | Knight.jcr@gmail.com      | NULL          | 726 Beal Parkway BLG#3, Fort Walton Beach, Florida, ... | Florida | NULL
--   Blaze Barbell  | Jason Anderson | Jason@crossfitblaze.com   | @blazebarbell | 6563 Taylor Rd, Unit 8, Naples, Florida 34109            | FL      | LGBTQIA+

-- Block 2: No shared specialty-provenance values on the wrong row (EXPECTED: empty).
SELECT club_name, contact_name, instagram
FROM public.usaw_clubs
WHERE club_name = 'Ablaze Barbell'
  AND (contact_name = 'Jason Anderson' OR instagram = '@blazebarbell');
-- EXPECTED: 0 rows.

-- Block 3: Genuine Ablaze base data preserved (EXPECTED: 1 row).
SELECT club_name, email, address, state, wso_geography
FROM public.usaw_clubs
WHERE club_name = 'Ablaze Barbell'
  AND email = 'Knight.jcr@gmail.com'
  AND address ILIKE '%Fort Walton Beach%'
  AND state = 'Florida';
-- EXPECTED: 1 row (email/address/state untouched by decontamination).
