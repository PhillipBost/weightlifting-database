-- Migration: Clear 14 erroneous specialty designations (2026-09-25 local-run contamination)
-- Date: 2026-09-28
-- Authority: self-hosted instance only. Run manually per project protocol.
-- Rule: as-written/as-found. Live page holds 23 rows; these 14 are absent.
-- Reproduction proof (2026-09-28, old committed script at 833fa8d, --bipoc --dry-run):
--   24 total rows parsed (1 header + 23 data), 21 matched, 2 new stubs
--   (Brave variant + Monument), zero of the 14 produced. The current page cannot
--   generate them, so they were added by mistake in the 2026-09-25 local run.
-- Scope: clear community_designation + freeze deprecated flags ONLY. Contact,
-- email, address, state, instagram preserved (all 14 carry distinct coherent
-- values that duplicate no live row — unlike Ablaze/Jason Anderson). Base rows
-- preserved for the daily Sport80 pipeline. No row deletes. No flags set true.
-- Acronyms: Black, Indigenous, and People of Color (BIPOC);
-- Lesbian, Gay, Bisexual, Transgender, Queer, Intersex, Asexual plus (LGBTQIA+).

UPDATE public.usaw_clubs
SET community_designation = NULL,
    is_bipoc_owned = false,
    is_lgbtqia_owned = false,
    updated_at = now()
WHERE club_name IN (
  'B3 Better Sport Performance',
  'Bearproof Weightlifting Club',
  'Desert Dome Weightlifting',
  'Diamond Fit Weightlifting Club',
  'Golden State Barbell',
  'ISA Barbell Club',
  'Liberation Barbell Club',
  'Liberty Barbell',
  'Olde City Barbell',
  'Olympus Weightlifting and Fitness Center',
  'Set Fire Barbell',
  'Team Kansas City Barbell',
  'Tri Peak Athlete',
  'Urban Power House'
);
