-- Verification: zero residual inferred flags on designated specialty rows
-- Date: 2026-09-28
-- Authority: self-hosted instance only. Run manually per project protocol.
-- Pairs with: migrations/zero-usaw-specialty-flags-2026-09-28.sql
-- Run AFTER applying that migration. Read-only (SELECT blocks only).
-- Acronyms: Black, Indigenous, and People of Color (BIPOC);
-- Lesbian, Gay, Bisexual, Transgender, Queer, Intersex, Asexual plus (LGBTQIA+).

-- Block 1: Every designated row must read false/false.
-- EXPECTED: 23 rows, bipoc=false, lgbtq=false for all.
SELECT club_name, is_bipoc_owned, is_lgbtqia_owned, community_designation
FROM public.usaw_clubs
WHERE community_designation IS NOT NULL
ORDER BY club_name;

-- Block 2: Zero designated rows may carry any true flag (expect count = 0).
-- EXPECTED: 0
SELECT count(*) AS residual_true_flags
FROM public.usaw_clubs
WHERE community_designation IS NOT NULL
  AND (is_bipoc_owned = true OR is_lgbtqia_owned = true);

-- Block 3: Designations must remain byte-verbatim (23 rows, spot-check verbatim text).
-- EXPECTED: 23
SELECT count(*) AS designated_rows
FROM public.usaw_clubs
WHERE community_designation IS NOT NULL;

-- Block 4: Table-wide diagnostic — any true flag on ANY row (designated or not).
-- EXPECTED: 0. If >0, report the rows: they are orphan flags from the pre-patch
-- inference era on never-designated rows (not caused by this migration) —
-- list them before deciding, do not assume failure.
SELECT club_name, is_bipoc_owned, is_lgbtqia_owned, community_designation
FROM public.usaw_clubs
WHERE is_bipoc_owned = true OR is_lgbtqia_owned = true
ORDER BY club_name;
